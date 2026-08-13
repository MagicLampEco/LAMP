// Integration test — full flow CONTRACT v2 "Capped Drop" off-chain (pure logic).
// Kiểm chứng: vested cộng dồn, cap E, đa-claim redeemed cộng dồn, chống double-redeem,
// entitlement bảo toàn (bỏ lỡ epoch không mất quyền), ví nhỏ E<D nhận hết ngay.
// Mirror CHÍNH XÁC logic claim_account Redeem validator.

import { describe, it, expect } from "vitest";
import { vested } from "../offchain/src/vested.js";
import { lampOildrop } from "./helpers.js";

// ── Mô hình ClaimAccount (mirror onchain datum v2) ──
interface Account {
  owner: string;
  entitlement: bigint;
  redeemed: bigint;
  startEpoch: bigint;
  dropsPerEpoch: bigint;
}

// Mirror claim_account.ak Redeem: trả amount + redeemed mới (hoặc throw như validator).
//   vested = min(E, D·dpe·max(0, t−t0)); amount = vested − redeemed > 0.
function simulateRedeem(
  acc: Account, D: bigint, currentEpoch: bigint,
): { amount: bigint; newRedeemed: bigint } {
  const v = vested(acc.entitlement, D, acc.dropsPerEpoch, acc.startEpoch, currentEpoch);
  const amount = v - acc.redeemed;            // C-RDM-1
  if (amount <= 0n) throw new Error("C-RDM-1: redeemable <= 0");
  return { amount, newRedeemed: acc.redeemed + amount };   // C-RDM-4
}

describe("Full distribution flow (Capped Drop)", () => {
  it("claim → drip nhiều epoch → redeem cộng dồn → double-redeem reject", () => {
    const D = lampOildrop(100n);   // committee post DropParam D = 100 LAMP

    // CLAIM: committee confirm A có entitlement 250 LAMP, start t0=0, dpe=1.
    const accA: Account = {
      owner: "a1", entitlement: lampOildrop(250n), redeemed: 0n, startEpoch: 0n, dropsPerEpoch: 1n,
    };

    // epoch 1: vested=100 → redeem 100
    const r1 = simulateRedeem(accA, D, 1n);
    expect(r1.amount).toBe(lampOildrop(100n));
    accA.redeemed = r1.newRedeemed;

    // double-redeem cùng epoch → vested=100, redeemed=100 → amount 0 → reject
    expect(() => simulateRedeem(accA, D, 1n)).toThrow("C-RDM-1");

    // epoch 2: vested=200 → redeem thêm 100
    const r2 = simulateRedeem(accA, D, 2n);
    expect(r2.amount).toBe(lampOildrop(100n));
    accA.redeemed = r2.newRedeemed;

    // epoch 3: vested=min(250, 300)=250 (cap E) → redeem 50 cuối
    const r3 = simulateRedeem(accA, D, 3n);
    expect(r3.amount).toBe(lampOildrop(50n));
    accA.redeemed = r3.newRedeemed;
    expect(accA.redeemed).toBe(accA.entitlement);   // tổng nhận = E

    // epoch 4: đã cap, redeemed=E → reject
    expect(() => simulateRedeem(accA, D, 4n)).toThrow("C-RDM-1");
  });

  it("entitlement bảo toàn: bỏ lỡ epoch 1-4, redeem ở epoch 5 nhận gộp đủ", () => {
    const D = lampOildrop(100n);
    const acc: Account = {
      owner: "b2", entitlement: lampOildrop(1000n), redeemed: 0n, startEpoch: 0n, dropsPerEpoch: 1n,
    };
    // không redeem ở epoch 1-4; epoch 5 redeem lần đầu → vested(5)=500, nhận đủ 500.
    const r = simulateRedeem(acc, D, 5n);
    expect(r.amount).toBe(lampOildrop(500n));   // không mất 4 epoch trước (khác lottery)
    acc.redeemed = r.newRedeemed;
    // tiếp tục tới cap
    expect(acc.redeemed).toBe(lampOildrop(500n));
  });

  it("ví nhỏ E < D → nhận hết ngay epoch đầu", () => {
    const D = lampOildrop(100n);
    const acc: Account = {
      owner: "c3", entitlement: lampOildrop(30n), redeemed: 0n, startEpoch: 0n, dropsPerEpoch: 1n,
    };
    const r = simulateRedeem(acc, D, 1n);
    expect(r.amount).toBe(lampOildrop(30n));    // min(30, 100) = 30 = full
    acc.redeemed = r.newRedeemed;
    expect(() => simulateRedeem(acc, D, 2n)).toThrow("C-RDM-1"); // hết
  });

  it("invariants xuyên suốt: redeemed đơn điệu, ≤ E, vested đơn điệu", () => {
    const D = lampOildrop(100n);
    const acc: Account = {
      owner: "d4", entitlement: lampOildrop(1000n), redeemed: 0n, startEpoch: 0n, dropsPerEpoch: 1n,
    };
    let prevVested = -1n;
    let prevRedeemed = -1n;
    for (let t = 1n; t <= 15n; t++) {
      const v = vested(acc.entitlement, D, acc.dropsPerEpoch, acc.startEpoch, t);
      expect(v >= prevVested).toBe(true);            // vested đơn điệu
      expect(v <= acc.entitlement).toBe(true);       // cap E
      prevVested = v;
      if (v > acc.redeemed) {
        const r = simulateRedeem(acc, D, t);
        acc.redeemed = r.newRedeemed;
      }
      expect(acc.redeemed >= prevRedeemed).toBe(true); // redeemed đơn điệu
      expect(acc.redeemed <= acc.entitlement).toBe(true);
      prevRedeemed = acc.redeemed;
    }
    expect(acc.redeemed).toBe(acc.entitlement);        // tổng cuối = E
  });

  it("committee tăng entitlement (Claim) giữa chừng → drip tiếp phần mới", () => {
    const D = lampOildrop(100n);
    const acc: Account = {
      owner: "e5", entitlement: lampOildrop(200n), redeemed: 0n, startEpoch: 0n, dropsPerEpoch: 1n,
    };
    // epoch 1,2 redeem hết 200 (cap)
    acc.redeemed = simulateRedeem(acc, D, 2n).newRedeemed;
    expect(acc.redeemed).toBe(lampOildrop(200n));

    // committee Claim thêm 300 → entitlement 500 (start_epoch giữ nguyên 0).
    acc.entitlement += lampOildrop(300n);

    // epoch 5: vested=min(500, 500)=500 → redeem thêm 300.
    const r = simulateRedeem(acc, D, 5n);
    expect(r.amount).toBe(lampOildrop(300n));
    acc.redeemed = r.newRedeemed;
    expect(acc.redeemed).toBe(lampOildrop(500n));
  });
});
