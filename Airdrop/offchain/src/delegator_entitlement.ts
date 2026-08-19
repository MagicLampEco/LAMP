// delegator_entitlement.ts — pot Delegator (100M LAMP) chia ∝accStake (mọi pool).
//
// TÁI DÙNG thuật toán chia của TIGER (computeEntitlements + buildSnapshotSet):
// KHÔNG viết lại largest-remainder/water-filling. Ở đây owner = ĐỊA CHỈ NHẬN LAMP
// (payment address bech32) — computeEntitlements coi owner là khoá đục, nên ta
// dùng thẳng payment address làm owner rồi map kết quả sang SnapshotEntry cho merkle.
//
// Bảo toàn: cap=null ⇒ Σ amount = budget (TIGER B4 gom hết phần lẻ).

import type { SnapshotEntry } from "./types.js";
import { computeEntitlements } from "../../../TIGER/offchain/src/entitlement.js";
import { buildSnapshotSet } from "../../../TIGER/offchain/src/snapshot.js";
import type { TigerEntitlement } from "../../../TIGER/offchain/src/types.js";

/** 1 đăng ký delegator (đã xác minh chữ ký + đã tổng hợp accStake mọi pool). */
export interface DelegatorReg {
  /** Địa chỉ nhận LAMP (payment address bech32) — làm khoá owner + đích merkle. */
  payment_address: string;
  /** Tổng stake tích lũy qua mọi epoch < cutoff (lovelace·epoch, mọi pool). */
  acc_stake_lovelace: bigint;
}

export interface DelegatorEntitlementResult {
  /** Chi tiết per-owner (accStake + oildrop) — minh bạch kiểm toán. */
  entitlements: TigerEntitlement[];
  /** Đầu vào trực tiếp cho merkle.buildTree / snapshotTool. */
  snapshot: SnapshotEntry[];
  /** oildrop chưa chia (cap=null ⇒ 0). */
  leftover: bigint;
  /** Tổng đã chia = Σ snapshot.amount. */
  distributed: bigint;
}

/** Chia budget (oildrop) cho delegator ∝accStake. cap=null ⇒ bảo toàn tuyệt đối.
 *  Ném lỗi nếu 2 đăng ký trùng payment_address (buildSnapshotSet bắt trùng owner).
 *
 *  `budgetOildrop` **BẮT BUỘC** — không default về pot Delegator. Thuật toán ở đây generic
 *  (adapter của computeEntitlements), nên pot khác (SPO…) tái dùng hàm này là đúng. Quên
 *  truyền budget mà có default thì cây vẫn dựng được, tổng vẫn bảo toàn, mọi proof vẫn verify
 *  — chỉ sai Ở CON SỐ, và pool nạp theo budget thật ⇒ claimer fail vĩnh viễn. Không test
 *  nào bắt được; chỉ trình biên dịch bắt được — nên để nó bắt. */
export function buildDelegatorEntitlements(
  regs: DelegatorReg[],
  opts: { budgetOildrop: bigint; capOildrop?: bigint | null },
): DelegatorEntitlementResult {
  const { budgetOildrop } = opts;
  const capOildrop = opts.capOildrop ?? null;

  // 1 "epoch" tổng hợp: rows = payment_address ↦ accStake. buildSnapshotSet bỏ stake ≤ 0
  // và ném lỗi nếu payment_address trùng (chống thổi phồng accStake).
  const rows = regs.map((r) => ({
    stake_address: r.payment_address,
    amount: r.acc_stake_lovelace.toString(),
  }));
  const snap = buildSnapshotSet([{ epoch: 0n, rows }]);

  const res = computeEntitlements(snap, { budgetOildrop, capOildrop });

  const snapshot: SnapshotEntry[] = res.entitlements.map((e) => ({
    address: e.owner,
    amount: e.amount,
  }));

  return {
    entitlements: res.entitlements,
    snapshot,
    leftover: res.leftover,
    distributed: res.distributed,
  };
}
