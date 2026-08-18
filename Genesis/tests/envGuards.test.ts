// Cổng gác tham số apply-param — `Genesis/scripts/_guards.ts`.
//
// Ca gốc (hồi quy): trước bản vá, `METER_NFT_POLICY` KHÔNG có cổng trong khi `DIST_DEST`
// ngay dưới 6 dòng thì có (`ddfa2c6`). Bản mồi mainnet mang hệ quả: meter_nft_policy =
// 28 byte 0 (`Genesis/offchain/src/deployed.ts:92`) ⇒ nhánh ReserveDraw chết vĩnh viễn.
// Bộ test dưới ép hai tham số CÙNG LOẠI hành xử GIỐNG NHAU — đó mới là thứ hỏng, không
// phải một biến cụ thể nào.

import { describe, it, expect, vi } from "vitest";
import {
  requiredHashParam, requiredHexParam, CONSEQUENCE_METER, CONSEQUENCE_DIST_DEST,
} from "../scripts/_guards.js";

const HASH28 = "ab".repeat(28);
const ZERO28 = "00".repeat(28);
const silent = () => {};

describe("requiredHashParam — SUBMIT bật + thiếu biến ⇒ NÉM", () => {
  it("METER_NFT_POLICY thiếu ⇒ ném", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER, env: {}, warn: silent,
      }),
    ).toThrow(/METER_NFT_POLICY chưa set/);
  });

  it("DIST_DEST thiếu ⇒ ném", () => {
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST, env: {}, warn: silent,
      }),
    ).toThrow(/DIST_DEST chưa set/);
  });

  it("chuỗi rỗng / toàn khoảng trắng tính là thiếu", () => {
    for (const v of ["", "   ", "\t\n"]) {
      expect(() =>
        requiredHashParam("METER_NFT_POLICY", {
          submit: true, consequence: CONSEQUENCE_METER,
          env: { METER_NFT_POLICY: v }, warn: silent,
        }),
      ).toThrow(/chưa set/);
    }
  });

  it("thông điệp lỗi nói HẬU QUẢ, không chỉ nói 'thiếu biến'", () => {
    let msg = "";
    try {
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER, env: {}, warn: silent,
      });
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/APPLY-PARAM/);
    expect(msg).toMatch(/KẸT VĨNH VIỄN/);
    expect(msg).toMatch(/KHÔNG burn/);
    expect(msg).toMatch(/policy-id/);
    expect(msg).toMatch(/ReserveDraw/);            // hậu quả riêng của meter
  });

  it("hậu quả DIST_DEST nói đúng đường A-DEST, không dán nhầm hậu quả của meter", () => {
    let msg = "";
    try {
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST, env: {}, warn: silent,
      });
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/A-DEST/);
    expect(msg).toMatch(/Script\(00×28\)/);
    expect(msg).not.toMatch(/ReserveDraw/);
  });
});

describe("requiredHashParam — SUBMIT tắt ⇒ KHÔNG ném", () => {
  it("thiếu biến ⇒ trả placeholder 00×28, không ném", () => {
    const got = requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER, env: {}, warn: silent,
    });
    expect(got.value).toBe(ZERO28);
    expect(got.source).toBe("placeholder");
  });

  it("placeholder LUÔN kèm cảnh báo có nêu hậu quả (im lặng là cách lỗi cũ lọt)", () => {
    const warn = vi.fn();
    requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER, env: {}, warn,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/ReserveDraw/);
  });

  it("có biến ⇒ dùng biến, không cảnh báo", () => {
    const warn = vi.fn();
    const got = requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER,
      env: { METER_NFT_POLICY: HASH28 }, warn,
    });
    expect(got).toEqual({ name: "METER_NFT_POLICY", value: HASH28, source: "env" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("requiredHashParam — có giá trị thì luôn kiểm dạng, kể cả khi không gửi", () => {
  it("thiếu/thừa byte ⇒ ném ở CẢ hai chế độ", () => {
    for (const submit of [true, false]) {
      expect(() =>
        requiredHashParam("METER_NFT_POLICY", {
          submit, consequence: CONSEQUENCE_METER,
          env: { METER_NFT_POLICY: "ab".repeat(27) }, warn: silent,
        }),
      ).toThrow(/sai dạng/);
    }
  });

  it("ký tự không phải hex ⇒ ném", () => {
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST,
        env: { DIST_DEST: "zz".repeat(28) }, warn: silent,
      }),
    ).toThrow(/sai dạng/);
  });

  it("hex CHỮ HOA được chấp nhận và chuẩn hoá về chữ thường", () => {
    const got = requiredHashParam("DIST_DEST", {
      submit: true, consequence: CONSEQUENCE_DIST_DEST,
      env: { DIST_DEST: "AB".repeat(28) }, warn: silent,
    });
    expect(got.value).toBe(HASH28);
  });

  it("độ dài byte đổi được qua opts.bytes (tx-hash 32 byte)", () => {
    expect(() =>
      requiredHashParam("GENESIS_TX", {
        submit: true, consequence: "x", bytes: 32,
        env: { GENESIS_TX: HASH28 }, warn: silent,
      }),
    ).toThrow(/64 ký tự hex/);
  });
});

describe("requiredHexParam — asset-name cũng qua cổng (gác nửa cặp = tái lập lỗi cũ)", () => {
  it("SUBMIT bật + thiếu ⇒ ném", () => {
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
        env: {}, warn: silent,
      }),
    ).toThrow(/METER_NFT_NAME chưa set/);
  });

  it("SUBMIT tắt + thiếu ⇒ trả placeholder, không ném", () => {
    const got = requiredHexParam("METER_NFT_NAME", {
      submit: false, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
      env: {}, warn: silent,
    });
    expect(got).toEqual({ name: "METER_NFT_NAME", value: "4d4554", source: "placeholder" });
  });

  it("hex lẻ ký tự ⇒ ném (không có nửa byte)", () => {
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
        env: { METER_NFT_NAME: "4d455" }, warn: silent,
      }),
    ).toThrow(/sai dạng/);
  });

  it("độ dài tự do được chấp nhận (asset-name không cố định 28 byte)", () => {
    const got = requiredHexParam("METER_NFT_NAME", {
      submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER,
      env: { METER_NFT_NAME: "535550504c59" }, warn: silent,
    });
    expect(got.value).toBe("535550504c59");
  });
});

describe("ĐỐI XỨNG — hai tham số cùng loại phải hành xử y hệt", () => {
  // Đây là bài kiểm chính. Lỗi gốc KHÔNG phải "quên một biến", mà là "hai tham số cùng
  // loại có hai mức bảo vệ khác nhau". Test này đỏ ngay khi ai đó gác lại một nửa.
  const HASH_PARAMS = ["METER_NFT_POLICY", "DIST_DEST"] as const;

  it("SUBMIT bật: MỌI tham số hash thiếu đều ném", () => {
    for (const name of HASH_PARAMS) {
      expect(() =>
        requiredHashParam(name, { submit: true, consequence: "hậu quả", env: {}, warn: silent }),
      ).toThrow(new RegExp(`${name} chưa set`));
    }
  });

  it("SUBMIT tắt: MỌI tham số hash thiếu đều trả placeholder, không cái nào ném", () => {
    for (const name of HASH_PARAMS) {
      const got = requiredHashParam(name, {
        submit: false, consequence: "hậu quả", env: {}, warn: silent,
      });
      expect(got.source).toBe("placeholder");
      expect(got.value).toBe(ZERO28);
    }
  });

  it("cặp meter (policy + name) cùng mức gác — không cái nào lọt khi cái kia chặn", () => {
    const env = {}; // cả hai đều thiếu
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER, env, warn: silent,
      }),
    ).toThrow();
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, placeholder: "4d4554", consequence: CONSEQUENCE_METER, env, warn: silent,
      }),
    ).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// GIÁ TRỊ CHẾT — cổng gác cũ chỉ chặn THIẾU biến, không chặn giá trị "đúng dạng
// nhưng không thể có tiền ảnh". Đó chính xác là kẽ mà bản mồi mainnet chui qua:
// deployed.ts:92 ghi meter_nft_policy = 28 byte 0, và nó ĐÃ đi qua mọi phép kiểm dạng.
// ══════════════════════════════════════════════════════════════
describe("giá trị CHẾT — đúng dạng vẫn phải bị chặn khi GỬI", () => {
  it("METER_NFT_POLICY = 00×28 bị chặn khi submit=true (đây là ca đã giết mainnet)", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER,
        env: { METER_NFT_POLICY: ZERO28 }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("DIST_DEST = 00×28 cũng bị chặn — luật một, không có ngoại lệ theo tên biến", () => {
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST,
        env: { DIST_DEST: ZERO28 }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("toàn f cũng là giá trị chết", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER,
        env: { METER_NFT_POLICY: "f".repeat(56) }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("asset-name cũng qua cùng cổng — gác nửa cặp là tái lập lỗi cũ", () => {
    expect(() =>
      requiredHexParam("METER_NFT_NAME", {
        submit: true, consequence: CONSEQUENCE_METER, placeholder: "4d4554",
        env: { METER_NFT_NAME: "0000" }, warn: silent,
      }),
    ).toThrow(/GIÁ TRỊ CHẾT/);
  });

  it("submit=false vẫn cho 00×28 — chế độ dựng-thử phải xem được CBOR", () => {
    const got = requiredHashParam("METER_NFT_POLICY", {
      submit: false, consequence: CONSEQUENCE_METER,
      env: { METER_NFT_POLICY: ZERO28 }, warn: silent,
    });
    expect(got).toEqual({ name: "METER_NFT_POLICY", value: ZERO28, source: "env" });
  });

  it("giá trị thật KHÔNG bị chặn — guard không được bắt nhầm", () => {
    expect(() =>
      requiredHashParam("METER_NFT_POLICY", {
        submit: true, consequence: CONSEQUENCE_METER,
        env: { METER_NFT_POLICY: HASH28 }, warn: silent,
      }),
    ).not.toThrow();
  });

  it("hash có nhiều số 0 nhưng KHÔNG toàn 0 thì hợp lệ", () => {
    const mostlyZero = "0".repeat(54) + "1a";
    expect(() =>
      requiredHashParam("DIST_DEST", {
        submit: true, consequence: CONSEQUENCE_DIST_DEST,
        env: { DIST_DEST: mostlyZero }, warn: silent,
      }),
    ).not.toThrow();
  });
});
