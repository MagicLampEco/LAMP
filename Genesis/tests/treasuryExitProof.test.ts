// Cổng "kho phải có LỐI RA trước khi nhận LAMP" — `Genesis/scripts/_treasuryExitProof.ts`.
//
// Ca gốc: trên Preprod, 10 tỷ tLAMP vào ĐÚNG địa chỉ kho và nằm NGOÀI sổ kho — không giao
// dịch nào chi được ra, và LAMP không burn. Cái hỏng không phải một lỗi dựng giao dịch; cái
// hỏng là KHÔNG AI BIẾT lối ra chưa từng chạy trên chuỗi.
//
// Bộ này ghim HAI thứ khác loại:
//   (1) bản thân phép đo phân biệt được ba trạng thái, và trạng thái MÙ không tụt xuống thành
//       trạng thái "chưa có";
//   (2) không script Genesis nào rót LAMP vào kho mà thiếu cổng — đây là vế chống QUÊN, thứ
//       mà một bài kiểm hàm đơn lẻ không ghim được.

import { describe, it, expect, vi } from "vitest";
import { writeFileSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  measureExitProof,
  assertTreasuryHasExit,
  BOOTSTRAP_CEILING_OILDROP,
} from "../scripts/_treasuryExitProof.js";

const TRE = "addr_test1_kho_dang_dung";
const TRE_KHAC = "addr_test1_kho_cu_da_bo";

function ledgerFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "exitproof-"));
  const p = join(dir, "treasury-exit-proof.json");
  writeFileSync(p, content, "utf8");
  return p;
}

const PROVEN = JSON.stringify({
  Preprod: { txHash: "abc123", date: "2026-09-20", branch: "Refill+Redeem", treasuryAddress: TRE },
});

describe("measureExitProof — ba trạng thái, và trạng thái mù không tụt hạng", () => {
  it("mục null = ĐÃ ĐO, lối ra chưa chạy", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: null }));
    expect(measureExitProof("Preprod", p)).toEqual({ state: "not-proven", network: "Preprod" });
  });

  it("mục đủ trường = đã chứng minh", () => {
    const r = measureExitProof("Preprod", ledgerFile(PROVEN));
    expect(r.state).toBe("proven");
  });

  // Đây là ca trung tâm của cả tệp. Thiếu KHOÁ và khoá giá trị null là hai chuyện khác nhau:
  // thiếu khoá nghĩa là cổng không biết gì về mạng này (mù), null nghĩa là có người đã đo và
  // khai rằng chưa chạy. Gộp hai cái làm một thì một mạng gõ sai tên đi qua dưới nhãn vô hại.
  it("THIẾU KHOÁ mạng = không đo được, KHÔNG phải 'chưa có lối ra'", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: null }));
    const r = measureExitProof("Preview", p);
    expect(r.state).toBe("unmeasurable");
    expect(r.state === "unmeasurable" && r.reason).toMatch(/KHÔNG có khoá/);
  });

  it("sổ không tồn tại = không đo được", () => {
    const r = measureExitProof("Preprod", "/khong/ton/tai/exit.json");
    expect(r.state).toBe("unmeasurable");
  });

  it("sổ không phải JSON = không đo được", () => {
    const r = measureExitProof("Preprod", ledgerFile("{ hỏng"));
    expect(r.state).toBe("unmeasurable");
  });

  it("mục thiếu trường = không đo được, và NÊU ĐÍCH DANH trường thiếu", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: { txHash: "abc", date: "2026-09-20" } }));
    const r = measureExitProof("Preprod", p);
    expect(r.state).toBe("unmeasurable");
    expect(r.state === "unmeasurable" && r.reason).toMatch(/branch/);
    expect(r.state === "unmeasurable" && r.reason).toMatch(/treasuryAddress/);
  });

  it("trường rỗng KHÔNG được tính là có — chuỗi rỗng là giá trị người ta thật sự gõ vào", () => {
    const p = ledgerFile(
      JSON.stringify({ Preprod: { txHash: "", date: "2026-09-20", branch: "Redeem", treasuryAddress: TRE } }),
    );
    expect(measureExitProof("Preprod", p).state).toBe("unmeasurable");
  });
});

describe("assertTreasuryHasExit — chặn, và chặn bằng hai câu khác nhau", () => {
  const LON = BOOTSTRAP_CEILING_OILDROP + 1n;

  it("chưa có lối ra + lượng vượt trần mồi ⇒ ném TRE-EXIT-001", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: null }));
    expect(() => assertTreasuryHasExit("Preprod", TRE, LON, p)).toThrow(/TRE-EXIT-001/);
  });

  it("không đo được ⇒ ném TRE-EXIT-002, KHÁC mã với ca trên", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: null }));
    expect(() => assertTreasuryHasExit("Preview", TRE, LON, p)).toThrow(/TRE-EXIT-002/);
  });

  it("có lối ra nhưng thuộc địa chỉ kho KHÁC ⇒ ném TRE-EXIT-003", () => {
    const p = ledgerFile(PROVEN);
    expect(() => assertTreasuryHasExit("Preprod", TRE_KHAC, LON, p)).toThrow(/TRE-EXIT-003/);
  });

  it("có lối ra, đúng địa chỉ ⇒ đi qua", () => {
    const p = ledgerFile(PROVEN);
    expect(() => assertTreasuryHasExit("Preprod", TRE, LON, p)).not.toThrow();
  });

  // Trần mồi tồn tại vì không có nó thì cổng là một vòng không lối vào: muốn có bằng chứng chi
  // ra thì trong kho phải có gì đó. Ca này ghim rằng lối mồi CÓ, và ca kế ghim rằng nó KHÔNG
  // mở rộng sang trạng thái mù.
  it("lượt nạp mồi ĐÚNG trần vẫn đi qua, kèm cảnh báo", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: null }));
    const warn = vi.fn();
    expect(() =>
      assertTreasuryHasExit("Preprod", TRE, BOOTSTRAP_CEILING_OILDROP, p, warn),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/NẠP MỒI/);
  });

  it("trần mồi KHÔNG nới cho trạng thái mù — nạp ít vẫn chặn khi không đo được", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: null }));
    expect(() => assertTreasuryHasExit("Preview", TRE, 1n, p, vi.fn())).toThrow(/TRE-EXIT-002/);
  });

  it("vượt trần mồi đúng MỘT đơn vị đã bị chặn — biên là biên, không phải vùng đệm", () => {
    const p = ledgerFile(JSON.stringify({ Preprod: null }));
    expect(() =>
      assertTreasuryHasExit("Preprod", TRE, BOOTSTRAP_CEILING_OILDROP + 1n, p, vi.fn()),
    ).toThrow(/TRE-EXIT-001/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Vế CHỐNG QUÊN: script rót LAMP vào kho thì phải gọi cổng.
//
// PHẠM VI phép đếm này — in ra để không ai đọc nó rộng hơn nó:
//   Quét: `Genesis/scripts/*.ts`, tìm lượt `pay.ToContract(wiring.treAddr` mà trong cùng lời
//   gọi có `lampUnit`. Vế `lampUnit` KHÔNG phải để thu hẹp cho tiện — nó là đại lượng đúng:
//   `20_canonical_genesis.ts` rót NFT kho vào chính địa chỉ đó, và đó không phải lượt nạp
//   LAMP nên cổng không áp. Bỏ vế ấy là đo "rót bất cứ gì vào kho", một câu hỏi khác.
//   NGOÀI vùng quét: mọi đường rót vào kho đi qua builder ở gói khác
//   (`Distribution/offchain/src/*`) — bài này KHÔNG nhìn thấy chúng. Một script tương lai gọi
//   builder như thế sẽ lọt. Nói ra vì một cổng không khai phạm vi thì bị đọc thành cổng mạnh
//   hơn nó, và ở đây phạm vi hẹp hơn tên gọi khá nhiều.
//   Cũng là phép khớp CHUỖI, nên đổi cách gọi (đặt địa chỉ vào một biến trung gian) làm nó mù
//   mà vẫn xanh. Đó là giới hạn thật của bài này, không phải chỗ để siết thêm regex.
// ════════════════════════════════════════════════════════════════════════════════

/** Lượt `pay.ToContract(wiring.treAddr …)` có kèm `lampUnit` trong cùng lời gọi. */
function paysLampIntoTreasury(src: string): boolean {
  const needle = "pay.ToContract(wiring.treAddr";
  let i = src.indexOf(needle);
  while (i !== -1) {
    // Một lời gọi `.pay.ToContract(...)` trong kho này dài dưới 300 ký tự; lấy dư để không cắt
    // mất phần value, và dừng ở dấu `.pay.` kế tiếp để không lấn sang lời gọi sau.
    const after = src.slice(i + needle.length, i + needle.length + 300).split(".pay.")[0]!;
    if (after.includes("lampUnit")) return true;
    i = src.indexOf(needle, i + needle.length);
  }
  return false;
}

describe("mọi script Genesis rót LAMP VÀO kho đều phải gọi cổng", () => {
  const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

  const all = readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));
  const payers = all.filter((f) => paysLampIntoTreasury(readFileSync(join(scriptsDir, f), "utf8")));

  it("vùng quét KHÔNG rỗng — bài này vô nghĩa nếu nó không tìm thấy script nào", () => {
    expect(payers.length).toBeGreaterThan(0);
  });

  // Vế (b) của §Cổng gác: đếm phần bị loại, không chỉ khai rằng có loại. Một lời khai không
  // thay được một phép đếm — và con số này là thứ sẽ đổi lặng lẽ khi ai đó thêm script.
  it("khai ĐƯỢC phần nằm ngoài: bao nhiêu tệp quét, bao nhiêu tệp trúng", () => {
    expect(all.length).toBeGreaterThan(payers.length);
    expect(payers).toContain("21_vest_to_kho.ts");
    // `20_canonical_genesis.ts` rót NFT kho chứ không rót LAMP ⇒ nằm ngoài, có lý do, không
    // phải một ngoại lệ được gõ tay vào danh sách bỏ qua.
    expect(payers).not.toContain("20_canonical_genesis.ts");
  });

  it.each(payers)("%s gọi assertTreasuryHasExit", (f) => {
    const src = readFileSync(join(scriptsDir, f), "utf8");
    expect(src).toContain("_treasuryExitProof.js");
    expect(src).toContain("assertTreasuryHasExit(");
  });
});
