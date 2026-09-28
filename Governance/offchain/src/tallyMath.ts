// Số học Tally + bảng knots — BẢN CHÉP CÓ NHÃN của logic on-chain, để builder dựng ĐÚNG datum
// ra mà validator so bằng `==`.
//
// Nguồn (đọc 2026-09-29, gov-v2 @ 46a3a36):
//   `onchain/lib/magiclamp/governance/power.ak`        ▸ interp, cap_of, vp_raw, scale
//   `onchain/lib/magiclamp/governance/weight_guard.ak` ▸ is_live, dominates, d8_ok
//   `onchain/lib/magiclamp/governance/tally.ak`        ▸ derive_batch, insert_desc, take_n,
//        batch_entries, merge_top, sigma_vp_raw, cap_per_did, apply_clamp, pass
//   `onchain/validators/tally.ak`                      ▸ c_sources_ok (phần kiểm được off-chain)
//
// Vì sao CHÉP chứ không trỏ: builder phải tính ra đúng số mà validator tính lại — không có cách
// nào "trỏ" tới một hàm Aiken từ TypeScript. Bản chép chết ỒN ÀO nhờ ca kiểm đầu-cuối
// (`tests/e2e.test.ts`) chạy validator THẬT trong Emulator trên datum do tệp này tính: lệch một
// phép chia là giao dịch bị từ chối ở đó.
//
// Phép chia: Aiken `/` = `divideInteger` = làm tròn về −∞. BigInt JS `/` làm tròn về 0 — khác
// nhau khi có số âm, nên mọi phép chia ở đây đi qua `floorDiv`.

import type { Knot, TallyDatum, TopEntry, VoteChoice, VoteDatum, WeightParam } from "./types.js";

/** power.ak ▸ scale (10^9). */
export const SCALE = 1_000_000_000n;
const SCALE_CUBED = SCALE * SCALE * SCALE;

/** tally.ak ▸ cap4_hard. */
export const CAP4_HARD = 100_000_000n;

export function floorDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("GOV-MATH-001: chia cho 0");
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

/** power.ak ▸ interp. */
export function interp(knots: readonly Knot[], x: bigint): bigint {
  let ks = knots;
  for (;;) {
    const lo = ks[0];
    if (lo === undefined) return 0n;
    const hi = ks[1];
    if (hi === undefined) return lo.pow;
    if (x <= lo.c) return lo.pow;
    if (x < hi.c) return lo.pow + floorDiv((hi.pow - lo.pow) * (x - lo.c), hi.c - lo.c);
    ks = ks.slice(1);
  }
}

/** power.ak ▸ cap_of — `c` của knot cuối; bảng rỗng → 0. */
export function capOf(knots: readonly Knot[]): bigint {
  const last = knots[knots.length - 1];
  return last === undefined ? 0n : last.c;
}

function lastPow(knots: readonly Knot[]): bigint {
  const last = knots[knots.length - 1];
  return last === undefined ? 0n : last.pow;
}

/** power.ak ▸ vp_raw. */
export function vpRaw(wp: WeightParam, v: Pick<VoteDatum, "c1_capped" | "c2_capped" | "c3_capped" | "c4_capped">): bigint {
  const p1 = interp(wp.k1, v.c1_capped);
  const p2 = interp(wp.k2, v.c2_capped);
  const p3 = interp(wp.k3, v.c3_capped);
  const p4 = interp(wp.k4, v.c4_capped);
  return floorDiv(p1 * p2 * p3 * p4, SCALE_CUBED);
}

/** weight_guard.ak ▸ is_live. */
export function isLive(knots: readonly Knot[]): boolean {
  const first = knots[0];
  if (first === undefined || knots.length < 2) return false;
  return lastPow(knots) > first.pow;
}

/** weight_guard.ak ▸ dominates. */
export function dominates(a: readonly Knot[], b: readonly Knot[]): boolean {
  const hi = capOf(a) < capOf(b) ? capOf(a) : capOf(b);
  const points = [...a.map((k) => k.c), ...b.map((k) => k.c)].filter((c) => c >= 1n && c <= hi);
  const all = hi >= 1n ? [hi, ...points] : points;
  return all.every((c) => interp(a, c) >= interp(b, c));
}

/** weight_guard.ak ▸ d8_ok. */
export function d8Ok(wp: Pick<WeightParam, "k1" | "k2" | "k3" | "k4">): boolean {
  return isLive(wp.k1) && isLive(wp.k2) && isLive(wp.k3) && isLive(wp.k4)
    && dominates(wp.k1, wp.k2) && dominates(wp.k3, wp.k4);
}

/** tally.ak ▸ derive_batch. */
export function deriveBatch(wp: WeightParam, votes: readonly VoteDatum[]) {
  let dy = 0n, dn = 0n, da = 0n, dv = 0n, dyv = 0n;
  for (const v of votes) {
    const p = vpRaw(wp, v);
    if (v.choice === "Yes") { dy += p; dv += 1n; dyv += 1n; }
    else if (v.choice === "No") { dn += p; dv += 1n; }
    else if (v.choice === "Abstain") { da += p; dv += 1n; }
    else throw new Error(`GOV-MATH-002: choice lạ '${String(v.choice)}'`);
  }
  return { dy, dn, da, dv, dyv };
}

/** tally.ak ▸ insert_desc — chèn ổn định: entry mới đứng SAU các entry ≥ nó. */
export function insertDesc(sorted: readonly TopEntry[], e: TopEntry): TopEntry[] {
  const i = sorted.findIndex((h) => e.vp_raw > h.vp_raw);
  return i < 0 ? [...sorted, e] : [...sorted.slice(0, i), e, ...sorted.slice(i)];
}

/** tally.ak ▸ take_n. */
export function takeN(xs: readonly TopEntry[], n: bigint): TopEntry[] {
  return n <= 0n ? [] : xs.slice(0, Number(n));
}

/** tally.ak ▸ batch_entries. */
export function batchEntries(wp: WeightParam, votes: readonly VoteDatum[]): TopEntry[] {
  return votes.map((v) => ({ vp_raw: vpRaw(wp, v), choice: v.choice }));
}

/** tally.ak ▸ merge_top. */
export function mergeTop(oldHeap: readonly TopEntry[], batch: readonly TopEntry[], limit: bigint): TopEntry[] {
  let acc: TopEntry[] = [...oldHeap];
  for (const e of batch) acc = insertDesc(acc, e);
  return takeN(acc, limit);
}

/** Datum Tally SAU một lượt SumBatch — mọi trường mà `tally.ak ▸ SumBatch` ép (trừ `voted_root`,
 *  do `VotedLedger` tính). Thứ tự `votes` PHẢI là thứ tự input của giao dịch. */
export function sumBatchNext(dIn: TallyDatum, wp: WeightParam, votes: readonly VoteDatum[], votedRootAfter: string): TallyDatum {
  const { dy, dn, da, dv, dyv } = deriveBatch(wp, votes);
  return {
    ...dIn,
    phase: "Summing",
    yes_power_raw: dIn.yes_power_raw + dy,
    no_power_raw: dIn.no_power_raw + dn,
    abstain_power_raw: dIn.abstain_power_raw + da,
    voters_acc: dIn.voters_acc + dv,
    yes_voters_acc: dIn.yes_voters_acc + dyv,
    top_did_vp: mergeTop(dIn.top_did_vp, batchEntries(wp, votes), wp.bft_floor - 1n),
    voted_root: votedRootAfter,
  };
}

/** tally.ak ▸ sigma_vp_raw. */
export function sigmaVpRaw(d: TallyDatum): bigint {
  return d.yes_power_raw + d.no_power_raw + d.abstain_power_raw;
}

function excessOfChoice(top: readonly TopEntry[], cap: bigint, want: VoteChoice): bigint {
  return top.reduce((acc, e) => (e.choice === want && e.vp_raw > cap ? acc + e.vp_raw - cap : acc), 0n);
}

/** tally.ak ▸ apply_clamp. `bftFloor` ≥ 1 (validator ép trước). */
export function applyClamp(d: TallyDatum, bftFloor: bigint) {
  if (bftFloor < 1n) throw new Error(`GOV-MATH-003: bft_floor phải ≥ 1, nhận ${bftFloor}`);
  const cap = floorDiv(sigmaVpRaw(d), bftFloor);
  return {
    yes_power_eff: d.yes_power_raw - excessOfChoice(d.top_did_vp, cap, "Yes"),
    no_power_eff: d.no_power_raw - excessOfChoice(d.top_did_vp, cap, "No"),
    abstain_power_eff: d.abstain_power_raw - excessOfChoice(d.top_did_vp, cap, "Abstain"),
  };
}

/** Datum Tally SAU `Finalize` (Summing → Clamped): chỉ phase + ba trường eff đổi. */
export function finalizeTallyNext(dIn: TallyDatum, wp: WeightParam): TallyDatum {
  return { ...dIn, phase: "Clamped", ...applyClamp(dIn, wp.bft_floor) };
}

/** tally.ak ▸ pass — biểu thức thông qua DUY NHẤT (`R-VERDICT-ONE-SOURCE`). */
export function pass(d: TallyDatum, wp: WeightParam): boolean {
  const base = d.yes_power_eff + d.no_power_eff;
  const total = d.yes_power_eff + d.no_power_eff + d.abstain_power_eff;
  return d.yes_voters_acc >= wp.bft_floor
    && total >= wp.quorum_vp_threshold
    && d.voters_acc >= wp.quorum_voter_threshold
    && d.yes_power_eff * wp.theta_den >= base * wp.theta_num;
}
