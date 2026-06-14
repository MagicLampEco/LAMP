// Deposits Step 1: Deploy DepositParam beacon + pot (v2).
//
// Chạy: npx tsx 01_deploy_pot.ts
//   SUBMIT=false (mặc định): plan + dựng tx, KHÔNG submit (build-mode).
//   SUBMIT=true + .env đủ: submit live Preview.
//
// Flow v2:
//   1. deposit_param + deposits validator → script hash + address.
//   2. DepositParam beacon: bảng phí cọc (dưa leo=0, bò=cao) + clamp. Genesis output
//      mang NFT xác thực (live: mint NFT one-shot; build-mode: placeholder demo).
//   3. Seed PotDatum (sổ rỗng) với v2 params: deposit_param NFT policy/name,
//      treasury_credential (đích escheat), escheat_after_epoch, ms_per_epoch.
//   4. Tự kiểm potValueOk + validParam trước khi build.
//   5. Ghi deployed.json cho 02 dùng lại.

import {
  NETWORK, SUBMIT, LAMP_ASSET_NAME, LAMP_POLICY_ID,
  makeLucid, walletPkh, rawValidator, depositsValidator, depositParamValidator,
  scriptAddress, scriptHash, saveDeployed, awaitTx, explorerTx,
  type DepositsDeployedState,
} from "./config.js";
import { potDatumToCbor, depositParamToCbor } from "../offchain/src/datum.js";
import { potValue, potValueOk, type AssetMap } from "../offchain/src/ledger.js";
import { validParam } from "../offchain/src/schedule.js";
import { mapToAssets } from "../offchain/src/builder.js";
import type { Credential, DepositParam, PotDatum } from "../offchain/src/types.js";

const INSTANCE_ID = (process.env.INSTANCE_ID ?? "01").trim();
const RESERVED_MIN_ADA = BigInt(process.env.RESERVED_MIN_ADA ?? "2000000");

const LIFECYCLE_AUTH_KIND = (process.env.LIFECYCLE_AUTH_KIND ?? "VerificationKey").trim() as
  "VerificationKey" | "Script";
const LIFECYCLE_AUTH_HASH = (process.env.LIFECYCLE_AUTH_HASH ?? "").trim();

// v2 params.
const TREASURY_KIND = (process.env.TREASURY_KIND ?? "VerificationKey").trim() as
  "VerificationKey" | "Script";
const TREASURY_HASH = (process.env.TREASURY_HASH ?? "").trim();
const ESCHEAT_AFTER_EPOCH = BigInt(process.env.ESCHEAT_AFTER_EPOCH ?? "6");
const MS_PER_EPOCH = BigInt(process.env.MS_PER_EPOCH ?? "86400000"); // Preview 1 ngày/epoch
// beacon NFT (live: policy từ mint one-shot; build-mode: demo placeholder hex).
const DP_NFT_POLICY = (process.env.DP_NFT_POLICY ?? "9999").trim();
const DP_NFT_NAME   = (process.env.DP_NFT_NAME ?? "5041524d").trim();   // "PARM"

// bảng phí demo (oil; LAMP 1e6/đơn vị). DAO chỉnh sau qua deposit_param beacon.
// phân loại: asset_type 0=con vật,1=cây; value_tier 0=thấp..2=cao; lifecycle_class 0=ngắn..2=dài.
function demoBeacon(): DepositParam {
  return {
    tiers: [
      // dưa leo: cây + thấp + ngắn → cọc 0 (min-ADA đã chống rác).
      { asset_type: 1n, value_tier: 0n, lifecycle_class: 0n, base_deposit: 0n },
      // bò: con vật + cao + dài → 50 LAMP.
      { asset_type: 0n, value_tier: 2n, lifecycle_class: 2n, base_deposit: 50_000_000n },
    ],
    demand_mult: 1_000_000_000n,   // 1.0×
    m_min: 500_000_000n,
    m_max: 2_000_000_000n,
    epoch: 0n,
  };
}

async function main(): Promise<void> {
  console.log("=== Deposits Step 1 (v2): Deploy DepositParam beacon + pot ===\n");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  console.log(`Network:      ${NETWORK}`);
  console.log(`Deploy PKH:   ${pkh}`);
  console.log(`Instance id:  ${INSTANCE_ID}`);
  console.log(`SUBMIT:       ${SUBMIT}`);

  // ── validators ──
  const rawPot = await rawValidator("deposits.deposits.spend");
  const potScript = depositsValidator(rawPot.compiledCode);
  const potHash = scriptHash(potScript);
  const potAddr = scriptAddress(potScript);

  const rawParam = await rawValidator("deposit_param.deposit_param.spend");
  const paramScript = depositParamValidator(rawParam.compiledCode);
  const paramHash = scriptHash(paramScript);
  const paramAddr = scriptAddress(paramScript);
  console.log(`pot hash:     ${potHash}`);
  console.log(`pot addr:     ${potAddr}`);
  console.log(`beacon hash:  ${paramHash}`);
  console.log(`beacon addr:  ${paramAddr}\n`);

  // ── DepositParam beacon datum ──
  const beacon = demoBeacon();
  if (!validParam(beacon)) throw new Error("BEACON-001: bảng phí demo vi phạm bất biến clamp/base");
  console.log("beacon: dưa leo (cây/thấp/ngắn)=0 LAMP, bò (vật/cao/dài)=50 LAMP @1.0×");

  // ── pot seed datum (v2 params) ──
  const authority: Credential = {
    kind: LIFECYCLE_AUTH_KIND,
    hash: LIFECYCLE_AUTH_HASH || pkh,   // self-test: ví deploy = council key
  };
  const treasury: Credential = {
    kind: TREASURY_KIND,
    hash: TREASURY_HASH || pkh,         // self-test: Treasury = ví deploy (demo)
  };

  const lampPolicy = LAMP_POLICY_ID;
  const acceptedAssets = [
    { policy: "", name: "" },
    ...(lampPolicy ? [{ policy: lampPolicy, name: LAMP_ASSET_NAME }] : []),
  ];

  const seedDatum: PotDatum = {
    instance_id:          INSTANCE_ID,
    accepted_assets:      acceptedAssets,
    lifecycle_authority:  authority,
    reserved_min_ada:     RESERVED_MIN_ADA,
    deposit_param_policy: DP_NFT_POLICY,
    deposit_param_name:   DP_NFT_NAME,
    treasury_credential:  treasury,
    escheat_after_epoch:  ESCHEAT_AFTER_EPOCH,
    ms_per_epoch:         MS_PER_EPOCH,
    ledger:               [],
    epoch:                0n,
  };

  const potValueMap: AssetMap = potValue(seedDatum.ledger, RESERVED_MIN_ADA);
  if (!potValueOk(potValueMap, seedDatum.ledger, RESERVED_MIN_ADA)) {
    throw new Error("SEED-001: seedDatum vi phạm bất biến nền (sổ≠value)");
  }
  const potAssets = mapToAssets(potValueMap);

  // beacon output: NFT + datum (build-mode: NFT placeholder; live: mint one-shot trước).
  const beaconAssets = mapToAssets({ "|": RESERVED_MIN_ADA });

  const tx = await lucid
    .newTx()
    .pay.ToAddressWithData(
      paramAddr,
      { kind: "inline", value: depositParamToCbor(beacon) },
      beaconAssets,
    )
    .pay.ToAddressWithData(
      potAddr,
      { kind: "inline", value: potDatumToCbor(seedDatum) },
      potAssets,
    )
    .complete();

  if (!SUBMIT) {
    console.log("\nℹ️  SUBMIT=false — dựng tx (beacon + pot) thành công, KHÔNG submit (build-mode).");
    console.log(`    beacon datum (cbor): ${depositParamToCbor(beacon).slice(0, 40)}…`);
    console.log(`    pot seed datum (cbor): ${potDatumToCbor(seedDatum).slice(0, 40)}…`);
    console.log("    Live: mint NFT one-shot cho beacon + apply params deposit_param, đặt SUBMIT=true.");
    return;
  }

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`   TX:       ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, "deploy beacon + pot");

  const potUtxos = await lucid.utxosAt(potAddr);
  const potOut = potUtxos.find((u) => u.txHash === txHash);
  if (!potOut) throw new Error("SEED-002: không tìm thấy pot output sau confirm");
  const paramUtxos = await lucid.utxosAt(paramAddr);
  const paramOut = paramUtxos.find((u) => u.txHash === txHash);

  const state: DepositsDeployedState = {
    network:            NETWORK,
    pot:                { hash: potHash, address: potAddr },
    instanceId:         INSTANCE_ID,
    lifecycleAuthority: authority,
    reservedMinAda:     RESERVED_MIN_ADA.toString(),
    depositParam: {
      hash: paramHash, address: paramAddr, nftPolicy: DP_NFT_POLICY, nftName: DP_NFT_NAME,
      ...(paramOut ? { genesisUtxo: { txHash: paramOut.txHash, outputIndex: paramOut.outputIndex } } : {}),
    },
    treasuryCredential: treasury,
    escheatAfterEpoch:  ESCHEAT_AFTER_EPOCH.toString(),
    msPerEpoch:         MS_PER_EPOCH.toString(),
    genesis:            { potUtxo: { txHash: potOut.txHash, outputIndex: potOut.outputIndex } },
    ...(lampPolicy ? { lamp: { policyId: lampPolicy, assetName: LAMP_ASSET_NAME } } : {}),
    wallet:             { pkh },
  };
  await saveDeployed(state);
  console.log("\n✅ Đã ghi deployed.json. Tiếp: npx tsx 02_deposit_refund_e2e.ts");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
