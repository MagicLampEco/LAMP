// PlatformKit/scripts/03_onboard_platform.ts — Onboard MỘT platform (PhoenixKey/OriLife).
//
// Chạy: npm run onboard -- phoenixkey      (hoặc orilife)
//       npx tsx 03_onboard_platform.ts phoenixkey
//
// Luồng (onboardPlatform = 2 BƯỚC, đúng thứ tự dependency):
//   BƯỚC 1 (SEED):    bootstrap Treasury custody instance (mint seed NFT + custody UTxO).
//   BƯỚC 2 (REGISTER): mint beacon NFT + entry UTxO ở registry address (trỏ vào instance).
//   BƯỚC 1 PHẢI confirm trước BƯỚC 2 (entry.seed_policy/instance_id trỏ instance đã seed).
//
// Apply-params (offline) cho cả custody (Treasury) lẫn registry (đã có ở registry.json):
//   custody_seed(genesis_ref) → seed_policy ; custody(proposal_policy, seed_policy, ms_per_epoch)
//   → custody_hash. beacon_policy lấy từ registry.json (deploy-registry).
//
// onboardPlatform tự kiểm 2 gương validator (seedDatumOk + entryWellFormed) fail-fast.
// KHÔNG submit thật (không credential). CÓ cred → build 2 tx dry-run (.complete()).

import {
  NETWORK, MS_PER_EPOCH,
  makeLucidOrNull, walletPkh,
  resolveProposalPolicy,
  applyCustodySeed, seedPolicyId,
  rawValidator, applyValidator, scriptHash, scriptAddress,
  loadRegistry, saveOnboarded, explorerTx,
  evaluateLiveGuards, warnLiveBlocked,
  loadOnboardedList, checkGovernanceRefCollision, warnGovernanceRefCollision,
  appendOnboardedList,
} from "./config.js";
import { onboardPlatform } from "../offchain/src/onboard.js";
import type { PlatformConfig } from "../offchain/src/types.js";
import type { OutputReference } from "../../Treasury/offchain/src/types.js";
import { buildSeedTx } from "../../Treasury/offchain/src/seedBuilder.js";
import { custodyDatumToCbor } from "../../Treasury/offchain/src/datum.js";
// Config platform là VÍ DỤ THAM CHIẾU (examples/) — không phải lõi framework.
// Mỗi platform tự viết config tương tự (copy examples/_template.ts).
import { phoenixKeyConfig } from "../examples/phoenixkey.js";
import { oriLifeConfig } from "../examples/orilife.js";

// ── chọn platform từ argv ──────────────────────────────────────
type PlatformName = "phoenixkey" | "orilife";

function parsePlatformArg(): PlatformName {
  const a = (process.argv[2] ?? process.env.PLATFORM ?? "phoenixkey").toLowerCase();
  if (a === "phoenixkey" || a === "orilife") return a;
  throw new Error(`platform '${a}' không hỗ trợ — dùng: phoenixkey | orilife`);
}

// placeholder policy dev (LAMP/MAGIC điền runtime sau khi Distribution/MAGIC deploy).
const DEV_LAMP_POLICY  = (process.env.LAMP_POLICY_ID  ?? "").trim().toLowerCase() || "11".repeat(28);
const DEV_MAGIC_POLICY = (process.env.MAGIC_POLICY_ID ?? "").trim().toLowerCase() || "22".repeat(28);

/** genesis_ref: LIVE → UTxO đầu của ví; DRY → GENESIS_REF env hoặc placeholder tĩnh. */
async function resolveGenesisRef(): Promise<{ ref: OutputReference; source: string; utxo: unknown | null }> {
  const lucid = await makeLucidOrNull();
  if (lucid) {
    const utxos = await lucid.wallet().getUtxos();
    if (utxos.length === 0) throw new Error("ví không có UTxO để seed genesis");
    const u = utxos[0]!;
    return { ref: { transaction_id: u.txHash, output_index: BigInt(u.outputIndex) }, source: "wallet-utxo", utxo: u };
  }
  const env = (process.env.GENESIS_REF ?? "").trim();
  if (env) {
    const [tx, ix] = env.split("#");
    if (!tx || ix === undefined) throw new Error('GENESIS_REF sai định dạng — cần "txhash#index"');
    return { ref: { transaction_id: tx.toLowerCase(), output_index: BigInt(ix) }, source: "env", utxo: null };
  }
  return { ref: { transaction_id: "00".repeat(32), output_index: 0n }, source: "placeholder", utxo: null };
}

// governance_ref override: env GOVERNANCE_REF (28-byte hex). Trống → undefined → platform
// dùng placeholder mặc định (padHash28("<name>-committee")). F14: source theo env.
const GOVERNANCE_REF_ENV = (process.env.GOVERNANCE_REF ?? "").trim().toLowerCase();
const GOVERNANCE_REF_PLACEHOLDER = GOVERNANCE_REF_ENV === "";

function buildConfig(
  name: PlatformName,
  opts: {
    registryAuthority: string;
    genesisRef: { transaction_id: string; output_index: bigint };
    seedPolicy: string;
  },
): PlatformConfig {
  const common = {
    lampPolicy:     DEV_LAMP_POLICY,
    registryAuthority: opts.registryAuthority,
    msPerEpoch:     MS_PER_EPOCH,
    reservedMinAda: 2_000_000n,
    genesisRef:     opts.genesisRef,
    seedPolicy:     opts.seedPolicy,
    // env override (nếu set) — KHÔNG truyền undefined để giữ default placeholder của platform.
    ...(GOVERNANCE_REF_ENV ? { governanceRef: GOVERNANCE_REF_ENV } : {}),
  };
  if (name === "phoenixkey") {
    return phoenixKeyConfig({ ...common, magicPolicy: DEV_MAGIC_POLICY });
  }
  return oriLifeConfig(common);
}

async function main(): Promise<void> {
  const name = parsePlatformArg();
  console.log(`=== PlatformKit Step 3: Onboard platform '${name}' ===\n`);

  const registry = await loadRegistry();
  const proposal = resolveProposalPolicy();
  const { ref: genesisRef, source: genSource, utxo } = await resolveGenesisRef();
  const createdEpoch = BigInt(process.env.CREATED_EPOCH ?? "0");

  // F14: VAN chặn LIVE khi param then-chốt còn PLACEHOLDER/rỗng (governance_ref kiểm sau
  // khi có config). registry_authority placeholder ⇔ authoritySource !== "env".
  const guard = evaluateLiveGuards([
    { name: "registry_authority", value: registry.registryAuthority, placeholder: registry.authoritySource !== "env" },
    { name: "proposal_policy",    value: proposal.policy,            placeholder: proposal.source !== "env" },
    { name: "genesis_ref",        value: `${genesisRef.transaction_id}#${genesisRef.output_index}`, placeholder: genSource === "placeholder" },
  ]);
  const dry = !guard.allowLive;          // F14: placeholder → ÉP DRY

  console.log(`Network:            ${NETWORK}`);
  console.log(`Mode:               ${dry ? "DRY (apply-params + plan tĩnh, không build tx)" : "LIVE (build 2 tx dry-run, KHÔNG submit)"}`);
  console.log(`registry_authority: ${registry.registryAuthority}  (${registry.authoritySource})`);
  console.log(`beacon_policy:      ${registry.beaconPolicy}`);
  console.log(`registry address:   ${registry.registryAddress}`);
  console.log(`proposal_policy:    ${proposal.policy}  (${proposal.source})`);
  console.log(`genesis_ref:        ${genesisRef.transaction_id}#${genesisRef.output_index}  (${genSource})`);
  console.log(`created_epoch:      ${createdEpoch}\n`);
  warnLiveBlocked(guard);                // F14: cảnh báo nếu LIVE bị chặn vì placeholder

  // ── Apply custody (Treasury) — lấy seed_policy + custody_hash ──
  const rawSeed = await rawValidator("custody_seed.custody_seed.mint");
  const custodySeed = applyCustodySeed(rawSeed.compiledCode, genesisRef);
  const seedPolicy = seedPolicyId(custodySeed);

  const rawCustody = await rawValidator("custody.custody.spend");
  const custodyScript = applyValidator(rawCustody.compiledCode, [
    proposal.policy, seedPolicy, MS_PER_EPOCH,
  ]);
  const custodyHash = scriptHash(custodyScript);
  const custodyAddr = scriptAddress(custodyScript);

  console.log("── Applied custody (Treasury) ──");
  console.log(`seed_policy:        ${seedPolicy}`);
  console.log(`custody hash:       ${custodyHash}`);
  console.log(`custody address:    ${custodyAddr}\n`);

  // ── Config platform + onboard plan (tự kiểm 2 gương validator) ─
  const config = buildConfig(name, {
    registryAuthority: registry.registryAuthority,
    genesisRef,
    seedPolicy,
  });

  // F14: governance_ref placeholder? (env trống → platform dùng padHash28("<name>-committee")).
  // Nếu placeholder → CHẶN LIVE thêm lần nữa (governance_ref biết được sau buildConfig).
  const govGuard = evaluateLiveGuards([
    { name: "governance_ref", value: config.governanceRef, placeholder: GOVERNANCE_REF_PLACEHOLDER },
  ]);
  warnLiveBlocked(govGuard);

  // F14: kiểm KHÔNG hai instance chung governance_ref (cảnh báo sớm replay chéo).
  const onboardedList = await loadOnboardedList();
  const collisions = checkGovernanceRefCollision(
    onboardedList, config.instanceId, config.governanceRef,
  );
  warnGovernanceRefCollision(collisions, config.governanceRef);

  const plan = onboardPlatform({
    config,
    beaconPolicy: registry.beaconPolicy,
    custodyHash,
    seedPolicy,
    createdEpoch,
  });

  console.log(plan.summary);
  console.log();
  console.log("── Datums (CBOR inline) ──");
  console.log(`custody (seed) datum: ${custodyDatumToCbor(plan.seed.datum)}`);
  console.log(`entry datum:          ${plan.register.entryDatumCbor}`);
  console.log(`mint redeemer:        ${plan.register.mintRedeemerCbor}`);
  console.log(`required signer:      ${plan.register.requiredSigner} (registry_authority — R-SIG)`);
  console.log();

  // F14: dry HỮU HIỆU = dry ban đầu ∨ governance_ref placeholder (gộp cả 2 van).
  const effectiveDry = dry || !govGuard.allowLive;

  // ── Build 2 tx dry-run (chỉ khi có cred + mọi param thật) ─────
  if (!effectiveDry) {
    const lucid = (await makeLucidOrNull())!;
    const pkh = await walletPkh(lucid);
    console.log(`Deploy wallet PKH: ${pkh}`);
    if (!utxo) throw new Error("LIVE mode nhưng không resolve được UTxO genesis (bug)");

    console.log("\n── BƯỚC 1: buildSeedTx (dry-run, KHÔNG submit) ──");
    const seedRes = await buildSeedTx({
      lucid, network: NETWORK,
      custodySeed, custodyScript,
      genesisUtxo: utxo as never,
      datum: {
        instance_id:        config.instanceId,
        accepted_assets:    config.acceptedAssets,
        ledger:             [],
        cut_bps:            config.cutBps,
        governance_ref:     config.governanceRef,
        epoch:              createdEpoch,
        consumed_proposals: [],
      },
      reservedMinAda: config.reservedMinAda,
    });
    console.log(seedRes.summary);

    console.log("\n── BƯỚC 2: build register tx (dry-run) — mint beacon NFT + entry UTxO ──");
    // Register tx: mint 1 beacon NFT (registry_beacon, name=platform_id) + output entry ở
    // registry address mang entry datum. Cần attach registry_beacon (minting) + ký authority.
    // (KHÔNG submit — chỉ .complete() để chứng minh tx hợp lệ.)
    const nftUnit = registry.beaconPolicy + plan.register.nftName;
    const registryBeacon = applyValidator(
      (await rawValidator("registry_beacon.registry_beacon.mint")).compiledCode,
      [registry.registryAuthority],
    );
    try {
      const regTx = await lucid.newTx()
        .mintAssets({ [nftUnit]: 1n }, plan.register.mintRedeemerCbor)
        .attach.MintingPolicy(registryBeacon)
        .pay.ToAddressWithData(
          registry.registryAddress,
          { kind: "inline", value: plan.register.entryDatumCbor },
          { [nftUnit]: 1n },
        )
        .addSignerKey(plan.register.requiredSigner)
        .complete();
      void regTx;
      console.log("register tx build OK (chưa ký/submit).");
    } catch (e) {
      console.log(`register tx build cần authority ký + min-ADA: ${e instanceof Error ? e.message : e}`);
      console.log("(authority placeholder không ký được — production truyền REGISTRY_AUTHORITY thật.)");
    }
    console.log(`\nSau submit BƯỚC 1 rồi BƯỚC 2: ${explorerTx("<txHash>")}`);
  } else {
    console.log("── DRY: cần BLOCKFROST_KEY + ví để build 2 tx thật (vẫn KHÔNG submit) ──");
    console.log("Plan + datum + address + hash ở trên KHÔNG cần mạng — đã đủ kiểm gương validator.");
  }

  // ── Ghi onboarded.json ────────────────────────────────────────
  await saveOnboarded({
    network:        NETWORK,
    platform:       name,
    platformId:     plan.register.entry.platform_id,
    instanceId:     plan.seed.datum.instance_id,
    custodyHash,
    custodyAddress: custodyAddr,
    seedPolicy,
    beaconPolicy:   registry.beaconPolicy,
    registryAddress: registry.registryAddress,
    entryDatumCbor: plan.register.entryDatumCbor,
    requiredSigner: plan.register.requiredSigner,
    governanceRef:  config.governanceRef,
    genesisRef:     { transaction_id: genesisRef.transaction_id, output_index: genesisRef.output_index.toString() },
    createdEpoch:   createdEpoch.toString(),
    dryRun:         effectiveDry,
  });

  // F14: cập nhật history list instance (để lần onboard sau kiểm trùng governance_ref).
  await appendOnboardedList({
    platform:      name,
    instanceId:    config.instanceId,
    governanceRef: config.governanceRef,
  });
  console.log(`\n✅ Đã ghi onboarded.json + onboarded-instances.json cho '${name}'.`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
