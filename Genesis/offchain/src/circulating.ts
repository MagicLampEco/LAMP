// LAMP Genesis — circulating supply (CONTRACT §6).
//
//   circulating = minted_total − Σ(Treasury + Deposits tLAMP held)
//   minted_total = dist_minted + reserve_minted ≤ 36 tỷ (oildrop).
//
// Reserve KHÔNG trừ ở đây: Reserve là quota CHƯA mint (ẢO) → token đó chưa tồn tại
// on-chain nên KHÔNG nằm trong minted_total. Chỉ trừ token ĐÃ mint mà đang nằm trong
// custody pot thật (Treasury/Deposits) — chưa tới tay user lưu hành.

import { mintedTotal } from "./supplyState.js";
import type { SupplyState } from "./types.js";

/** Một pot custody giữ tLAMP đã mint (Treasury / Deposits). amount = oildrop đang giữ. */
export interface PotHolding {
  label  : string;   // "Treasury" | "Deposits" | ...
  held   : bigint;   // oildrop tLAMP custody giữ
}

export class CirculatingError extends Error {}

/**
 * circulating = minted_total − Σ pot.held.
 * Throw nếu Σ held > minted_total (bất khả thi — custody không thể giữ nhiều hơn đã mint).
 */
export function circulating(s: SupplyState, pots: PotHolding[]): bigint {
  const minted = mintedTotal(s);
  const heldTotal = pots.reduce((acc, p) => {
    if (p.held < 0n) {
      throw new CirculatingError(`GCIRC-001: pot "${p.label}" held âm (${p.held})`);
    }
    return acc + p.held;
  }, 0n);
  if (heldTotal > minted) {
    throw new CirculatingError(
      `GCIRC-002: Σ pot held ${heldTotal} > minted_total ${minted} (bất khả thi)`,
    );
  }
  return minted - heldTotal;
}
