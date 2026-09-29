// Số học Tally + bảng knots — BẢN CHÉP CÓ NHÃN của logic on-chain, để builder dựng ĐÚNG datum
// ra mà validator so bằng `==`.
//
// Nguồn (đọc 2026-09-29, gov-v2 @ f2e1b31):
//   `onchain/lib/magiclamp/governance/power.ak`        ▸ interp, cap_of, vp_raw, scale
//   `onchain/lib/magiclamp/governance/weight_guard.ak` ▸ knots_wellformed, is_live, dominates, d8_ok
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

/**
 * weight_guard.ak ▸ knots_wellformed (G0) — trả LÝ DO bảng sai khuôn, hoặc `null` khi hợp khuôn.
 *
 * Bảy vế, ghép AND như on-chain: `length >= 2` · `first.c == 0` · `first.pow == 0` · `c` tăng
 * NGHIÊM NGẶT · `pow` không giảm · `pow >= 0` · `last_c >= 1`. On-chain không có vế `pow >= 0`
 * riêng — nó là hệ quả của `first.pow == 0` + `pow` không giảm; SDK vẫn nêu tên nó để thông báo
 * lỗi chỉ đúng chỗ. Tương tự `last_c >= 1` là hệ quả của `first.c == 0` + `c` tăng nghiêm ngặt +
 * `length >= 2` (chú thích "ĐỘT BIẾN TƯƠNG ĐƯƠNG" tại vế đó trong `weight_guard.ak`) — giữ lại
 * vì on-chain giữ nó.
 *
 * Một nguồn trong SDK: `knotsWellformed` và `d8Ok` đều đọc từ hàm này.
 */
export function knotsProblem(knots: readonly Knot[]): string | null {
  if (!Array.isArray(knots)) return "bảng knots không phải mảng";
  if (knots.length < 2) return `bảng có ${knots.length} mốc, cần ≥ 2`;
  const first = knots[0]!;
  if (first.c !== 0n) return `mốc đầu c = ${first.c}, phải = 0`;
  if (first.pow !== 0n) return `mốc đầu pow = ${first.pow}, phải = 0 (pow(0) = 0 — VotingPower CONTRACT §1)`;
  for (let i = 1; i < knots.length; i++) {
    const prev = knots[i - 1]!;
    const k = knots[i]!;
    if (!(k.c > prev.c)) return `c không tăng nghiêm ngặt ở mốc ${i} (${prev.c} → ${k.c})`;
    if (!(k.pow >= prev.pow)) return `pow giảm ở mốc ${i} (${prev.pow} → ${k.pow})`;
    if (k.pow < 0n) return `pow âm ở mốc ${i} (${k.pow})`;
  }
  if (capOf(knots) < 1n) return `mốc cuối c = ${capOf(knots)}, phải ≥ 1`;
  return null;
}

/** weight_guard.ak ▸ knots_wellformed. */
export function knotsWellformed(knots: readonly Knot[]): boolean {
  return knotsProblem(knots) === null;
}

/**
 * weight_guard.ak ▸ dominates. Miền chung `[1, min(cap_a, cap_b)]` RỖNG ⇒ `false` (không phải
 * "đúng rỗng"): "không so được" không được đọc thành "đã so và đạt".
 */
export function dominates(a: readonly Knot[], b: readonly Knot[]): boolean {
  const hi = capOf(a) < capOf(b) ? capOf(a) : capOf(b);
  if (hi < 1n) return false;
  const points = [...a.map((k) => k.c), ...b.map((k) => k.c)].filter((c) => c >= 1n && c <= hi);
  return [hi, ...points].every((c) => interp(a, c) >= interp(b, c));
}

/** Lý do bảng vi phạm cổng D8 đầy đủ (G0 ∧ G1 ∧ G2 ∧ G3), hoặc `null` khi đạt. */
export function d8Problem(wp: Pick<WeightParam, "k1" | "k2" | "k3" | "k4">): string | null {
  const tables = [["k1", wp.k1], ["k2", wp.k2], ["k3", wp.k3], ["k4", wp.k4]] as const;
  for (const [name, k] of tables) {
    const why = knotsProblem(k);
    if (why !== null) return `G0 ${name}: ${why}`;
  }
  for (const [name, k] of tables) {
    if (!isLive(k)) return `G3 ${name}: bảng phẳng (w = 0) — yếu tố bị tắt`;
  }
  if (!dominates(wp.k1, wp.k2)) return "G1: k1 không nằm trên k2 (w_1 < w_2)";
  if (!dominates(wp.k3, wp.k4)) return "G2: k3 không nằm trên k4 (w_3 < w_4)";
  return null;
}

/** weight_guard.ak ▸ d8_ok. */
export function d8Ok(wp: Pick<WeightParam, "k1" | "k2" | "k3" | "k4">): boolean {
  return d8Problem(wp) === null;
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
