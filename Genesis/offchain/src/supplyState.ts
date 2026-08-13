// LAMP Genesis — SupplyState cap math (offchain mirror onchain lamp_mint luật 4-7).
//
// Pure BigInt. Tính transition + kiểm bất biến TRƯỚC khi build tx (fail-fast offchain,
// tránh tốn phí tx chắc chắn reject onchain). Logic PHẢI khớp lamp_mint.ak.

import { DIST_CAP_OILDROP, RESERVE_CAP_OILDROP } from "./constants.js";
import type { MintRoute, SupplyState } from "./types.js";

/** SupplyState khởi tạo (genesis): chưa mint gì, caps chuẩn MVP. */
export function genesisSupplyState(): SupplyState {
  return {
    dist_minted:    0n,
    reserve_minted: 0n,
    dist_cap:       DIST_CAP_OILDROP,
    reserve_cap:    RESERVE_CAP_OILDROP,
  };
}

/** minted_total = dist_minted + reserve_minted. */
export function mintedTotal(s: SupplyState): bigint {
  return s.dist_minted + s.reserve_minted;
}

/** Quota Distribution còn lại (oildrop) = dist_cap − dist_minted (POT Reserve ẢO tương tự). */
export function distRemaining(s: SupplyState): bigint {
  return s.dist_cap - s.dist_minted;
}

/** Quota Reserve còn lại (oildrop) = reserve_cap − reserve_minted (POT Reserve ẢO). */
export function reserveRemaining(s: SupplyState): bigint {
  return s.reserve_cap - s.reserve_minted;
}

export class SupplyMintError extends Error {}

/**
 * Tính SupplyState mới sau khi mint `delta` oildrop qua `route`.
 * Ép ĐÚNG luật onchain (Δ>0, cộng đúng quota, monotonic, ≤ cap, cap bất biến).
 * Throw SupplyMintError nếu vi phạm (fail-fast TRƯỚC khi tốn phí onchain).
 */
export function applyMint(s: SupplyState, route: MintRoute, delta: bigint): SupplyState {
  if (delta <= 0n) {
    throw new SupplyMintError(`GMINT-001: Δ phải > 0 (lazy-mint không burn/no-op), got ${delta}`);
  }
  if (route === "DistributionVest") {
    const next = s.dist_minted + delta;
    if (next > s.dist_cap) {
      throw new SupplyMintError(
        `GMINT-010: vượt dist_cap — dist_minted ${next} > cap ${s.dist_cap} ` +
        `(còn ${distRemaining(s)} oildrop)`,
      );
    }
    return { ...s, dist_minted: next };
  }
  // ReserveDraw
  const next = s.reserve_minted + delta;
  if (next > s.reserve_cap) {
    throw new SupplyMintError(
      `GMINT-011: vượt reserve_cap — reserve_minted ${next} > cap ${s.reserve_cap} ` +
      `(còn ${reserveRemaining(s)} oildrop)`,
    );
  }
  return { ...s, reserve_minted: next };
}

/** Kiểm bất biến SupplyState (audit offchain): caps đúng MVP, minted ≤ cap, ≥ 0. */
export function assertInvariants(s: SupplyState): void {
  if (s.dist_minted < 0n || s.reserve_minted < 0n) {
    throw new SupplyMintError(`GMINT-020: minted âm — dist=${s.dist_minted} reserve=${s.reserve_minted}`);
  }
  if (s.dist_minted > s.dist_cap) {
    throw new SupplyMintError(`GMINT-021: dist_minted ${s.dist_minted} > dist_cap ${s.dist_cap}`);
  }
  if (s.reserve_minted > s.reserve_cap) {
    throw new SupplyMintError(`GMINT-022: reserve_minted ${s.reserve_minted} > reserve_cap ${s.reserve_cap}`);
  }
}
