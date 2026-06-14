// Deposits Step 2 (v2): E2E demo — deposit ĐỘNG (dưa leo=0 vs bò cao) → refund → escheat.
//
// Chạy: npx tsx 02_deposit_refund_e2e.ts   (sau 01_deploy_pot)
//   SUBMIT=false (mặc định): PLAN cả 3 nghiệp vụ trên datum mô phỏng (tự kiểm bất
//     biến onchain qua planDeposit/planRefund/planEscheat), KHÔNG submit.
//   SUBMIT=true + .env đủ: dựng + submit deposit (bò) → refund live Preview.
//
// Demo định giá ĐỘNG: cùng beacon, dưa leo (cây/thấp/ngắn) cọc 0; bò (vật/cao/dài)
// cọc 50 LAMP. amount KHÔNG do client mớm — planDeposit ĐỌC beacon + ÉP.

import {
  NETWORK, SUBMIT, makeLucid, walletPkh, rawValidator, depositsValidator,
  loadDeployed, awaitTx, explorerTx,
} from "./config.js";
import {
  planDeposit, planRefund, planEscheat,
  buildDepositTx, buildRefundTx,
} from "../offchain/src/builder.js";
import type { AssetMap } from "../offchain/src/ledger.js";
import type { DepositParam, PotDatum } from "../offchain/src/types.js";
import type { UTxO } from "@lucid-evolution/lucid";

const ENTITY_CATTLE = (process.env.ENTITY_CATTLE ?? "e1cattle").trim();
const ENTITY_CUKE   = (process.env.ENTITY_CUKE ?? "e2cucumber").trim();

// beacon demo khớp 01_deploy_pot.demoBeacon (dưa leo=0, bò=50 LAMP @1.0×).
function demoBeacon(): DepositParam {
  return {
    tiers: [
      { asset_type: 1n, value_tier: 0n, lifecycle_class: 0n, base_deposit: 0n },
      { asset_type: 0n, value_tier: 2n, lifecycle_class: 2n, base_deposit: 50_000_000n },
    ],
    demand_mult: 1_000_000_000n, m_min: 500_000_000n, m_max: 2_000_000_000n, epoch: 0n,
  };
}

async function main(): Promise<void> {
  console.log("=== Deposits Step 2 (v2): deposit động → refund → escheat ===\n");

  const state = await loadDeployed().catch(() => null);
  const beacon = demoBeacon();

  // ── build-mode: PLAN cả 3 nghiệp vụ trên datum mô phỏng (KHÔNG cần .env/lucid) ──
  if (!SUBMIT) {
    console.log("ℹ️  SUBMIT=false — PLAN deposit động + refund + escheat (tự kiểm bất biến):\n");
    // demo pkh (KHÔNG cần ví thật cho plan thuần). policy/name từ state nếu có.
    const pkh = (process.env.DEMO_PKH ?? "a11ce0deadbeef").trim();
    const policy = state?.lamp?.policyId ?? "";
    const name = state?.lamp?.assetName ?? "";

    // datum mô phỏng (khớp seed 01 — v2 params).
    const reserved = BigInt(state?.reservedMinAda ?? "2000000");
    const escheatAfter = BigInt(state?.escheatAfterEpoch ?? "6");
    const datum0: PotDatum = {
      instance_id: state?.instanceId ?? "01",
      accepted_assets: [{ policy: "", name: "" }, ...(policy ? [{ policy, name }] : [])],
      lifecycle_authority: { kind: "VerificationKey", hash: pkh },
      reserved_min_ada: reserved,
      deposit_param_policy: state?.depositParam?.nftPolicy ?? "9999",
      deposit_param_name: state?.depositParam?.nftName ?? "5041524d",
      treasury_credential: { kind: "VerificationKey", hash: pkh },
      escheat_after_epoch: escheatAfter,
      ms_per_epoch: BigInt(state?.msPerEpoch ?? "86400000"),
      ledger: [],
      epoch: 10n,
    };
    let value0: AssetMap = { "|": reserved };

    // (a) DEPOSIT bò: phân loại (0,2,2) → beacon 50 LAMP. amount ÉP từ beacon.
    const depCattle = planDeposit(
      datum0, value0, beacon, ENTITY_CATTLE, pkh, policy, name, 0n, 2n, 2n, 11n,
    );
    console.log(`── DEPOSIT bò (vật/cao/dài) ── amount ÉP từ beacon = ${depCattle.amount} oil (50 LAMP)`);
    console.log(`   sổ: ${depCattle.newDatum.ledger.length} dòng; epoch → ${depCattle.newDatum.epoch}`);

    // (b) DEPOSIT dưa leo: phân loại (1,0,0) → beacon 0. KHÔNG ghi dòng (min-ADA đủ chống rác).
    const depCuke = planDeposit(
      depCattle.newDatum, depCattle.potAfter, beacon, ENTITY_CUKE, pkh, policy, name, 1n, 0n, 0n, 11n,
    );
    console.log(`── DEPOSIT dưa leo (cây/thấp/ngắn) ── amount ÉP từ beacon = ${depCuke.amount} oil (≈ 0)`);
    console.log(`   sổ: ${depCuke.newDatum.ledger.length} dòng (KHÔNG thêm dòng cho cọc 0)`);

    // (c) REFUND bò (creator-refund: về người tạo = pkh).
    const ref = planRefund(depCuke.newDatum, depCuke.potAfter, ENTITY_CATTLE, pkh, policy, name, 12n);
    console.log(`── REFUND bò ── trả ${ref.refundAmount} oil về người tạo ${pkh.slice(0, 12)}…; sổ xóa dòng`);

    // (d) ESCHEAT bò (mô phỏng: deposit epoch 11 + escheat_after → cur_epoch đủ hạn).
    //     dùng datum sau deposit (trước refund) để có dòng bò; cur_epoch = 11 + escheatAfter.
    const curEpoch = 11n + escheatAfter;
    const esc = planEscheat(
      depCuke.newDatum, depCuke.potAfter, ENTITY_CATTLE, pkh, policy, name, curEpoch, curEpoch,
    );
    console.log(`── ESCHEAT bò ── DID mồ côi quá hạn (cur ${curEpoch} ≥ 11+${escheatAfter}) → ${esc.escheatAmount} oil về Treasury; sổ xóa dòng`);

    console.log("\n✅ build-mode: cả 4 plan vượt qua bất biến onchain (deposit động/refund/escheat).");
    console.log("   Đặt SUBMIT=true + .env (BLOCKFROST + WALLET + LAMP_POLICY_ID + beacon NFT) để live.");
    return;
  }

  // ── live (SUBMIT=true): deposit bò → refund ──
  if (!state) throw new Error("E2E-000: chưa có deployed.json — chạy 01_deploy_pot.ts (SUBMIT=true) trước.");
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const policy = state.lamp?.policyId ?? "";
  const name = state.lamp?.assetName ?? "";
  const raw = await rawValidator("deposits.deposits.spend");
  const potScript = depositsValidator(raw.compiledCode);

  let potUtxos = await lucid.utxosAt(state.pot.address);
  let potUtxo: UTxO | undefined = state.genesis
    ? potUtxos.find((u) => u.txHash === state.genesis!.potUtxo.txHash && u.outputIndex === state.genesis!.potUtxo.outputIndex)
    : potUtxos[0];
  if (!potUtxo) throw new Error("E2E-001: không tìm thấy pot UTxO — kiểm tra deployed.json");

  // beacon reference UTxO.
  if (!state.depositParam?.genesisUtxo) throw new Error("E2E-003: thiếu DepositParam beacon UTxO trong deployed.json");
  const paramUtxos = await lucid.utxosAt(state.depositParam.address);
  const paramUtxo = paramUtxos.find(
    (u) => u.txHash === state.depositParam!.genesisUtxo!.txHash && u.outputIndex === state.depositParam!.genesisUtxo!.outputIndex,
  );
  if (!paramUtxo) throw new Error("E2E-004: không tìm thấy DepositParam beacon UTxO");

  console.log("── DEPOSIT bò (động — amount từ beacon) ──");
  const dep = await buildDepositTx({
    lucid, network: NETWORK, potUtxo, potScript, paramUtxo,
    entityId: ENTITY_CATTLE, depositor: pkh, policy, name,
    assetType: 0n, valueTier: 2n, lifecycleClass: 2n,
  });
  console.log(dep.summary);
  const sDep = await dep.tx.sign.withWallet().complete();
  const hDep = await sDep.submit();
  console.log(`   TX: ${hDep}  ${explorerTx(hDep)}`);
  await awaitTx(lucid, hDep, "deposit");
  potUtxos = await lucid.utxosAt(state.pot.address);
  potUtxo = potUtxos.find((u) => u.txHash === hDep);
  if (!potUtxo) throw new Error("E2E-002: không tìm thấy pot UTxO sau deposit");

  console.log("\n── REFUND bò (creator-refund) ──");
  const ref = await buildRefundTx({
    lucid, network: NETWORK, potUtxo, potScript,
    entityId: ENTITY_CATTLE, depositor: pkh, policy, name, signerPkh: pkh,
  });
  console.log(ref.summary);
  const sRef = await ref.tx.sign.withWallet().complete();
  const hRef = await sRef.submit();
  console.log(`   TX: ${hRef}  ${explorerTx(hRef)}`);
  await awaitTx(lucid, hRef, "refund");

  console.log("\n✅ E2E deposit động → refund hoàn tất. (escheat demo: build-mode plan ở trên.)");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
