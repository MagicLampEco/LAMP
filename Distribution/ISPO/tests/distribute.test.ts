// ISPO distribution engine — bảo toàn oil, ∝ ADA, SPO bonus + clamp, anti front-run,
// bait-switch cooldown, pool không config, whale cap, Sybil vô hại, cumulative + Merkle.
import { describe, it, expect } from "vitest";
import { distributeEpoch, runIspo, effectiveRateBp } from "../offchain/src/distribute.js";
import { verifyClaim } from "../offchain/src/merkle.js";
import { PER_EPOCH_OIL, MAX_RATE_BP } from "../offchain/src/constants.js";
import type { PoolConfig, Contribution, DistributeParams } from "../offchain/src/types.js";

const pkh = (b: string): string => b.repeat(28);
const OS1 = pkh("51"), OS2 = pkh("52");
const D1 = pkh("d1"), D2 = pkh("d2"), D3 = pkh("d3");

const PARAMS: DistributeParams = { perEpochOil: PER_EPOCH_OIL, maxContribLovelace: null };

// P1: SPO rate 10% (hiệu lực từ epoch 0); P2: rate 0.
const POOLS: PoolConfig[] = [
  { poolId: "P1", spoRewardOwner: OS1, bonusRateBp: 1000n, rateEffectiveFromEpoch: 0n },
  { poolId: "P2", spoRewardOwner: OS2, bonusRateBp: 0n, rateEffectiveFromEpoch: 0n },
];

// contribution epoch 1; phân phối epoch 2. Σ_P1 = 4000, Σ_P2 = 4000, Σ_all = 8000.
const CONTRIBS: Contribution[] = [
  { owner: D1, poolId: "P1", contributedLovelace: 1_000n, epoch: 1n },
  { owner: D2, poolId: "P1", contributedLovelace: 3_000n, epoch: 1n },
  { owner: D3, poolId: "P2", contributedLovelace: 4_000n, epoch: 1n },
];

const won = (es: { owner: string; wonThisEpoch: bigint }[], o: string): bigint =>
  es.find((e) => e.owner === o)?.wonThisEpoch ?? 0n;

describe("ISPO distribute — 1 epoch", () => {
  it("bảo toàn: Σ wonThisEpoch + leftover == LAMP_e", () => {
    const r = distributeEpoch(2n, POOLS, CONTRIBS, PARAMS);
    expect(r.distributed + r.leftover).toBe(PER_EPOCH_OIL);
    expect(r.leftover).toBe(0n);
  });

  it("LAMP_pool ∝ ADA (Σ_P1 == Σ_P2 ⇒ mỗi pool nửa LAMP_e)", () => {
    const r = distributeEpoch(2n, POOLS, CONTRIBS, PARAMS);
    const half = PER_EPOCH_OIL / 2n;
    // P1: OS1 + D1 + D2 == half ; P2: D3 == half
    expect(won(r.entitlements, OS1) + won(r.entitlements, D1) + won(r.entitlements, D2)).toBe(half);
    expect(won(r.entitlements, D3)).toBe(half);
  });

  it("spo_bonus = 10% LAMP_pool; delegator pro-rata trong pool (D2 = 3·D1)", () => {
    const r = distributeEpoch(2n, POOLS, CONTRIBS, PARAMS);
    const lampPool = PER_EPOCH_OIL / 2n;
    expect(won(r.entitlements, OS1)).toBe(lampPool / 10n);       // 10%
    expect(won(r.entitlements, D2)).toBe(won(r.entitlements, D1) * 3n);
  });

  it("pool rate 0 (P2): delegator nhận đủ LAMP_pool, không SPO leaf", () => {
    const r = distributeEpoch(2n, POOLS, CONTRIBS, PARAMS);
    expect(won(r.entitlements, D3)).toBe(PER_EPOCH_OIL / 2n);
    expect(won(r.entitlements, OS2)).toBe(0n);
  });

  it("anti front-run: contribution epoch == distributionEpoch KHÔNG tính", () => {
    const late: Contribution[] = [...CONTRIBS, { owner: D1, poolId: "P1", contributedLovelace: 9_999n, epoch: 2n }];
    const r = distributeEpoch(2n, POOLS, late, PARAMS);
    // D1 vẫn như cũ (góp epoch 2 chỉ tính cho epoch 3+)
    const base = distributeEpoch(2n, POOLS, CONTRIBS, PARAMS);
    expect(won(r.entitlements, D1)).toBe(won(base.entitlements, D1));
  });

  it("bait-switch: rate chỉ hiệu lực từ rateEffectiveFromEpoch (trước đó = 0)", () => {
    const pools: PoolConfig[] = [
      { poolId: "P1", spoRewardOwner: OS1, bonusRateBp: 1000n, rateEffectiveFromEpoch: 5n },
      { poolId: "P2", spoRewardOwner: OS2, bonusRateBp: 0n, rateEffectiveFromEpoch: 0n },
    ];
    const r = distributeEpoch(2n, pools, CONTRIBS, PARAMS); // epoch 2 < 5 → rate 0
    expect(won(r.entitlements, OS1)).toBe(0n);
    // D1+D2 nhận đủ LAMP_P1 (không bị trích bonus)
    expect(won(r.entitlements, D1) + won(r.entitlements, D2)).toBe(PER_EPOCH_OIL / 2n);
  });

  it("clamp rate: bonusRateBp 5000 (50%) → trần MAX_RATE_BP (10%)", () => {
    const pools: PoolConfig[] = [
      { poolId: "P1", spoRewardOwner: OS1, bonusRateBp: 5000n, rateEffectiveFromEpoch: 0n },
      { poolId: "P2", spoRewardOwner: OS2, bonusRateBp: 0n, rateEffectiveFromEpoch: 0n },
    ];
    const r = distributeEpoch(2n, pools, CONTRIBS, PARAMS);
    expect(won(r.entitlements, OS1)).toBe(PER_EPOCH_OIL / 2n / 10n); // 10% không phải 50%
    expect(effectiveRateBp(pools[0]!, 2n)).toBe(MAX_RATE_BP);
  });

  it("whale cap: maxContrib giới hạn ADA 1 delegator", () => {
    const big: Contribution[] = [
      { owner: D1, poolId: "P1", contributedLovelace: 1_000_000n, epoch: 1n }, // whale
      { owner: D2, poolId: "P1", contributedLovelace: 1_000n, epoch: 1n },
    ];
    const capped: DistributeParams = { perEpochOil: PER_EPOCH_OIL, maxContribLovelace: 1_000n };
    const r = distributeEpoch(2n, POOLS, big, capped);
    // D1 bị cap về 1000 = D2 ⇒ chia đều phần delegator
    expect(won(r.entitlements, D1)).toBe(won(r.entitlements, D2));
  });

  it("Sybil delegator vô hại: tách 1 ví thành 2 (cùng tổng ADA) ⇒ tổng LAMP không đổi", () => {
    const single: Contribution[] = [{ owner: D1, poolId: "P2", contributedLovelace: 1_000n, epoch: 1n }];
    const split: Contribution[] = [
      { owner: pkh("aa"), poolId: "P2", contributedLovelace: 500n, epoch: 1n },
      { owner: pkh("bb"), poolId: "P2", contributedLovelace: 500n, epoch: 1n },
    ];
    const a = distributeEpoch(2n, POOLS, single, PARAMS);
    const b = distributeEpoch(2n, POOLS, split, PARAMS);
    // 1 pool duy nhất có ADA ⇒ nhận toàn bộ LAMP_e; tổng bằng nhau
    expect(a.distributed).toBe(b.distributed);
    expect(won(a.entitlements, D1)).toBe(won(b.entitlements, pkh("aa")) + won(b.entitlements, pkh("bb")));
  });

  it("Σ_all == 0 (chưa ai góp) ⇒ leftover = LAMP_e", () => {
    const r = distributeEpoch(1n, POOLS, CONTRIBS, PARAMS); // epoch 1: contribution epoch 1 không < 1
    expect(r.entitlements).toEqual([]);
    expect(r.leftover).toBe(PER_EPOCH_OIL);
  });
});

describe("ISPO distribute — đa epoch (cumulative + Merkle)", () => {
  it("cumulative đơn điệu + bảo toàn tổng; Merkle verify mọi owner", () => {
    // phân phối epoch 2..4; contribution cố định epoch 1 (đếm cho mọi epoch ≥ 2)
    const outs = runIspo([2n, 3n, 4n], POOLS, CONTRIBS, PARAMS);
    let prev = 0n;
    for (const o of outs) {
      const c = o.entitlements.find((e) => e.owner === D2)!.wonCumulative;
      expect(c).toBeGreaterThan(prev);
      prev = c;
      for (const e of o.entitlements) {
        expect(verifyClaim(o.rootHex, e.owner, e.wonCumulative, o.proofs.get(e.owner)!)).toBe(true);
      }
    }
    const tot = outs.reduce((s, o) => s + o.distributed + o.leftover, 0n);
    expect(tot).toBe(PER_EPOCH_OIL * 3n);
    // cumulative cuối D2 = 3 × won/epoch
    const last = outs[2]!.entitlements.find((e) => e.owner === D2)!;
    expect(last.wonCumulative).toBe(last.wonThisEpoch * 3n);
  });
});
