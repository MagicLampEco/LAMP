// Phần tính toán THUẦN của `04_e2e.ts` — tách ra để kiểm được không cần mạng hay ví
// (bài kiểm: `Distribution/tests/e2ePlan.test.ts`). Chỉ phụ thuộc `offchain/src`.
//
// Issue #77: runner cũ gọi builder với hình dạng tham số trước PR #75 — grant chỉ có đầu
// dưới, beacon thiếu `msPerEpoch`/`currentDropValue`, và cấp lại cho tài khoản mỗi lượt
// chạy nên sau rebase (C-ACC-3) bước redeem cùng lượt không bao giờ rút được gì.

import type { BeaconDatum, ClaimAccountDatum } from "../offchain/src/types.js";
import { redeemable } from "../offchain/src/vested.js";
import { DEFAULT_DROPS_PER_EPOCH, epochWindow } from "../offchain/src/constants.js";

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
  | { action: "post"; params: { newBeacon: BeaconDatum; msPerEpoch: bigint; currentDropValue: bigint } };

/**
 * C-BCN-2 đòi nhãn tăng, C-BCN-3 đòi nhãn == cửa sổ ⇒ mỗi cửa sổ đúng một lượt post.
 * Nhãn trên chuỗi == cửa sổ này ⇒ đã post, bỏ qua. Nhãn trên chuỗi LỚN HƠN cửa sổ này thì
 * đồng hồ hoặc dữ liệu sai — ném, vì không có lượt post nào hợp lệ được nữa.
 * `currentDropValue` lấy từ datum trên chuỗi để builder kiểm trần ±10% (C-BCN-5).
 */
export function planBeacon(p: {
  onChain: BeaconDatum; window: EpochWindow; dropValue: bigint; msPerEpoch: bigint;
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
      newBeacon: { epoch: w.epoch, kind: "DropParam", drop_value: p.dropValue },
      msPerEpoch: p.msPerEpoch,
      currentDropValue: onChain.drop_value,
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
  dropValue: bigint; windowEpoch: bigint; dropsPerEpoch?: bigint;
}): GrantPlan {
  const { account: a, windowEpoch: e } = p;
  if (!a) {
    return {
      action: "create",
      expected: {
        owner: normHex(p.ownerPkh), entitlement: p.amount, redeemed: 0n,
        start_epoch: e, drops_per_epoch: p.dropsPerEpoch ?? DEFAULT_DROPS_PER_EPOCH,
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
    return { action: "skip", pending: redeemable(a, p.dropValue, e) };
  }
  return {
    action: "topup",
    expected: { ...a, entitlement: a.entitlement - a.redeemed + p.amount, redeemed: 0n, start_epoch: e },
  };
}

export type RedeemPlan =
  | { action: "redeem"; amount: bigint; expected: ClaimAccountDatum }
  | { action: "wait"; fromEpoch: bigint }
  | { action: "stalled" }
  | { action: "exhausted" };

/** Số rút kỳ vọng và datum kỳ vọng sau Redeem (C-RDM-4: `redeemed' = redeemed + amount`). */
export function planRedeem(a: ClaimAccountDatum, dropValue: bigint, windowEpoch: bigint): RedeemPlan {
  const amount = redeemable(a, dropValue, windowEpoch);
  if (amount > 0n) return { action: "redeem", amount, expected: { ...a, redeemed: a.redeemed + amount } };
  if (a.redeemed >= a.entitlement) return { action: "exhausted" };
  // Cửa sổ đầu tiên mà `rate·(t − start) > redeemed`: t = start + ⌊redeemed / rate⌋ + 1.
  // `rate = D·dpe ≤ 0` thì không cửa sổ nào rút được — nói thẳng, đừng in một cửa sổ bịa.
  const rate = dropValue * a.drops_per_epoch;
  if (rate <= 0n) return { action: "stalled" };
  const next = a.start_epoch + a.redeemed / rate + 1n;
  return { action: "wait", fromEpoch: next > windowEpoch ? next : windowEpoch + 1n };
}

/** Các trường lệch giữa datum kỳ vọng và datum đọc lại trên chuỗi; rỗng = khớp. */
export function accountDatumMismatches(expected: ClaimAccountDatum, actual: ClaimAccountDatum): string[] {
  const out: string[] = [];
  if (normHex(expected.owner) !== normHex(actual.owner)) {
    out.push(`owner: kỳ vọng ${expected.owner}, trên chuỗi ${actual.owner}`);
  }
  for (const k of ["entitlement", "redeemed", "start_epoch", "drops_per_epoch"] as const) {
    if (expected[k] !== actual[k]) out.push(`${k}: kỳ vọng ${expected[k]}, trên chuỗi ${actual[k]}`);
  }
  return out;
}
