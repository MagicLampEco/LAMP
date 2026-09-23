// Distribution/tests/pots.test.ts — sổ 18 pot phải khớp BẢNG NGUỒN, không chỉ khớp chính nó.
//
// `assertPotCatalog()` soát tính toàn vẹn NỘI BỘ của sổ (đủ 18, không trùng, tổng đúng trần).
// Nó không phát hiện được ca cả sổ lẫn người sửa sổ cùng lệch khỏi `Papers/pot-catalog.md` —
// và đó đúng là ca mà một bản chép chết trong im lặng. Tệp này đo đại lượng CÒN LẠI: đọc lại
// tệp nguồn, tự phân tách bảng markdown, đối chiếu từng dòng.
//
// Nếu bảng nguồn đổi hình dạng (đổi cột, bỏ in đậm, đổi dấu phân cách nghìn) thì phép phân tách
// trả về ít hơn 18 dòng và ca đầu tiên ĐỎ — cố ý. Một phép phân tách trả về rỗng rồi so rỗng với
// rỗng là phép đo tự khai "khớp" đúng lúc nó không đo được gì.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  POTS, POT_IDS, POT_IDS_CAPPED_DROP, TOTAL_THOUSAND_LAMP,
  assertPotCatalog, potById, potBudgetOildrop,
} from "../offchain/src/pots.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG = resolve(__dirname, "../../Papers/pot-catalog.md");

interface SourceRow { index: number; label: string; thousandLamp: number }

/**
 * Phân tách các dòng `| <số> | **<tên>** | <số có dấu chấm ngăn nghìn> | …` của bảng 18 pot.
 * Chỉ nhận dòng có số thứ tự 1..18 ở cột đầu, để không nuốt các bảng khác trong cùng tệp.
 */
function parseCatalog(): SourceRow[] {
  const text = readFileSync(CATALOG, "utf8");
  const rows: SourceRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\|\s*(\d{1,2})\s*\|\s*\*\*(.+?)\*\*\s*\|\s*([\d.]+)\s*\|/.exec(line);
    if (!m) continue;
    const index = Number(m[1]);
    if (index < 1 || index > 18) continue;
    rows.push({
      index,
      label: m[2].trim(),
      thousandLamp: Number(m[3].replace(/\./g, "")),
    });
  }
  return rows;
}

describe("sổ 18 pot đối chiếu Papers/pot-catalog.md", () => {
  const rows = parseCatalog();

  it("phép phân tách bảng nguồn đọc được ĐÚNG 18 dòng", () => {
    // Ca này đứng trước mọi ca khác: nó là ca chứng minh phép đo còn đo được. Đỏ ở đây
    // nghĩa là bảng nguồn đã đổi hình dạng, KHÔNG nghĩa là con số đã sai.
    expect(rows.length, `đọc được ${rows.length} dòng từ ${CATALOG}`).toBe(18);
  });

  it("mỗi pot trong sổ khớp đúng dòng cùng số thứ tự của bảng nguồn", () => {
    for (const pot of POTS) {
      const row = rows.find((r) => r.index === pot.index);
      expect(row, `bảng nguồn không có dòng số ${pot.index}`).toBeDefined();
      expect(row!.label, `pot '${pot.id}' — tên lệch nguồn`).toBe(pot.label);
      expect(row!.thousandLamp, `pot '${pot.id}' — ngân sách lệch nguồn`).toBe(pot.thousandLamp);
    }
  });

  it("tổng bảng nguồn = trần cung 36.000.000 nghìn LAMP", () => {
    expect(rows.reduce((a, r) => a + r.thousandLamp, 0)).toBe(TOTAL_THOUSAND_LAMP);
  });
});

describe("tính toàn vẹn nội bộ của sổ", () => {
  it("assertPotCatalog() không ném", () => {
    expect(() => assertPotCatalog()).not.toThrow();
  });

  it("đúng 18 mã, không trùng", () => {
    expect(POT_IDS.length).toBe(18);
    expect(new Set(POT_IDS).size).toBe(18);
  });

  it("mã pot viết bằng chữ thường + gạch nối, không dấu tiếng Việt", () => {
    for (const id of POT_IDS) expect(id).toMatch(/^[a-z][a-z-]*[a-z]$/);
  });

  it("Reserve bị loại khỏi danh sách Capped Drop, 17 pot còn lại giữ nguyên", () => {
    expect(POT_IDS_CAPPED_DROP).not.toContain("reserve");
    expect(POT_IDS_CAPPED_DROP.length).toBe(17);
  });
});

describe("tra cứu + quy đổi đơn vị", () => {
  it("potById ném với mã không có trong danh sách ĐÓNG", () => {
    expect(() => potById("wakemee")).toThrow(/POT-001/);
    // Chữ hoa KHÔNG được tự hạ xuống chữ thường: một phép chuẩn hoá ngầm ở đây là chỗ
    // `POT=Wakeme` và `POT=wakeme` cùng trỏ một cụm mà tên tệp trạng thái lại khác nhau.
    expect(() => potById("Wakeme")).toThrow(/POT-001/);
  });

  it("thông báo lỗi liệt kê cả 18 mã hợp lệ", () => {
    try {
      potById("khong-co-that");
      expect.unreachable("phải ném");
    } catch (e) {
      const msg = String(e);
      for (const id of POT_IDS) expect(msg).toContain(id);
    }
  });

  it("ngân sách quy ra oildrop = nghìn LAMP × 1000 × 10^6", () => {
    // Wakeme: 1.001.000 nghìn LAMP = 1.001.000.000 LAMP = 1.001e15 oildrop.
    expect(potBudgetOildrop("wakeme")).toBe(1_001_000_000_000_000n);
    expect(potBudgetOildrop("early-tiger-deleg")).toBe(12_000_000_000_000n);
  });

  it("tổng ngân sách 18 pot quy ra oildrop = 36 tỷ LAMP", () => {
    const sum = POT_IDS.reduce((a, id) => a + potBudgetOildrop(id), 0n);
    expect(sum).toBe(36_000_000_000n * 1_000_000n);
  });
});
