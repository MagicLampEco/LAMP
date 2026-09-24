// Vested math tests — CONTRACT v3 "Capped Drop" §1/§7.
//
//   A(t)    = index + rate_root · (t − epoch)
//   A_span  = A(bây giờ) − index_at_start                     (≥ 0, âm thì NÉM)
//   vested  = min(E, isqrt(dpe² · E · A_span²))
//   trần    = max(trim_floor, total_redeemed · trim_num / trim_den)
//   rút được lượt này = min(vested − redeemed, trần)
//
// Bài kiểm ở đây soi từng hàm MỘT; `integration.test.ts` soi chúng nối vào nhau.
//
// `epochsToFull` của v2 KHÔNG còn: nó giả định tốc độ tuyến tính theo epoch. Thay bằng
// `windowsToFull`, đếm theo CỬA SỔ chỉ số.

import { describe, it, expect } from "vitest";
import {
  vested, redeemable, remaining, windowsToFull, isqrt, beaconIndexAt, aSpan, trimCap,
} from "../offchain/src/vested.js";
import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "../offchain/src/types.js";
import { lampOildrop, TRIM_FLOOR } from "./helpers.js";

// E = 1.000.000 LAMP = 10^12 ⇒ √E = 10^6 CHẴN; rate_root = 10^5 ⇒ mỗi cửa sổ 10^11 = 100.000 LAMP.
const E_BIG      = lampOildrop(1_000_000n);
const RATE       = 100_000n;
const PER_WINDOW = lampOildrop(100_000n);

function bcn(over: Partial<BeaconDatum> = {}): BeaconDatum {
  return {
    epoch: 0n, kind: "DropParam", index: 0n, rate_root: RATE,
    trim_num: 1n, trim_den: 1_000n, speed_policies: [],
    ...over,
  };
}

function acc(over: Partial<ClaimAccountDatum> = {}): ClaimAccountDatum {
  return {
    owner: "0a0a", entitlement: E_BIG, redeemed: 0n, start_epoch: 0n,
    drops_per_epoch: 1n, index_at_start: 0n,
    ...over,
  };
}

function tre(totalRedeemed = 0n, outstanding = E_BIG): TreasuryDatum {
  return {
    committee_hash: "cc".repeat(28),
    outstanding_entitlement: outstanding,
    total_redeemed: totalRedeemed,
  };
}

describe("isqrt — căn bậc hai NGUYÊN, làm tròn XUỐNG", () => {
  it("số chính phương trả đúng căn", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrt(10n ** 12n)).toBe(10n ** 6n);
  });

  it("số KHÔNG chính phương làm tròn xuống, không lên", () => {
    expect(isqrt(2n)).toBe(1n);
    expect(isqrt(3n)).toBe(1n);
    expect(isqrt(8n)).toBe(2n);
    expect(isqrt(99n)).toBe(9n);
  });

  it("đúng ở biên `n²−1` và `n²` với số rất lớn (Newton không được vượt một bậc)", () => {
    const n = 123_456_789_012_345n;
    expect(isqrt(n * n)).toBe(n);
    expect(isqrt(n * n - 1n)).toBe(n - 1n);
    expect(isqrt(n * n + 2n * n)).toBe(n);   // (n+1)² = n²+2n+1 > cái này
  });

  it("số âm bị NÉM", () => {
    expect(() => isqrt(-1n)).toThrow(/VESTED-004/);
  });
});

describe("beaconIndexAt — A(t) = index + rate_root · (t − epoch)", () => {
  it("tại chính `epoch` trả về `index`", () => {
    expect(beaconIndexAt(bcn({ epoch: 7n, index: 500n }), 7n)).toBe(500n);
  });

  it("tiến `n` cửa sổ cộng đúng `n · rate_root`", () => {
    const b = bcn({ epoch: 7n, index: 500n, rate_root: 100n });
    expect(beaconIndexAt(b, 10n)).toBe(800n);
  });

  it("LÙI trước `epoch` trả số nhỏ hơn `index` — hàm không tự kẹp, người gọi kẹp", () => {
    // Đây là hình dạng ĐÚNG: kẹp ở đây sẽ che mất một beacon dán nhãn tương lai, mà đó là
    // trạng thái mà C-BCN-3 cấm và người vận hành phải nhìn thấy.
    const b = bcn({ epoch: 7n, index: 500n, rate_root: 100n });
    expect(beaconIndexAt(b, 5n)).toBe(300n);
  });
});

describe("aSpan — A(bây giờ) − index_at_start", () => {
  it("bằng 0 tại chính cửa sổ mở tài khoản", () => {
    const b = bcn({ epoch: 4n, index: 900n });
    expect(aSpan(acc({ index_at_start: beaconIndexAt(b, 4n) }), b, 4n)).toBe(0n);
  });

  it("dùng CẢ `epoch` của beacon — bản quên số hạng đó sẽ trả số khác ở ca này", () => {
    const b = bcn({ epoch: 100n, index: 5_000_000n, rate_root: 100n });
    const a = acc({ index_at_start: beaconIndexAt(b, 100n) });
    expect(aSpan(a, b, 103n)).toBe(300n);
    // Bản quên `epoch` cho `A = index` phẳng ⇒ span 0. Ca này phân biệt được hai bên; một
    // ca với `epoch = 0` thì KHÔNG, và đó là lý do mọi fixture ở đây không dùng epoch 0.
  });

  it("ÂM thì NÉM, không kẹp về 0", () => {
    // Kẹp ở đây làm ví dựng ra một giao dịch mà validator chắc chắn từ chối, và lỗi hiện ra
    // ở chỗ không đọc được nguyên nhân.
    expect(() => aSpan(acc({ index_at_start: 10n }), bcn(), 0n)).toThrow(/VESTED-005/);
  });
});

describe("vested = min(E, isqrt(dpe² · E · A_span²))", () => {
  it("A_span = 0 → 0", () => {
    expect(vested(E_BIG, 1n, 0n)).toBe(0n);
  });

  it("tuyến tính theo A_span trong vùng chưa chạm trần", () => {
    expect(vested(E_BIG, 1n, RATE * 1n)).toBe(PER_WINDOW);
    expect(vested(E_BIG, 1n, RATE * 3n)).toBe(PER_WINDOW * 3n);
    expect(vested(E_BIG, 1n, RATE * 9n)).toBe(PER_WINDOW * 9n);
  });

  it("cap E: không vượt entitlement dù A_span lớn", () => {
    expect(vested(E_BIG, 1n, RATE * 10n)).toBe(E_BIG);
    expect(vested(E_BIG, 1n, RATE * 11n)).toBe(E_BIG);
    expect(vested(E_BIG, 1n, RATE * 9_999n)).toBe(E_BIG);
  });

  it("đơn điệu tăng theo A_span (không bao giờ giảm)", () => {
    let prev = -1n;
    for (let n = 0n; n <= 20n; n++) {
      const v = vested(E_BIG, 1n, RATE * n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(E_BIG);
  });

  it("CĂN của E, không tuyến tính theo E — ví gấp 4 chỉ vest gấp 2", () => {
    const quarter = lampOildrop(250_000n);            // E/4, √ = 500.000
    expect(vested(quarter, 1n, RATE)).toBe(lampOildrop(50_000n));
    expect(vested(E_BIG,   1n, RATE)).toBe(lampOildrop(100_000n));
  });

  it("ví nhỏ hơn một bước mở khoá → nhận trọn ngay", () => {
    const tiny = lampOildrop(1n);
    expect(vested(tiny, 1n, RATE)).toBe(tiny);
    expect(vested(tiny, 1n, RATE * 5n)).toBe(tiny);
  });

  it("phải căn TRỌN tích: `isqrt(k²E) ≠ k·isqrt(E)`", () => {
    // k=3, E=2: isqrt(9·2)=4 nhưng 3·isqrt(2)=3. Validator ép dạng BÌNH PHƯƠNG nên bên
    // đúng là 4; tính theo cách kia thì ví xin THIẾU và giao dịch vẫn qua — im lặng.
    expect(isqrt(9n * 2n)).not.toBe(3n * isqrt(2n));
    expect(vested(2n, 3n, 1n)).toBe(2n);          // min(E=2, 4)
    expect(vested(50n, 3n, 1n)).toBe(21n);        // isqrt(9·50) = isqrt(450) = 21
  });

  it("`drops_per_epoch` nhân vào TRONG căn — dpe=2 cho gấp đôi", () => {
    // v3 ghim dpe == 1 (C-ACC-DPE), nhưng hàm vẫn phải đúng với tham số nó nhận: một hàm
    // chỉ đúng ở đúng một giá trị là một hàm không kiểm được.
    expect(vested(E_BIG, 2n, RATE)).toBe(PER_WINDOW * 2n);
  });

  it("`dpe = 0` hoặc `A_span = 0` → 0, không NÉM (đó là trạng thái hợp lệ)", () => {
    expect(vested(E_BIG, 0n, RATE * 5n)).toBe(0n);
    expect(vested(E_BIG, 1n, 0n)).toBe(0n);
  });

  it("từ chối đầu vào âm", () => {
    expect(() => vested(-1n, 1n, 1n)).toThrow(/entitlement/);
    expect(() => vested(1n, -1n, 1n)).toThrow(/dropsPerEpoch/);
    expect(() => vested(1n, 1n, -1n)).toThrow(/A_span/);
  });
});

describe("trimCap = max(trim_floor, total_redeemed · trim_num / trim_den)", () => {
  it("ở genesis (`total_redeemed = 0`) SÀN là thứ đang chặn", () => {
    expect(trimCap(tre(0n), bcn(), TRIM_FLOOR)).toBe(TRIM_FLOOR);
  });

  it("κ vượt sàn khi `total_redeemed · κ > trim_floor`", () => {
    expect(trimCap(tre(TRIM_FLOOR * 3_000n), bcn(), TRIM_FLOOR)).toBe(TRIM_FLOOR * 3n);
  });

  it("chia NGUYÊN, làm tròn xuống — khớp validator", () => {
    // 1.999 / 1.000 = 1 (không phải 1,999 và không phải 2).
    expect(trimCap(tre(1_999n), bcn({ trim_num: 1n, trim_den: 1_000n }), 0n)).toBe(1n);
  });

  it("`trim_floor = 0` dựng lại ĐIỂM HẤP THỤ: 0 · κ = 0 ⇒ không ai rút được nữa", () => {
    // Hai cực khác nhau ở đúng một tham số — đây là chỗ chứng minh sàn có tác dụng, không
    // phải chỗ khai rằng nó có.
    expect(trimCap(tre(0n), bcn(), 0n)).toBe(0n);
    expect(trimCap(tre(0n), bcn(), TRIM_FLOOR)).toBe(TRIM_FLOOR);
  });

  it("`trim_den ≤ 0` bị NÉM — chia 0 trong Plutus là LỖI, tức giết mọi Redeem toàn hệ", () => {
    expect(() => trimCap(tre(0n), bcn({ trim_den: 0n }), TRIM_FLOOR)).toThrow(/VESTED-006/);
    expect(() => trimCap(tre(0n), bcn({ trim_den: -1n }), TRIM_FLOOR)).toThrow(/VESTED-006/);
  });
});

describe("redeemable = min(vested − redeemed, trần một lượt)", () => {
  it("không bao giờ âm: `redeemed` đã vượt `vested` → 0", () => {
    const a = acc({ redeemed: lampOildrop(500_000n) });
    expect(redeemable(a, bcn(), tre(), RATE * 2n / RATE, TRIM_FLOOR)).toBe(0n);
  });

  it("trần KHÔNG chạm → trả trọn phần chưa rút của vested", () => {
    const b = bcn({ trim_num: 1n, trim_den: 1n });     // κ = 1 ⇒ trần rộng
    // Nhưng total_redeemed = 0 ⇒ trần = sàn = 1.000 LAMP. Nâng total_redeemed để trần rộng.
    const t = tre(lampOildrop(10_000_000n));
    expect(redeemable(acc(), b, t, 3n, TRIM_FLOOR)).toBe(PER_WINDOW * 3n);
  });

  it("trần CHẠM → cắt đúng bằng trần, phần dư còn nguyên quyền", () => {
    // vested(3 cửa sổ) = 300.000 LAMP, trần = sàn = 1.000 LAMP.
    const got = redeemable(acc(), bcn(), tre(0n), 3n, TRIM_FLOOR);
    expect(got).toBe(TRIM_FLOOR);
    expect(got).toBeLessThan(PER_WINDOW * 3n);
    // `remaining` KHÔNG bị cắt — hai số phải khác nhau, nếu không giao diện đọc phép cắt
    // ngọn thành tịch thu.
    expect(remaining(acc())).toBe(E_BIG);
  });

  it("rút nhiều lượt cộng dồn tới đúng E, không hơn", () => {
    const b = bcn({ trim_num: 1n, trim_den: 1n });
    const a = acc({ entitlement: lampOildrop(250_000n) });
    let t = tre(0n);
    let total = 0n;
    for (let i = 0; i < 200 && a.redeemed < a.entitlement; i++) {
      const r = redeemable(a, b, t, 5n, TRIM_FLOOR);
      if (r === 0n) break;
      a.redeemed += r;
      total += r;
      t = { ...t, total_redeemed: t.total_redeemed + r };
    }
    expect(total).toBe(a.entitlement);
    expect(redeemable(a, b, t, 5n, TRIM_FLOOR)).toBe(0n);   // đã cạn, không phát thêm
  });

  it("rút một lần sau nhiều cửa sổ = gộp trọn phần đã tích (trong giới hạn trần)", () => {
    const t = tre(lampOildrop(10_000_000n));               // trần rộng
    expect(redeemable(acc(), bcn({ trim_num: 1n, trim_den: 1n }), t, 3n, TRIM_FLOOR))
      .toBe(PER_WINDOW * 3n);
  });

  it("rút hai lần CÙNG cửa sổ: lần hai trả 0", () => {
    const b = bcn({ trim_num: 1n, trim_den: 1n });
    const t = tre(lampOildrop(10_000_000n));
    const a = acc({ redeemed: PER_WINDOW * 3n });
    expect(redeemable(a, b, t, 3n, TRIM_FLOOR)).toBe(0n);
  });
});

describe("remaining = E − redeemed (KHÔNG bị cắt ngọn)", () => {
  it("trả phần còn lại trọn đời", () => {
    expect(remaining(acc({ redeemed: lampOildrop(400_000n) }))).toBe(lampOildrop(600_000n));
  });
  it("kẹp ở 0 khi redeemed ≥ E (datum lệch thì cũng không in số âm)", () => {
    expect(remaining(acc({ redeemed: E_BIG * 2n }))).toBe(0n);
  });
});

describe("windowsToFull = ⌈√E / (dpe · rate_root)⌉", () => {
  it("chia hết", () => {
    expect(windowsToFull(E_BIG, 1n, RATE)).toBe(10n);      // 10^6 / 10^5
  });

  it("làm tròn LÊN khi lẻ — thiếu một cửa sổ là in ra một mốc chưa rút được", () => {
    expect(windowsToFull(lampOildrop(250_000n), 1n, RATE)).toBe(5n);   // √ = 500.000
    expect(windowsToFull(2n, 1n, 1n)).toBe(2n);            // √2 = 1,41… ⇒ 2
    expect(windowsToFull(1n, 1n, 1n)).toBe(1n);
  });

  it("`dpe · rate_root ≤ 0` → null, KHÔNG phải 0 và không phải một số lớn", () => {
    // Cả hai giá trị kia là một câu trả lời trông có lý cho một câu hỏi không có câu trả lời.
    expect(windowsToFull(E_BIG, 0n, RATE)).toBe(null);
    expect(windowsToFull(E_BIG, 1n, 0n)).toBe(null);
    expect(windowsToFull(E_BIG, 1n, -1n)).toBe(null);
  });

  it("E = 0 → 0 cửa sổ", () => {
    expect(windowsToFull(0n, 1n, RATE)).toBe(0n);
  });

  it("kết quả trả về ĐÚNG là cửa sổ đầu tiên chạm trần, không sớm hơn", () => {
    // Ghim chính cái mà làm-tròn-lên phải bảo đảm: tại `n` thì đủ, tại `n−1` thì chưa.
    for (const E of [2n, 3n, 5n, 7n, 50n, 99n, 101n, 12_345n]) {
      const n = windowsToFull(E, 1n, 1n);
      expect(n).not.toBe(null);
      expect(vested(E, 1n, n as bigint)).toBe(E);
      if ((n as bigint) > 0n) {
        expect(vested(E, 1n, (n as bigint) - 1n)).toBeLessThan(E);
      }
    }
  });
});
