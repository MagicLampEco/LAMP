// 33_drip_pot.ts — két drip cho đợt ETD trên mạng thử: LAMP nhả theo lịch THẲNG vào địa chỉ đích
// của từng người (ví khoá, hoặc két `did_payment` của PhoenixKey), không cần người nhận ký.
// Hợp đồng: `Distribution/drip-pot/CONTRACT.md` v0.2. Phần thuần: `Distribution/offchain/src/dripPot.ts`.
//
// Khác `32_etd_claim.ts` (tài khoản `claim_account`): ở đó LAMP chỉ về `VerificationKey(owner)` và
// owner phải ký, nên đích không thể là một script như `did_payment`.
//
// Bước:
//   STEP=address  in địa chỉ + hash + datum Reserve — đưa vào `fund_pot.ts` (POT_ID=early-tiger-deleg).
//   STEP=status   liệt kê Reserve + tài khoản, lượng đến hạn ở cửa sổ hiện tại.
//   STEP=seed     GRANTS_FILE (etd-grants/1) — committee mở tài khoản từ Reserve, BATCH mỗi giao dịch.
//                 START_EPOCH mặc định = cửa sổ hiện tại (cửa sổ đầu tiên được tính, CONTRACT §3).
//   STEP=claim    rút phần đến hạn của MỌI tài khoản (hoặc VAULT=<địa chỉ>), mỗi tài khoản một giao
//                 dịch (DP-CLAIM-1). Ví vận hành chỉ trả phí — không chữ ký nào của người nhận.
// SUBMIT=false (mặc định): dựng, không ký, không gửi.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Constr, Data, applyParamsToScript, validatorToAddress, validatorToScriptHash, toUnit,
  type LucidEvolution, type UTxO, type Validator,
} from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import { rehydrate, MS_PER_EPOCH } from "./_canonical_v2.js";
import { canonicalWindowOrigin } from "./_epochWindow.js";
import { parseEtdGrants, type EtdNetwork } from "./_etdGrants.js";
import {
  DRIP_ACCOUNT_TOKEN_NAME, DRIP_RESERVE_DATUM_CBOR, DRIP_SPEND, DRIP_MINT,
  dripParamList, encodeAccountDatum, decodeDripDatum, dripClaimable, dripTagDatum, dataToAddress,
  vaultKey, epochAt,
} from "../../Distribution/offchain/src/dripPot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STEP = (process.env.STEP ?? "").toLowerCase();
const CAMPAIGN = "early-tiger-deleg";
const VEST_EPOCHS = BigInt(process.env.VEST_EPOCHS ?? "36");
const BATCH = Number(process.env.BATCH ?? "15");
const ACCOUNT_LOVELACE = 2_500_000n;
const VAULT_LOVELACE = 1_600_000n;
const RESERVE_LOVELACE = 2_000_000n;

const redeemer = (i: number) => Data.to(new Constr(i, []));

async function dripScript(lampPolicy: string, lampName: string, pkh: string): Promise<Validator> {
  const p = resolve(__dirname, "../../Distribution/drip-pot/onchain/plutus.json");
  const vs = (JSON.parse(readFileSync(p, "utf8")) as {
    validators: { title: string; compiledCode: string; parameters?: unknown[] }[];
  }).validators;
  const v = vs.find((x) => x.title === "drip_pot.drip_pot.spend");
  if (!v) throw new Error(`DRIP-BP-001: không thấy 'drip_pot.drip_pot.spend' trong ${p} — chạy 'aiken build'.`);
  const params = dripParamList({
    campaignIdHex: Buffer.from(CAMPAIGN, "utf8").toString("hex"),
    lampPolicy, lampName, committee: [pkh], threshold: 1n,
    msPerEpoch: MS_PER_EPOCH, windowOriginMs: canonicalWindowOrigin(NETWORK), vestEpochs: VEST_EPOCHS,
  });
  if (v.parameters?.length !== params.length) {
    throw new Error(`DRIP-BP-002: blueprint khai ${v.parameters?.length} tham số, truyền ${params.length}.`);
  }
  return { type: "PlutusV3", script: applyParamsToScript(v.compiledCode, params as never) };
}

interface AccountUtxo {
  utxo: UTxO;
  vault: string;
  entitlement: bigint;
  claimed: bigint;
  startEpoch: bigint;
}

function classify(utxos: UTxO[], tokenUnit: string): { reserves: UTxO[]; accounts: AccountUtxo[]; stray: UTxO[] } {
  const reserves: UTxO[] = [], accounts: AccountUtxo[] = [], stray: UTxO[] = [];
  for (const u of utxos) {
    if (!u.datum) { stray.push(u); continue; }
    let d;
    try { d = decodeDripDatum(u.datum); } catch { stray.push(u); continue; }
    const hasToken = (u.assets[tokenUnit] ?? 0n) === 1n;
    if (d === null && !hasToken) reserves.push(u);
    else if (d !== null && hasToken) {
      accounts.push({ utxo: u, vault: dataToAddress(NETWORK, d.vaultData), entitlement: d.entitlement,
        claimed: d.claimed, startEpoch: d.startEpoch });
    } else stray.push(u);
  }
  return { reserves, accounts, stray };
}

async function submitAndWait(lucid: LucidEvolution, signed: { submit(): Promise<string> }, label: string): Promise<string> {
  // Mọi chỗ gọi đã rẽ nhánh SUBMIT=false trước; cổng này đứng ngay trước lời gửi
  // (`Genesis/tests/submitGate.test.ts`).
  if (!SUBMIT) throw new Error(`DRIP-SUBMIT-001: ${label} — SUBMIT=false nhưng đã tới bước gửi.`);
  const hash = await signed.submit();
  console.log(`📤 ${label}: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  return hash;
}

const fmt = (o: bigint) => (Number(o) / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 6 });

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: két drip v0.2 chưa audit cho Mainnet.");
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  const lampPolicy = wiring.lampUnit.slice(0, 56), lampName = wiring.lampUnit.slice(56);
  const script = await dripScript(lampPolicy, lampName, pkh);
  const hash = validatorToScriptHash(script);
  const addr = validatorToAddress(NETWORK, script);
  const tokenUnit = toUnit(hash, DRIP_ACCOUNT_TOKEN_NAME);
  const origin = canonicalWindowOrigin(NETWORK);
  const nowMs = BigInt(Date.now());
  const epoch = epochAt(nowMs, origin, MS_PER_EPOCH);

  console.log(`═══ Két drip (${NETWORK}) · STEP=${STEP} · cửa sổ ${epoch} · N=${VEST_EPOCHS} ═══`);
  if (STEP === "address") {
    console.log(`POT_ID=${CAMPAIGN}\nPOT_ADDRESS=${addr}\nPOT_SCRIPT_HASH=${hash}\nPOT_DATUM_CBOR=${DRIP_RESERVE_DATUM_CBOR}`);
    return;
  }

  const { reserves, accounts, stray } = classify(await lucid.utxosAt(addr), tokenUnit);
  const lampOf = (u: UTxO) => u.assets[wiring.lampUnit] ?? 0n;
  const reserveLamp = reserves.reduce((s, u) => s + lampOf(u), 0n);

  if (STEP === "status") {
    const due = accounts.reduce((s, a) => s + (dripClaimable(a, epoch, VEST_EPOCHS) > 0n ? dripClaimable(a, epoch, VEST_EPOCHS) : 0n), 0n);
    console.log(`Reserve : ${reserves.length} UTxO · ${fmt(reserveLamp)} LAMP`);
    console.log(`Tài khoản: ${accounts.length} · tổng E ${fmt(accounts.reduce((s, a) => s + a.entitlement, 0n))} · ` +
      `đã nhả ${fmt(accounts.reduce((s, a) => s + a.claimed, 0n))} · đến hạn ngay ${fmt(due)} LAMP`);
    if (stray.length) console.log(`⚠ ${stray.length} UTxO lạ ở địa chỉ két (không Reserve, không tài khoản có token).`);
    return;
  }

  if (STEP === "seed") {
    const file = process.env.GRANTS_FILE ?? "";
    if (!file) throw new Error("DRIP-SEED-001: đặt GRANTS_FILE.");
    const grants = parseEtdGrants(JSON.parse(readFileSync(file, "utf8")), NETWORK as EtdNetwork);
    const startEpoch = BigInt(process.env.START_EPOCH ?? String(epoch));
    if (startEpoch < epoch) throw new Error(`DRIP-SEED-002: START_EPOCH ${startEpoch} < cửa sổ hiện tại ${epoch} (DP-MINT-4).`);
    const have = new Map(accounts.map((a) => [vaultKey(a.vault), a]));
    const todo = grants.filter((g) => {
      const a = have.get(vaultKey(g.paymentAddress));
      if (!a) return true;
      if (a.entitlement !== g.entitlementOildrop) {
        throw new Error(`DRIP-SEED-003: ${g.paymentAddress} đã có tài khoản E=${a.entitlement}, danh sách ghi ${g.entitlementOildrop}.`);
      }
      return false;
    });
    const need = todo.reduce((s, g) => s + g.entitlementOildrop, 0n);
    console.log(`Danh sách ${grants.length} · đã mở ${grants.length - todo.length} · cần mở ${todo.length} (${fmt(need)} LAMP) · ` +
      `Reserve ${fmt(reserveLamp)} LAMP · start_epoch ${startEpoch}`);
    if (need > reserveLamp) throw new Error(`DRIP-SEED-004: Reserve thiếu ${fmt(need - reserveLamp)} LAMP — rót qua fund_pot.ts trước.`);
    let pool = reserves;
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const sum = batch.reduce((s, g) => s + g.entitlementOildrop, 0n);
      const picked: UTxO[] = [];
      let got = 0n;
      for (const u of [...pool].sort((a, b) => Number(lampOf(b) - lampOf(a)))) {
        if (got >= sum) break;
        picked.push(u); got += lampOf(u);
      }
      const now = Date.now();
      const epochEnd = Number(origin + (epoch + 1n) * MS_PER_EPOCH) - 1;
      let tx = lucid.newTx()
        .collectFrom(picked, redeemer(DRIP_SPEND.Seed))
        .attach.SpendingValidator(script)
        .mintAssets({ [tokenUnit]: BigInt(batch.length) }, redeemer(DRIP_MINT.MintAccounts))
        .attach.MintingPolicy(script);
      for (const g of batch) {
        tx = tx.pay.ToContract(addr, { kind: "inline", value: encodeAccountDatum({
          vault: g.paymentAddress, entitlement: g.entitlementOildrop, claimed: 0n, startEpoch,
        }) }, { lovelace: ACCOUNT_LOVELACE, [wiring.lampUnit]: g.entitlementOildrop, [tokenUnit]: 1n });
      }
      if (got > sum) {
        tx = tx.pay.ToContract(addr, { kind: "inline", value: DRIP_RESERVE_DATUM_CBOR },
          { lovelace: RESERVE_LOVELACE, [wiring.lampUnit]: got - sum });
      }
      const built = await tx.addSignerKey(pkh).validFrom(now - 60_000)
        .validTo(Math.min(now + 30 * 60_000, epochEnd)).complete();
      console.log(`Lô ${i / BATCH + 1}: ${batch.length} tài khoản · ${fmt(sum)} LAMP · ${picked.length} Reserve vào · dư ${fmt(got - sum)}`);
      if (!SUBMIT) { console.log(`(SUBMIT=false) hash thân ${built.toHash()}`); return; }
      const signed = await built.sign.withWallet().complete();
      await submitAndWait(lucid, signed, `mở lô ${i / BATCH + 1}`);
      // Chỉ mục trễ sau `awaitTx`: đọc lại ngay thì còn thấy Reserve vừa tiêu (đo 2026-10-04: lô 2
      // dựng trên Reserve đã chi, mempool từ chối "All inputs are spent"). Chờ tới khi nó biến mất.
      const spent = new Set(picked.map((u) => `${u.txHash}#${u.outputIndex}`));
      for (let t = 0; ; t++) {
        pool = classify(await lucid.utxosAt(addr), tokenUnit).reserves;
        if (!pool.some((u) => spent.has(`${u.txHash}#${u.outputIndex}`)) && (got === sum || pool.length > 0)) break;
        if (t >= 30) throw new Error("DRIP-SEED-005: sau 5 phút chỉ mục vẫn còn Reserve đã tiêu — không đo được, dừng.");
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
    return;
  }

  if (STEP === "claim") {
    const only = (process.env.VAULT ?? "").trim();
    const due = accounts
      .filter((a) => !only || a.vault === only)
      .map((a) => ({ a, amount: dripClaimable(a, epoch, VEST_EPOCHS) }))
      .filter((x) => x.amount > 0n);
    console.log(`${due.length} tài khoản có phần đến hạn · tổng ${fmt(due.reduce((s, x) => s + x.amount, 0n))} LAMP`);
    let done = 0;
    const walletAddr = await lucid.wallet().address();
    // Ví chỉ dùng UTxO THUẦN ADA, và tập đó do CHÍNH script giữ qua từng lượt (`chain()` trả tập ví
    // sau giao dịch) — không đọc lại từ chỉ mục. Đo 2026-10-04, hai cách hỏng:
    //   • để lucid tự chọn ⇒ nó lấy UTxO ví giữ token làm collateral (`CollateralContainsNonADA`);
    //   • đọc lại ví từ chỉ mục sau `awaitTx` (kể cả chờ 20 s) ⇒ còn thấy UTxO vừa tiêu (`BadInputsUTxO`).
    const isPure = (u: UTxO) => Object.keys(u.assets).length === 1 && (u.assets.lovelace ?? 0n) >= 5_000_000n;
    let walletSet = (await lucid.utxosAt(walletAddr)).filter(isPure);
    for (const { a, amount } of due) {
      const next = a.claimed + amount;
      const inLovelace = a.utxo.assets.lovelace ?? 0n;
      if (walletSet.length === 0) throw new Error("DRIP-CLAIM-010: ví vận hành không còn UTxO thuần ADA ≥ 5 ADA.");
      lucid.wallet().overrideUTxOs(walletSet);
      let tx = lucid.newTx()
        .collectFrom([a.utxo], redeemer(DRIP_SPEND.Claim))
        .attach.SpendingValidator(script)
        .pay.ToAddressWithData(a.vault, { kind: "inline", value: dripTagDatum(a.utxo.txHash, a.utxo.outputIndex) },
          { lovelace: VAULT_LOVELACE, [wiring.lampUnit]: amount });
      if (next < a.entitlement) {
        tx = tx.pay.ToContract(addr, { kind: "inline", value: encodeAccountDatum({
          vault: a.vault, entitlement: a.entitlement, claimed: next, startEpoch: a.startEpoch,
        }) }, { lovelace: inLovelace > ACCOUNT_LOVELACE ? inLovelace : ACCOUNT_LOVELACE,
          [wiring.lampUnit]: a.entitlement - next, [tokenUnit]: 1n });
      } else {
        tx = tx.mintAssets({ [tokenUnit]: -1n }, redeemer(DRIP_MINT.BurnAccount)).attach.MintingPolicy(script);
      }
      const [walletAfter, , built] = await tx.validFrom(Date.now() - 60_000).chain();
      console.log(`→ ${a.vault.slice(0, 24)}… +${fmt(amount)} LAMP (đã nhả ${fmt(next)}/${fmt(a.entitlement)})`);
      if (!SUBMIT) { console.log(`(SUBMIT=false) hash thân ${built.toHash()}`); return; }
      const signed = await built.sign.withWallet().complete();
      await submitAndWait(lucid, signed, `rút ${++done}/${due.length}`);
      walletSet = walletAfter.filter(isPure);
    }
    return;
  }

  throw new Error(`DRIP-010: STEP phải là address | status | seed | claim (đang '${STEP}').`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
