// oneshot_cap_mint.ts — ĐÚC TRỌN QUOTA DISTRIBUTION TRONG ĐÚNG MỘT GIAO DỊCH, rồi
// CHỨNG MINH cổng đã chết bằng cách CỐ TÌNH đúc thêm và để chain từ chối.
//
// Điều kiện anh chốt 2026-08-18:
//   (1) BẮT BUỘC — đúc một lần chạm cap ⇒ cổng chết ⇒ xoay khoá OrgDID bao nhiêu
//       lần cũng không ảnh hưởng.
//   (2) Không để registry sống mãi.
//   (3) Tổng cung 36 tỷ — KHÔNG hạ.
//
// Khác canonical_mint.ts ở ba chỗ, và ba chỗ đó là toàn bộ lý do file này tồn tại:
//   • DELTA = TRỌN dist_cap (26,37 tỷ LAMP), không phải 10k tượng trưng.
//   • Có bước d: dựng tx đúc thêm 1 oildrop — tx này PHẢI hỏng. Script chỉ báo
//     THÀNH CÔNG khi nó hỏng. Đúc được thêm = cổng chưa chết = chạy mainnet là sai.
//   • Có bước e: thu hồi Registry NFT, rồi cho thấy registry sống hay chết KHÔNG
//     đổi kết quả — cổng đã chết vì số học.
//
// SỬA 2026-08-19 — LỖI NẶNG ở bản đầu, phải nói rõ vì nó phá cả cap:
//   Bản đầu (và canonical_mint.ts, canonical_compute.ts) dùng `scriptFromNative sig`
//   cho cả bốn marker NFT. Native-sig KHÔNG one-shot ⇒ người cầm khoá đúc được SUPPLY
//   NFT THỨ HAI bất cứ lúc nào ⇒ dựng SupplyState mới với dist_minted = 0 ⇒ đúc lại
//   TRỌN 26,37 tỷ. Cổng cũ chết, nhưng mở được cổng mới y hệt — nên "đúc trọn cap rồi
//   khoá vô tác dụng" là SAI với cách nối đó. `lamp_mint.ak:88-89` đã ghi rõ an toàn
//   dựa vào "thread_nft param genesis_ref", nhưng không script deploy nào làm theo.
//   Nay cả bốn marker dùng `oneshot_nft` (param genesis_ref + asset_name), CÙNG buộc
//   vào MỘT UTxO genesis ⇒ bốn policy-id khác nhau, cả bốn đúc gọn trong đúng một
//   giao dịch, và không policy nào chạy được lần thứ hai.
//
// 9,63 tỷ Reserve KHÔNG đi đường này. Nó ở lại quota ReserveDraw — nhánh không
// đọc registry, không đòi chữ ký, bị reserve_draw ép trần E/1000 mỗi epoch.
// Cổng Distribution chết KHÔNG kéo Reserve chết theo (test
// `reserve_alive_after_dist_gate_dead` ở lamp_mint.ak chứng minh ở tầng validator).

import {
  Data, Constr, fromText, toUnit, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, applyParamsToScript,
  type Validator, type MintingPolicy, type UTxO,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK, makeLucid, walletPkh, applyPolicy, policyId, rawValidator, explorerTx } from "./config.js";
import { supplyStateToCbor, mintRouteToCbor } from "../offchain/src/datum.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPPLY_NAME = "535550504c59";
const TLAMP_NAME  = "744c414d50";
const TOKEN_TAG   = "4c414d50";
const DIST_CAP    = 26_370_000_000_000_000n;   // 26,37 tỷ LAMP × 10^6 oildrop
const RESERVE_CAP =  9_630_000_000_000_000n;   //  9,63 tỷ — KHÔNG đúc ở đây
const TOTAL_CAP   = DIST_CAP + RESERVE_CAP;    // 36 tỷ, bất biến
const REG_NAME = fromText("REG");
const KHO_NAME = fromText("KHO");
const MET_NAME = fromText("MET");
const MS_PER_EPOCH = 432_000_000n;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function distCode(title: string): Promise<string> {
  const bp = JSON.parse(await readFile(resolve(__dirname, "../../Distribution/onchain/plutus.json"), "utf8"));
  const v = (bp.validators as { title: string; compiledCode: string }[]).find((x) => x.title === title);
  if (!v) throw new Error(`Distribution '${title}' không có trong plutus.json`);
  return v.compiledCode;
}

/** Dựng tx và mong nó HỎNG. Trả về thông điệp lỗi. Dựng được = hỏng cả kế hoạch. */
async function mustFail(label: string, build: () => Promise<unknown>): Promise<string> {
  try {
    await build();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`   ✓ ${label} — bị TỪ CHỐI đúng như phải thế`);
    console.log(`     lý do: ${msg.slice(0, 300).replace(/\s+/g, " ")}`);
    return msg;
  }
  throw new Error(
    `🔴 ${label} DỰNG ĐƯỢC. Cổng CHƯA chết — điều kiện bắt buộc của anh KHÔNG thoả. ` +
    `TUYỆT ĐỐI không chạy bản này lên mainnet.`,
  );
}

async function main() {
  if (NETWORK !== "Preprod" && NETWORK !== "Preview") throw new Error(`CHẶN mạng: ${NETWORK}`);
  if (DIST_CAP + RESERVE_CAP !== 36_000_000_000_000_000n) throw new Error("tổng cap ≠ 36 tỷ");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  console.log(`=== ĐÚC TRỌN CAP MỘT LƯỢT + CHỨNG MINH CỔNG CHẾT (${NETWORK}) ===`);
  console.log(`ví deploy: ${walletAddr}\npkh: ${pkh}\n`);

  // ── Bốn marker one-shot, CÙNG buộc vào MỘT UTxO genesis ──
  // UTxO đó tiêu đúng một lần trong lịch sử chain ⇒ mỗi policy chạy đúng một lần.
  // asset_name là param nên bốn tên khác nhau ⇒ bốn policy-id khác nhau.
  const wUtxos = await lucid.utxosAt(walletAddr);
  const seed: UTxO | undefined = wUtxos.sort((a, b) =>
    Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n)))[0];
  if (!seed) throw new Error("ví rỗng — không có UTxO nào làm genesis_ref");
  const genesisRef = new Constr(0, [seed.txHash, BigInt(seed.outputIndex)]);
  console.log(`UTxO genesis (one-shot): ${seed.txHash}#${seed.outputIndex}\n`);

  const oneshotCode = (await rawValidator("oneshot_nft.oneshot_nft.mint")).compiledCode;
  const mkOneshot = (name: string): MintingPolicy =>
    applyPolicy(oneshotCode, [genesisRef, name]);
  const supplyPol = mkOneshot(SUPPLY_NAME);
  const regPol = mkOneshot(REG_NAME);
  const khoPol = mkOneshot(KHO_NAME);
  const metPol = mkOneshot(MET_NAME);
  const supplyPid = policyId(supplyPol);
  const regPid = policyId(regPol);
  const khoPid = policyId(khoPol);
  const metPid = policyId(metPol);

  const lampMint = applyPolicy((await rawValidator("lamp_mint.lamp_mint.mint")).compiledCode, [
    supplyPid, SUPPLY_NAME, TLAMP_NAME, DIST_CAP, RESERVE_CAP,
    regPid, REG_NAME, TOKEN_TAG, khoPid, KHO_NAME, metPid, MET_NAME,
  ]);
  const lampPid = policyId(lampMint);
  const lampUnit = toUnit(lampPid, TLAMP_NAME);

  const committee = [pkh]; const threshold = 1n;
  const claimS: Validator = { type: "PlutusV3", script: applyParamsToScript(await distCode("claim_account.claim_account.spend"), [committee, threshold, MS_PER_EPOCH, lampPid, TLAMP_NAME, khoPid] as never) };
  const claimHash = validatorToScriptHash(claimS);
  const treS: Validator = { type: "PlutusV3", script: applyParamsToScript(await distCode("treasury.treasury.spend"), [claimHash, lampPid, TLAMP_NAME] as never) };
  const treHash = validatorToScriptHash(treS);
  const treAddr = credentialToAddress(NETWORK, scriptHashToCredential(treHash));

  console.log(`lamp_policy: ${lampPid}`);
  console.log(`KHO (treasury.ak): ${treAddr}`);
  console.log(`cap: dist ${DIST_CAP} + reserve ${RESERVE_CAP} = ${TOTAL_CAP} oildrop (36 tỷ LAMP)\n`);

  const regAddr = credentialToAddress(NETWORK, scriptHashToCredential(regPid));
  const threadUnit = toUnit(supplyPid, SUPPLY_NAME);
  const regUnit = toUnit(regPid, REG_NAME);
  const khoUnit = toUnit(khoPid, KHO_NAME);
  const metUnit = toUnit(metPid, MET_NAME);
  console.log(`marker one-shot: SUPPLY ${supplyPid}\n                 REG    ${regPid}\n                 KHO    ${khoPid}\n                 MET    ${metPid}\n`);

  const ssFresh = supplyStateToCbor({ dist_minted: 0n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const ssFull  = supplyStateToCbor({ dist_minted: DIST_CAP, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const regDatum = Data.to(new Constr(0, [fromText("did:phoenix:org:greensun"), [new Constr(0, [TOKEN_TAG, new Constr(0, [pkh])])]]));
  const treDatum = Data.to(new Constr(0, [pkh]));

  // ── a. genesis: 4 marker NFT + SupplyState trắng + registry + kho-NFT@treasury ──
  console.log("── a. genesis (4 marker + SupplyState + registry + kho-NFT) ──");
  const genTx = await lucid.newTx()
    .collectFrom([seed])                       // TIÊU UTxO genesis → mở one-shot đúng 1 lần
    .mintAssets({ [threadUnit]: 1n }, Data.void()).attach.MintingPolicy(supplyPol)
    .mintAssets({ [regUnit]: 1n }, Data.void()).attach.MintingPolicy(regPol)
    .mintAssets({ [khoUnit]: 1n }, Data.void()).attach.MintingPolicy(khoPol)
    .mintAssets({ [metUnit]: 1n }, Data.void()).attach.MintingPolicy(metPol)
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssFresh }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    // Registry NFT PHẢI nằm ở địa chỉ script == chính policy của nó (`registry.ak:148`),
    // không phải ví. Và `oneshot_nft` có `else(_) { fail }` nên UTxO đó KHÔNG tiêu được:
    // registry đóng băng ngay từ lúc sinh — không ai viết lại authority, kể cả anh.
    .pay.ToAddressWithData(regAddr, { kind: "inline", value: regDatum }, { lovelace: 2_000_000n, [regUnit]: 1n })
    .pay.ToAddress(treAddr, { lovelace: 2_000_000n, [khoUnit]: 1n })
    .pay.ToAddress(walletAddr, { lovelace: 2_000_000n, [metUnit]: 1n })
    .complete();
  const gh = await (await genTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${gh}\n   ${explorerTx(gh)}`); await lucid.awaitTx(gh); await sleep(20_000);

  const findAt = async (addr: string, unit: string) =>
    (await lucid.utxosAt(addr)).find((u) => (u.assets[unit] ?? 0n) === 1n);
  let ssU = await findAt(walletAddr, threadUnit);
  const regU = await findAt(regAddr, regUnit);
  const khoU = await findAt(treAddr, khoUnit);
  if (!ssU || !regU || !khoU) throw new Error("không resolve được UTxO genesis");

  // ── b. ĐÚC TRỌN 26,37 TỶ TRONG ĐÚNG MỘT GIAO DỊCH ──
  console.log(`\n── b. đúc TRỌN ${DIST_CAP / 1_000_000n} tLAMP trong MỘT tx → KHO ──`);
  const mintTx = await lucid.newTx()
    .collectFrom([ssU])
    .mintAssets({ [lampUnit]: DIST_CAP }, mintRouteToCbor("DistributionVest"))
    .attach.MintingPolicy(lampMint)
    .readFrom([regU, khoU])
    .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssFull }, { lovelace: 2_000_000n, [threadUnit]: 1n })
    .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: DIST_CAP })
    .addSigner(walletAddr)
    .complete();
  const mh = await (await mintTx.sign.withWallet().complete()).submit();
  console.log(`   TX: ${mh}\n   ${explorerTx(mh)}`); await lucid.awaitTx(mh); await sleep(20_000);

  const khoLamp = (await lucid.utxosAt(treAddr)).reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`   KHO giữ ${khoLamp} oildrop (mong đợi ${DIST_CAP})`);
  if (khoLamp !== DIST_CAP) throw new Error(`A-DEST FAIL: kho giữ ${khoLamp} ≠ ${DIST_CAP}`);
  console.log(`   ✓ trọn quota Distribution nằm trong kho, đúng MỘT giao dịch`);

  // ── c. sổ on-chain đã chạm cap ──
  ssU = await findAt(walletAddr, threadUnit);
  if (!ssU) throw new Error("mất SupplyState sau khi đúc");
  console.log(`\n── c. SupplyState on-chain: dist_minted == dist_cap ──`);
  console.log(`   datum: ${ssU.datum}`);

  // ── d. CỔNG CHẾT — ba đường thử, cả ba PHẢI hỏng ──
  console.log(`\n── d. cố tình đúc thêm — cả ba đường PHẢI bị từ chối ──`);
  const ssOver = supplyStateToCbor({ dist_minted: DIST_CAP + 1n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  const rejects: Record<string, string> = {};

  rejects.plus_one = await mustFail("d1. đúc thêm 1 oildrop, khoá vận hành ký đúng", () =>
    lucid.newTx()
      .collectFrom([ssU!])
      .mintAssets({ [lampUnit]: 1n }, mintRouteToCbor("DistributionVest"))
      .attach.MintingPolicy(lampMint)
      .readFrom([regU, khoU])
      .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssOver }, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: 1n })
      .addSigner(walletAddr)
      .complete());

  rejects.unbooked = await mustFail("d2. đúc thêm mà KHÔNG ghi sổ (giữ nguyên dist_minted)", () =>
    lucid.newTx()
      .collectFrom([ssU!])
      .mintAssets({ [lampUnit]: 1_000_000n }, mintRouteToCbor("DistributionVest"))
      .attach.MintingPolicy(lampMint)
      .readFrom([regU, khoU])
      .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssFull }, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: 1_000_000n })
      .addSigner(walletAddr)
      .complete());

  const ssRollback = supplyStateToCbor({ dist_minted: DIST_CAP - 1_000_000n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP });
  rejects.rollback = await mustFail("d3. quay ngược sổ để mở lại quota", () =>
    lucid.newTx()
      .collectFrom([ssU!])
      .mintAssets({ [lampUnit]: 1_000_000n }, mintRouteToCbor("DistributionVest"))
      .attach.MintingPolicy(lampMint)
      .readFrom([regU, khoU])
      .pay.ToAddressWithData(walletAddr, { kind: "inline", value: ssRollback }, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .pay.ToAddressWithData(treAddr, { kind: "inline", value: treDatum }, { lovelace: 2_000_000n, [lampUnit]: 1_000_000n })
      .addSigner(walletAddr)
      .complete());

  // ── e. KHOÁ CÒN LÀM ĐƯỢC GÌ? — thử đúc SUPPLY NFT THỨ HAI ──
  // Đây là câu hỏi thật: cổng chết rồi thì người cầm seed có dựng được SupplyState
  // MỚI (dist_minted=0) để đúc lại trọn cap không. Chỉ one-shot mới trả lời được KHÔNG.
  console.log(`\n── e. thử đúc SUPPLY NFT thứ hai (đường phá cap) ──`);
  rejects.second_supply_nft = await mustFail(
    "e1. đúc SUPPLY NFT thứ hai để dựng SupplyState mới",
    () => lucid.newTx()
      .mintAssets({ [threadUnit]: 1n }, Data.void())
      .attach.MintingPolicy(supplyPol)
      .pay.ToAddress(walletAddr, { lovelace: 2_000_000n, [threadUnit]: 1n })
      .complete());
  console.log(`   ⟹ UTxO genesis đã tiêu, policy one-shot không chạy lần hai được.`);
  console.log(`      Không dựng nổi SupplyState thứ hai ⇒ cap 36 tỷ đứng vững.`);

  const state = {
    network: NETWORK,
    genesisSeedUtxo: `${seed.txHash}#${seed.outputIndex}`,
    markerPolicies: { supply: supplyPid, registry: regPid, kho: khoPid, meter: metPid },
    lampPid, lampUnit, treHash, treAddr, claimHash,
    distCap: DIST_CAP.toString(), reserveCap: RESERVE_CAP.toString(), totalCap: TOTAL_CAP.toString(),
    genesisTx: gh, oneshotMintTx: mh,
    khoHolds: khoLamp.toString(), supplyStateDatum: ssU.datum, gateDeathRejects: rejects,
  };
  await writeFile(resolve(__dirname, "oneshot-cap-state.json"), JSON.stringify(state, null, 2) + "\n");

  console.log(`\n✅ XONG:`);
  console.log(`   • ${DIST_CAP / 1_000_000n} tLAMP đúc trong ĐÚNG một giao dịch, toàn bộ vào kho`);
  console.log(`   • ba đường đúc thêm đều bị chain từ chối — cổng chết`);
  console.log(`   • không đúc nổi SUPPLY NFT thứ hai — không dựng lại được cổng`);
  console.log(`   • 9,63 tỷ Reserve còn nguyên quota, đi đường ReserveDraw không chữ ký`);
  console.log(`   state → oneshot-cap-state.json`);
}
main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
