// Phần tính toán THUẦN của `04_e2e.ts` — tách ra để kiểm được không cần mạng hay ví
// (bài kiểm: `Distribution/tests/e2ePlan.test.ts`). Chỉ phụ thuộc `offchain/src`.
//
// Issue #77: runner cũ gọi builder với hình dạng tham số trước PR #75 — grant chỉ có đầu
// dưới, beacon thiếu `msPerEpoch`/`currentDropValue`, và cấp lại cho tài khoản mỗi lượt
// chạy nên sau rebase (C-ACC-3) bước redeem cùng lượt không bao giờ rút được gì.

import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "../offchain/src/types.js";
import { redeemable, beaconIndexAt, isqrt, vested, aSpan } from "../offchain/src/vested.js";
import { DEFAULT_DROPS_PER_EPOCH, TRIM_FLOOR, epochWindow } from "../offchain/src/constants.js";

export interface EpochWindow { loMs: bigint; hiMs: bigint; epoch: bigint }

const normHex = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

/**
 * Cặp lo/hi của cửa sổ hiện tại, ném nếu cửa sổ đã sang trang so với `expectedEpoch` chốt ở
 * đầu lượt. Cùng khuôn `windowNow` của `Genesis/scripts/28_beacon_grant_redeem.ts`: nhãn in
 * cho người vận hành, nhãn tính kế hoạch và nhãn ghi vào datum phải là CÙNG một cửa sổ.
 */
export function windowNow(
  msPerEpoch: bigint, expectedEpoch: bigint, nowMs: bigint = BigInt(Date.now()),
): EpochWindow {
  const w = epochWindow(msPerEpoch, nowMs);
  if (w.epoch !== expectedEpoch) {
    throw new Error(
      `WINDOW-001: cửa sổ vừa sang trang (${expectedEpoch} → ${w.epoch}) giữa lượt chạy. ` +
        `Kế hoạch của lượt này tính theo cửa sổ ${expectedEpoch} — chạy lại từ đầu.`,
    );
  }
  return w;
}

/** Tham số thời gian cho grant (CREATE lẫn UPDATE): CẢ HAI đầu, cùng cửa sổ (C-ACC-2/3). */
export function grantTimeParams(w: EpochWindow): { currentEpoch: bigint; validFromMs: bigint; validToMs: bigint } {
  return { currentEpoch: w.epoch, validFromMs: w.loMs, validToMs: w.hiMs };
}

/** Redeem chỉ đọc đầu dưới (`get_epoch`); đầu dưới phải ≤ now và nằm trong cửa sổ. */
export function redeemTimeParams(w: EpochWindow): { currentEpoch: bigint; validFromMs: bigint } {
  return { currentEpoch: w.epoch, validFromMs: w.loMs };
}

export type BeaconPlan =
  | { action: "skip"; onChainEpoch: bigint }
  | { action: "post"; params: { newBeacon: BeaconDatum; msPerEpoch: bigint; currentBeacon: BeaconDatum } };

/**
 * C-BCN-2 đòi nhãn tăng, C-BCN-3 đòi nhãn == cửa sổ ⇒ mỗi cửa sổ đúng một lượt post.
 * Nhãn trên chuỗi == cửa sổ này ⇒ đã post, bỏ qua. Nhãn trên chuỗi LỚN HƠN cửa sổ này thì
 * đồng hồ hoặc dữ liệu sai — ném, vì không có lượt post nào hợp lệ được nữa.
 *
 * v3: `index` của beacon mới KHÔNG phải tham số — nó được TÍNH từ beacon cũ theo C-BCN-6
 * (`index_out == index_in + rate_root_IN · (epoch_out − epoch_in)`), tức quá khứ luôn được
 * định giá bằng tốc độ CŨ. Nhận nó làm tham số là mở một chỗ để người gọi gõ một con số
 * trông hợp lý, và validator sẽ từ chối sau khi đã mất phí.
 *
 * `rateRoot` mới thì VẪN là tham số (đó là cái committee quyết), nhưng nó chỉ được NỚI LÊN
 * — `beaconBuilder` ép C-BCN-5'/5a/5b. Ở đây chỉ dựng datum; không kiểm hộ nó hai lần.
 */
export function planBeacon(p: {
  onChain: BeaconDatum; window: EpochWindow; rateRoot: bigint; msPerEpoch: bigint;
  trimNum?: bigint; trimDen?: bigint;
}): BeaconPlan {
  const { onChain, window: w } = p;
  if (onChain.epoch > w.epoch) {
    throw new Error(
      `E2E-BCN-001: beacon trên chuỗi mang nhãn ${onChain.epoch} LỚN HƠN cửa sổ hiện tại ${w.epoch}. ` +
        `C-BCN-3 không cho dán nhãn tương lai, nên đồng hồ máy dựng hoặc MS_PER_EPOCH đang lệch.`,
    );
  }
  if (onChain.epoch === w.epoch) return { action: "skip", onChainEpoch: onChain.epoch };
  return {
    action: "post",
    params: {
      newBeacon: {
        epoch:      w.epoch,
        kind:       "DropParam",
        index:      beaconIndexAt(onChain, w.epoch),          // C-BCN-6
        rate_root:  p.rateRoot,
        trim_num:   p.trimNum ?? onChain.trim_num,
        trim_den:   p.trimDen ?? onChain.trim_den,
        speed_policies: onChain.speed_policies,
      },
      msPerEpoch: p.msPerEpoch,
      currentBeacon: onChain,
    },
  };
}

export type GrantPlan =
  | { action: "create" | "topup"; expected: ClaimAccountDatum }
  | { action: "skip"; pending: bigint };

/**
 * Cấp cho một owner trong lượt e2e.
 *  - chưa có tài khoản → CREATE, `start_epoch` = cửa sổ này.
 *  - có tài khoản mà đang còn phần RÚT ĐƯỢC → BỎ QUA. Cấp thêm là REBASE
 *    (`E' = E − redeemed + amount`, `redeemed' = 0`, `start' = cửa sổ này` — Tech-Spec
 *    §"Bất biến thêm 2026-09-17"), nên phần đã vest phải vest lại và bước redeem cùng lượt
 *    rút được 0. Runner cũ cấp lại mỗi lượt nên không lượt nào đi tới redeem.
 *  - có tài khoản, lô chưa rút trọn (kể cả chưa vest gì) → cũng BỎ QUA.
 *  - có tài khoản, đã rút TRỌN (`redeemed ≥ entitlement`) → TOPUP theo rebase.
 */
export function planGrant(p: {
  account: ClaimAccountDatum | null; ownerPkh: string; amount: bigint;
  beacon: BeaconDatum; treasury: TreasuryDatum; windowEpoch: bigint; dropsPerEpoch?: bigint;
}): GrantPlan {
  const { account: a, windowEpoch: e } = p;
  // A(cửa sổ này) — mốc CHỈ SỐ mà cả CREATE lẫn TOPUP phải ghi vào datum (C-CLAIM-8).
  // Tính MỘT lần: hai chỗ tính riêng là hai chỗ trôi riêng.
  const aNow = beaconIndexAt(p.beacon, e);
  if (!a) {
    return {
      action: "create",
      expected: {
        owner: normHex(p.ownerPkh), entitlement: p.amount, redeemed: 0n,
        start_epoch: e, drops_per_epoch: p.dropsPerEpoch ?? DEFAULT_DROPS_PER_EPOCH,
        index_at_start: aNow,
      },
    };
  }
  if (normHex(a.owner) !== normHex(p.ownerPkh)) {
    throw new Error(`E2E-GRANT-002: tài khoản thuộc ${a.owner}, không phải ${p.ownerPkh}.`);
  }
  if (a.start_epoch > e) {
    throw new Error(
      `E2E-GRANT-001: tài khoản mang start_epoch ${a.start_epoch} LỚN HƠN cửa sổ hiện tại ${e}. ` +
        `C-ACC-2/3 ghim mốc bằng get_epoch_strict nên mốc tương lai nghĩa là đồng hồ đang lệch.`,
    );
  }
  // TOPUP chỉ khi đã rút TRỌN lô. Bản trước topup mỗi khi "không còn gì rút được lúc này" —
  // gồm cả ca tài khoản mở trong CHÍNH cửa sổ này (chưa vest) và ca vừa rút hết phần đã vest:
  // chạy lại runner trong cùng cửa sổ là cấp chồng 1.250 LAMP mỗi lần cho tới khi cạn kho,
  // và ở ca thứ hai là rebase xoá tiến độ vest.
  if (a.redeemed < a.entitlement) {
    return { action: "skip", pending: redeemable(a, p.beacon, p.treasury, e, TRIM_FLOOR) };
  }
  return {
    action: "topup",
    expected: {
      ...a, entitlement: a.entitlement - a.redeemed + p.amount, redeemed: 0n,
      start_epoch: e, index_at_start: aNow,
    },
  };
}

export type RedeemPlan =
  | { action: "redeem"; amount: bigint; trimmed: bigint; expected: ClaimAccountDatum }
  | { action: "wait"; fromEpoch: bigint }
  | { action: "stalled" }
  | { action: "exhausted" };

/**
 * `A_span` NHỎ NHẤT để `vested` vượt `redeemed`, hay `null` nếu không span nào đạt.
 *
 * v3 đòi `dpe² · E · span² ≥ (redeemed + 1)²` (vì `isqrt(x) > r ⟺ x ≥ (r+1)²`). Giải trực
 * tiếp bằng `isqrt` rồi DÒ LÊN tối đa một bước: `isqrt` làm tròn xuống, nên nghiệm ước
 * lượng có thể hụt đúng 1. Vòng dò là hai dòng và nó chặn được cái sai mà một công thức
 * đóng "trông đúng" sẽ mắc — hụt một cửa sổ thì runner in ra một mốc chờ SỚM HƠN thật, và
 * lượt chạy ở mốc đó thất bại mà không ai hiểu vì sao.
 */
function minSpanForProgress(entitlement: bigint, dpe: bigint, redeemed: bigint): bigint | null {
  if (redeemed >= entitlement) return null;          // đã rút trọn, không span nào đổi được
  const k = dpe * dpe * entitlement;
  if (k <= 0n) return null;
  const target = (redeemed + 1n) * (redeemed + 1n);
  let s = isqrt((target + k - 1n) / k);
  while (k * s * s < target) s += 1n;
  return s;
}

/**
 * Số rút kỳ vọng và datum kỳ vọng sau Redeem (C-RDM-4: `redeemed' = redeemed + amount`,
 * mọi trường khác — KỂ CẢ `index_at_start` — bất biến).
 *
 * v3 cần thêm `treasury`: trần một lượt đọc `total_redeemed`, nên số rút không còn tính
 * được chỉ từ tài khoản. `trimmed` là phần bị cắt lượt này — nó KHÔNG mất, và tách ra để
 * runner không in phép cắt ngọn thành một lượt rút hụt.
 */
export function planRedeem(
  a: ClaimAccountDatum, beacon: BeaconDatum, treasury: TreasuryDatum, windowEpoch: bigint,
): RedeemPlan {
  const amount = redeemable(a, beacon, treasury, windowEpoch, TRIM_FLOOR);
  if (amount > 0n) {
    const span = aSpan(a, beacon, windowEpoch);
    const uncapped = vested(a.entitlement, a.drops_per_epoch, span) - a.redeemed;
    return {
      action: "redeem", amount, trimmed: uncapped - amount,
      expected: { ...a, redeemed: a.redeemed + amount },
    };
  }
  if (a.redeemed >= a.entitlement) return { action: "exhausted" };

  // Cửa sổ đầu tiên rút được: `A(t) − index_at_start ≥ span_min`.
  // `A(t) = index + rate_root · (t − epoch)` ⇒ t = windowEpoch + ⌈thiếu / rate_root⌉.
  // `rate_root ≤ 0` hoặc `dpe ≤ 0` ⇒ chỉ số đứng yên ⇒ không cửa sổ nào rút được. Nói
  // thẳng là KẸT, đừng in một cửa sổ bịa — một mốc chờ trông có lý là câu trả lời sai cho
  // một câu hỏi không có câu trả lời.
  const span = minSpanForProgress(a.entitlement, a.drops_per_epoch, a.redeemed);
  if (span === null || beacon.rate_root <= 0n) return { action: "stalled" };
  const deficit = a.index_at_start + span - beaconIndexAt(beacon, windowEpoch);
  const steps = deficit <= 0n ? 0n : (deficit + beacon.rate_root - 1n) / beacon.rate_root;
  const next = windowEpoch + steps;
  return { action: "wait", fromEpoch: next > windowEpoch ? next : windowEpoch + 1n };
}

/** Các trường lệch giữa datum kỳ vọng và datum đọc lại trên chuỗi; rỗng = khớp. */
export function accountDatumMismatches(expected: ClaimAccountDatum, actual: ClaimAccountDatum): string[] {
  const out: string[] = [];
  if (normHex(expected.owner) !== normHex(actual.owner)) {
    out.push(`owner: kỳ vọng ${expected.owner}, trên chuỗi ${actual.owner}`);
  }
  // `index_at_start` nằm TRONG danh sách: ở v3 nó là thứ duy nhất đi vào phép tính vested,
  // nên một datum lệch đúng trường này đọc lại vẫn "khớp" theo bản cũ của hàm — và lệch ở
  // đó là lệch toàn bộ lịch mở khoá của tài khoản.
  for (const k of
    ["entitlement", "redeemed", "start_epoch", "drops_per_epoch", "index_at_start"] as const) {
    if (expected[k] !== actual[k]) out.push(`${k}: kỳ vọng ${expected[k]}, trên chuỗi ${actual[k]}`);
  }
  return out;
}
