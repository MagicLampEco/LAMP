// Treasury/scripts/01_seed_custody.ts — Bootstrap MỘT custody instance (genesis seed).
//
// Chạy: npm run seed   (hoặc: npx tsx 01_seed_custody.ts)
//
// Luồng (mirror Treasury seedBuilder + custody_seed.ak một-shot):
//   1. Chọn UTxO genesis (ví deploy) → genesis_ref. Thiếu cred (DRY) → ref tĩnh từ
//      GENESIS_REF .env hoặc placeholder, để vẫn apply-params + in plan/hash/address.
//   2. apply custody_seed(genesis_ref) → seed_policy (= mintingPolicyToId).
//   3. apply custody(proposal_policy, seed_policy, ms_per_epoch) → custody hash/address.
//   4. planSeed (Treasury SDK): dựng CustodyDatum genesis (sổ canonical, consumed=[]) +
//      value seed (gồm 1 NFT authenticity) + tự kiểm seedDatumOk (gương validator).
//   5. CÓ cred → buildSeedTx dry-run (.complete() build tx, KHÔNG submit). In datum/hash/
//      address/cbor. Thiếu cred → in plan tĩnh ("DRY: cần BLOCKFROST_KEY để build tx thật").
//   6. Ghi seeded.json (instance_id, custody_hash, seed_policy, ...).
//
// KHÔNG submit thật (không credential). KHÔNG đụng onchain/ hay offchain/src.

import { credentialToAddress, scriptHashToCredential, validatorToScriptHash } from "@lucid-evolution/lucid";
import {
  NETWORK, MS_PER_EPOCH,
  makeLucidOrNull, walletPkh,
  applyCustodyInstance, resolveProposalPolicy,
  asciiToHex, padHash28,
  evaluateLiveGuards, warnLiveBlocked,
  saveSeeded, explorerTx, type SeededInstance,
} from "./config.js";
import type { CustodyDatum, OutputReference } from "../offchain/src/types.js";
import { custodyDatumToCbor } from "../offchain/src/datum.js";
import { planSeed, buildSeedTx, seedPolicyId } from "../offchain/src/seedBuilder.js";

// ── Tham số instance (dev mặc định; override qua .env) ──────────
const INSTANCE_ID    = asciiToHex(process.env.INSTANCE_ID ?? "treasury-custody-v1");
const CUT_BPS        = BigInt(process.env.CUT_BPS ?? "500");                 // 5% mẫu
const RESERVED_MIN_ADA = BigInt(process.env.RESERVED_MIN_ADA ?? "2000000"); // 2 ADA min-UTxO
// governance_ref: script hash Governance gác treasury này. Dev → placeholder 28-byte.
const GOVERNANCE_REF_ENV = (process.env.GOVERNANCE_REF ?? "").trim().toLowerCase();
const GOVERNANCE_REF_PLACEHOLDER = GOVERNANCE_REF_ENV === "";   // F14: rỗng → placeholder
const GOVERNANCE_REF = GOVERNANCE_REF_ENV || padHash28(asciiToHex("treasury-committee"));

/**
 * Chọn genesis UTxO. Có ví → UTxO đầu của ví (one-shot tiêu khi seed). DRY → đọc
 * GENESIS_REF "txhash#index" từ .env, hoặc placeholder tĩnh (chỉ để apply-params).
 */
async function resolveGenesisRef(): Promise<{ ref: OutputReference; source: string; utxo: unknown | null }> {
  const lucid = await makeLucidOrNull();
  if (lucid) {
    const utxos = await lucid.wallet().getUtxos();
    if (utxos.length === 0) throw new Error("ví deploy không có UTxO nào để seed genesis");
    const u = utxos[0]!;
    return {
      ref: { transaction_id: u.txHash, output_index: BigInt(u.outputIndex) },
      source: "wallet-utxo",
      utxo: u,
    };
  }
  const env = (process.env.GENESIS_REF ?? "").trim();
  if (env) {
    const [tx, ix] = env.split("#");
    if (!tx || ix === undefined) throw new Error('GENESIS_REF sai định dạng — cần "txhash#index"');
    return { ref: { transaction_id: tx.toLowerCase(), output_index: BigInt(ix) }, source: "env", utxo: null };
  }
  // Placeholder tĩnh (32-byte tx hash giả) — chỉ để apply-params/in hash, KHÔNG build tx.
  return {
    ref: { transaction_id: "00".repeat(32), output_index: 0n },
    source: "placeholder",
    utxo: null,
  };
}

async function main(): Promise<void> {
  console.log("=== Treasury Step 1: Seed custody instance (apply-params + plan) ===\n");

  const proposal = resolveProposalPolicy();
  const { ref: genesisRef, source: genSource, utxo } = await resolveGenesisRef();

  // F14: VAN chặn LIVE khi param then-chốt còn PLACEHOLDER/rỗng.
  //   proposal_policy placeholder ⇔ proposal.source !== "env".
  //   governance_ref  placeholder ⇔ GOVERNANCE_REF_PLACEHOLDER.
  //   genesis_ref     placeholder ⇔ genSource === "placeholder".
  const guard = evaluateLiveGuards([
    { name: "proposal_policy", value: proposal.policy, placeholder: proposal.source !== "env" },
    { name: "governance_ref",  value: GOVERNANCE_REF,  placeholder: GOVERNANCE_REF_PLACEHOLDER },
    { name: "genesis_ref",     value: `${genesisRef.transaction_id}#${genesisRef.output_index}`, placeholder: genSource === "placeholder" },
  ]);
  const dry = !guard.allowLive;          // F14: placeholder → ÉP DRY (không build LIVE)

  console.log(`Network:         ${NETWORK}`);
  console.log(`ms_per_epoch:    ${MS_PER_EPOCH}`);
  console.log(`Mode:            ${dry ? "DRY (apply-params + plan tĩnh)" : "LIVE (build tx dry-run, KHÔNG submit)"}`);
  warnLiveBlocked(guard);                // in cảnh báo nếu LIVE bị chặn vì placeholder
  console.log(`genesis_ref:     ${genesisRef.transaction_id}#${genesisRef.output_index}  (${genSource})`);
  console.log(`proposal_policy: ${proposal.policy}  (${proposal.source})`);
  console.log(`governance_ref:  ${GOVERNANCE_REF}`);
  console.log(`instance_id:     ${INSTANCE_ID} ("${Buffer.from(INSTANCE_ID, "hex").toString("utf8")}")`);
  console.log(`cut_bps:         ${CUT_BPS}`);
  console.log(`reserved_min_ada:${RESERVED_MIN_ADA} lovelace\n`);

  // ── Apply params 2 validator (offline — KHÔNG cần mạng) ───────
  const applied = await applyCustodyInstance(genesisRef, proposal.policy, MS_PER_EPOCH);
  console.log("── Applied validators ──");
  console.log(`seed_policy:     ${applied.seedPolicy}`);
  console.log(`custody hash:    ${applied.custodyHash}`);
  console.log(`custody addr:    ${applied.custodyAddr}\n`);

  // ── Plan seed datum + value + tự kiểm seedDatumOk (gương validator) ──
  // CustodyDatum genesis: sổ rỗng (custody bắt đầu trống — chỉ reserved ADA + NFT).
  const datumIn: CustodyDatum = {
    instance_id:        INSTANCE_ID,
    accepted_assets:    [{ policy: "", name: "" }],   // ADA tối thiểu (DAO mở rộng sau)
    ledger:             [],                            // genesis trống
    cut_bps:            CUT_BPS,
    governance_ref:     GOVERNANCE_REF,
    epoch:              0n,
    consumed_proposals: [],
  };
  const plan = planSeed(datumIn, applied.seedPolicy, RESERVED_MIN_ADA);
  const datumCbor = custodyDatumToCbor(plan.datum);

  console.log("── Seed plan (seedDatumOk PASS) ──");
  console.log(`NFT authenticity: ${plan.seedPolicy}${plan.nftName} (qty 1)`);
  console.log(`seed_policy ck:   ${seedPolicyId(applied.custodySeed) === plan.seedPolicy ? "khớp ✓" : "LỆCH ✗"}`);
  console.log(`datum cbor:       ${datumCbor}`);
  console.log(`custody value:    ${JSON.stringify(plan.custodyValue, (_k, v) => typeof v === "bigint" ? v.toString() : v)}\n`);

  // ── Build tx dry-run (chỉ khi có cred) — .complete() build NHƯNG KHÔNG submit ──
  let txHash: string | undefined;
  if (!dry) {
    const lucid = (await makeLucidOrNull())!;
    const pkh = await walletPkh(lucid);
    console.log(`Deploy wallet PKH: ${pkh}`);
    if (!utxo) throw new Error("LIVE mode nhưng không resolve được UTxO genesis (bug)");
    const res = await buildSeedTx({
      lucid,
      network: NETWORK,
      custodySeed:   applied.custodySeed,
      custodyScript: applied.custodyScript,
      genesisUtxo:   utxo as never,
      datum:         datumIn,
      reservedMinAda: RESERVED_MIN_ADA,
    });
    console.log("── buildSeedTx (dry-run, KHÔNG submit) ──");
    console.log(res.summary);
    console.log(`\nKÝ + SUBMIT thủ công sau khi anh duyệt (script KHÔNG tự submit).`);
    console.log(`Sau submit: ${explorerTx("<txHash>")}`);
  } else {
    console.log("── DRY: cần BLOCKFROST_KEY + PRIVATE_KEY/WALLET_SEED để build tx thật ──");
    console.log("Phần apply-params/hash/address/datum ở trên KHÔNG cần mạng — đã đủ kiểm.");
    const custodyAddrCheck = credentialToAddress(
      NETWORK, scriptHashToCredential(validatorToScriptHash(applied.custodyScript)),
    );
    console.log(`custody addr (verify): ${custodyAddrCheck}`);
  }

  // ── Ghi seeded.json ──────────────────────────────────────────
  const state: SeededInstance = {
    network:        NETWORK,
    msPerEpoch:     MS_PER_EPOCH.toString(),
    instanceId:     INSTANCE_ID,
    custodyHash:    applied.custodyHash,
    custodyAddress: applied.custodyAddr,
    seedPolicy:     applied.seedPolicy,
    proposalPolicy: proposal.policy,
    proposalSource: proposal.source,
    genesisRef: {
      transaction_id: genesisRef.transaction_id,
      output_index:   genesisRef.output_index.toString(),
    },
    cutBps:         CUT_BPS.toString(),
    reservedMinAda: RESERVED_MIN_ADA.toString(),
    datumCbor,
    dryRun:         dry,
    ...(txHash ? { txHash } : {}),
  };
  await saveSeeded(state);
  console.log(`\n✅ Đã ghi seeded.json (instance_id, custody_hash, seed_policy).`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
