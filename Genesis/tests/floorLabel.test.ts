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

  it("FLOOR_SOURCE khai ngay cạnh FLOOR_OILDROP, cùng kiểu liệt kê đóng", () => {
    const src = readFileSync(`${SCRIPTS_DIR}/_reserve_layer2.ts`, "utf8");
    expect(src).toMatch(/export const FLOOR_SOURCE:\s*FloorSource\s*=/);
    // Khoảng cách giữa hai khai báo: đứng cạnh nhau thì đổi con số mà quên nhãn là chuyện khó
    // xảy ra hơn. Không phải một bảo đảm, là một cách sắp xếp — nên ngưỡng đặt rộng.
    const iSo = src.indexOf("export const FLOOR_OILDROP");
    const iNhan = src.indexOf("export const FLOOR_SOURCE");
    expect(iSo).toBeGreaterThan(-1);
    expect(iNhan).toBeGreaterThan(iSo);
    expect(src.slice(iSo, iNhan).split("\n").length).toBeLessThan(15);
  });

  it("bước Lớp 2 GHI cả hai trường vào state, không chỉ in ra", () => {
    const src = readFileSync(`${SCRIPTS_DIR}/24_reserve_layer2_init.ts`, "utf8");
    expect(src).toMatch(/state\.floorOildrop\s*=/);
    expect(src).toMatch(/state\.floorSource\s*=\s*FLOOR_SOURCE/);
  });

  it("bước đối chiếu ĐỌC nhãn qua liệt kê đóng, không đọc chuỗi trần", () => {
    const src = readFileSync(`${SCRIPTS_DIR}/verify_canonical_v2.ts`, "utf8");
    expect(src).toMatch(/parseFloorSource\(/);
  });
});
