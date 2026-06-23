// ISPO distribution engine (§6.3) — tất định, bảo toàn oil, DECOUPLED.
//
// ─────────────────────────────────────────────────────────────────────────
// MỖI EPOCH e (LAMP_e = perEpochOil; Σ_p = Σ ADA pool p góp; Σ_all = Σ Σ_p):
//
//   LAMP_pool(p)  = floor(LAMP_e · Σ_p / Σ_all)           (pool góp gấp đôi → gấp đôi LAMP)
//   spo_bonus(p)  = floor(LAMP_pool · rate_bp(p) / 10000)  (SPO tự đặt rate, trần MAX_RATE_BP)
//   LAMP_deleg(p) = LAMP_pool − spo_bonus
//   entitlement(d)= floor(LAMP_deleg · c_d / Σ_p)          (c_d = ADA delegator d góp)
//
//   • Anti-front-run: chỉ đếm contribution có epoch < e (góp ở e → tính cho e+1).
//   • Bait-and-switch: rate chỉ hiệu lực từ rateEffectiveFromEpoch (đã qua cooldown);
//     trước đó rate = 0.
//   • SPO không cấu hình/đặt rate ⇒ rate = 0, delegator pool đó NHẬN ĐỦ LAMP_pool.
//   • Sybil delegator vô hại (chia theo ADA). Whale: cap maxContribLovelace (tuỳ chọn).
//   • Dư floor → contributor ADA lớn nhất (tie owner hex nhỏ nhất) — tất định.
//
//   Bất biến/epoch:  Σ wonThisEpoch + leftover == LAMP_e  (leftover>0 chỉ khi Σ_all=0).

import type { PoolConfig, Contribution, DistributeParams, IspoEntitlement } from "./types.js";
import { MAX_RATE_BP, BP_DENOM } from "./constants.js";
import { buildMerkleTree, type MerkleTree } from "./merkle.js";

function normHex(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

export interface EpochDistribution {
  epoch: bigint;
  entitlements: IspoEntitlement[];
  leftover: bigint;
  distributed: bigint;
  cumulative: Map<string, bigint>;
}

/** Rate hiệu lực của pool tại epoch e: clamp [0, MAX_RATE_BP]; 0 nếu chưa tới effectiveFrom. */
export function effectiveRateBp(cfg: PoolConfig, epoch: bigint): bigint {
  if (epoch < cfg.rateEffectiveFromEpoch) return 0n;
  if (cfg.bonusRateBp <= 0n) return 0n;
  return cfg.bonusRateBp > MAX_RATE_BP ? MAX_RATE_BP : cfg.bonusRateBp;
}

/** Phân phối 1 epoch. contributions = TOÀN BỘ lịch sử (engine tự lọc epoch < distributionEpoch). */
export function distributeEpoch(
  distributionEpoch: bigint,
  pools: PoolConfig[],
  contributions: Contribution[],
  params: DistributeParams,
  prevCumulative: ReadonlyMap<string, bigint> = new Map(),
): EpochDistribution {
  const perEpochOil = params.perEpochOil;
  if (perEpochOil < 0n) throw new Error("ISPO-000: perEpochOil ≥ 0");
  const maxContrib = params.maxContribLovelace;
  if (maxContrib !== null && maxContrib <= 0n) throw new Error("ISPO-001: maxContrib > 0 hoặc null");

  const config = new Map<string, PoolConfig>();
  for (const p of pools) {
    if (config.has(p.poolId)) throw new Error(`ISPO-002: pool ${p.poolId} cấu hình trùng`);
    config.set(p.poolId, p);
  }

  // gộp ADA theo (owner, pool); chỉ epoch < distributionEpoch (anti front-run); clamp whale.
  const cByOwnerPool = new Map<string, bigint>(); // key = owner|pool
  for (const c of contributions) {
    if (c.epoch >= distributionEpoch) continue;
    if (c.contributedLovelace <= 0n) continue;
    const key = `${normHex(c.owner)}|${c.poolId}`;
    cByOwnerPool.set(key, (cByOwnerPool.get(key) ?? 0n) + c.contributedLovelace);
  }
  if (maxContrib !== null) {
    for (const [k, v] of cByOwnerPool) if (v > maxContrib) cByOwnerPool.set(k, maxContrib);
  }

  // Σ_p, danh sách delegator/pool, Σ_all, tổng ADA per owner (cho dust)
  const Sp = new Map<string, bigint>();
  const poolDelegators = new Map<string, { owner: string; c: bigint }[]>();
  const contribByOwner = new Map<string, bigint>();
  for (const [key, c] of cByOwnerPool) {
    const sep = key.indexOf("|");
    const owner = key.slice(0, sep);
    const poolId = key.slice(sep + 1);
    Sp.set(poolId, (Sp.get(poolId) ?? 0n) + c);
    const arr = poolDelegators.get(poolId) ?? [];
    arr.push({ owner, c });
    poolDelegators.set(poolId, arr);
    contribByOwner.set(owner, (contribByOwner.get(owner) ?? 0n) + c);
  }
  let Sall = 0n;
  for (const v of Sp.values()) Sall += v;

  const thisEpoch = new Map<string, bigint>();
  let leftover = 0n;

  if (Sall === 0n) {
    leftover = perEpochOil;
  } else {
    for (const [poolId, sp] of Sp) {
      const lampPool = (perEpochOil * sp) / Sall;
      const cfg = config.get(poolId);
      const rate = cfg ? effectiveRateBp(cfg, distributionEpoch) : 0n;
      const spoBonus = cfg && rate > 0n ? (lampPool * rate) / BP_DENOM : 0n;
      const lampDeleg = lampPool - spoBonus;
      for (const { owner, c } of poolDelegators.get(poolId)!) {
        const alloc = (lampDeleg * c) / sp;
        if (alloc > 0n) thisEpoch.set(owner, (thisEpoch.get(owner) ?? 0n) + alloc);
      }
      if (cfg && spoBonus > 0n) {
        const spoOwner = normHex(cfg.spoRewardOwner);
        thisEpoch.set(spoOwner, (thisEpoch.get(spoOwner) ?? 0n) + spoBonus);
      }
    }
    // dư floor → contributor ADA lớn nhất (tie owner hex asc)
    let dist = 0n;
    for (const v of thisEpoch.values()) dist += v;
    const dust = perEpochOil - dist; // ≥ 0
    if (dust > 0n && contribByOwner.size > 0) {
      const target = [...contribByOwner.entries()]
        .sort((a, b) => (a[1] !== b[1] ? (a[1] > b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))[0]![0];
      thisEpoch.set(target, (thisEpoch.get(target) ?? 0n) + dust);
    }
  }

  let distributed = 0n;
  for (const v of thisEpoch.values()) distributed += v;

  const cumulative = new Map<string, bigint>(prevCumulative);
  for (const [o, v] of thisEpoch) cumulative.set(o, (cumulative.get(o) ?? 0n) + v);

  const entitlements: IspoEntitlement[] = [...cumulative.entries()]
    .map(([owner, wonCumulative]) => ({ owner, wonThisEpoch: thisEpoch.get(owner) ?? 0n, wonCumulative }))
    .filter((e) => e.wonCumulative > 0n)
    .sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));

  return { epoch: distributionEpoch, entitlements, leftover, distributed, cumulative };
}

/** Merkle tree (root + proof) 1 epoch từ entitlement cumulative. */
export function epochMerkle(entitlements: IspoEntitlement[]): MerkleTree {
  return buildMerkleTree(entitlements.map((e) => ({ owner: e.owner, wonCumulative: e.wonCumulative })));
}

export interface IspoEpochOutput extends EpochDistribution {
  rootHex: string;
  proofs: Map<string, string[]>;
}

/** Chạy nhiều epoch: fold cumulative + build Merkle. contributions = toàn bộ lịch sử. */
export function runIspo(
  distributionEpochs: bigint[],
  pools: PoolConfig[],
  contributions: Contribution[],
  params: DistributeParams,
): IspoEpochOutput[] {
  const out: IspoEpochOutput[] = [];
  let cumulative: Map<string, bigint> = new Map();
  for (const e of distributionEpochs) {
    const dist = distributeEpoch(e, pools, contributions, params, cumulative);
    cumulative = dist.cumulative;
    const tree = dist.entitlements.length > 0
      ? epochMerkle(dist.entitlements)
      : { rootHex: "", proofs: new Map<string, string[]>(), leafCount: 0 };
    out.push({ ...dist, rootHex: tree.rootHex, proofs: tree.proofs });
  }
  return out;
}
