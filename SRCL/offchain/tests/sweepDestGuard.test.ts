// Cổng gác `treasury_dest` — `SRCL/offchain/src/sweepDestGuard.ts`.
//
// Ca gốc (hồi quy), đo được trong cây trước bản vá: `demo_srcl.ts` đặt `ADMIN = [pkh]` (`:98`)
// và `treasury_dest: pkh` (`:139`) — CÙNG đúng 28 byte. Hai chỗ hỏng chồng lên nhau:
//   (1) đích trùng người gác ⇒ Sweep không phải một đường ra;
//   (2) `pkh` là khoá VÍ, mà `srcl_pool.ak:210` → `util.is_at_script:23-27` đòi `Script(h)` ⇒
//       Sweep trả LAMP tới `Script(<khoá ví>)`, địa chỉ không có tiền ảnh, không ai spend được.
// Bộ test dưới ép cả hai ca, và ép luôn ca hồi quy trên chính tệp demo.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assertSweepDest } from "../src/sweepDestGuard.js";

const ADMIN_A = "aa".repeat(28);
const ADMIN_B = "bb".repeat(28);
const SCRIPT_DEST = "cc".repeat(28);
const ok = { admin: [ADMIN_A, ADMIN_B], willWrite: true, isScriptHash: true };

describe("assertSweepDest — SWEEP-001/002/003", () => {
  it("đích rời admin + khai là script hash ⇒ đi tiếp", () => {
    expect(() => assertSweepDest(SCRIPT_DEST, ok)).not.toThrow();
  });

  it("SWEEP-001: không phải 28 byte hex ⇒ ném", () => {
    for (const bad of ["", "zz".repeat(28), "aa".repeat(27), "aa".repeat(29), "0x" + "aa".repeat(28)]) {
      expect(() => assertSweepDest(bad, ok)).toThrow(/SWEEP-001/);
    }
  });

  it("SWEEP-002: trùng ĐÚNG MỘT khoá admin ⇒ ném", () => {
    expect(() => assertSweepDest(ADMIN_B, ok)).toThrow(/SWEEP-002/);
  });

  it("SWEEP-002: trùng nhưng viết HOA ⇒ vẫn ném (so khớp không phân biệt hoa/thường)", () => {
    expect(() => assertSweepDest(ADMIN_A.toUpperCase(), ok)).toThrow(/SWEEP-002/);
  });

  it("SWEEP-002 xét TRƯỚC SWEEP-003 — trùng admin thì khai script hash cũng không cứu", () => {
    expect(() => assertSweepDest(ADMIN_A, { ...ok, isScriptHash: false })).toThrow(/SWEEP-002/);
  });

  it("SWEEP-003: chưa khai là script hash + sắp ghi datum ⇒ ném", () => {
    expect(() => assertSweepDest(SCRIPT_DEST, { ...ok, isScriptHash: false }))
      .toThrow(/SWEEP-003/);
  });

  it("chưa ghi datum ⇒ chưa đòi khai script hash (còn sửa được thì chưa phải cổng)", () => {
    expect(() => assertSweepDest(SCRIPT_DEST, { ...ok, willWrite: false, isScriptHash: false }))
      .not.toThrow();
  });

  it("thông điệp phải nói ĐÚNG hậu quả, không nói chung chung", () => {
    let msg = "";
    try { assertSweepDest(SCRIPT_DEST, { ...ok, isScriptHash: false }); }
    catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("KHÔNG CÓ TIỀN ẢNH");
    expect(msg).toContain("LAMP không burn");
  });

  it("HỒI QUY: demo_srcl.ts không được đặt treasury_dest bằng chính khoá admin", () => {
    // Phép kiểm thật của bài này. Tám test trên chứng minh cổng chạy; test này chứng minh cổng
    // ĐƯỢC MẮC VÀO đúng chỗ đã hỏng. Đếm LỜI GỌI, không đếm chuỗi — dòng `import` cũng mang tên
    // hàm, nên `includes()` sẽ xanh cả khi lời gọi bị gỡ.
    const src = readFileSync("../scripts/demo_srcl.ts", "utf8");
    const calls = src.split("\n")
      .filter((l: string) => !l.trimStart().startsWith("import"))
      .filter((l: string) => /\bassertSweepDest\s*\(/.test(l));
    expect(calls.length, "demo_srcl.ts dựng SrclDatum mà KHÔNG GỌI assertSweepDest")
      .toBeGreaterThan(0);
  });
});
