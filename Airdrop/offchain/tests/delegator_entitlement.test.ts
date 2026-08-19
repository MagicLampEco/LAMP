// delegator_entitlement.test.ts — pot Delegator (100M LAMP) chia ∝accStake.
// Tái dùng computeEntitlements (TIGER): ∝stake, largest-remainder, bảo toàn.

import { describe, it, expect } from "vitest";
import {
  buildDelegatorEntitlements,
  type DelegatorReg,
} from "../src/delegator_entitlement.js";
import { DELEGATOR_TOTAL_OILDROP } from "../src/constants.js";

// payment_address ở đây là khoá owner đục — dùng chuỗi giả cho test toán chia.
const regs: DelegatorReg[] = [
  { payment_address: "addr_small", acc_stake_lovelace: 100n },
  { payment_address: "addr_mid", acc_stake_lovelace: 300n },
  { payment_address: "addr_big", acc_stake_lovelace: 600n },
];

describe("buildDelegatorEntitlements ∝accStake", () => {
  it("Σ amount = budget (bảo toàn tuyệt đối, cap=null)", () => {
    const r = buildDelegatorEntitlements(regs, { budgetOildrop: 1_000_000n });
    const total = r.snapshot.reduce((s, e) => s + e.amount, 0n);
    expect(total).toBe(1_000_000n);
    expect(r.leftover).toBe(0n);
    expect(r.distributed).toBe(1_000_000n);
  });

  it("ví stake nhiều nhận nhiều hơn (∝ chặt)", () => {
    const r = buildDelegatorEntitlements(regs, { budgetOildrop: 1_000_000n });
    const amt = Object.fromEntries(r.snapshot.map((e) => [e.address, e.amount]));
    expect(amt.addr_big).toBeGreaterThan(amt.addr_mid!);
    expect(amt.addr_mid).toBeGreaterThan(amt.addr_small!);
    // accStake 100:300:600 → 1e6 oildrop → 100.000 / 300.000 / 600.000
    expect(amt.addr_small).toBe(100_000n);
    expect(amt.addr_mid).toBe(300_000n);
    expect(amt.addr_big).toBe(600_000n);
  });

  it("budget PHẢI truyền tường minh — không còn default 100M LAMP", () => {
    // Hàm này là hàm chia ∝stake DUY NHẤT trong repo, nên pot khác (SPO 5M…) sẽ tái dùng
    // nó. Default im lặng về pot Delegator nghĩa là quên truyền budget ⇒ cây chia 100M thay
    // vì 5M: tổng vẫn bảo toàn, mọi proof vẫn verify, test vẫn xanh — nhưng pool SPO chỉ nạp
    // 5M nên ~95% claimer fail VĨNH VIỄN. Chỉ trình biên dịch bắt được ca này.
    // @ts-expect-error — thiếu budgetOildrop là LỖI BIÊN DỊCH (hàng rào chính, thấy ngay
    // trong IDE). Runtime bên dưới là lưới thứ hai cho đường JS thuần: không còn default
    // thì destructure `opts` undefined ném ngay, thay vì lặng lẽ chia 100M.
    expect(() => buildDelegatorEntitlements(regs)).toThrow();

    // Truyền tường minh đúng pot Delegator thì vẫn bảo toàn như cũ.
    const r = buildDelegatorEntitlements(regs, { budgetOildrop: DELEGATOR_TOTAL_OILDROP });
    const total = r.snapshot.reduce((s, e) => s + e.amount, 0n);
    expect(total).toBe(DELEGATOR_TOTAL_OILDROP);
    expect(r.leftover).toBe(0n);
  });

  it("snapshot nạp thẳng merkle: mỗi entry {address, amount>0}", () => {
    const r = buildDelegatorEntitlements(regs, { budgetOildrop: 1_000_000n });
    for (const e of r.snapshot) {
      expect(typeof e.address).toBe("string");
      expect(e.amount > 0n).toBe(true);
    }
    expect(r.snapshot.length).toBe(3);
  });

  it("trùng payment_address → ném lỗi toàn vẹn (chống thổi phồng accStake)", () => {
    const dup: DelegatorReg[] = [
      { payment_address: "addr_x", acc_stake_lovelace: 100n },
      { payment_address: "addr_x", acc_stake_lovelace: 200n },
    ];
    expect(() => buildDelegatorEntitlements(dup, { budgetOildrop: 1_000n })).toThrow();
  });
});
