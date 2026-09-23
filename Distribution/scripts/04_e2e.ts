// LampDistribution/scripts/04_e2e.ts — Full flow THẬT trên Preview (CONTRACT v2 "Capped Drop").
//
// Chạy: npm run e2e   (sau 01 → 02 → 03)
//
// Flow tất định (CONTRACT v2 §1/§4 — KHÔNG lottery/merkle/nonce):
//   a. Grant:   committee 2/3 ký → cấp entitlement E cho A (250 LAMP), B (1000 LAMP).
//   b. Beacon:  committee post DropParam{D} cho cửa sổ hiện tại (nếu cửa sổ chưa post).
//   c. Redeem:  A tự tính vested(t) on-chain → nhận LAMP đã mở khoá vào ví (permissionless).
//   d. Verify:  đọc lại datum, đối chiếu datum kỳ vọng + LAMP balance.
//
//   vested(t) = min(E, D · drops_per_epoch · max(0, t − start_epoch))
//   amount    = vested − redeemed   (yêu cầu > 0)
//
// Mỗi tx: in tx hash + explorer link + await confirm trước khi sang bước sau.
//
// CHẠY HAI LƯỢT, cách nhau ít nhất một cửa sổ epoch validator. Grant đặt
// `start_epoch` = cửa sổ hiện tại (C-ACC-2 khi CREATE, C-ACC-3 rebase khi cấp thêm), nên
// trong CÙNG cửa sổ vested = 0 và lượt đầu dừng ở bước c, báo cửa sổ rút được. Lượt sau
// thấy A còn phần rút được ⇒ BỎ QUA grant A (cấp thêm lúc đó là rebase, xoá tiến độ vest)
// ⇒ đi tới redeem. Quyết định từng bước nằm ở `e2ePlan.ts` (hàm thuần, có bài kiểm).

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME, TREASURY_NFT_ASSET_NAME, MS_PER_EPOCH,
  makeLucid, walletPkh, loadDeployed, reapplyValidators,
  toUnit, explorerTx, awaitTx,
} from "./config.js";
import {
  decodeClaimAccountDatum, decodeBeaconDatum, decodeTreasuryDatum,
} from "../offchain/src/datum.js";
import type { BeaconDatum } from "../offchain/src/types.js";
import { buildClaimTx }      from "../offchain/src/claimBuilder.js";
import { buildPostBeaconTx } from "../offchain/src/beaconBuilder.js";
import { buildRedeemTx }     from "../offchain/src/redeemBuilder.js";
import { RATE_ROOT_GENESIS, epochWindow } from "../offchain/src/constants.js";
import type { LucidEvolution, UTxO, TxSignBuilder, Validator } from "@lucid-evolution/lucid";
import {
  windowNow, grantTimeParams, redeemTimeParams,
  planGrant, planBeacon, planRedeem, accountDatumMismatches,
} from "./e2ePlan.js";

const LAMP_A = 250_000_000n;   // 250 LAMP entitlement (oildrop)
const LAMP_B = 1_000_000_000n; // 1000 LAMP entitlement (oildrop)

// `rate_root` đích cho lượt post beacon. Khớp `03_genesis` (biến `RATE_ROOT`) nếu set.
//
// ⚠ `DROP_VALUE_OILDROP` là khái niệm CHẾT ở v3 — từ chối thẳng thay vì bỏ qua, cùng lý do
// đã ghi ở `03_genesis.ts`: bỏ qua im lặng làm người vận hành tin mình đã chỉnh được tốc độ.
if ((process.env.DROP_VALUE_OILDROP ?? "").trim() !== "") {
  throw new Error(
    "E2E-V3-001: `DROP_VALUE_OILDROP` không còn nghĩa ở v3 — beacon mang `rate_root` (w). " +
    "Đặt `RATE_ROOT` nếu muốn chỉnh, rồi bỏ biến cũ đi.",
  );
}
const RATE_ROOT = BigInt(process.env.RATE_ROOT ?? RATE_ROOT_GENESIS.toString());

function norm(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

/** Tìm ClaimAccount UTxO theo owner PKH (decode datum). `null` = chưa có tài khoản.
 *  Nhiều account cùng owner → chọn cái entitlement cao nhất (account "hoạt động"). */
async function findClaimAccountOpt(
  lucid: LucidEvolution, address: string, ownerPkh: string,
): Promise<UTxO | null> {
  const utxos = await lucid.utxosAt(address);
  let best: UTxO | null = null;
  let bestEnt = -1n;
  for (const u of utxos) {
    if (!u.datum) continue;
    try {
      const d = decodeClaimAccountDatum(Data.from(u.datum));
      if (norm(d.owner) === norm(ownerPkh) && d.entitlement > bestEnt) {
        best = u; bestEnt = d.entitlement;
      }
    } catch { /* không phải ClaimAccountDatum */ }
  }
  return best;
}

/** Như trên nhưng BẮT BUỘC có (dùng sau khi đã Claim xong). */
async function findClaimAccount(
  lucid: LucidEvolution, address: string, ownerPkh: string,
): Promise<UTxO> {
  const u = await findClaimAccountOpt(lucid, address, ownerPkh);
  if (!u) throw new Error(`không tìm thấy ClaimAccount cho owner ${ownerPkh} tại ${address}`);
  return u;
}

/** Tìm beacon UTxO theo NFT asset. Re-resolve sau mỗi PostBeacon. */
async function findBeacon(
  lucid: LucidEvolution, address: string, nftUnit: string,
): Promise<UTxO> {
  const utxos = await lucid.utxosAt(address);
  const u = utxos.find((x) => (x.assets[nftUnit] ?? 0n) === 1n);
  if (!u) throw new Error(`không tìm thấy beacon UTxO chứa ${nftUnit}`);
  return u;
}

/** Tìm treasury UTxO canonical (mang đúng 1 NFT TRSY). Re-resolve sau mỗi Claim/Redeem. */
async function findTreasury(
  lucid: LucidEvolution, address: string, trsyUnit: string,
): Promise<UTxO> {
  const utxos = await lucid.utxosAt(address);
  const u = utxos.find((x) => (x.assets[trsyUnit] ?? 0n) === 1n);
  if (!u) throw new Error(`không tìm thấy treasury UTxO chứa NFT TRSY ${trsyUnit}`);
  return u;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Sign + submit + await + settle. Trả txHash.
 *  Sleep sau confirm để Blockfrost index UTxO mới (tránh stale input ở tx kế). */
async function submit(
  lucid: LucidEvolution, txComplete: TxSignBuilder, label: string,
): Promise<string> {
  const signed = await txComplete.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`   TX:       ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, label);
  await sleep(20_000);  // chờ provider index xong (chống TranslationLogicMissingInput)
  return txHash;
}

/** Đảm bảo ví có ≥2 UTxO ADA-thuần (≥5 tADA) làm collateral cho Plutus tx. */
async function ensureCollateral(lucid: LucidEvolution): Promise<void> {
  const addr = await lucid.wallet().address();
  const isPureAda = (u: UTxO): boolean =>
    Object.keys(u.assets).length === 1 && (u.assets["lovelace"] ?? 0n) >= 5_000_000n;
  const utxos = await lucid.wallet().getUtxos();
  if (utxos.filter(isPureAda).length >= 2) {
    console.log("   collateral: đã có UTxO ADA-thuần ✓");
    return;
  }
  console.log("   collateral: tạo 2 UTxO ADA-thuần (5 tADA mỗi cái)…");
  const tx = await lucid.newTx()
    .pay.ToAddress(addr, { lovelace: 5_000_000n })
    .pay.ToAddress(addr, { lovelace: 5_000_000n })
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const h = await signed.submit();
  console.log(`   TX:       ${h}`);
  await awaitTx(lucid, h, "prep collateral");
  await sleep(20_000);
}

/** Cấp E cho một owner theo `planGrant`, rồi đọc lại datum trên chuỗi và đối chiếu kỳ vọng. */
async function grantFor(args: {
  lucid: LucidEvolution; label: string; ownerPkh: string; amount: bigint;
  beacon: BeaconDatum; beaconAddress: string; dropNft: string; e: bigint;
  claimAddress: string; treasuryAddress: string; trsyUnit: string; treasuryNftPolicy: string;
  claimScript: Validator; treasuryScript: Validator; accountNftScript: Validator;
  committee: string[]; threshold: number;
}): Promise<void> {
  const { lucid, label, ownerPkh, amount, e } = args;
  const accUtxo = await findClaimAccountOpt(lucid, args.claimAddress, ownerPkh);
  const before = accUtxo ? decodeClaimAccountDatum(Data.from(accUtxo.datum!)) : null;
  // v3: kế hoạch cấp cần CẢ kho — trần một lượt đọc `total_redeemed`, nên số "đang rút được"
  // in ra ở nhánh BỎ QUA không tính được nếu chỉ nhìn tài khoản.
  const treasuryForPlan = decodeTreasuryDatum(
    Data.from((await findTreasury(lucid, args.treasuryAddress, args.trsyUnit)).datum!),
  );
  const plan = planGrant({
    account: before, ownerPkh, amount,
    beacon: args.beacon, treasury: treasuryForPlan, windowEpoch: e,
  });

  if (plan.action === "skip") {
    console.log(
      `   ${label}: BỎ QUA cấp — lô hiện tại chưa rút trọn (đang rút được ${plan.pending} oildrop). ` +
      `Cấp thêm là rebase (C-ACC-3) nên phần đã vest sẽ phải vest lại.`,
    );
    return;
  }
  console.log(`   ${label}: ${plan.action === "create" ? "chưa có tài khoản → CREATE (đúc NFT)" : "đã có tài khoản → TOPUP (rebase)"}`);

  // `exactOptionalPropertyTypes`: thêm khoá bằng spread có điều kiện, không gán undefined.
  const treasuryUtxo = await findTreasury(lucid, args.treasuryAddress, args.trsyUnit);
  const w = windowNow(MS_PER_EPOCH, e);
  const res = await buildClaimTx({
    lucid, claimScript: args.claimScript, network: NETWORK,
    ownerPkh, amount,
    ...(accUtxo ? { claimAccountUtxo: accUtxo } : { accountNft: { script: args.accountNftScript } }),
    treasury: {
      utxo: treasuryUtxo, script: args.treasuryScript,
      nftPolicy: args.treasuryNftPolicy, nftAssetName: TREASURY_NFT_ASSET_NAME,
    },
    // v3: beacon làm INPUT THAM CHIẾU ở CẢ hai đường. Đọc lại UTxO ngay đây thay vì mang
    // theo từ đầu lượt — nó có thể đã bị tiêu bởi bước post beacon xen giữa.
    beacon: {
      utxo: await findBeacon(lucid, args.beaconAddress, args.dropNft),
      datum: args.beacon,
    },
    committeeKeyHashes: args.committee, threshold: args.threshold,
    ...grantTimeParams(w),   // Luật 2b: hai đầu cùng cửa sổ (CREATE-002 áp cả UPDATE)
  });
  console.log(res.summary);
  await submit(lucid, res.tx, `grant ${label}`);

  const after = decodeClaimAccountDatum(
    Data.from((await findClaimAccount(lucid, args.claimAddress, ownerPkh)).datum!),
  );
  const diff = accountDatumMismatches(plan.expected, after);
  if (diff.length > 0) {
    throw new Error(`E2E-VERIFY-001: datum ${label} sau grant lệch kỳ vọng — ${diff.join("; ")}`);
  }
}

async function main(): Promise<void> {
  console.log("=== LampDistribution Step 4: E2E live flow (Capped Drop v2) ===\n");

  const state = await loadDeployed();
  if (!state.genesis || !state.wallets || !state.testLamp || !state.beaconNftPolicy) {
    throw new Error("deployed.json thiếu genesis/wallets/testLamp — chạy 01→02→03 trước.");
  }

  const lucid = await makeLucid();
  const aPkh  = await walletPkh(lucid);
  if (norm(aPkh) !== norm(state.wallets.aPkh)) {
    throw new Error(`ví hiện tại (${aPkh}) ≠ ví A genesis (${state.wallets.aPkh}). Dùng đúng ví deploy.`);
  }
  const bPkh = state.wallets.bPkh;

  const { claimScript, beaconScript, treasuryScript, accountNftScript } =
    await reapplyValidators(state);
  const committee = state.committee.keyHashes;
  const threshold = state.committee.threshold;

  // Cửa sổ của CẢ lượt chạy. Mọi bước dựng tx lấy lại cặp lo/hi qua `windowNow`, ném
  // WINDOW-001 nếu cửa sổ đã sang trang — kế hoạch tính ở đây sẽ không còn đúng nữa.
  const e = epochWindow(MS_PER_EPOCH).epoch;
  console.log(`Network: ${NETWORK}   cửa sổ epoch validator: ${e}`);
  console.log(`Committee: ${committee.length} keys (threshold ${threshold}, source ${state.committee.source})`);

  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);
  const dropNft  = toUnit(state.beaconNftPolicy, DROP_ASSET_NAME);
  const treasuryNftPolicy = state.params.treasuryNftPolicy;
  const trsyUnit = toUnit(treasuryNftPolicy, TREASURY_NFT_ASSET_NAME);

  const balBefore = (await lucid.wallet().getUtxos())
    .reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);
  console.log(`Ví A test-LAMP trước: ${balBefore / 1_000_000n} LAMP\n`);

  await ensureCollateral(lucid);

  // D ĐANG CÓ HIỆU LỰC trên chuỗi — dùng để tính phần rút được trước khi quyết cấp.
  const beaconBefore = decodeBeaconDatum(
    Data.from((await findBeacon(lucid, state.beacon.address, dropNft)).datum!),
  );

  // ════════════════════════════════════════════════════════════
  // a. GRANT — committee cấp entitlement E (A 250 LAMP, B 1000 LAMP)
  // ════════════════════════════════════════════════════════════
  // SOLVENCY co-spend (C-SOLV-*): mỗi grant spend treasury (GrantEntitlement), nên treasury
  // được tìm lại trước MỖI grant. Không còn `try/catch` quanh grant B: lỗi nào ở đây cũng là
  // lỗi thật (luật on-chain, solvency, cấu hình), và nuốt nó thì bước verify phía sau chạy
  // trên một trạng thái mà không ai biết là sai.
  console.log("── a. Grant (committee cấp entitlement E) ──");
  const grantCommon = {
    lucid, beacon: beaconBefore, beaconAddress: state.beacon.address, dropNft, e,
    claimAddress: state.claimAccount.address, treasuryAddress: state.treasury.address,
    trsyUnit, treasuryNftPolicy, claimScript, treasuryScript, accountNftScript,
    committee, threshold,
  };
  await grantFor({ ...grantCommon, label: "A", ownerPkh: aPkh, amount: LAMP_A });
  await grantFor({ ...grantCommon, label: "B", ownerPkh: bPkh, amount: LAMP_B });

  // ════════════════════════════════════════════════════════════
  // b. POST DropParam beacon — nhãn = cửa sổ hiện tại (C-BCN-3), |ΔD| ≤ 10% (C-BCN-5)
  // ════════════════════════════════════════════════════════════
  console.log("\n── b. Post DropParam beacon (chỉ số cộng dồn) ──");
  const beaconPlan = planBeacon({
    onChain: beaconBefore, window: windowNow(MS_PER_EPOCH, e),
    rateRoot: RATE_ROOT, msPerEpoch: MS_PER_EPOCH,
  });
  if (beaconPlan.action === "skip") {
    console.log(`   BỎ QUA — cửa sổ ${e} đã có lượt post (C-BCN-2/3: một lượt mỗi cửa sổ).`);
  } else {
    const postD = await buildPostBeaconTx({
      lucid, beaconUtxo: await findBeacon(lucid, state.beacon.address, dropNft),
      beaconScript, network: NETWORK,
      beaconNftPolicy: state.beaconNftPolicy,
      committeeKeyHashes: committee, threshold,
      ...beaconPlan.params,   // newBeacon + msPerEpoch + currentBeacon
    });
    console.log(postD.summary);
    await submit(lucid, postD.tx, "post DropParam");
  }

  // ════════════════════════════════════════════════════════════
  // c. REDEEM — A tự tính vested(t), nhận LAMP đã mở khoá
  // ════════════════════════════════════════════════════════════
  console.log("\n── c. Redeem (ví A — tất định, self-compute vested) ──");

  const accA1 = await findClaimAccount(lucid, state.claimAccount.address, aPkh);
  const dA1   = decodeClaimAccountDatum(Data.from(accA1.datum!));
  const dropBeacon = await findBeacon(lucid, state.beacon.address, dropNft);
  const bNow = decodeBeaconDatum(Data.from(dropBeacon.datum!));
  const treasuryNow = decodeTreasuryDatum(
    Data.from((await findTreasury(lucid, state.treasury.address, trsyUnit)).datum!),
  );
  const redeemPlan = planRedeem(dA1, bNow, treasuryNow, e);

  if (redeemPlan.action === "wait") {
    console.log(
      `   ⏸ Chưa có gì để rút: index_at_start=${dA1.index_at_start}, ` +
      `A(${e})=${bNow.index + bNow.rate_root * (e - bNow.epoch)}, redeemed=${dA1.redeemed}. ` +
      `Chạy lại từ cửa sổ ${redeemPlan.fromEpoch} — lượt sau sẽ BỎ QUA grant A vì lô chưa rút trọn.`,
    );
    console.log("\n⏸ E2E CHƯA hoàn tất — grant + beacon xong, redeem chờ cửa sổ sau.");
    return;
  }
  if (redeemPlan.action === "stalled") {
    throw new Error(
      `E2E-REDEEM-003: rate_root·drops_per_epoch = ${bNow.rate_root}·${dA1.drops_per_epoch} ≤ 0 — ` +
      `chỉ số đứng yên nên tài khoản A KHÔNG BAO GIỜ rút được. Kiểm beacon DropParam và datum ` +
      `tài khoản. (Không in một cửa sổ chờ ở đây: một mốc trông có lý là câu trả lời sai cho ` +
      `một câu hỏi không có câu trả lời.)`,
    );
  }
  if (redeemPlan.action === "exhausted") {
    throw new Error(
      `E2E-REDEEM-001: tài khoản A đã rút trọn (${dA1.redeemed}/${dA1.entitlement}) mà grant A không ` +
      `chạy ở bước a — trạng thái này không phải kết quả của lượt chạy này.`,
    );
  }
  if (redeemPlan.trimmed > 0n) {
    console.log(
      `   ✂ Trần một lượt cắt ${redeemPlan.trimmed} oildrop khỏi lượt này. ` +
      `Phần đó CÒN NGUYÊN QUYỀN — rút được ở lượt sau, không mất.`,
    );
  }

  // Treasury canonical mang TRSY + còn LAMP (redeem path bind TRSY on-chain mới).
  const treasuryU = (await lucid.utxosAt(state.treasury.address))
    .find((u) => (u.assets[trsyUnit] ?? 0n) === 1n && (u.assets[lampUnit] ?? 0n) > 0n);
  if (!treasuryU) throw new Error("không tìm thấy treasury UTxO (TRSY + còn LAMP)");

  const redeem = await buildRedeemTx({
    lucid, network: NETWORK,
    claimAccountUtxo: accA1, claimScript,
    treasuryUtxo: treasuryU, treasuryScript,
    dropBeaconUtxo: dropBeacon,
    ...redeemTimeParams(windowNow(MS_PER_EPOCH, e)),
    lampPolicyId: state.testLamp.policyId, lampAssetName: state.testLamp.assetName,
    treasuryNftPolicy,
  });
  if (redeem.amount !== redeemPlan.amount) {
    throw new Error(`E2E-REDEEM-002: builder tính ${redeem.amount}, kế hoạch tính ${redeemPlan.amount}.`);
  }
  console.log(redeem.summary);
  await submit(lucid, redeem.tx, "redeem A");

  // ════════════════════════════════════════════════════════════
  // d. VERIFY on-chain (redeemed cộng dồn + LAMP balance)
  // ════════════════════════════════════════════════════════════
  console.log("\n── d. Verify on-chain ──");

  const dA = decodeClaimAccountDatum(
    Data.from((await findClaimAccount(lucid, state.claimAccount.address, aPkh)).datum!),
  );
  const balAfter = (await lucid.wallet().getUtxos())
    .reduce((s, u) => s + (u.assets[lampUnit] ?? 0n), 0n);

  console.log(`   ClaimAccount A: entitlement=${dA.entitlement / 1_000_000n} ` +
    `redeemed=${dA.redeemed / 1_000_000n} LAMP ` +
    `(start_epoch=${dA.start_epoch}, drops/epoch=${dA.drops_per_epoch})`);
  console.log(`   Vested tại redeem: ${redeem.vested / 1_000_000n} LAMP; released ${redeem.amount / 1_000_000n} LAMP`);
  console.log(`   Ví A test-LAMP: ${balBefore / 1_000_000n} → ${balAfter / 1_000_000n} LAMP ` +
    `(+${(balAfter - balBefore) / 1_000_000n})`);

  // Bất biến C-RDM-4/4a: redeemed' = redeemed + amount, các trường khác bất biến. Bản cũ so
  // `redeemed == amount`, chỉ đúng khi tài khoản chưa từng rút.
  const diff = accountDatumMismatches(redeemPlan.expected, dA);
  if (diff.length > 0) {
    throw new Error(`E2E-VERIFY-002: datum A sau redeem lệch kỳ vọng — ${diff.join("; ")}`);
  }
  if (dA.redeemed > dA.entitlement) {
    throw new Error(`redeemed (${dA.redeemed}) > entitlement (${dA.entitlement}) — vi phạm cap E`);
  }
  if (balAfter - balBefore !== redeem.amount) {
    console.log(`   ⚠ chênh balance (${balAfter - balBefore}) ≠ released (${redeem.amount}) ` +
      `— có thể do change UTxO/min-ADA; kiểm tra explorer.`);
  }

  console.log("\n✅ E2E hoàn tất — grant → post DropParam → redeem (vested tất định) chạy THẬT trên Preview.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
