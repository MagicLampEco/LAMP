// genesisGate.test.ts — cổng fail-closed cho `rate_root` của beacon GENESIS.
//
// Vì sao cổng này cần bài kiểm riêng thay vì nằm im trong `scripts/03_genesis.ts`: nó gác
// một trạng thái BẤT KHẢ HỒI (beacon NFT one-shot, không đốt được, `beacon.ak` không có
// nhánh nào cho nó rời script), và nó chỉ chạy khi có người gõ lệnh genesis — tức nó không
// bao giờ tự khai là đã chết. Một `if` trong script chạy tay thì phép đo duy nhất còn lại là
// đọc mã bằng mắt.
//
// Hai vế đo HAI ĐẠI LƯỢNG khác nhau, và mỗi vế mù đúng chỗ vế kia gác:
//   • GEN-V3-002 (biên cứng) — ca BẾ TẮC. Có bản sao ON-CHAIN ở `beacon_nft.ak` C-BCN-GEN-2.
//   • GEN-V3-003 (đúng mốc hiệu chỉnh, chỉ Mainnet) — ca genesis TRONG BIÊN mà SAI LỊCH.
//     KHÔNG có bản sao on-chain và sẽ không có: nó không phá bất biến nào.
import { describe, it, expect } from "vitest";
import {
  assertGenesisRateRoot, RATE_ROOT_GENESIS, RATE_ROOT_MIN, RATE_ROOT_MAX,
} from "../offchain/src/constants.js";

describe("GEN-V3-002 — biên cứng của `rate_root` genesis (mọi mạng)", () => {
  it("ĐỎ: dưới sàn một đơn vị — post không với nổi tới sàn trong một bước +10%", () => {
    expect(() => assertGenesisRateRoot(RATE_ROOT_MIN - 1n, "Preprod")).toThrow(/GEN-V3-002/);
  });

  it("ĐỎ: trên trần một đơn vị — mọi post phải `≥ w > max` ⇒ đứt C-BCN-5b vĩnh viễn", () => {
    expect(() => assertGenesisRateRoot(RATE_ROOT_MAX + 1n, "Preprod")).toThrow(/GEN-V3-002/);
  });

  // Cặp đối chứng: ĐÚNG hai biên phải QUA (mệnh đề là `<`/`>`, không phải `<=`/`>=`).
  // Thiếu cặp này, hai bài trên có thể đỏ vì hằng biên hỏng chứ không vì cái biên.
  it("XANH: đúng SÀN", () => {
    expect(() => assertGenesisRateRoot(RATE_ROOT_MIN, "Preprod")).not.toThrow();
  });

  it("XANH: đúng TRẦN", () => {
    expect(() => assertGenesisRateRoot(RATE_ROOT_MAX, "Preprod")).not.toThrow();
  });
});

describe("GEN-V3-003 — Mainnet đòi ĐÚNG mốc hiệu chỉnh, không chỉ 'trong biên'", () => {
  it("ĐỎ: Mainnet + `rate_root` HỢP BIÊN nhưng gấp 100 lần mốc (đúng bằng trần)", () => {
    // Đây là ca mà GEN-V3-002 KHÔNG bắt được: `RATE_ROOT_MAX` = w×100 nằm trong biên theo
    // định nghĩa, và một pot mở khoá nhanh gấp 100 lần lịch đã chốt vẫn thoả mọi bất biến.
    expect(() => assertGenesisRateRoot(RATE_ROOT_MAX, "Mainnet")).toThrow(/GEN-V3-003/);
  });

  it("ĐỎ: Mainnet + lệch MỘT đơn vị so với mốc — mệnh đề là đẳng thức", () => {
    expect(() => assertGenesisRateRoot(RATE_ROOT_GENESIS + 1n, "Mainnet")).toThrow(/GEN-V3-003/);
    expect(() => assertGenesisRateRoot(RATE_ROOT_GENESIS - 1n, "Mainnet")).toThrow(/GEN-V3-003/);
  });

  it("XANH: Mainnet + đúng mốc hiệu chỉnh", () => {
    expect(() => assertGenesisRateRoot(RATE_ROOT_GENESIS, "Mainnet")).not.toThrow();
  });

  // Vế này cố ý MỞ ngoài Mainnet — đổi `rate_root` genesis là đúng cách dựng ca kiểm cho
  // C-BCN-5a/5b trên mạng thử. Bài kiểm ghim chính sự cố ý đó: nếu ai siết cổng thành
  // "mọi mạng đều phải đúng mốc" thì bộ diễn tập Preprod đứng lại mà không dòng nào nói vì sao.
  it("XANH: ngoài Mainnet, một giá trị hợp biên KHÁC mốc vẫn được phép", () => {
    expect(() => assertGenesisRateRoot(RATE_ROOT_MAX, "Preprod")).not.toThrow();
    expect(() => assertGenesisRateRoot(RATE_ROOT_GENESIS * 2n, "Preview")).not.toThrow();
  });
});
