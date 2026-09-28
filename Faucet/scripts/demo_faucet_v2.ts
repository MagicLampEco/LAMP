// demo_faucet_v2.ts — LUỒNG 1 Faucet v3 (DID-gated, rate-limited, tự thu hồi) trên Preview.
//
// Các tx:
//   T0  mint DID test NFT (native sig-policy) → ví (chứng minh DID cho claim/use).
//   T1  deploy pool: mint POOL NFT one-shot (faucet_nft MintPool) + seed pool UTxO với
//       tLAMP (LAMP_POLICY/LAMP_NAME — token ĐÃ CÓ SẴN, KHÔNG mint ở đây) + PoolDatum
//       {cfg{drip,cooldown,max_claims_per_window}, window_epoch(pinned), claims_in_window=0}.
//   T2  ClaimOpen: mở account MỚI cho DID — dùng SDK `buildClaimOpenTx` (spend pool + mint
//       ACCT NFT + drip → account UTxO {did_name, last_claim_epoch=now, last_touch_epoch=now}).
//   T3  Use: chủ DID gia hạn mốc idle — dùng SDK `buildUseTx` (last_claim_epoch bất biến,
//       last_touch_epoch=now).
//
// v3 KHÁC v2: pool datum nay là `PoolDatum` bọc `FaucetConfig` (KHÔNG còn `reclaim_epochs` —
// hằng đó chuyển thành compile-time on-chain), `faucet_pool` nhận THÊM tham số
// `account_script_hash` (6 tham số, ĐẶT SAU `faucet_account` trong thứ tự apply — xem
// `onchain/lib/magiclamp/faucet/ledger.ak` đầu tệp), và account datum tách hai mốc
// `last_claim_epoch`/`last_touch_epoch`. T2 dùng redeemer `ClaimOpen` (KHÔNG còn `Claim` trần).
//
// tLAMP dùng: policy b1474a77... name 744c414d50 (genesis DistributionVest, đã mint thêm).

import {
  Lucid, Blockfrost, applyParamsToScript, mintingPolicyToId,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  Constr, getAddressDetails, toUnit, fromText, scriptFromNative,
  type MintingPolicy, type Validator, type UTxO,
} from "@lucid-evolution/lucid";
import { assertParamCountFromBlueprint } from "../../Genesis/offchain/src/applyGate.js";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { buildClaimOpenTx } from "../offchain/src/claimBuilder.js";
import { buildUseTx } from "../offchain/src/useBuilder.js";
import { poolDatumToCbor, mintPoolRedeemerToCbor } from "../offchain/src/datum.js";
import {
  DRIP_OILDROP, COOLDOWN, POOL_NFT_NAME, acctName,
  msPerEpoch, assertMsPerEpochMatchesNetwork,
} from "../offchain/src/constants.js";
import { pinnedEpochWindow } from "../offchain/src/epochWindow.js";
import type { FaucetConfig, PoolDatum } from "../offchain/src/types.js";

// BÍ MẬT: tệp này nhận GIÁ TRỊ qua biến môi trường, KHÔNG mở kho khoá và KHÔNG biết
// kho ở đâu. Đường cũ tự đọc biến trỏ tới kho rồi `dotenv.config()` lên tệp đó — thứ
// đắt nhất bị lộ không phải giá trị mà là SƠ ĐỒ KHO, và mọi phép quét bí mật đều im
// lặng đúng ở ca đó. Đặt biến ngay trước lệnh, để bí mật sống trong đúng một tiến trình:
//   NETWORK=… BLOCKFROST_KEY=… WALLET_SEED="…" tsx <tệp>.ts

// tLAMP genesis DistributionVest — token ĐÃ CÓ SẴN, script này KHÔNG mint (khác mintBuilder.ts
// SDK, vốn mint tLAMP MỚI qua `tlamp_policy` cho một pool deploy độc lập không có sẵn cung).
const LAMP_POLICY = "b1474a77c8867762efda418adda90ecf7bb5ca35b0be13a7bfbf0ebd";
const LAMP_NAME = "744c414d50";
const lampUnit = toUnit(LAMP_POLICY, LAMP_NAME);

const POOL_SEED_OILDROP = BigInt(process.env.POOL_SEED_OILDROP ?? "2500000000"); // 2500 tLAMP
const MAX_CLAIMS_PER_WINDOW = BigInt(process.env.MAX_CLAIMS_PER_WINDOW ?? "20");
// ms/epoch lấy theo mạng đích, KHÔNG hardcode: số này vừa nướng vào script hash
// (poolParams) vừa quyết window_epoch/last_*_epoch trong datum. Assert = tripwire cho lần ai
// đó hardcode lại 432_000_000 (số của Preprod/Mainnet, lệch 5× trên Preview).
const NETWORK = "Preview" as const;
const MS_PER_EPOCH = msPerEpoch(NETWORK);
assertMsPerEpochMatchesNetwork(MS_PER_EPOCH, NETWORK);

const lucid = await Lucid(
  new Blockfrost(`https://cardano-preview.blockfrost.io/api/v0`, process.env.BLOCKFROST_KEY!),
  "Preview",
);
lucid.selectWallet.fromSeed((process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " "));
const myAddr = await lucid.wallet().address();
const pkh = getAddressDetails(myAddr).paymentCredential!.hash;

const bp = JSON.parse(await readFile(resolve(process.cwd(), "../onchain/plutus.json"), "utf8"));
const get = (t: string) => bp.validators.find((v: { title: string }) => v.title === t).compiledCode;

// ── Cổng đếm khe APPLY-001/002: mọi lượt apply-param phải đi qua đây ──────────
// Script này TỰ đọc plutus.json thay vì đi qua `config.ts::applyValidator`, nên nó không
// hưởng cổng ở đó. `applyParamsToScript` KHÔNG báo lỗi khi thiếu/thừa tham số: nó apply một
// phần rồi trả về một script hash / policy id KHÁC, im lặng. Số khe đọc TỪ blueprint đang
// mở ở trên — không gõ tay. Ba trạng thái: khớp im lặng · lệch APPLY-001 · không đo được
// APPLY-002 (xem `Genesis/offchain/src/applyGate.ts`).
const applyChecked = (title: string, params: unknown[]): string => {
  assertParamCountFromBlueprint(bp, title, "Faucet", params.length);
  return applyParamsToScript(get(title), params as never);
};

const link = (h: string) => `https://preview.cexplorer.io/tx/${h}`;
const out: Record<string, unknown> = { network: "Preview", txs: [] as unknown[] };
const rec = (o: unknown) => (out.txs as unknown[]).push(o);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chờ Blockfrost index xong outputs của tx (UTxO của txHash xuất hiện ở 1 địa chỉ). */
async function waitVisible(txHash: string, addr: string, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const us = await lucid.utxosAt(addr);
    if (us.some((u) => u.txHash === txHash)) return;
    await sleep(5000);
  }
  throw new Error(`tx ${txHash} chưa visible ở ${addr} sau ${tries} lần thử`);
}

// ─────────────────────────────────────────────────────────────────────────
// T0 — mint DID test NFT (native sig-policy keyed bởi ví). asset name = "DIDalice".
// ─────────────────────────────────────────────────────────────────────────
const didPolicyScript = scriptFromNative({ type: "sig", keyHash: pkh });
const didPolicyId = validatorToScriptHash(didPolicyScript);
const DID_NAME = fromText("DIDalice");           // hex của "DIDalice"
const didUnit = toUnit(didPolicyId, DID_NAME);
console.log(`[T0] DID policy=${didPolicyId} name=${DID_NAME} unit=${didUnit}`);

{
  const have = (await lucid.wallet().getUtxos()).some((u) => (u.assets[didUnit] ?? 0n) >= 1n);
  if (have) {
    console.log(`[T0] DID NFT đã có sẵn trong ví — bỏ qua mint.`);
    rec({ step: "T0_mint_did_nft", reused: true, didPolicyId, didName: DID_NAME, didUnit });
  } else {
    const tx = await lucid.newTx()
      .mintAssets({ [didUnit]: 1n })
      .attach.MintingPolicy(didPolicyScript)
      .pay.ToAddress(myAddr, { [didUnit]: 1n, lovelace: 2_000_000n })
      .addSignerKey(pkh)
      .complete();
    const h = await (await tx.sign.withWallet().complete()).submit();
    console.log(`[T0] DID NFT minted ${link(h)}`);
    rec({ step: "T0_mint_did_nft", hash: h, link: link(h), didPolicyId, didName: DID_NAME, didUnit });
    await lucid.awaitTx(h);
    await waitVisible(h, myAddr);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Apply validators (genesis_ref = UTxO ví → one-shot POOL NFT).
// Thứ tự acyclic: faucet_nft(genesis_ref, ms) → faucet_account(faucet_nft_pid, …, ms) →
// faucet_pool(faucet_nft_pid, …, ms, account_script_hash). `faucet_account` KHÔNG nhận
// account_script_hash (nó chính là account); `faucet_pool` nhận THÊM tham số đó ở CUỐI.
// ─────────────────────────────────────────────────────────────────────────
const utxos0 = await lucid.wallet().getUtxos();
const genesis = utxos0.reduce((a, b) => ((b.assets.lovelace ?? 0n) > (a.assets.lovelace ?? 0n) ? b : a));
const genesisRef = new Constr(0, [genesis.txHash, BigInt(genesis.outputIndex)]);
console.log(`[deploy] genesis ref: ${genesis.txHash}#${genesis.outputIndex}`);

const faucetNftPolicy: MintingPolicy = { type: "PlutusV3", script: applyChecked("faucet_nft.faucet_nft.mint", [genesisRef, MS_PER_EPOCH]) };
const faucetNftPid = mintingPolicyToId(faucetNftPolicy);

const acctParams = [faucetNftPid, didPolicyId, LAMP_POLICY, LAMP_NAME, MS_PER_EPOCH];
const faucetAccountScript: Validator = { type: "PlutusV3", script: applyChecked("faucet_account.faucet_account.spend", acctParams) };
const accountScriptHash = validatorToScriptHash(faucetAccountScript);

const poolParams = [...acctParams, accountScriptHash];
const faucetPoolScript: Validator = { type: "PlutusV3", script: applyChecked("faucet_pool.faucet_pool.spend", poolParams) };

const poolAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(faucetPoolScript)));
const accountAddr = credentialToAddress("Preview", scriptHashToCredential(validatorToScriptHash(faucetAccountScript)));
const poolNftUnit = toUnit(faucetNftPid, POOL_NFT_NAME);
const acctNftUnit = toUnit(faucetNftPid, acctName(DID_NAME));

console.log(`[deploy] faucetNftPid=${faucetNftPid}`);
console.log(`[deploy] accountScriptHash=${accountScriptHash}`);
console.log(`[deploy] poolAddr=${poolAddr}`);
console.log(`[deploy] accountAddr=${accountAddr}`);
Object.assign(out, { faucetNftPid, didPolicyId, didName: DID_NAME, poolAddr, accountAddr, lampUnit });

// ─────────────────────────────────────────────────────────────────────────
// T1 — deploy pool: mint POOL NFT one-shot + seed tLAMP (đã có sẵn trong ví) + PoolDatum.
// ─────────────────────────────────────────────────────────────────────────
const cfg: FaucetConfig = { drip_oildrop: DRIP_OILDROP, cooldown_epochs: COOLDOWN, max_claims_per_window: MAX_CLAIMS_PER_WINDOW };
let poolInitialDatum: PoolDatum;
{
  // C-MP-6: window_epoch khởi tạo PHẢI đúng bucket THẬT — pinned, không phải 0 mặc định.
  const { loMs, hiMs, epoch } = pinnedEpochWindow(Date.now(), Number(MS_PER_EPOCH));
  poolInitialDatum = { cfg, window_epoch: epoch, claims_in_window: 0n };

  const tx = await lucid.newTx()
    .collectFrom([genesis])                                  // consume genesis (one-shot)
    .mintAssets({ [poolNftUnit]: 1n }, mintPoolRedeemerToCbor())
    .attach.MintingPolicy(faucetNftPolicy)
    .pay.ToAddressWithData(
      poolAddr,
      { kind: "inline", value: poolDatumToCbor(poolInitialDatum) },
      { lovelace: 5_000_000n, [poolNftUnit]: 1n, [lampUnit]: POOL_SEED_OILDROP },
    )
    .validFrom(loMs)
    .validTo(hiMs)
    .addSignerKey(pkh)
    .complete({ coinSelection: true });
  const h = await (await tx.sign.withWallet().complete()).submit();
  console.log(`[T1] pool deployed (POOL NFT + ${Number(POOL_SEED_OILDROP) / 1e6} tLAMP, window_epoch=${epoch}) ${link(h)}`);
  rec({ step: "T1_deploy_pool", hash: h, link: link(h), poolAddr, poolNftUnit, seedOildrop: POOL_SEED_OILDROP.toString(), windowEpoch: epoch.toString() });
  await lucid.awaitTx(h);
  await waitVisible(h, poolAddr);
  await waitVisible(h, myAddr);
}

// ─────────────────────────────────────────────────────────────────────────
// T2 — ClaimOpen: mở account MỚI (SDK `buildClaimOpenTx`) + mint ACCT NFT + drip; mang DID NFT.
// ─────────────────────────────────────────────────────────────────────────
let accountRef: { txHash: string; outputIndex: number };
{
  const poolUtxos = await lucid.utxosAt(poolAddr);
  const poolUtxo = poolUtxos.find((u) => (u.assets[poolNftUnit] ?? 0n) === 1n);
  if (!poolUtxo) throw new Error(`[T2] không tìm thấy pool UTxO mang POOL NFT ở ${poolAddr}`);
  const didUtxos = (await lucid.wallet().getUtxos()).filter((u) => (u.assets[didUnit] ?? 0n) >= 1n);
  const didUtxo = didUtxos[0];
  if (!didUtxo) throw new Error(`[T2] ví không còn UTxO mang DID NFT ${didUnit}`);

  const res = await buildClaimOpenTx({
    lucid, network: NETWORK,
    poolUtxo, faucetPoolScript,
    faucetNftPolicy, faucetNftPolicyId: faucetNftPid,
    faucetAccountScript,
    didUtxo, didNftPolicyId: didPolicyId, didName: DID_NAME,
    tlampPolicyId: LAMP_POLICY, tlampAssetName: LAMP_NAME,
    nowMs: Date.now(), msPerEpoch: MS_PER_EPOCH,
  });
  const h = await (await res.tx.sign.withWallet().complete()).submit();
  console.log(`[T2] ClaimOpen ${res.drip / 1_000_000n} tLAMP → account (epoch=${res.epoch}) ${link(h)}`);
  rec({ step: "T2_claim_open", hash: h, link: link(h), accountAddr: res.accountAddress, dripOildrop: res.drip.toString(), epoch: res.epoch.toString() });
  await lucid.awaitTx(h);
  await waitVisible(h, accountAddr);
  await waitVisible(h, myAddr);

  const accs = await lucid.utxosAt(accountAddr);
  const a = accs.find((u) => (u.assets[acctNftUnit] ?? 0n) === 1n);
  if (!a) throw new Error(`[T2] không tìm thấy account UTxO mang ACCT NFT ${acctNftUnit} sau khi claim`);
  accountRef = { txHash: a.txHash, outputIndex: a.outputIndex };
}

// ─────────────────────────────────────────────────────────────────────────
// T3 — Use (SDK `buildUseTx`): spend account + mang DID NFT → gia hạn last_touch_epoch=now,
// last_claim_epoch BẤT BIẾN.
// ─────────────────────────────────────────────────────────────────────────
{
  const accs = await lucid.utxosAt(accountAddr);
  const acctUtxo = accs.find((u) => u.txHash === accountRef.txHash && u.outputIndex === accountRef.outputIndex);
  if (!acctUtxo) throw new Error(`[T3] không tìm thấy lại account UTxO ${accountRef.txHash}#${accountRef.outputIndex}`);
  const didUtxosNow = (await lucid.wallet().getUtxos()).filter((u) => (u.assets[didUnit] ?? 0n) >= 1n);
  const didUtxo: UTxO | undefined = didUtxosNow[0];
  if (!didUtxo) throw new Error(`[T3] ví không còn UTxO mang DID NFT ${didUnit}`);

  const res = await buildUseTx({
    lucid, network: NETWORK,
    accountUtxo: acctUtxo, faucetAccountScript, faucetNftPolicyId: faucetNftPid,
    didUtxo, didNftPolicyId: didPolicyId, didName: DID_NAME,
    tlampPolicyId: LAMP_POLICY, tlampAssetName: LAMP_NAME,
    nowMs: Date.now(), msPerEpoch: MS_PER_EPOCH,
  });
  const h = await (await res.tx.sign.withWallet().complete()).submit();
  console.log(`[T3] Use (last_touch_epoch=${res.epoch}) ${link(h)}`);
  rec({ step: "T3_use", hash: h, link: link(h), epoch: res.epoch.toString() });
  await lucid.awaitTx(h);
}

await writeFile(resolve(process.cwd(), "demo-faucet-v2-out.json"), JSON.stringify(out, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
console.log("DONE. wrote demo-faucet-v2-out.json");
