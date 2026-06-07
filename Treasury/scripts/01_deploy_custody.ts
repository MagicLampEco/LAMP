// Treasury Step 1: Deploy custody — mint custody_seed NFT one-shot + tạo custody
// UTxO genesis qua custody_seed validator.
//
// Chạy: npx tsx 01_deploy_custody.ts   (sau 00_preflight)
//
// Flow (custody_seed.ak — GENESIS ép bất biến nền sổ↔value):
//   1. Chọn 1 UTxO ví làm genesis_ref (one-shot: policy chỉ chạy được 1 lần vì
//      UTxO spend được đúng 1 lần). NFT name = instance_id.
//   2. Apply custody validator (proposal_policy, ms_per_epoch) → custody address +
//      script hash. custody_seed parameterized (genesis_ref, custody_script_hash).
//   3. Dựng seed CustodyDatum (ledger khởi tạo, accepted_assets, cut_bps...) sao cho
//      seedDatumOk: value == ledgerValue ⊕ reserved_min_ada ∧ no_dup_lines ∧ accepted.
//   4. Mint 1 NFT custody_seed + tạo 1 output custody mang NFT + inline datum.
//   5. Ghi deployed.json để 02_collect_e2e dùng lại.
//
// KHÔNG submit ở chế độ build — chỉ import + tsc. Live khi có .env.

import { Constr, Data, type UTxO, type Validator } from "@lucid-evolution/lucid";
import {
  NETWORK, MS_PER_EPOCH, LAMP_ASSET_NAME, LAMP_POLICY_ID,
  makeLucid, walletPkh,
  rawValidator, applyValidator, applyMintingPolicy,
  scriptAddress, scriptHash, policyIdOf,
  saveDeployed, awaitTx, explorerTx, toUnit,
  type TreasuryDeployedState, type OutRef,
} from "./config.js";
import { custodyDatumToCbor } from "../offchain/src/datum.js";
import { seedValue, seedDatumOk, type AssetMap } from "../offchain/src/collect.js";
import { mapToAssets } from "../offchain/src/collectBuilder.js";
import type { CustodyDatum } from "../offchain/src/types.js";

// Instance id (hex) — định danh đa thuê bao. NFT name == instance_id (S-PARAM-0).
const INSTANCE_ID = (process.env.INSTANCE_ID ?? "01").trim();

// reserved_min_ada: lovelace giữ cho min-UTxO, KHÔNG ghi sổ (≥ 0).
const RESERVED_MIN_ADA = BigInt(process.env.RESERVED_MIN_ADA ?? "2000000");

// proposal_policy (Governance one-shot NFT). Self-test: placeholder 28-byte 0.
// Production: truyền PROPOSAL_POLICY qua .env (policy thật của Governance).
const PROPOSAL_POLICY = (process.env.PROPOSAL_POLICY ?? "00".repeat(28)).trim();

// cut_bps mặc định 1000 (10%). DAO chỉnh sau qua governance.
const CUT_BPS = BigInt(process.env.CUT_BPS ?? "1000");

/** SeedGenesis{reserved_min_ada} = Constr(0,[int]) — mirror custody_seed.ak redeemer. */
function seedRedeemerCbor(reservedMinAda: bigint): string {
  return Data.to(new Constr(0, [reservedMinAda]));
}

/** OutputReference (Plutus) = Constr(0,[tx_id:bytes, idx:int]) — cho custody_seed param. */
function outputRefData(txHash: string, index: number): Constr<Data> {
  return new Constr(0, [txHash.toLowerCase(), BigInt(index)]);
}

async function main(): Promise<void> {
  console.log("=== Treasury Step 1: Deploy custody (seed NFT + genesis UTxO) ===\n");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  console.log(`Network:        ${NETWORK}`);
  console.log(`Deploy PKH:     ${pkh}`);
  console.log(`Instance id:    ${INSTANCE_ID}`);
  console.log(`reserved_min:   ${RESERVED_MIN_ADA} lovelace`);
  console.log(`proposal_policy:${PROPOSAL_POLICY}`);
  console.log();

  // ── 1. genesis_ref: chọn 1 UTxO ví (một-shot) ──────────────────────────
  const walletUtxos: UTxO[] = await lucid.wallet().getUtxos();
  if (walletUtxos.length === 0) throw new Error("ví không có UTxO — nạp tADA từ faucet.");
  const genesis = walletUtxos[0]!;
  const genesisRef: OutRef = { txHash: genesis.txHash, outputIndex: genesis.outputIndex };
  console.log(`genesis_ref:    ${genesisRef.txHash}#${genesisRef.outputIndex}`);

  // ── 2. apply custody validator + custody_seed minting policy ───────────
  const rawCustody = await rawValidator("custody.custody.spend");
  const custodyScript: Validator = applyValidator(rawCustody.compiledCode, [
    PROPOSAL_POLICY, MS_PER_EPOCH,
  ]);
  const custodyHash = scriptHash(custodyScript);
  const custodyAddr = scriptAddress(custodyScript);

  const rawSeed = await rawValidator("custody_seed.custody_seed.mint");
  const seedPolicy = applyMintingPolicy(rawSeed.compiledCode, [
    outputRefData(genesisRef.txHash, genesisRef.outputIndex),
    custodyHash,
  ]);
  const seedPolicyId = policyIdOf(seedPolicy);

  console.log(`custody hash:   ${custodyHash}`);
  console.log(`custody addr:   ${custodyAddr}`);
  console.log(`seed policy id: ${seedPolicyId}`);
  console.log();

  // ── 3. seed CustodyDatum + value khớp bất biến nền ─────────────────────
  // LAMP policy: self-test có thể chưa có LAMP thật → seed ledger RỖNG (chỉ ADA
  // reserved, không ghi sổ). accepted_assets gồm ADA + LAMP (nếu policy biết).
  const lampPolicy = LAMP_POLICY_ID;   // "" nếu chưa cấp → chỉ accept ADA
  const acceptedAssets = [
    { policy: "", name: "" },
    ...(lampPolicy ? [{ policy: lampPolicy, name: LAMP_ASSET_NAME }] : []),
  ];

  const seedDatum: CustodyDatum = {
    instance_id:        INSTANCE_ID,
    accepted_assets:    acceptedAssets,
    ledger:             [],           // genesis: sổ rỗng (chưa thu gì)
    cut_bps:            CUT_BPS,
    governance_ref:     PROPOSAL_POLICY,  // gắn governance (placeholder self-test)
    epoch:              0n,
    consumed_proposals: [],
  };

  // value custody output = ledgerValue(ledger) ⊕ reserved_min_ada (lovelace).
  // ledger rỗng → chỉ reserved_min_ada ADA. Tự kiểm seedDatumOk trước khi build.
  const custodyValue: AssetMap = seedValue(seedDatum.ledger, RESERVED_MIN_ADA);
  if (!seedDatumOk(custodyValue, seedDatum, RESERVED_MIN_ADA)) {
    throw new Error("SEED-001: seedDatum vi phạm bất biến nền (sổ≠value / dup / asset không accepted)");
  }
  const custodyAssets = mapToAssets(custodyValue);
  // NFT authenticity custody (name == instance_id, qty 1).
  const seedNftUnit = toUnit(seedPolicyId, INSTANCE_ID);
  custodyAssets[seedNftUnit] = 1n;

  // ── 4. build tx: mint NFT + tạo custody output ─────────────────────────
  const tx = await lucid
    .newTx()
    .collectFrom([genesis])   // consume genesis_ref (one-shot)
    .mintAssets({ [seedNftUnit]: 1n }, seedRedeemerCbor(RESERVED_MIN_ADA))
    .attach.MintingPolicy(seedPolicy)
    .pay.ToAddressWithData(
      custodyAddr,
      { kind: "inline", value: custodyDatumToCbor(seedDatum) },
      custodyAssets,
    )
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log(`   TX:       ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
  await awaitTx(lucid, txHash, "deploy custody");

  // custody output index: tìm output mang NFT (Lucid không đảm bảo idx 0).
  const custodyUtxos = await lucid.utxosAt(custodyAddr);
  const custodyOut = custodyUtxos.find((u) => (u.assets[seedNftUnit] ?? 0n) === 1n);
  if (!custodyOut) throw new Error("SEED-002: không tìm thấy custody output mang NFT sau confirm");

  const state: TreasuryDeployedState = {
    network:        NETWORK,
    msPerEpoch:     MS_PER_EPOCH.toString(),
    proposalPolicy: PROPOSAL_POLICY,
    custody:        { hash: custodyHash, address: custodyAddr },
    custodySeed:    { policyId: seedPolicyId, genesisRef, instanceId: INSTANCE_ID },
    genesis:        { custodyUtxo: { txHash: custodyOut.txHash, outputIndex: custodyOut.outputIndex } },
    ...(lampPolicy ? { lamp: { policyId: lampPolicy, assetName: LAMP_ASSET_NAME } } : {}),
    wallet:         { pkh },
  };
  await saveDeployed(state);

  console.log("\n✅ Đã ghi deployed.json. Tiếp theo: npx tsx 02_collect_e2e.ts");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
