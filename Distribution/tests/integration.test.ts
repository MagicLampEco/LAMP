// Integration test — full flow CONTRACT v3 "Capped Drop" off-chain (logic thuần).
// Mirror CHÍNH XÁC logic `claim_account` nhánh Redeem, không chạm mạng hay ví.
//
// v3 đổi đại lượng chứ không chỉ đổi công thức, nên bài kiểm phải đổi theo cả ba vế:
//   (1) `vested = min(E, isqrt(dpe² · E · A_span²))` — CĂN của E, không còn tuyến tính
//       theo E. Đây là tính chất cốt lõi của v3 và nó có bài riêng bên dưới.
//   (2) `A_span` là hiệu của CHỈ SỐ CỘNG DỒN từ beacon, không phải `t − start_epoch`.
//       `start_epoch` KHÔNG còn đi vào phép tính.
//   (3) trần một lượt `max(trim_floor, total_redeemed · κ)` — trạng thái TOÀN HỆ, nên một
//       tài khoản không tính được số rút của mình nếu chỉ nhìn chính nó.

import { describe, it, expect } from "vitest";
import { vested, isqrt, beaconIndexAt, aSpan, trimCap, redeemable } from "../offchain/src/vested.js";
import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "../offchain/src/types.js";
import { lampOildrop, TRIM_FLOOR } from "./helpers.js";

// ── Số hiệu chỉnh cho bài kiểm ────────────────────────────────────────────────
// E = 1.000.000 LAMP = 10^12 oildrop ⇒ √E = 10^6 CHẴN. `rate_root = 100.000` ⇒ mỗi cửa sổ
// mở thêm đúng `10^6 · 10^5 = 10^11` oildrop = 100.000 LAMP, chạm trần E sau ĐÚNG 10 cửa sổ.
// Chọn số chính phương là cố ý: nó làm mọi kỳ vọng dưới đây kiểm được bằng tay, thay vì
// phải tin vào chính hàm đang được kiểm.
const E_BIG      = lampOildrop(1_000_000n);   // 10^12
const RATE       = 100_000n;
const PER_WINDOW = lampOildrop(100_000n);     // 10^11

function beacon(overrides: Partial<BeaconDatum> = {}): BeaconDatum {
  return {
    epoch: 0n, kind: "DropParam", index: 0n, rate_root: RATE,
    trim_num: 1n, trim_den: 1_000n, speed_policies: [],
    ...overrides,
  };
}

function account(o: Partial<ClaimAccountDatum> = {}): ClaimAccountDatum {
  return {
    owner: "a1", entitlement: E_BIG, redeemed: 0n, start_epoch: 0n,
    drops_per_epoch: 1n, index_at_start: 0n,
    ...o,
  };
}

function treasury(totalRedeemed = 0n): TreasuryDatum {
  return {
    committee_hash: "cc".repeat(28),
    outstanding_entitlement: E_BIG,
    total_redeemed: totalRedeemed,
  };
}

/** `vested` tại cửa sổ `w` — cùng đường mà builder đi, không phải một bản chép. */
function vestedAt(a: ClaimAccountDatum, b: BeaconDatum, w: bigint): bigint {
  return vested(a.entitlement, a.drops_per_epoch, aSpan(a, b, w));
}

describe("v3: vested theo CHỈ SỐ CỘNG DỒN", () => {
  it("mỗi cửa sổ mở thêm đúng √E · rate_root, chạm trần E sau 10 cửa sổ", () => {
    const a = account();
    const b = beacon();
    for (let w = 1n; w <= 9n; w++) {
      expect(vestedAt(a, b, w)).toBe(PER_WINDOW * w);
    }
    expect(vestedAt(a, b, 10n)).toBe(E_BIG);      // chạm trần đúng cửa sổ 10
    expect(vestedAt(a, b, 50n)).toBe(E_BIG);      // và ở lì đó — cap E (C-RDM-2)
  });

  it("bỏ lỡ cửa sổ KHÔNG mất quyền: rút lần đầu ở cửa sổ 5 nhận gộp đủ 5 cửa sổ", () => {
    const a = account();
    // Khác xổ số: quyền tích luỹ theo chỉ số, không theo số lần bấm nút.
    expect(vestedAt(a, beacon(), 5n)).toBe(PER_WINDOW * 5n);
  });

  it("`start_epoch` KHÔNG còn đi vào phép tính — chỉ `index_at_start` đi vào", () => {
    // Hai tài khoản CHỈ khác `start_epoch`; ở v2 chúng vest khác nhau, ở v3 thì không.
    const older = account({ start_epoch: 0n });
    const newer = account({ start_epoch: 900n });
    expect(vestedAt(newer, beacon(), 3n)).toBe(vestedAt(older, beacon(), 3n));

    // Và ngược lại: CHỈ khác `index_at_start` ⇒ PHẢI khác. Không có ca này thì bài trên
    // cũng xanh với một bản hiện thực bỏ qua cả hai trường.
    const late = account({ index_at_start: RATE * 2n });
    expect(vestedAt(late, beacon(), 3n)).toBe(PER_WINDOW * 1n);
  });

  it("beacon mang `epoch ≠ 0` vẫn tính đúng — `A(t)` phải dùng tới `epoch`", () => {
    // Bản hiện thực quên số hạng `epoch` sẽ cho `A(t) = index` phẳng, và mọi ca ở trên
    // (beacon epoch 0) vẫn xanh. Ca này là chỗ duy nhất phân biệt được hai bên.
    const b = beacon({ epoch: 100n, index: 5_000_000n });
    const a = account({ index_at_start: beaconIndexAt(b, 100n) });
    expect(aSpan(a, b, 103n)).toBe(RATE * 3n);
    expect(vestedAt(a, b, 103n)).toBe(PER_WINDOW * 3n);
  });

  it("A_span ÂM bị NÉM, không kẹp về 0 — validator từ chối ca này", () => {
    const b = beacon();
    const a = account({ index_at_start: RATE * 10n });   // mốc ở tương lai
    expect(() => aSpan(a, b, 3n)).toThrow(/VESTED-005/);
  });
});

describe("v3: tốc độ mở khoá theo CĂN của entitlement (chống cá voi)", () => {
  it("ví lớn gấp 4 chỉ vest nhanh gấp 2 tại cùng một A_span", () => {
    const b = beacon();
    const small = account({ entitlement: lampOildrop(250_000n) });   // E/4
    const big   = account({ entitlement: E_BIG });                   // E
    const vs = vestedAt(small, b, 1n);
    const vb = vestedAt(big, b, 1n);
    expect(vb).toBe(vs * 2n);          // √4 = 2, KHÔNG phải 4
  });

  it("và vì vậy ví lớn mất NHIỀU cửa sổ HƠN để nhận trọn phần của mình", () => {
    const b = beacon();
    const small = account({ entitlement: lampOildrop(250_000n) });
    const big   = account({ entitlement: E_BIG });
    // nhỏ: √E' = 500.000 ⇒ mỗi cửa sổ 50.000 LAMP ⇒ trọn sau 5 cửa sổ.
    expect(vestedAt(small, b, 5n)).toBe(small.entitlement);
    expect(vestedAt(small, b, 4n)).toBeLessThan(small.entitlement);
    // lớn: 10 cửa sổ.
    expect(vestedAt(big, b, 9n)).toBeLessThan(big.entitlement);
    expect(vestedAt(big, b, 10n)).toBe(big.entitlement);
  });

  it("ví NHỎ hơn một bước mở khoá nhận trọn ngay cửa sổ đầu", () => {
    const tiny = account({ entitlement: lampOildrop(1n) });
    expect(vestedAt(tiny, beacon(), 1n)).toBe(tiny.entitlement);
  });

  it("`isqrt(k²·E) ≠ k·isqrt(E)` — vì sao phải căn TRỌN tích, không căn rồi nhân", () => {
    // Bẫy này không lộ ra ở số chính phương, nên nó cần một ca mang số KHÔNG chính phương.
    // Tính theo `k · isqrt(E)` cho số NHỎ HƠN validator cho phép, và ví sẽ xin thiếu mà
    // giao dịch VẪN QUA — không có gì báo.
    expect(isqrt(9n * 2n)).toBe(4n);
    expect(3n * isqrt(2n)).toBe(3n);
    expect(vested(2n, 1n, 3n)).toBe(2n);   // min(E=2, isqrt(18)=4) = 2
  });
});

describe("v3: trần một lượt (cắt ngọn) là trạng thái TOÀN HỆ", () => {
  it("ở genesis `total_redeemed = 0` nên SÀN là thứ đang chặn, không phải κ", () => {
    const t = treasury(0n);
    expect(trimCap(t, beacon(), TRIM_FLOOR)).toBe(TRIM_FLOOR);
  });

  it("κ chỉ vượt được sàn khi `total_redeemed` đã lớn hơn `trim_floor · trim_den`", () => {
    const b = beacon();                              // κ = 1/1000
    const under = treasury(TRIM_FLOOR * 1_000n - 1_000n);
    const over  = treasury(TRIM_FLOOR * 2_000n);
    expect(trimCap(under, b, TRIM_FLOOR)).toBe(TRIM_FLOOR);
    expect(trimCap(over,  b, TRIM_FLOOR)).toBe(TRIM_FLOOR * 2n);
  });

  it("`trim_floor` là thứ PHÁ điểm hấp thụ: bỏ nó đi thì 0 · κ = 0 và không ai rút được", () => {
    // Cùng đầu vào, chỉ khác sàn — hai kết quả phải KHÁC nhau, nếu không bài này không
    // kiểm gì về sàn cả.
    expect(trimCap(treasury(0n), beacon(), 0n)).toBe(0n);
    expect(trimCap(treasury(0n), beacon(), TRIM_FLOOR)).toBe(TRIM_FLOOR);
  });

  it("`trim_den = 0` bị NÉM — phép chia cho 0 trong Plutus là lỗi, tức giết MỌI Redeem", () => {
    expect(() => trimCap(treasury(0n), beacon({ trim_den: 0n }), TRIM_FLOOR)).toThrow(/VESTED-006/);
  });

  it("phần bị cắt KHÔNG mất: rút nhiều lượt vẫn đi tới trọn entitlement", () => {
    // Một tài khoản nhỏ, trần rộng (κ=1/1) để vòng lặp kết thúc trong vài lượt — điều đang
    // kiểm là TÍNH CỘNG DỒN của `redeemed`, không phải tốc độ.
    const b = beacon({ trim_num: 1n, trim_den: 1n });
    const a = account({ entitlement: lampOildrop(250_000n) });
    let t = treasury(0n);
    let guard = 0;
    while (a.redeemed < a.entitlement && guard++ < 100) {
      const amount = redeemable(a, b, t, 5n, TRIM_FLOOR);
      if (amount === 0n) break;
      a.redeemed += amount;                                       // C-RDM-4
      t = { ...t, total_redeemed: t.total_redeemed + amount };    // C-RDM-TOTAL
      expect(a.redeemed).toBeLessThanOrEqual(a.entitlement);      // không bao giờ vượt E
    }
    expect(a.redeemed).toBe(a.entitlement);
    expect(t.total_redeemed).toBe(a.entitlement);
  });

  it("đã rút trọn ⇒ `redeemable` trả 0, không trả số âm", () => {
    const a = account({ redeemed: E_BIG });
    expect(redeemable(a, beacon(), treasury(0n), 50n, TRIM_FLOOR)).toBe(0n);
  });
});

describe("v3: bất biến xuyên suốt", () => {
  it("vested đơn điệu tăng theo cửa sổ, redeemed đơn điệu, cả hai ≤ E", () => {
    const b = beacon({ trim_num: 1n, trim_den: 1n });
    const a = account();
    let t = treasury(0n);
    let prevVested = -1n;
    let prevRedeemed = -1n;
    for (let w = 1n; w <= 15n; w++) {
      const v = vestedAt(a, b, w);
      expect(v).toBeGreaterThanOrEqual(prevVested);
      expect(v).toBeLessThanOrEqual(a.entitlement);
      prevVested = v;

      const amount = redeemable(a, b, t, w, TRIM_FLOOR);
      a.redeemed += amount;
      t = { ...t, total_redeemed: t.total_redeemed + amount };

      expect(a.redeemed).toBeGreaterThanOrEqual(prevRedeemed);
      expect(a.redeemed).toBeLessThanOrEqual(a.entitlement);
      expect(a.redeemed).toBeLessThanOrEqual(v);   // không rút quá phần đã vest
      prevRedeemed = a.redeemed;
    }
    expect(a.redeemed).toBe(a.entitlement);
  });

  it("REBASE (cấp thêm) đặt lại CẢ HAI mốc — `redeemed` về 0 VÀ `index_at_start` về A(nay)", () => {
    const b = beacon();
    const a = account({ entitlement: lampOildrop(200_000n) });
    // rút trọn ở cửa sổ đủ xa (√E' = 447.213 ⇒ mỗi cửa sổ ~44.721 LAMP ⇒ trọn sau 5).
    a.redeemed = vestedAt(a, b, 10n);
    expect(a.redeemed).toBe(a.entitlement);

    // Cấp thêm 300.000 LAMP tại cửa sổ 10: E' = E − redeemed + granted = 300.000 LAMP.
    const w = 10n;
    const after: ClaimAccountDatum = {
      ...a,
      entitlement: a.entitlement - a.redeemed + lampOildrop(300_000n),
      redeemed: 0n,
      start_epoch: w,
      index_at_start: beaconIndexAt(b, w),        // C-CLAIM-8
    };
    // Ngay tại cửa sổ rebase: A_span = 0 ⇒ chưa vest gì. Đây là cái giá đã khai của rebase,
    // và nó là thứ chặn đường rửa tuổi tài khoản.
    expect(vestedAt(after, b, w)).toBe(0n);
    expect(vestedAt(after, b, w + 1n)).toBeGreaterThan(0n);
  });
});
