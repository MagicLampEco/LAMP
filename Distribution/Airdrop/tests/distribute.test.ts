// Airdrop distribution engine — bảo toàn oil, pro-rata, chống Sybil tách pool,
// gate đủ-tư-cách SPO, cộng dồn cumulative đa-epoch, Merkle claim.
import { describe, it, expect } from "vitest";
import { distributeEpoch, runAirdrop } from "../offchain/src/distribute.js";
import { splitEpoch } from "../offchain/src/split.js";
import { verifyClaim } from "../offchain/src/merkle.js";
import type { EpochSnapshot, DistributeParams } from "../offchain/src/types.js";

const pkh = (b: string): string => b.repeat(28);
const OS1 = pkh("51"), OS2 = pkh("52");           // SPO reward owners
const D1 = pkh("d1"), D2 = pkh("d2"), D3 = pkh("d3");

const { spoBudgetOil, delegatorBudgetOil } = splitEpoch();
const PARAMS: DistributeParams = { spoBudgetOil, delegatorBudgetOil, floorStake: 0n };
const PER_EPOCH = spoBudgetOil + delegatorBudgetOil;

/** 2 pool, cả 2 sản xuất block; D1+D2 ở P1, D3 ở P2. */
function baseSnapshot(epoch: bigint): EpochSnapshot {
  return {
    epoch,
    registrations: [
      { poolId: "P1", spoRewardOwner: OS1, epochRegistered: 1n },
      { poolId: "P2", spoRewardOwner: OS2, epochRegistered: 1n },
    ],
    poolStatus: [
      { poolId: "P1", producedBlock: true },
      { poolId: "P2", producedBlock: true },
    ],
    delegators: [
      { owner: D1, poolId: "P1", stake: 1_000n },
      { owner: D2, poolId: "P1", stake: 3_000n },
      { owner: D3, poolId: "P2", stake: 4_000n },
    ],
  };
}

const won = (es: { owner: string; wonThisEpoch: bigint }[], o: string): bigint =>
  es.find((e) => e.owner === o)?.wonThisEpoch ?? 0n;

describe("Airdrop distribute — 1 epoch", () => {
  it("bảo toàn: Σ wonThisEpoch + leftover == B_spo + B_del", () => {
    const r = distributeEpoch(baseSnapshot(1n), PARAMS);
    expect(r.distributed + r.leftover).toBe(PER_EPOCH);
    expect(r.leftover).toBe(0n); // mọi pool đủ tư cách
  });

  it("delegator pro-rata stake toàn cục (D1:D2 = 1:3)", () => {
    const r = distributeEpoch(baseSnapshot(1n), PARAMS);
    expect(won(r.entitlements, D2)).toBe(won(r.entitlements, D1) * 3n);
    expect(won(r.entitlements, D3)).toBe(delegatorBudgetOil / 2n); // 4000/8000
  });

  it("SPO chia theo S_p/S_tot (P1=P2=4000 ⇒ mỗi SPO nửa B_spo)", () => {
    const r = distributeEpoch(baseSnapshot(1n), PARAMS);
    expect(won(r.entitlements, OS1)).toBe(spoBudgetOil / 2n);
    expect(won(r.entitlements, OS2)).toBe(spoBudgetOil / 2n);
  });

  it("pool KHÔNG sản xuất block ⇒ SPO forfeit → leftover; delegator vẫn nhận đủ", () => {
    const snap = baseSnapshot(1n);
    snap.poolStatus = [{ poolId: "P1", producedBlock: true }, { poolId: "P2", producedBlock: false }];
    const r = distributeEpoch(snap, PARAMS);
    expect(won(r.entitlements, OS2)).toBe(0n);                // forfeit
    expect(won(r.entitlements, OS1)).toBe(spoBudgetOil / 2n);  // P1 vẫn theo S_p/S_tot
    expect(r.leftover).toBe(spoBudgetOil / 2n);               // phần P2 forfeit
    const sumDel = won(r.entitlements, D1) + won(r.entitlements, D2) + won(r.entitlements, D3);
    expect(sumDel).toBe(delegatorBudgetOil);
    expect(r.distributed + r.leftover).toBe(PER_EPOCH);
  });

  it("sàn stake: pool S_p < floor ⇒ SPO forfeit", () => {
    const params: DistributeParams = { spoBudgetOil, delegatorBudgetOil, floorStake: 5_000n };
    const r = distributeEpoch(baseSnapshot(1n), params); // P1=P2=4000 < 5000
    expect(won(r.entitlements, OS1)).toBe(0n);
    expect(won(r.entitlements, OS2)).toBe(0n);
    expect(r.leftover).toBe(spoBudgetOil);
  });

  it("Sybil tách pool vô hại: SPO total không đổi khi 1 pool tách đôi (cùng owner)", () => {
    const snapA: EpochSnapshot = {
      epoch: 1n,
      registrations: [{ poolId: "P1", spoRewardOwner: OS1, epochRegistered: 1n }],
      poolStatus: [{ poolId: "P1", producedBlock: true }],
      delegators: [{ owner: D1, poolId: "P1", stake: 8_000n }],
    };
    const snapB: EpochSnapshot = {
      epoch: 1n,
      registrations: [
        { poolId: "P1a", spoRewardOwner: OS1, epochRegistered: 1n },
        { poolId: "P1b", spoRewardOwner: OS1, epochRegistered: 1n },
      ],
      poolStatus: [{ poolId: "P1a", producedBlock: true }, { poolId: "P1b", producedBlock: true }],
      delegators: [
        { owner: D1, poolId: "P1a", stake: 4_000n },
        { owner: D1, poolId: "P1b", stake: 4_000n },
      ],
    };
    const a = distributeEpoch(snapA, PARAMS);
    const b = distributeEpoch(snapB, PARAMS);
    expect(won(b.entitlements, OS1)).toBe(won(a.entitlements, OS1));
    expect(won(a.entitlements, OS1)).toBe(spoBudgetOil); // 1 pool eligible ⇒ toàn bộ B_spo
  });

  it("owner vừa là SPO vừa là delegator ⇒ cộng gộp", () => {
    const snap = baseSnapshot(1n);
    snap.delegators.push({ owner: OS1, poolId: "P2", stake: 4_000n });
    const r = distributeEpoch(snap, PARAMS);
    const e = r.entitlements.find((x) => x.owner === OS1)!;
    expect(e.wonThisEpoch).toBeGreaterThan(spoBudgetOil / 2n);
  });

  it("không pool nào đăng ký ⇒ leftover = full budget, entitlements rỗng", () => {
    const r = distributeEpoch({ epoch: 1n, registrations: [], poolStatus: [], delegators: [] }, PARAMS);
    expect(r.entitlements).toEqual([]);
    expect(r.leftover).toBe(PER_EPOCH);
  });

  it("pool đăng ký SAU epoch hiện tại ⇒ chưa tính", () => {
    const snap = baseSnapshot(1n);
    snap.registrations = [{ poolId: "P1", spoRewardOwner: OS1, epochRegistered: 3n }];
    snap.delegators = [{ owner: D1, poolId: "P1", stake: 1_000n }];
    const r = distributeEpoch(snap, PARAMS);
    expect(r.distributed).toBe(0n);
    expect(r.leftover).toBe(PER_EPOCH);
  });
});

describe("Airdrop distribute — đa epoch (cumulative + Merkle)", () => {
  it("cumulative cộng dồn đơn điệu; bảo toàn tổng qua 5 epoch", () => {
    const snaps = [1n, 2n, 3n, 4n, 5n].map(baseSnapshot);
    const outs = runAirdrop(snaps, PARAMS);
    let prev = 0n;
    for (const o of outs) {
      const c = o.entitlements.find((e) => e.owner === D1)!.wonCumulative;
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
    const tot = outs.reduce((s, o) => s + o.distributed + o.leftover, 0n);
    expect(tot).toBe(PER_EPOCH * 5n);
    const last = outs[4]!.entitlements.find((e) => e.owner === D1)!;
    expect(last.wonCumulative).toBe(last.wonThisEpoch * 5n);
  });

  it("mỗi epoch: Merkle root verify được cho mọi owner (claim permissionless)", () => {
    const outs = runAirdrop([1n, 2n].map(baseSnapshot), PARAMS);
    for (const o of outs) {
      for (const e of o.entitlements) {
        const proof = o.proofs.get(e.owner)!;
        expect(verifyClaim(o.rootHex, e.owner, e.wonCumulative, proof)).toBe(true);
      }
    }
  });

  it("owner tham gia trễ vẫn xuất hiện ở cây epoch sau với cumulative đúng", () => {
    const s1 = baseSnapshot(1n);
    const s2 = baseSnapshot(2n);
    s1.delegators = s1.delegators.filter((d) => d.owner !== D3); // D3 chỉ từ epoch 2
    const outs = runAirdrop([s1, s2], PARAMS);
    expect(outs[0]!.entitlements.find((e) => e.owner === D3)).toBeUndefined();
    const d3e2 = outs[1]!.entitlements.find((e) => e.owner === D3)!;
    expect(d3e2.wonCumulative).toBe(d3e2.wonThisEpoch);
    expect(d3e2.wonThisEpoch).toBeGreaterThan(0n);
  });
});
