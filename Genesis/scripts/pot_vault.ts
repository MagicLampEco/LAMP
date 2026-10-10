// pot_vault.ts — két pot 8 (`Distribution/pot-vault`) trên Preprod: áp tham số, giữ hạt giống
// one-shot, đúc pot, rót sang két swap, hút UTxO lạc. Hợp đồng: `Distribution/pot-vault/CONTRACT.md`
// v1.0. Phần thuần + builder: `Distribution/offchain/src/potVault.ts`.
//
// Bước (STEP):
//   pin      dựng giao dịch gửi 5 tADA tới địa chỉ enterprise của khoá dẫn xuất RIÊNG (CIP-1852
//            account 8000 từ seed vận hành) — UTxO đó làm `genesis_ref`, để coin selection của các
//            giao dịch khác của ví vận hành không tiêu mất nó. In địa chỉ + ref dự kiến `<hash>#0`
//            (chỉ đúng nếu ĐÚNG giao dịch này được gửi; dựng lại là hash khác).
//   address  GENESIS_REF=<txhash>#<idx> — in 7 tham số đã áp, hash, `pot_return`, policy NFT pot.
//   mint     GENESIS_REF · RESERVE_HASH (28 byte hex, hash két swap) · INITIAL_LAMP_OILDROP (≥ 0)
//            [POT_LOVELACE=2000000]. LAMP lấy từ pot development thay thế (native script
//            `sig(khoá vận hành)`, `Genesis/offchain/src/preprodDevPot.ts`); phần dư quay về đó.
//   feed     FEED_OILDROP · RESERVE_REDEEMER_CBOR · (RESERVE_SCRIPT_REF=<txhash>#<idx> hoặc
//            RESERVE_SCRIPT_CBOR) [RESERVE_OUT_DATUM_CBOR = datum input két] [FEED_TTL_MS=1800000].
//            Luật của két swap là việc của két — script chỉ soát hash script két = reserve_hash.
//   absorb   hút mọi UTxO lạc ở địa chỉ pot vào pot.
//
// SUBMIT=false (mặc định): dựng + soát rồi DỪNG, in hash thân giao dịch, không ký, không gửi.
// Chỉ Preprod: trần `window_cap`/`total_cap` là giá trị Preprod của CONTRACT, và pot development
// thay thế là một khoá đơn chỉ dùng trên mạng thử.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coreToTxOutput, getAddressDetails, validatorToScriptHash, walletFromSeed,
  type LucidEvolution, type TxSignBuilder, type UTxO,
} from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, WALLET_SEED, makeLucid, walletPkh, explorerTx } from "./config.js";
import { canonicalWindowOrigin, CANONICAL_MS_PER_EPOCH } from "./_epochWindow.js";
import { activeLampPolicyId, LAMP_POLICY_REGISTRY } from "../offchain/src/lampPolicies.js";
import { preprodDevPot, DEV_POT_DATUM_CBOR } from "../offchain/src/preprodDevPot.js";
import {
  POT_VAULT_PREPROD_CAPS, POT_NFT_NAME, applyPotVault, buildAbsorbTx, buildFeedTx, buildMintPotTx,
  decodePotDatum, encodePotDatum, enterpriseScriptAddress, initialPotDatum, parseOutRef,
  potOutputFailures, RESERVE_NFT_NAME, type AppliedPotVault, type ShapedOutput,
} from "../../Distribution/offchain/src/potVault.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STEP = (process.env.STEP ?? "").toLowerCase();
/** CIP-1852 account index của khoá giữ hạt giống — tách khỏi dải feeder (`30_feeder_accounts.ts`). */
const PIN_ACCOUNT_INDEX = 8000;
const PIN_LOVELACE = 5_000_000n;
const DEV_POT_LOVELACE = 2_000_000n;

const fmt = (o: bigint) => `${(Number(o) / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 6 })} LAMP`;

function need(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`POTVS-ENV-001: thiếu ${name}.`);
  return v;
}

function bigEnv(name: string, min: bigint): bigint {
  const raw = need(name);
  if (!/^\d+$/.test(raw)) throw new Error(`POTVS-ENV-002: ${name}='${raw}' không phải số nguyên không âm.`);
  const v = BigInt(raw);
  if (v < min) throw new Error(`POTVS-ENV-003: ${name}=${v} < ${min}.`);
  return v;
}

/** tLAMP đang hiệu lực trên Preprod — đọc từ sổ, không gõ cứng. */
function activeLamp(): { policy: string; name: string } {
  const policy = activeLampPolicyId("preprod");
  const rec = LAMP_POLICY_REGISTRY.filter((r) => r.network === "preprod" && r.policyId === policy);
  if (rec.length !== 1) throw new Error(`POTVS-LAMP-001: sổ có ${rec.length} bản ghi mang policy ACTIVE ${policy}.`);
  return { policy, name: rec[0]!.assetName };
}

function loadPot(genesisRef: string): AppliedPotVault {
  const p = resolve(__dirname, "../../Distribution/pot-vault/onchain/plutus.json");
  let bp: unknown;
  try { bp = JSON.parse(readFileSync(p, "utf8")); } catch (e) {
    throw new Error(`POTVS-BP-001: không đọc được ${p} (${(e as Error).message}) — chạy 'aiken build' trong pot-vault/onchain.`);
  }
  const lamp = activeLamp();
  return applyPotVault(bp, {
    genesisRef: parseOutRef(genesisRef),
    lampPolicy: lamp.policy,
    lampName: lamp.name,
    msPerEpoch: CANONICAL_MS_PER_EPOCH,
    windowCap: POT_VAULT_PREPROD_CAPS.windowCap,
    totalCap: POT_VAULT_PREPROD_CAPS.totalCap,
    windowOriginMs: canonicalWindowOrigin(NETWORK),
  }, NETWORK);
}

/** Khoá giữ hạt giống: account 8000 của CHÍNH seed vận hành (index 0 phải ra đúng pkh ví). */
function pinKey(operatorPkh: string): { address: string; pkh: string; key: string } {
  if (!WALLET_SEED) throw new Error("POTVS-PIN-001: khoá hạt giống dẫn xuất từ seed vận hành — chạy với WALLET_SEED.");
  const op = walletFromSeed(WALLET_SEED, { addressType: "Base", accountIndex: 0, network: NETWORK });
  if (getAddressDetails(op.address).paymentCredential?.hash !== operatorPkh) {
    throw new Error("POTVS-PIN-002: seed dẫn xuất ra ví khác ví vận hành đang nạp. Dừng.");
  }
  const w = walletFromSeed(WALLET_SEED, { addressType: "Enterprise", accountIndex: PIN_ACCOUNT_INDEX, network: NETWORK });
  const d = getAddressDetails(w.address);
  if (d.paymentCredential?.type !== "Key" || d.stakeCredential) throw new Error("POTVS-PIN-003: địa chỉ khoá 8000 không phải enterprise khoá.");
  if (d.paymentCredential.hash === operatorPkh) throw new Error("POTVS-PIN-004: khoá 8000 trùng khoá vận hành.");
  return { address: w.address, pkh: d.paymentCredential.hash, key: w.paymentKey };
}

const isPureAda = (u: UTxO) => Object.keys(u.assets).length === 1 && (u.assets.lovelace ?? 0n) >= 5_000_000n;

/** Ví vận hành chỉ dùng UTxO thuần ADA (collateral chứa token bị từ chối — đo 2026-10-04, 33_drip_pot). */
async function pureWallet(lucid: LucidEvolution): Promise<void> {
  const pure = (await lucid.utxosAt(await lucid.wallet().address())).filter(isPureAda);
  if (pure.length === 0) throw new Error("POTVS-WALLET-001: ví vận hành không có UTxO thuần ADA ≥ 5 ADA.");
  lucid.wallet().overrideUTxOs(pure);
}

function shapedOutputs(built: TxSignBuilder): ShapedOutput[] {
  const outs = built.toTransaction().body().outputs();
  const r: ShapedOutput[] = [];
  for (let i = 0; i < outs.len(); i++) r.push(coreToTxOutput(outs.get(i)) as ShapedOutput);
  return r;
}

function inputRefs(built: TxSignBuilder): string[] {
  const ins = built.toTransaction().body().inputs();
  const r: string[] = [];
  for (let i = 0; i < ins.len(); i++) r.push(`${ins.get(i).transaction_id().to_hex()}#${ins.get(i).index()}`);
  return r;
}

async function finish(lucid: LucidEvolution, built: TxSignBuilder, label: string, extraKeys: string[] = []): Promise<void> {
  console.log(`Hash thân giao dịch (${label}): ${built.toHash()}`);
  if (!SUBMIT) {
    console.log("(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.)");
    return;
  }
  let s = built.sign.withWallet();
  for (const k of extraKeys) s = s.sign.withPrivateKey(k);
  const hash = await (await s.complete()).submit();
  console.log(`📤 ${label}: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  console.log("✅ Đã vào block.");
}

async function main(): Promise<void> {
  if (NETWORK !== "Preprod") throw new Error(`POTVS-NET-001: chỉ chạy Preprod (đang ${NETWORK}) — trần là giá trị Preprod của CONTRACT.`);
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  console.log(`═══ Két pot 8 (${NETWORK}) · STEP=${STEP} · SUBMIT=${SUBMIT} ═══`);

  if (STEP === "pin") {
    const pin = pinKey(pkh);
    const have = await lucid.utxosAt(pin.address);
    console.log(`Khoá hạt giống: account ${PIN_ACCOUNT_INDEX} · ${pin.address}`);
    console.log(`Đang có ${have.length} UTxO: ${have.map((u) => `${u.txHash}#${u.outputIndex} (${u.assets.lovelace} lovelace)`).join(", ") || "(không)"}`);
    const built = await lucid.newTx().pay.ToAddress(pin.address, { lovelace: PIN_LOVELACE }).complete();
    const o0 = shapedOutputs(built)[0];
    if (!o0 || o0.address !== pin.address || o0.assets.lovelace !== PIN_LOVELACE || Object.keys(o0.assets).length !== 1) {
      throw new Error("POTVS-PIN-005: output #0 của giao dịch đã dựng không phải 5 tADA thuần tới khoá 8000.");
    }
    console.log(`GENESIS_REF dự kiến = ${built.toHash()}#0  (chỉ đúng nếu gửi ĐÚNG giao dịch này)`);
    return finish(lucid, built, "giữ hạt giống");
  }

  const genesisRef = need("GENESIS_REF");
  const pot = loadPot(genesisRef);
  const potUtxos = await lucid.utxosAtWithUnit(pot.address, pot.nftUnit);

  if (STEP === "address") {
    const p = pot.params;
    console.log("Tham số đã áp (thứ tự `validator pot_vault(`):");
    console.log(`  genesis_ref      = ${p.genesisRef.txHash}#${p.genesisRef.outputIndex}`);
    console.log(`  lamp_policy      = ${p.lampPolicy}`);
    console.log(`  lamp_name        = ${p.lampName}`);
    console.log(`  ms_per_epoch     = ${p.msPerEpoch}`);
    console.log(`  window_cap       = ${p.windowCap} (${fmt(p.windowCap)})`);
    console.log(`  total_cap        = ${p.totalCap} (${fmt(p.totalCap)})`);
    console.log(`  window_origin_ms = ${p.windowOriginMs}`);
    console.log(`POT_SCRIPT_HASH=${pot.scriptHash}`);
    console.log(`POT_RETURN=${pot.address}`);
    console.log(`POT_NFT_POLICY=${pot.scriptHash}  (asset name "${POT_NFT_NAME}" rỗng; unit = ${pot.nftUnit})`);
    const g = await lucid.utxosByOutRef([{ txHash: p.genesisRef.txHash, outputIndex: p.genesisRef.outputIndex }]);
    console.log(`genesis_ref trên chuỗi: ${g.length ? `CÒN, ở ${g[0]!.address}` : "KHÔNG thấy (chưa có hoặc đã tiêu)"}`);
    console.log(`Pot đã đúc: ${potUtxos.length ? `CÓ (${potUtxos.length} UTxO mang NFT)` : "chưa"}`);
    const dev = preprodDevPot(NETWORK, pkh);
    const devLamp = (await lucid.utxosAt(dev.address)).reduce((s, u) => s + (u.assets[pot.lampUnit] ?? 0n), 0n);
    console.log(`Nguồn LAMP cho lượt đúc: pot development ${dev.address} · ${fmt(devLamp)}`);
    return;
  }

  if (STEP === "mint") {
    const reserveHash = need("RESERVE_HASH").toLowerCase();
    const initialLamp = bigEnv("INITIAL_LAMP_OILDROP", 0n);
    const potLovelace = BigInt(process.env.POT_LOVELACE ?? "2000000");
    if (potUtxos.length > 0) throw new Error("POTVS-MINT-001: pot đã đúc — NFT one-shot.");
    const pin = pinKey(pkh);
    const ref = pot.params.genesisRef;
    const [g] = await lucid.utxosByOutRef([{ txHash: ref.txHash, outputIndex: ref.outputIndex }]);
    if (!g) throw new Error(`POTVS-MINT-002: genesis_ref ${genesisRef} không có trên chuỗi (chưa gửi pin, hoặc đã tiêu).`);
    if (g.address !== pin.address) {
      throw new Error(`POTVS-MINT-003: genesis_ref ở ${g.address}, không ở khoá hạt giống ${pin.address} — ` +
        "UTxO của ví vận hành có thể bị coin selection tiêu mất trước lượt đúc.");
    }
    await pureWallet(lucid);
    let tx = buildMintPotTx({ lucid, pot, genesisUtxo: g, reserveHash, initialLamp, potLovelace }).addSignerKey(pin.pkh);
    if (initialLamp > 0n) {
      const dev = preprodDevPot(NETWORK, pkh);
      const lampOf = (u: UTxO) => u.assets[pot.lampUnit] ?? 0n;
      const sorted = (await lucid.utxosAt(dev.address)).filter((u) => lampOf(u) > 0n).sort((a, b) => (lampOf(b) > lampOf(a) ? 1 : -1));
      const picked: UTxO[] = [];
      let sum = 0n;
      for (const u of sorted) { if (sum >= initialLamp) break; picked.push(u); sum += lampOf(u); }
      if (sum < initialLamp) throw new Error(`POTVS-MINT-004: pot development ${dev.address} giữ ${fmt(sum)}, cần ${fmt(initialLamp)}.`);
      tx = tx.collectFrom(picked).attach.SpendingValidator(dev.script).addSignerKey(pkh);
      if (sum > initialLamp) {
        tx = tx.pay.ToContract(dev.address, { kind: "inline", value: DEV_POT_DATUM_CBOR },
          { lovelace: DEV_POT_LOVELACE, [pot.lampUnit]: sum - initialLamp });
      }
      console.log(`Nguồn LAMP: pot development ${dev.address} · ${picked.length} UTxO · ${fmt(sum)} vào · ${fmt(sum - initialLamp)} quay về.`);
    }
    const built = await tx.complete();
    const fails = potOutputFailures(shapedOutputs(built), pot, initialPotDatum(reserveHash), initialLamp);
    if (!inputRefs(built).includes(`${ref.txHash}#${ref.outputIndex}`)) fails.push("genesis_ref không có trong input");
    if (fails.length) throw new Error(`POTVS-MINT-005: giao dịch đã dựng lệch hình dạng — ${fails.join("; ")}`);
    console.log(`Đúc pot: NFT ${pot.nftUnit} · ${fmt(initialLamp)} · datum ${initialPotDatum(reserveHash)} → ${pot.address}`);
    return finish(lucid, built, "đúc pot", [pin.key]);
  }

  if (potUtxos.length !== 1) throw new Error(`POTVS-POT-001: ${potUtxos.length} UTxO mang NFT pot ở ${pot.address} (cần 1 — đã đúc chưa?).`);
  const potUtxo = potUtxos[0]!;

  if (STEP === "feed") {
    const d = bigEnv("FEED_OILDROP", 1n);
    if (!potUtxo.datum) throw new Error("POTVS-POT-002: UTxO pot không có datum inline.");
    const din = decodePotDatum(potUtxo.datum);
    const reserveAddr = enterpriseScriptAddress(NETWORK, din.reserveHash);
    const reserves = await lucid.utxosAtWithUnit(reserveAddr, `${din.reserveHash}${RESERVE_NFT_NAME}`);
    if (reserves.length !== 1) throw new Error(`POTVS-FEED-001: ${reserves.length} UTxO két mang NFT ở ${reserveAddr}.`);
    const reserve = reserves[0]!;
    if (!reserve.datum) throw new Error("POTVS-FEED-002: UTxO két không có datum inline.");
    const scriptRef = (process.env.RESERVE_SCRIPT_REF ?? "").trim();
    const scriptCbor = (process.env.RESERVE_SCRIPT_CBOR ?? "").trim();
    if (!!scriptRef === !!scriptCbor) throw new Error("POTVS-FEED-003: đặt ĐÚNG MỘT trong RESERVE_SCRIPT_REF / RESERVE_SCRIPT_CBOR.");
    let refUtxo: UTxO | undefined;
    if (scriptRef) {
      const r = parseOutRef(scriptRef);
      [refUtxo] = await lucid.utxosByOutRef([r]);
      if (!refUtxo?.scriptRef) throw new Error(`POTVS-FEED-004: ${scriptRef} không mang reference script.`);
      if (validatorToScriptHash(refUtxo.scriptRef) !== din.reserveHash) throw new Error("POTVS-FEED-005: reference script không có hash = reserve_hash.");
    } else if (validatorToScriptHash({ type: "PlutusV3", script: scriptCbor }) !== din.reserveHash) {
      throw new Error("POTVS-FEED-005: RESERVE_SCRIPT_CBOR không có hash = reserve_hash.");
    }
    await pureWallet(lucid);
    const { tx, window, nextDatum } = buildFeedTx({
      lucid, pot, potUtxo, reserveUtxo: reserve, d,
      reserveRedeemer: need("RESERVE_REDEEMER_CBOR"),
      reserveOutDatum: (process.env.RESERVE_OUT_DATUM_CBOR ?? "").trim() || reserve.datum,
      attachReserve: (t) => (refUtxo ? t.readFrom([refUtxo]) : t.attach.SpendingValidator({ type: "PlutusV3", script: scriptCbor })),
      nowMs: BigInt(Date.now()),
      ttlMs: BigInt(process.env.FEED_TTL_MS ?? "1800000"),
    });
    const built = await tx.complete();
    const fails = potOutputFailures(shapedOutputs(built), pot, encodePotDatum(nextDatum), (potUtxo.assets[pot.lampUnit] ?? 0n) - d);
    if (fails.length) throw new Error(`POTVS-FEED-006: giao dịch đã dựng lệch hình dạng — ${fails.join("; ")}`);
    console.log(`Rót ${fmt(d)} → két ${reserveAddr} · cửa sổ ${window.window} [${window.loMs}, ${window.hiMs}] · drawn_total ${fmt(nextDatum.drawnTotal)}`);
    return finish(lucid, built, "rót sang két");
  }

  if (STEP === "absorb") {
    const strays = (await lucid.utxosAt(pot.address)).filter((u) => !(pot.nftUnit in u.assets));
    const strayLamp = strays.reduce((s, u) => s + (u.assets[pot.lampUnit] ?? 0n), 0n);
    console.log(`${strays.length} UTxO lạc · ${fmt(strayLamp)}`);
    await pureWallet(lucid);
    const built = await buildAbsorbTx({ lucid, pot, potUtxo, strays }).complete();
    if (!potUtxo.datum) throw new Error("POTVS-POT-002: UTxO pot không có datum inline.");
    const fails = potOutputFailures(shapedOutputs(built), pot, potUtxo.datum, (potUtxo.assets[pot.lampUnit] ?? 0n) + strayLamp);
    if (fails.length) throw new Error(`POTVS-ABS-001: giao dịch đã dựng lệch hình dạng — ${fails.join("; ")}`);
    return finish(lucid, built, "hút UTxO lạc");
  }

  throw new Error(`POTVS-010: STEP phải là pin | address | mint | feed | absorb (đang '${STEP}').`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
