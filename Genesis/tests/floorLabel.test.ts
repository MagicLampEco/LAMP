// FLOOR-LABEL-001 — nhãn xuất xứ của con số SÀN phải là LIỆT KÊ ĐÓNG, và phải nằm trong TẠO TÁC.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// `FLOOR_OILDROP` là giá trị diễn tập. Trước đợt vá này chữ "diễn tập" chỉ sống trong một chú
// thích và một dòng `console.log`: `CanonicalState` không có trường nào cho nó, nên tệp trạng
// thái ghi lại toàn bộ đường ống mà KHÔNG ghi lại việc con số ấy là tạm. Bản thật sau này kế
// thừa con số mà không kế thừa nhãn, và không có gì kêu — nhãn chết ở màn hình là nhãn không
// tồn tại.
//
// Bài chia hai phần, cố ý:
//   · phần LOGIC   — liệt kê đóng từ chối mọi giá trị ngoài dự kiến (chạy được ở mọi máy);
//   · phần TẠO TÁC — nhãn có thật trong `CanonicalState` và có thật cạnh con số trong mã.
// Phần thứ hai đọc VĂN BẢN NGUỒN vì hai tệp đó `import ./config.js`, mà `config.ts` NÉM lúc
// import khi môi trường chưa dựng (`SECRETS-001`). Đây là một phép đo yếu hơn — nó chứng minh
// nhãn CÓ MẶT, không chứng minh nó được ghi đúng lượt — và nói thẳng ra thế còn hơn im lặng.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FLOOR_SOURCES, floorSourceWarning, parseFloorSource,
} from "../scripts/_floorLabel.js";

const SCRIPTS_DIR = "../scripts";

describe("FLOOR-LABEL-001 — liệt kê đóng", () => {
  it('nhận "demo"', () => {
    expect(parseFloorSource("demo")).toBe("demo");
  });

  it('nhận "production"', () => {
    expect(parseFloorSource("production")).toBe("production");
  });

  it("liệt kê có ĐÚNG hai giá trị — nới ra là một quyết định, không phải một lần gõ", () => {
    expect([...FLOOR_SOURCES]).toEqual(["demo", "production"]);
  });

  it("undefined: ném — thiếu nhãn KHÔNG được đọc thành 'chắc là bản thật'", () => {
    expect(() => parseFloorSource(undefined)).toThrow(/FLOOR-LABEL-001/);
  });

  it("chuỗi rỗng: ném", () => {
    expect(() => parseFloorSource("")).toThrow(/FLOOR-LABEL-001/);
  });

  it('"Demo" hoa chữ đầu: ném — nhãn do MÃ đặt, một biến thể là dấu hiệu nguồn thứ hai', () => {
    expect(() => parseFloorSource("Demo")).toThrow(/FLOOR-LABEL-001/);
  });

  it('"demo " thừa khoảng trắng: ném, không tự cắt', () => {
    expect(() => parseFloorSource("demo ")).toThrow(/FLOOR-LABEL-001/);
  });

  it('"mainnet" — giá trị nghe hợp lý nhưng ngoài liệt kê: ném', () => {
    expect(() => parseFloorSource("mainnet")).toThrow(/FLOOR-LABEL-001/);
  });

  it("không phải chuỗi: ném", () => {
    expect(() => parseFloorSource(1_000_000_000)).toThrow(/FLOOR-LABEL-001/);
    expect(() => parseFloorSource(null)).toThrow(/FLOOR-LABEL-001/);
  });

  it("câu lỗi nêu tên trường để người đọc biết sửa ở đâu", () => {
    expect(() => parseFloorSource("x", "state.floorSource"))
      .toThrow(/state\.floorSource/);
  });
});

describe("floorSourceWarning — chỉ 'demo' mới kéo theo cảnh báo", () => {
  // Hai cực phân biệt được: một nhãn kêu, một nhãn im. Nếu hàm luôn trả về câu cảnh báo thì
  // cảnh báo đó xuất hiện ở cả bản thật, và một cảnh báo luôn hiện là một cảnh báo bị lướt qua.
  it('"demo" có cảnh báo, và cảnh báo nói rõ phải thay trước bản thật', () => {
    expect(floorSourceWarning("demo")).toMatch(/DIỄN TẬP/);
  });

  it('"production" KHÔNG có cảnh báo', () => {
    expect(floorSourceWarning("production")).toBeUndefined();
  });
});

describe("nhãn phải nằm trong TẠO TÁC, không chỉ trên màn hình", () => {
  it("CanonicalState khai hai trường floorOildrop + floorSource", () => {
    const src = readFileSync(`${SCRIPTS_DIR}/_canonical_v2.ts`, "utf8");
    expect(src).toMatch(/floorOildrop\?:\s*string;/);
    expect(src).toMatch(/floorSource\?:\s*FloorSource;/);
  });

  // Sàn nay đọc từ `RESERVE_FLOOR_OILDROP` (bắt buộc). Nhãn KHÔNG còn là một hằng gõ tay cạnh con
  // số: `reserveFloorFromEnv` SUY nhãn từ phép so với giá trị đã chốt, nên con số và nhãn đi ra
  // từ CÙNG một lời gọi — không còn hai chỗ để đổi lệch nhau. Hành vi nhãn ghim ở
  // `genesisReservePlacement.test.ts` ▸ "reserveFloorFromEnv".
  it("nhãn sàn suy ra trong reserveFloorFromEnv, không phải hằng gõ tay", () => {
    const src = readFileSync(`${SCRIPTS_DIR}/_reserve_layer2.ts`, "utf8");
    expect(src).not.toMatch(/export const FLOOR_SOURCE/);
    expect(src).toMatch(/floorSource:\s*v === DECIDED_FLOOR_OILDROP \? "production" : "demo"/);
  });

  it("bước Lớp 2 rời và bước genesis GHI cả hai trường vào state, không chỉ in ra", () => {
    const l2 = readFileSync(`${SCRIPTS_DIR}/24_reserve_layer2_init.ts`, "utf8");
    expect(l2).toMatch(/state\.floorOildrop\s*=/);
    expect(l2).toMatch(/state\.floorSource\s*=\s*floor\.floorSource/);
    const g = readFileSync(`${SCRIPTS_DIR}/20_canonical_genesis.ts`, "utf8");
    expect(g).toMatch(/floorOildrop:\s*floor\.floorOildrop\.toString\(\)/);
    expect(g).toMatch(/floorSource:\s*floor\.floorSource/);
  });

  it("bước đối chiếu ĐỌC nhãn qua liệt kê đóng, không đọc chuỗi trần", () => {
    const src = readFileSync(`${SCRIPTS_DIR}/verify_canonical_v2.ts`, "utf8");
    expect(src).toMatch(/parseFloorSource\(/);
  });
});
