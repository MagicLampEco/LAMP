// Genesis circulating — lưu hành đa pot.
// circulating = tổng cung − Σ balance pots (tLAMP). KHÔNG burn: token rời pot = vào
// lưu hành; token vào pot (thu phí Treasury / bond Deposits) = rời lưu hành. Tổng cung
// A BẤT BIẾN. Mirror Treasury CONTRACT §5 ("giảm lưu hành" là thuộc tính kế toán).
//
// Pure Int/BigInt. Chỉ tính tLAMP — ADA / asset khác KHÔNG vào circulating tLAMP.

import { TOTAL_SUPPLY_OIL, type PotName, type PotShare } from "./split.js";

/** Số dư tLAMP (oil) của 1 pot. Ở mô hình này = value pot (sổ chỉ giữ tLAMP booked). */
export function potBalance(pot: PotShare): bigint {
  return pot.value;
}

/** Σ balance tLAMP của các pot (oil). */
export function sumPotBalances(pots: PotShare[]): bigint {
  return pots.reduce((s, p) => s + potBalance(p), 0n);
}

/**
 * tLAMP đang lưu hành (oil) = total − Σ pot balances.
 * Bất biến C-INV: 0 ≤ circulating ≤ total (vì 0 ≤ Σ pots ≤ total).
 * @throws nếu Σ pots vượt total hoặc âm (kế toán hỏng — phát hiện sớm).
 */
export function circulating(pots: PotShare[], total: bigint = TOTAL_SUPPLY_OIL): bigint {
  if (total < 0n) throw new Error("CIRC-001: total < 0");
  const held = sumPotBalances(pots);
  if (held < 0n) throw new Error("CIRC-002: Σ pots < 0 (pot âm)");
  if (held > total) {
    throw new Error(`CIRC-003: Σ pots = ${held} > total = ${total} (vi phạm bảo toàn)`);
  }
  return total - held;
}

/** circulating đổi sang tLAMP nguyên (làm tròn xuống). Tiện hiển thị. */
export function circulatingLamp(pots: PotShare[], total: bigint = TOTAL_SUPPLY_OIL): bigint {
  return circulating(pots, total) / 1_000_000n;
}

/**
 * Áp 1 dịch chuyển value cho 1 pot (oil, có dấu): +delta vào pot, trả pots mới.
 * delta > 0 = token vào pot (rời lưu hành); delta < 0 = ra pot (vào lưu hành).
 * Dùng mô phỏng vest / thu phí trong test + dashboard. KHÔNG đổi total.
 */
export function applyPotDelta(pots: PotShare[], pot: PotName, delta: bigint): PotShare[] {
  let found = false;
  const out = pots.map((p) => {
    if (p.pot !== pot) return { ...p };
    found = true;
    const v = p.value + delta;
    if (v < 0n) throw new Error(`CIRC-004: pot ${pot} âm sau delta (${v})`);
    return { ...p, value: v };
  });
  if (!found) throw new Error(`CIRC-005: không tìm thấy pot ${pot}`);
  return out;
}
