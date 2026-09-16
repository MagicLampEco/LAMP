// RFL-010 — đọc lại giao dịch Refill ĐÃ DỰNG, không tin số builder đã TÍNH.
//
// Ca quan trọng nhất ở đây là ca đối kháng: `complete()` thật của Lucid có thể ÂM THẦM nâng
// lovelace output lên min-ADA khi bó tài sản gộp mang nhiều loại — hành vi đó nằm TRONG thư viện,
// không đo được bằng mock ghi lại tham số builder đã GỌI (mock kiểu đó chỉ đo builder đã XIN gì,
// không đo Lucid đã DỰNG gì). Khai `BuiltTxOutputs` theo HÌNH DẠNG (không import kiểu lucid) để
// stub dựng được ở đây mà không cần một giao dịch thật — cùng lý do `_custodySeedRef.ts` đã ghi.

import { describe, it, expect } from "vitest";
import { outputsAt, assertRefillOutputMatches, type BuiltTxOutputs } from "../scripts/_refillReadback.js";

const KHO_ADDR = "addr_test1wqcnq8kkza7kw8409pt8ytywgeat4strz5sxt0g5wdl9a8q0r2v2g";
const VI_ADDR  = "addr_test1qz-vi-van-hanh";

function danhSachOutput(outs: { addr: string; coin: bigint }[]) {
  return {
    len: () => outs.length,
    get: (i: number) => ({
      address: () => ({ to_bech32: (_p?: string) => outs[i]!.addr }),
      amount:  () => ({ coin: () => outs[i]!.coin }),
    }),
  };
}

/** Giao dịch stub — chỉ khai đủ hình dạng `BuiltTxOutputs` cần. */
function txVoiOutputs(outs: { addr: string; coin: bigint }[]): BuiltTxOutputs {
  return { toTransaction: () => ({ body: () => ({ outputs: () => danhSachOutput(outs) }) }) };
}

describe("outputsAt — đọc lại giao dịch ĐÃ DỰNG", () => {
  it("đếm đúng số output ở địa chỉ, cộng dồn lovelace, bỏ qua output ở địa chỉ khác", () => {
    const tx = txVoiOutputs([
      { addr: VI_ADDR, coin: 1_500_000n },
      { addr: KHO_ADDR, coin: 4_000_000n },
    ]);
    expect(outputsAt(tx, KHO_ADDR)).toEqual({ count: 1, lovelace: 4_000_000n });
  });

  it("không có output nào ở địa chỉ ⇒ count 0, lovelace 0 (không phải throw)", () => {
    const tx = txVoiOutputs([{ addr: VI_ADDR, coin: 2_000_000n }]);
    expect(outputsAt(tx, KHO_ADDR)).toEqual({ count: 0, lovelace: 0n });
  });
});

describe("assertRefillOutputMatches — RFL-010", () => {
  it("khớp đúng số đã tính ⇒ không ném", () => {
    const tx = txVoiOutputs([{ addr: KHO_ADDR, coin: 4_000_000n }]);
    expect(() => assertRefillOutputMatches(tx, KHO_ADDR, 4_000_000n)).not.toThrow();
  });

  // Ca đối kháng chính: Lucid tự nâng lovelace lên min-ADA vì bó tài sản gộp mang nhiều loại.
  // Builder TÍNH 4_000_000n (đúng Σ lovelace vào), Lucid DỰNG 6_200_000n (min-ADA của bó đã
  // gộp thêm rác). `treasury.ak:232` sẽ từ chối tx này — RFL-010 phải bắt được TRƯỚC khi ký.
  it("Lucid âm thầm nâng lovelace lên min-ADA ⇒ ném RFL-010, nêu cả hai con số", () => {
    const tx = txVoiOutputs([{ addr: KHO_ADDR, coin: 6_200_000n }]);
    expect(() => assertRefillOutputMatches(tx, KHO_ADDR, 4_000_000n))
      .toThrow(/RFL-010.*6200000.*4000000|RFL-010.*4000000.*6200000/s);
  });

  it("giao dịch dựng ra 0 output ở địa chỉ kho ⇒ ném RFL-010 (không phải 1, không lệch lovelace)", () => {
    const tx = txVoiOutputs([{ addr: VI_ADDR, coin: 4_000_000n }]);
    expect(() => assertRefillOutputMatches(tx, KHO_ADDR, 4_000_000n)).toThrow(/RFL-010/);
  });

  it("giao dịch dựng ra 2 output ở địa chỉ kho ⇒ ném RFL-010 (treasury.ak:198 đòi đúng 1)", () => {
    const tx = txVoiOutputs([
      { addr: KHO_ADDR, coin: 2_000_000n },
      { addr: KHO_ADDR, coin: 2_000_000n },
    ]);
    expect(() => assertRefillOutputMatches(tx, KHO_ADDR, 4_000_000n)).toThrow(/RFL-010/);
  });
});
