// Deposits Step 1: Deploy pot — tạo pot UTxO genesis (sổ rỗng) ở deposits validator.
//
// Chạy: npx tsx 01_deploy_pot.ts   (sau 00_preflight nếu có)
//   SUBMIT=false (mặc định): plan + dựng tx, KHÔNG submit (build-mode).
//   SUBMIT=true + .env đủ: submit live Preview.
//
// Flow:
//   1. deposits validator KHÔNG param → script hash + pot address.
//   2. Dựng seed PotDatum (ledger rỗng, accepted_assets, lifecycle_authority,
//      reserved_min_ada). value pot = reserved_min_ada (lovelace), không bond.
//   3. Tự kiểm potValueOk trước khi build.
//   4. Tạo 1 output pot mang inline datum (+ reserved_min_ada ADA).
//   5. Ghi deployed.json cho 02_deposit_refund_e2e dùng lại.

import {
  NETWORK, SUBMIT, LAMP_ASSET_NAME, LAMP_POLICY_ID,
  makeLucid, walletPkh, rawValidator, depositsValidator,
  scriptAddress, scriptHash, saveDeployed, awaitTx, explorerTx,
  type DepositsDeployedState,
} from "./config.js";
import { potDatumToCbor } from "../offchain/src/datum.js";
import { potValue, potValueOk, type AssetMap } from "../offchain/src/ledger.js";
import { mapToAssets } from "../offchain/src/builder.js";
import type { Credential, PotDatum } from "../offchain/src/types.js";

const INSTANCE_ID = (process.env.INSTANCE_ID ?? "01").trim();
const RESERVED_MIN_ADA = BigInt(process.env.RESERVED_MIN_ADA ?? "2000000");

// lifecycle_authority: mặc định = pkh ví deploy (council key self-test). Production:
// truyền LIFECYCLE_AUTH_HASH + LIFECYCLE_AUTH_KIND (VerificationKey|Script) qua .env.
const LIFECYCLE_AUTH_KIND = (process.env.LIFECYCLE_AUTH_KIND ?? "VerificationKey").trim() as
  "VerificationKey" | "Script";
const LIFECYCLE_AUTH_HASH = (process.env.LIFECYCLE_AUTH_HASH ?? "").trim();

async function main(): Promise<void> {
  console.log("=== Deposits Step 1: Deploy pot (genesis UTxO) ===\n");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  console.log(`Network:      ${NETWORK}`);
  console.log(`Deploy PKH:   ${pkh}`);
  console.log(`Instance id:  ${INSTANCE_ID}`);
  console.log(`reserved_min: ${RESERVED_MIN_ADA} lovelace`);
  console.log(`SUBMIT:       ${SUBMIT}`);

  const raw = await rawValidator("deposits.deposits.spend");
  const potScript = depositsValidator(raw.compiledCode);
  const potHash = scriptHash(potScript);
  const potAddr = scriptAddress(potScript);
  console.log(`pot hash:     ${potHash}`);
  console.log(`pot addr:     ${potAddr}\n`);

  const authority: Credential = {
    kind: LIFECYCLE_AUTH_KIND,
    hash: LIFECYCLE_AUTH_HASH || pkh,   // self-test: ví deploy là council key
  };

  const lampPolicy = LAMP_POLICY_ID;
  const acceptedAssets = [
    { policy: "", name: "" },
    ...(lampPolicy ? [{ policy: lampPolicy, name: LAMP_ASSET_NAME }] : []),
  ];

  const seedDatum: PotDatum = {
    instance_id:         INSTANCE_ID,
    accepted_assets:     acceptedAssets,
    lifecycle_authority: authority,
    reserved_min_ada:    RESERVED_MIN_ADA,
    ledger:              [],            // genesis: sổ rỗng (chưa cọc gì)
    epoch:               0n,
  };

  const potValueMap: AssetMap = potValue(seedDatum.ledger, RESERVED_MIN_ADA);
  if (!potValueOk(potValueMap, seedDatum.ledger, RESERVED_MIN_ADA)) {
    throw new Error("SEED-001: seedDatum vi phạm bất biến nền (sổ≠value)");
  }
  const potAssets = mapToAssets(potValueMap);

  const tx = await lucid
    .newTx()
    .pay.ToAddressWithData(
      potAddr,
      { kind: "inline", value: potDatumToCbor(seedDatum) },
      potAssets,
    )
    .complete();

  if (!SUBMIT) {
    console.log("ℹ️  SUBMIT=false — dựng tx thành công, KHÔNG submit (build-mode).");
    console.log(`    seed datum (cbor): ${potDatumToCbor(seedDatum).slice(0, 40)}…`);
    console.log("    Đặt SUBMIT=true + .env đủ để deploy live Preview.");
    return;
  }

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`   TX:       ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, "deploy pot");

  const potUtxos = await lucid.utxosAt(potAddr);
  const potOut = potUtxos.find((u) => u.txHash === txHash);
  if (!potOut) throw new Error("SEED-002: không tìm thấy pot output sau confirm");

  const state: DepositsDeployedState = {
    network:            NETWORK,
    pot:                { hash: potHash, address: potAddr },
    instanceId:         INSTANCE_ID,
    lifecycleAuthority: authority,
    reservedMinAda:     RESERVED_MIN_ADA.toString(),
    genesis:            { potUtxo: { txHash: potOut.txHash, outputIndex: potOut.outputIndex } },
    ...(lampPolicy ? { lamp: { policyId: lampPolicy, assetName: LAMP_ASSET_NAME } } : {}),
    wallet:             { pkh },
  };
  await saveDeployed(state);
  console.log("\n✅ Đã ghi deployed.json. Tiếp: npx tsx 02_deposit_refund_e2e.ts");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
