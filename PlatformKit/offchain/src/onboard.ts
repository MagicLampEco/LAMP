// PlatformKit onboard — orchestrator cấp cao: đưa một Platform vào hệ sinh thái.
//
// onboardPlatform(config) trả PLAN 2 BƯỚC (theo đúng thứ tự + dependency):
//   BƯỚC 1 (SEED): bootstrap Treasury custody instance qua Treasury seedBuilder.planSeed
//     → mint NFT authenticity (seed_policy, instance_id) + output custody ở custody address
//     mang CustodyDatum genesis (sổ canonical, consumed=[]). seed_policy SUY từ bước này.
//   BƯỚC 2 (REGISTER): planRegister → mint beacon NFT (registry_beacon, name=platform_id)
//     + output entry UTxO ở registry script address mang datum PlatformEntry well-formed.
//
// DEPENDENCY: bước 2 cần seed_policy (kết quả bước 1) để điền entry.seed_policy +
//   instance_id phải khớp giữa custody datum và entry. → BƯỚC 1 PHẢI confirm trước BƯỚC 2
//   (entry trỏ vào instance đã tồn tại). KHÔNG submit thật ở đây (không credential) —
//   trả plan + tự-kiểm cả hai gương validator.
//
// R-BIND (MỚI): bước REGISTER on-chain ép tx reference 1 custody UTxO mang đúng 1 NFT
//   authenticity (seed_policy, instance_id) Ở Script(custodyHash). custody UTxO đó CHÍNH LÀ
//   output custody của bước SEED. → BƯỚC 1 PHẢI SUBMIT (custody UTxO tồn tại trên chain)
//   trước BƯỚC 2; caller phải có txHash#outputIndex của custody output để readFrom. onboard
//   dựng custodyRef từ seed.custodyValue + custodyHash; caller điền custodyOutRef sau submit.

import type { PlatformConfig } from "./types.js";
import { planRegister, type RegisterPlan, type CustodyRef } from "./registrationBuilder.js";
import type { CustodyDatum } from "../../../Treasury/offchain/src/types.js";
import { planSeed, type SeedPlan } from "../../../Treasury/offchain/src/seedBuilder.js";

export interface OnboardParams {
  config: PlatformConfig;

  /** beacon NFT policy = hash(registry_beacon(authority)). Caller cấp sau aiken build+apply. */
  beaconPolicy: string;
  /** custody script hash của platform (custody.ak đã apply). Vào entry.custody_hash + seed datum address. */
  custodyHash: string;
  /** seed_policy = mintingPolicyToId(custody_seed đã apply genesisRef). */
  seedPolicy: string;
  /** epoch đăng ký (created_epoch) ≥ 0. */
  createdEpoch: bigint;

  /** Sổ kế toán genesis (thường rỗng — custody bắt đầu trống, chỉ reserved ADA).
   *  Nếu rỗng, planSeed dựng datum canonical với ledger=[]. */
  genesisLedger?: CustodyDatum["ledger"];

  /** Tham chiếu UTxO custody output của bước SEED (sau khi SEED đã SUBMIT).
   *  Bước REGISTER PHẢI readFrom UTxO này (R-BIND). txHash/outputIndex chỉ biết SAU submit
   *  bước 1 → khi mới dựng plan (chưa submit) có thể bỏ trống, điền lại trước khi build tx
   *  REGISTER thật. Gương R-BIND vẫn chạy trên value+custodyHash bất kể ref. */
  custodyOutRef?: { txHash: string; outputIndex: number };
}

export interface OnboardPlan {
  /** BƯỚC 1 — seed custody instance (Treasury). PHẢI confirm trước bước 2. */
  seed: SeedPlan;
  /** BƯỚC 2 — đăng ký entry vào registry (PlatformKit). Phụ thuộc seed.seedPolicy. */
  register: RegisterPlan;
  /** Tóm tắt 2 bước + dependency, người đọc. */
  summary: string;
}

/**
 * Dựng plan onboard đầy đủ một platform. KHÔNG submit (không credential) — trả plan +
 * tự kiểm cả hai gương validator (seedDatumOk trong planSeed; entryWellFormed trong planRegister).
 * Ném lỗi fail-fast nếu bất kỳ gương nào fail.
 */
export function onboardPlatform(params: OnboardParams): OnboardPlan {
  const { config, beaconPolicy, custodyHash, seedPolicy, createdEpoch } = params;

  // ── BƯỚC 1: SEED custody instance ─────────────────────────────────────────
  // CustodyDatum genesis: instance_id, accepted_assets, ledger (canonical hoá trong planSeed),
  // cut_bps, governance_ref, epoch. planSeed ép consumed=[] + tự kiểm seedDatumOk.
  const custodyDatumIn: CustodyDatum = {
    instance_id:     config.instanceId,
    accepted_assets: config.acceptedAssets,
    ledger:          params.genesisLedger ?? [],
    cut_bps:         config.cutBps,
    governance_ref:  config.governanceRef,
    epoch:           createdEpoch,
    consumed_proposals: [],
  };
  const seed = planSeed(custodyDatumIn, seedPolicy, config.reservedMinAda);

  // DEPENDENCY: instance_id của custody == instance_id entry; seed_policy entry == seed.seedPolicy.
  // (seed.seedPolicy = seedPolicy truyền vào — giữ nhất quán.)

  // R-BIND: custody UTxO bước REGISTER readFrom = output custody của bước SEED. value =
  // seed.custodyValue (mang NFT authenticity qty 1); địa chỉ = Script(custodyHash). txHash/
  // outputIndex chỉ biết SAU submit bước 1 → caller điền qua custodyOutRef.
  const custodyUtxo: CustodyRef = {
    value:      seed.custodyValue,
    scriptHash: custodyHash,
    // txHash/outputIndex chỉ set khi caller đã có (sau submit BƯỚC 1) — tránh gán undefined
    // dưới exactOptionalPropertyTypes.
    ...(params.custodyOutRef !== undefined
      ? { txHash: params.custodyOutRef.txHash, outputIndex: params.custodyOutRef.outputIndex }
      : {}),
  };

  // ── BƯỚC 2: REGISTER entry vào registry ───────────────────────────────────
  const register = planRegister({
    config,
    beaconPolicy,
    custodyHash,
    seedPolicy: seed.seedPolicy,   // <-- dependency từ bước 1
    createdEpoch,
    custodyUtxo,                    // <-- R-BIND: custody từ bước SEED
  });

  // Kiểm chéo: entry.instance_id phải khớp custody instance_id (cùng instance).
  if (register.entry.instance_id !== seed.datum.instance_id.toLowerCase()) {
    throw new Error(
      `ONBOARD-INST: entry.instance_id (${register.entry.instance_id}) != custody instance_id `
      + `(${seed.datum.instance_id}) — entry phải trỏ đúng instance đã seed`,
    );
  }
  // Kiểm chéo: entry.seed_policy phải khớp seed_policy custody (NFT authenticity).
  if (register.entry.seed_policy !== seed.seedPolicy.toLowerCase()) {
    throw new Error(
      `ONBOARD-SEED: entry.seed_policy (${register.entry.seed_policy}) != custody seed_policy `
      + `(${seed.seedPolicy})`,
    );
  }

  // planSeed (Treasury) trả {datum, custodyValue, seedPolicy, nftName} — KHÔNG có summary
  // (chỉ buildSeedTx mới có). Dựng tóm tắt bước 1 tại đây từ các field plan.
  const seedSummary = [
    `Instance:    ${seed.datum.instance_id}`,
    `Seed policy: ${seed.seedPolicy}`,
    `NFT:         ${seed.seedPolicy}${seed.nftName} (qty 1)`,
    `Cut bps:     ${seed.datum.cut_bps}`,
    `Reserved:    ${config.reservedMinAda} lovelace`,
    `Ledger:      ${seed.datum.ledger.length} dòng (canonical)`,
  ].join("\n");

  const summary = [
    `╔══════════════════════════════════════════════════════╗`,
    `║  ONBOARD PLATFORM: ${config.platformId}`,
    `╚══════════════════════════════════════════════════════╝`,
    ``,
    `BƯỚC 1 — SEED custody instance (Treasury custody_seed):`,
    seedSummary.split("\n").map((l) => "  " + l).join("\n"),
    ``,
    `        ↓ (chờ confirm — entry bước 2 trỏ vào instance này)`,
    ``,
    `BƯỚC 2 — REGISTER entry (PlatformKit registry_beacon):`,
    register.summary.split("\n").map((l) => "  " + l).join("\n"),
    ``,
    `THỨ TỰ: BƯỚC 1 PHẢI SUBMIT trước BƯỚC 2.`,
    `Lý do:  entry.seed_policy + entry.instance_id trỏ vào custody instance đã seed.`,
    `        Đăng ký trước khi seed = entry trỏ vào instance KHÔNG tồn tại.`,
    `R-BIND: BƯỚC 2 readFrom custody UTxO của BƯỚC 1 (NFT authenticity @ Script(custody_hash)).`,
    `        → custody phải TỒN TẠI trên chain; điền custodyOutRef (txHash#idx) sau submit BƯỚC 1.`,
  ].join("\n");

  return { seed, register, summary };
}
