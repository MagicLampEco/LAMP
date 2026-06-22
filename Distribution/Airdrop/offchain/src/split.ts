// Airdrop split 20:100 (§6.2) — chia ngân sách 1 epoch thành SPO + Delegator.
//
//   B_spo = budget × 20/120   ·   B_del = budget × 100/120
//
// Dư floor (budget − B_spo − B_del do chia nguyên) → dồn vào Delegator (pool lớn hơn,
// tất định). Bất biến: B_spo + B_del == budget.

import {
  PER_EPOCH_OIL, SPO_RATIO, DELEGATOR_RATIO, TOTAL_RATIO, AIRDROP_EPOCHS, AIRDROP_TOTAL_OIL,
} from "./constants.js";

export interface EpochSplit {
  /** Ngân sách SPO epoch này (oil). */
  spoBudgetOil: bigint;
  /** Ngân sách Delegator epoch này (oil). */
  delegatorBudgetOil: bigint;
}

/** Chia 1 ngân sách epoch theo 20:100; dư floor → Delegator. */
export function splitEpoch(budgetOil: bigint = PER_EPOCH_OIL): EpochSplit {
  if (budgetOil < 0n) throw new Error("SPLIT-000: budget phải ≥ 0");
  const spo = (budgetOil * SPO_RATIO) / TOTAL_RATIO;
  const del = budgetOil - spo; // phần còn lại (gồm dư floor) về Delegator
  return { spoBudgetOil: spo, delegatorBudgetOil: del };
}

/** Tự kiểm: tổng 5 epoch == AIRDROP_TOTAL_OIL (bất biến ngân sách toàn pot). */
export function totalAcrossEpochs(): bigint {
  return PER_EPOCH_OIL * AIRDROP_EPOCHS;
}

/** Bất biến đối chiếu (dùng trong test + assert vận hành). */
export function assertBudgetInvariant(): void {
  if (totalAcrossEpochs() !== AIRDROP_TOTAL_OIL) {
    throw new Error(
      `SPLIT-001: PER_EPOCH × ${AIRDROP_EPOCHS} (${totalAcrossEpochs()}) ≠ AIRDROP_TOTAL (${AIRDROP_TOTAL_OIL})`,
    );
  }
  const { spoBudgetOil, delegatorBudgetOil } = splitEpoch();
  if (spoBudgetOil + delegatorBudgetOil !== PER_EPOCH_OIL) {
    throw new Error("SPLIT-002: B_spo + B_del ≠ PER_EPOCH");
  }
  // DELEGATOR_RATIO chỉ dùng để tài liệu hoá tỉ lệ; kiểm cho rõ ý nghĩa.
  if (SPO_RATIO + DELEGATOR_RATIO !== TOTAL_RATIO) {
    throw new Error("SPLIT-003: SPO_RATIO + DELEGATOR_RATIO ≠ TOTAL_RATIO");
  }
}
