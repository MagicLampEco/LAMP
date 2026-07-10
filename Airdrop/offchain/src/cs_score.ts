// cs_score.ts — phân phối 3 pot Airdrop theo TRỌNG SỐ STAKE (stake-weighted).
//
// Vai trò: SPO = Staking Pool Operator · CS = Community Supporter.
//
// ─────────────────────────────────────────────────────────────────────────
// MÔ HÌNH (thay hoàn toàn CS log-score cũ — xem SPO-CS-SPEC-Vi.md)
//
//   Mỗi pot chia ∝ trọng số stake của người nhận, bằng largest-remainder
//   (Hamilton) → BẢO TOÀN TUYỆT ĐỐI: Σ oil = potOil (khi cap=null).
//
//   • Pot SPO (5M)  — trọng số SPO(i) = Σ stake các delegator (đã đăng ký) ủy
//     thác VÀO POOL của SPO i (delegation chảy vào pool).
//   • Pot CS  (15M) — trọng số CS(j)  = Σ stake các delegator đã BÌNH CHỌN
//     rằng j đã hỗ trợ họ (stake của người-được-giúp công nhận).
//   • Pot Delegator (100M) — GIỮ nguyên `delegator_entitlement.ts`
//     (trọng số = stake của CHÍNH delegator).
//
//   Cả 3 đều neo STAKE (đại lượng tốn kém, không ngụy tạo được) → chống sybil.
//   Khác nhau ở NGUỒN trọng số: SPO = stake-vào-pool · CS = stake-bình-chọn.
//
// ─────────────────────────────────────────────────────────────────────────
// RANH GIỚI BIGINT (đọc kỹ trước khi sửa)
//
//   MỌI trọng số + khoản tiền là BigInt oildrop. KHÔNG float, KHÔNG Number.
//   Chia bằng largest-remainder → bảo toàn tuyệt đối. Cap tuỳ chọn mỗi-người
//   nhận (như ETD `capOil`) qua water-filling; mặc định null (không cap).
//
//   Đơn vị: 1 LAMP = 10^6 oildrop (OIL_PER_LAMP).
//   Pot SPO = 5.000.000 LAMP · Pot CS = 15.000.000 LAMP (constants.ts).
// ─────────────────────────────────────────────────────────────────────────

import { SPO_POT_OIL, CS_POT_OIL } from "./constants.js";
import { computeEntitlements } from "../../../TIGER/offchain/src/entitlement.js";
import { buildSnapshotSet } from "../../../TIGER/offchain/src/snapshot.js";

// ── Types ────────────────────────────────────────────────────────────────

/** 1 trọng số stake của người nhận.
 *  - Pot SPO: id = spo_id, stake = Σ stake delegator ủy thác vào pool đó.
 *  - Pot CS : id = supporter_id, stake = weight_stake (Σ stake người bình chọn). */
export interface StakeWeight {
  id: string;
  /** Trọng số stake (lovelace tích luỹ) — BigInt, không âm. */
  stake: bigint;
}

/** Reward 1 người nhận (oildrop). */
export interface StakeReward {
  id: string;
  oil: bigint;
}

// ── Lõi: chia 1 pot ∝ stake ────────────────────────────────────────────────

/** Chia `potOil` (oildrop) cho `weights` ∝ stake, bằng largest-remainder (Hamilton).
 *
 *  TÁI DÙNG thuật toán token-side đã chạy thật trên Preview (`computeEntitlements`
 *  của TIGER): cùng largest-remainder + water-filling cap + gom dư floor → KHÔNG
 *  copy-lệch, 1 nguồn thuật toán duy nhất.
 *
 *  Trả về 1 entry / id theo ĐÚNG thứ tự input (id trọng số 0 hoặc bị loại → oil=0).
 *
 *  Bất biến:
 *    • cap=null ⇒ Σ oil = potOil (bảo toàn tuyệt đối; dư floor gom về stake lớn nhất).
 *    • không id nào stake>0 (mảng rỗng / toàn 0) ⇒ Σ oil = 0, leftover = potOil.
 *    • cap>0 ⇒ mỗi oil ≤ cap; phần không chia được (do cap) là leftover về Treasury.
 *
 *  Ném lỗi nếu 2 weight trùng id (buildSnapshotSet bắt trùng owner — chống thổi phồng). */
export function splitByStake(
  weights: StakeWeight[],
  potOil: bigint,
  capOil: bigint | null = null,
): StakeReward[] {
  if (potOil < 0n) throw new Error("CS-POT: potOil phải ≥ 0");

  // 1 "epoch" tổng hợp: rows = id ↦ stake. buildSnapshotSet bỏ stake ≤ 0 và ném
  // lỗi nếu id trùng trong cùng epoch (chống 1 người xuất hiện 2 dòng).
  const rows = weights.map((w) => ({
    stake_address: w.id,
    amount: w.stake.toString(),
  }));
  const snap = buildSnapshotSet([{ epoch: 0n, rows }]);

  const res = computeEntitlements(snap, { budgetOil: potOil, capOil });
  const oilById = new Map(res.entitlements.map((e) => [e.owner, e.amount]));

  return weights.map((w) => ({ id: w.id, oil: oilById.get(w.id) ?? 0n }));
}

// ── Pot SPO — trọng số = stake chảy VÀO POOL ────────────────────────────────

/** Chia pot SPO ∝ tổng stake (đã đăng ký) ủy thác vào pool mỗi SPO.
 *  `spoWeights[i].stake` = Σ active_stake của các delegator đã đăng ký delegate
 *  vào pool của SPO i. Thưởng SPO hút/giữ được nhiều delegation. */
export function splitSpoPot(
  spoWeights: StakeWeight[],
  potOil: bigint = SPO_POT_OIL,
  capOil: bigint | null = null,
): StakeReward[] {
  return splitByStake(spoWeights, potOil, capOil);
}

// ── Pot CS (Community Supporter) — trọng số = stake của người BÌNH CHỌN ──────

/** Chia pot CS ∝ tổng "phiếu-stake" bình chọn cho mỗi supporter.
 *  `csWeights[j].stake` = Σ stake của các delegator đã bình chọn rằng supporter j
 *  đã hỗ trợ họ (mỗi delegator có phiếu-stake = stake của mình, tổng phân bổ ≤ stake
 *  của họ — quy tắc chống double-count, xem SPO-CS-SPEC §Quy tắc bình chọn).
 *  Supporter KHÔNG cần là SPO — chỉ cần được stakeholder công nhận đã giúp. */
export function splitCsPot(
  csWeights: StakeWeight[],
  potOil: bigint = CS_POT_OIL,
  capOil: bigint | null = null,
): StakeReward[] {
  return splitByStake(csWeights, potOil, capOil);
}
