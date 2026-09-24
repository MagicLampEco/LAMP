// LampDistribution vested math — CONTRACT v3 "Capped Drop" §1.
// Tất định, O(1) trừ `isqrt`, PHẢI khớp byte-perfect với validator on-chain.
//
//   A(t)    = index + rate_root · (t − epoch)          ← chỉ số CỘNG DỒN từ beacon
//   A_span  = A(bây giờ) − index_at_start              ← PHẢI ≥ 0
//   vested  = min( entitlement , √entitlement · A_span )
//   trần một lượt = max( trim_floor , total_redeemed · trim_num / trim_den )
//   amount  = min( xin , vested − redeemed , trần một lượt )
//
// ⚠ VÌ SAO KHÔNG TÍNH `√E` RỒI NHÂN: validator ép dạng BÌNH PHƯƠNG
//     (redeemed + amount)² ≤ dpe² · E · A_span²
// và `isqrt(k²·E) ≠ k·isqrt(E)` nói chung — ví dụ k = 3, E = 2 cho 4 và 3. Tính theo
// `k · isqrt(E)` sẽ ra số NHỎ HƠN validator cho phép ở một số đầu vào, và ví sẽ xin
// thiếu mà không ai biết vì giao dịch vẫn qua. Phải `isqrt` trên TRỌN tích.
//
// Bất biến (CONTRACT §7):
//   - vested đơn điệu tăng theo t VỚI MỌI quỹ đạo tham số — `rate_root` chỉ được NỚI.
//   - đa-claim: redeemed cộng dồn, redeemable ≥ 0, tổng nhận ≤ E.
//   - `drops_per_epoch` GHIM == 1 (C-ACC-DPE): nó đứng NGOÀI tổng `A_span`, nên nó không
//     phải một tham số — đổi nó là viết lại quá khứ.

import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "./types.js";

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Căn bậc hai NGUYÊN (làm tròn xuống) của một bigint ≥ 0 — Newton, hội tụ bậc hai. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("VESTED-004: isqrt của số âm");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** `A(window) = index + rate_root · (window − epoch)` — dạng đóng của chỉ số cộng dồn. */
export function beaconIndexAt(beacon: BeaconDatum, window: bigint): bigint {
  return beacon.index + beacon.rate_root * (window - beacon.epoch);
}

/**
 * `A_span = A(window) − index_at_start`. Ném khi âm.
 *
 * Âm chỉ xảy ra khi tài khoản mang một mốc chỉ số ở TƯƠNG LAI so với beacon hiện tại —
 * on-chain `expect a_span >= 0` từ chối thẳng, nên off-chain phải ném chứ không được
 * kẹp về 0: kẹp ở đây làm ví dựng một giao dịch mà validator chắc chắn từ chối, và lỗi
 * hiện ra ở nơi không đọc được nguyên nhân.
 */
export function aSpan(
  datum:  ClaimAccountDatum,
  beacon: BeaconDatum,
  window: bigint,
): bigint {
  const span = beaconIndexAt(beacon, window) - datum.index_at_start;
  if (span < 0n) {
    throw new Error(
      `VESTED-005: A_span âm (${span}) — index_at_start=${datum.index_at_start} ` +
      `lớn hơn A(${window})=${beaconIndexAt(beacon, window)}. Validator từ chối ca này.`,
    );
  }
  return span;
}

/**
 * `vested = min(E, isqrt(dpe² · E · A_span²))` — trần TÍCH LUỸ.
 *
 * Trả về số LAMP tối đa mà tài khoản được phép đã-nhận-cộng-dồn tại cửa sổ này, tức vế
 * phải của `new_redeemed ≤ …` trong validator.
 */
export function vested(
  entitlement:   bigint,
  dropsPerEpoch: bigint,
  span:          bigint,
): bigint {
  if (entitlement < 0n)   throw new Error("VESTED-000: entitlement phải ≥ 0");
  if (dropsPerEpoch < 0n) throw new Error("VESTED-002: dropsPerEpoch phải ≥ 0");
  if (span < 0n)          throw new Error("VESTED-003: A_span phải ≥ 0");

  const bound = isqrt(dropsPerEpoch * dropsPerEpoch * entitlement * span * span);
  return minBig(entitlement, bound);
}

/**
 * Trần MỘT LƯỢT RÚT: `max(trim_floor, total_redeemed · trim_num / trim_den)`.
 *
 * `trimFloor` là HẰNG của validator (`constants.ak`), KHÔNG đọc từ datum nào — truyền
 * vào để phía gọi lấy từ đúng một nguồn. Thiếu nó thì `total_redeemed = 0` là một ĐIỂM
 * HẤP THỤ: trần 0 ⟹ không ai rút được ⟹ `total_redeemed` mãi bằng 0.
 *
 * Phép chia là chia NGUYÊN, đúng như validator.
 */
export function trimCap(
  treasury:  TreasuryDatum,
  beacon:    BeaconDatum,
  trimFloor: bigint,
): bigint {
  if (beacon.trim_den <= 0n) throw new Error("VESTED-006: trim_den phải > 0");
  return maxBig(trimFloor, treasury.total_redeemed * beacon.trim_num / beacon.trim_den);
}

/**
 * Số LAMP rút được NGAY LƯỢT NÀY: `min(vested − redeemed, trần một lượt)`.
 *
 * Phần bị cắt KHÔNG mất — nó còn nguyên quyền và chờ lượt sau. Giao diện phải tách bạch
 * "rút được lượt này" với "còn lại tất cả", nếu không mỗi lần cắt ngọn đọc như tịch thu.
 */
export function redeemable(
  datum:     ClaimAccountDatum,
  beacon:    BeaconDatum,
  treasury:  TreasuryDatum,
  window:    bigint,
  trimFloor: bigint,
): bigint {
  const span = aSpan(datum, beacon, window);
  const v = vested(datum.entitlement, datum.drops_per_epoch, span);
  const uncapped = v - datum.redeemed;
  if (uncapped <= 0n) return 0n;
  return minBig(uncapped, trimCap(treasury, beacon, trimFloor));
}

/** Phần CÒN LẠI trọn đời: `entitlement − redeemed`. Khác `redeemable` ở chỗ nó không bị cắt. */
export function remaining(datum: ClaimAccountDatum): bigint {
  const r = datum.entitlement - datum.redeemed;
  return r > 0n ? r : 0n;
}

/**
 * Số CỬA SỔ (kể từ mốc chỉ số) để vested chạm trọn entitlement, bỏ qua phép cắt ngọn:
 * `n* = ⌈√E / (dpe · rate_root)⌉`.
 *
 * `rate_root` hoặc `dpe` bằng 0 ⟹ không bao giờ mở khoá (trả `null`). KHÔNG trả 0 và
 * KHÔNG trả một số lớn: cả hai đều là một câu trả lời trông có lý cho một câu hỏi không
 * có câu trả lời.
 */
export function windowsToFull(
  entitlement:   bigint,
  dropsPerEpoch: bigint,
  rateRoot:      bigint,
): bigint | null {
  const perWindow = dropsPerEpoch * rateRoot;
  if (perWindow <= 0n) return null;
  if (entitlement <= 0n) return 0n;
  const root = isqrt(entitlement);
  // ⌈√E / perWindow⌉ — nhưng `isqrt` làm tròn XUỐNG, nên một `E` không chính phương cần
  // thêm một cửa sổ khi phần dư còn. So bằng bình phương thay vì tin vào `root`.
  const n = (root + perWindow - 1n) / perWindow;
  const reached = perWindow * n;
  return reached * reached >= entitlement ? n : n + 1n;
}
