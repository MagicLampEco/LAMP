// Vitest — cổng đếm khe apply-param: BA trạng thái, và trạng thái thứ ba không được im.
//
// VÌ SAO BỘ KIỂM NÀY TỒN TẠI: `assertParamCount(title, declared, provided)` nhận `declared`
// như MỘT CON SỐ, nên chữ ký của nó không ép được con số ấy đến từ blueprint. Gõ tay `12`
// vào cũng đi lọt, và lúc validator lên 14 khe thì cổng vẫn xanh trong khi nó đang canh một
// con số đã chết. `declaredParamCount`/`blueprintGate` đóng đúng lỗ đó — số khe chỉ ĐỌC
// được từ blueprint. Các ca dưới đây đo cả ba trạng thái:
//   • khớp            → im lặng
//   • lệch            → APPLY-001, thông điệp mang CẢ HAI số + tên validator
//   • KHÔNG ĐO ĐƯỢC   → APPLY-002 (thiếu tệp · JSON hỏng · validator không có trong
//                       blueprint · `parameters` vắng mặt), KHÔNG được đọc thành "khớp"
//
// Ca "blueprint vắng mặt" không phải giả tưởng: `plutus.json` là artefact `aiken build` và
// bị `.gitignore:9` chặn, nên mọi cây chưa dựng đều rơi vào đúng ca đó.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertParamCountFromBlueprint, declaredParamCount } from "../offchain/src/applyGate.js";
import { blueprintGate } from "../offchain/src/blueprintSource.js";

/** Blueprint giả lập đúng hình dạng `plutus.json` của Aiken. */
const BLUEPRINT = {
  validators: [
    {
      title: "custody.custody.spend",
      compiledCode: "aa11",
      parameters: [
        { title: "proposal_policy" }, { title: "seed_policy" }, { title: "ms_per_epoch" },
        { title: "lamp_policy" }, { title: "token_name" },
      ],
    },
    { title: "custody.custody.else", compiledCode: "aa11", parameters: [{}, {}, {}, {}, {}] },
    // Validator KHÔNG tham số — Aiken lược hẳn khoá `parameters` (đo 2026-09-11 trên
    // `Genesis/onchain/plutus.json`, `lock_vault.lock_vault.spend`).
    { title: "lock_vault.lock_vault.spend", compiledCode: "bb22" },
  ],
};

function withTempBlueprint<T>(content: string | null, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "lamp-bp-"));
  const path = join(dir, "plutus.json");
  if (content !== null) writeFileSync(path, content, "utf8");
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("trạng thái 1 — KHỚP: cổng im lặng", () => {
  it("custody khai 5 khe, truyền 5 → không ném", () => {
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, "custody.custody.spend", "Treasury", 5))
      .not.toThrow();
  });

  it("declaredParamCount đọc ĐÚNG 5 từ blueprint, không phải từ một số gõ tay", () => {
    expect(declaredParamCount(BLUEPRINT, "custody.custody.spend", "Treasury", 5)).toBe(5);
  });

  it("`parameters` vắng mặt + truyền 0 → 0 khe, hợp lệ (apply 0 tham số là phép đồng nhất)", () => {
    expect(declaredParamCount(BLUEPRINT, "lock_vault.lock_vault.spend", "Genesis", 0)).toBe(0);
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, "lock_vault.lock_vault.spend", "Genesis", 0))
      .not.toThrow();
  });
});

describe("trạng thái 2 — LỆCH: APPLY-001, thông điệp mang cả hai số + tên validator", () => {
  // ĐÂY là ca của lỗ đã đo: `Treasury/scripts/config.ts` áp 3 tham số vào validator khai 5.
  it("custody khai 5, truyền 3 → ném APPLY-001", () => {
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, "custody.custody.spend", "Treasury", 3))
      .toThrow(/APPLY-001/);
  });

  it("thông điệp in CẢ HAI số và tên validator (không phải câu chung chung)", () => {
    let message = "";
    try {
      assertParamCountFromBlueprint(BLUEPRINT, "custody.custody.spend", "Treasury", 3);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/khai 5 tham số/);
    expect(message).toMatch(/truyền 3/);
    expect(message).toMatch(/custody\.custody\.spend/);
    expect(message).toMatch(/Treasury/);
  });

  it("truyền THỪA cũng ném — không chỉ chặn thiếu", () => {
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, "custody.custody.spend", "Treasury", 6))
      .toThrow(/APPLY-001/);
  });
});

describe("trạng thái 3 — KHÔNG ĐO ĐƯỢC: APPLY-002, và KHÔNG được đọc thành 'khớp'", () => {
  it("validator KHÔNG có trong blueprint → APPLY-002, kèm danh sách validator có thật", () => {
    let message = "";
    try {
      assertParamCountFromBlueprint(BLUEPRINT, "khong_ton_tai.spend", "Treasury", 5);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/APPLY-002/);
    expect(message).toMatch(/KHÔNG ĐO ĐƯỢC/);
    expect(message).toMatch(/custody\.custody\.spend/);   // gợi ý cái có thật
  });

  it("`parameters` vắng mặt trong khi chỗ gọi truyền tham số → APPLY-002, KHÔNG đọc thành 0", () => {
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, "lock_vault.lock_vault.spend", "Genesis", 3))
      .toThrow(/APPLY-002/);
  });

  it("blueprint không có mảng `validators` → APPLY-002", () => {
    expect(() => assertParamCountFromBlueprint({ foo: 1 }, "custody.custody.spend", "Treasury", 5))
      .toThrow(/APPLY-002/);
  });

  it("blueprint là null → APPLY-002 (không sập bằng TypeError)", () => {
    expect(() => assertParamCountFromBlueprint(null, "custody.custody.spend", "Treasury", 5))
      .toThrow(/APPLY-002/);
  });
});

describe("blueprintGate — cùng ba trạng thái, nhưng đọc từ TỆP trên đĩa", () => {
  it("tệp blueprint VẮNG MẶT → APPLY-002 nói rõ không đo được + chỉ sang `aiken build`", () => {
    withTempBlueprint(null, (path) => {
      const gate = blueprintGate(path, "Treasury");
      let message = "";
      try {
        gate.assertParamCount("custody.custody.spend", 5);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/APPLY-002/);
      expect(message).toMatch(/aiken build/);
      expect(message).toMatch(/fail-closed/);
    });
  });

  it("tệp blueprint hỏng JSON → APPLY-002, không nuốt thành 'khớp'", () => {
    withTempBlueprint("{ đây không phải JSON", (path) => {
      expect(() => blueprintGate(path, "Treasury").assertParamCount("custody.custody.spend", 5))
        .toThrow(/APPLY-002/);
    });
  });

  it("dựng cổng KHÔNG đọc tệp — chỉ lần assert đầu tiên mới đọc (lazy)", () => {
    // Nếu đọc ngay lúc dựng thì mọi module có cổng sẽ vỡ lúc import trên cây chưa `aiken
    // build`, kể cả khi lượt chạy đó không apply gì.
    expect(() => blueprintGate("/khong/co/duong/nay/plutus.json", "Treasury")).not.toThrow();
  });

  it("tệp đủ: khớp im lặng · lệch APPLY-001", () => {
    withTempBlueprint(JSON.stringify(BLUEPRINT), (path) => {
      const gate = blueprintGate(path, "Treasury");
      expect(() => gate.assertParamCount("custody.custody.spend", 5)).not.toThrow();
      expect(() => gate.assertParamCount("custody.custody.spend", 3)).toThrow(/APPLY-001/);
    });
  });

  it("tra theo compiledCode: khớp im lặng · lệch APPLY-001 · code lạ APPLY-002", () => {
    withTempBlueprint(JSON.stringify(BLUEPRINT), (path) => {
      const gate = blueprintGate(path, "Treasury");
      expect(() => gate.assertParamCountOfCode("aa11", 5)).not.toThrow();
      expect(() => gate.assertParamCountOfCode("aa11", 3)).toThrow(/APPLY-001/);
      // Code lạ là ca cổng MÙ — fail-closed, không "không đoán rồi cho qua".
      expect(() => gate.assertParamCountOfCode("ffff", 5)).toThrow(/APPLY-002/);
    });
  });

  it("tra theo compiledCode báo tên bản CHÍNH, không phải nhánh `.else`", () => {
    withTempBlueprint(JSON.stringify(BLUEPRINT), (path) => {
      let message = "";
      try {
        blueprintGate(path, "Treasury").assertParamCountOfCode("aa11", 3);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/custody\.custody\.spend/);
      expect(message).not.toMatch(/\.else/);
    });
  });
});

describe("HAI CỰC phải phân biệt được — tiền đề của mọi ca trên", () => {
  // Một bộ kiểm mà cả hai cực cùng cho một kết quả thì nó không đo gì. Ở đây hai cực là
  // "truyền đúng số khe" và "truyền thiếu", và chúng phải ra hai kết cục KHÁC nhau.
  it("cùng một validator: 5 tham số đi qua, 3 tham số bị chặn", () => {
    const ok = (() => {
      try { assertParamCountFromBlueprint(BLUEPRINT, "custody.custody.spend", "Treasury", 5); return "qua"; }
      catch { return "chặn"; }
    })();
    const bad = (() => {
      try { assertParamCountFromBlueprint(BLUEPRINT, "custody.custody.spend", "Treasury", 3); return "qua"; }
      catch { return "chặn"; }
    })();
    expect(ok).toBe("qua");
    expect(bad).toBe("chặn");
    expect(ok).not.toBe(bad);
  });
});
