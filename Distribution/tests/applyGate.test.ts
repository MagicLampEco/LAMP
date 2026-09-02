// applyGate.test.ts — cổng APPLY-001 mang từ Genesis sang LampDistribution.
//
// Ca ĐỎ bắt buộc (báo cáo vá "apply thiếu tham số claim_account/treasury"): chứng minh
// cổng ĐỎ khi apply THIẾU đúng tham số đã gây lỗi thật — `account_nft_policy` (tham số
// CUỐI, thêm 2026-08-12, PR #22 điểm 1) — 7/8 cho claim_account, 5/6 cho treasury; và
// XANH khi apply đủ. `applyParamsToScript` không tự báo lỗi khi thiếu tham số — nó trả
// về một script hash KHÁC, im lặng — đây là lý do cổng này tồn tại.
import { describe, it, expect } from "vitest";
import { assertParamCount } from "../offchain/src/applyGate.js";

describe("cổng APPLY-001 — apply thiếu tham số KHÔNG báo lỗi, nó đổi script hash", () => {
  it("ĐỎ: claim_account.claim_account.spend khai 8 tham số, chỗ gọi (lỗi cũ) chỉ truyền 7 " +
     "(thiếu account_nft_policy)", () => {
    expect(() => assertParamCount("claim_account.claim_account.spend", 8, 7)).toThrow(/APPLY-001/);
  });

  it("ĐỎ: treasury.treasury.spend khai 6 tham số, chỗ gọi (lỗi cũ) chỉ truyền 5 " +
     "(thiếu account_nft_policy)", () => {
    expect(() => assertParamCount("treasury.treasury.spend", 6, 5)).toThrow(/APPLY-001/);
  });

  it("XANH: claim_account đủ 8/8, treasury đủ 6/6 — sau vá", () => {
    expect(() => assertParamCount("claim_account.claim_account.spend", 8, 8)).not.toThrow();
    expect(() => assertParamCount("treasury.treasury.spend", 6, 6)).not.toThrow();
  });

  it("ném khi TRUYỀN THỪA tham số (đối xứng với thiếu — cùng một lớp lỗi)", () => {
    expect(() => assertParamCount("claim_account.claim_account.spend", 8, 9)).toThrow(/APPLY-001/);
  });

  it("thông điệp nêu tên validator + cả hai con số để đối chiếu", () => {
    expect(() => assertParamCount("treasury.treasury.spend", 6, 5)).toThrow(
      /treasury\.treasury\.spend khai 6 tham số, chỗ gọi truyền 5/,
    );
  });
});
