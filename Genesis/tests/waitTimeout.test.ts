// WAIT-TIMEOUT-001 — sau khi giao dịch đã gửi, "chưa đo được" và "hỏng thật" phải là HAI nhãn.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// Hai bước `21_vest_to_kho.ts` và `22_reserve_draw.ts` cố ý KHÔNG ném ở phép đối chiếu hậu-gửi:
// ném sau một thao tác bất khả hồi không cứu được gì, chỉ bỏ lại một cuốn sổ dở dang. Nhưng bản
// đầu của quyết định đó bọc trọn khối đối chiếu trong một `catch` rồi gán MỌI ngoại lệ vào nhãn
// `⚠ CHƯA ĐO ĐƯỢC (không phải "hỏng")`, rồi in `✅ Xong` và thoát 0. Hai ngoại lệ đi qua đúng
// đường đó là thảm hoạ: `theOneHolding` ném khi tìm thấy HAI UTxO mang SUPPLY NFT (thread NFT
// nhân đôi ⇒ `dist_minted` về 0 ⇒ đúc lại trọn cap), và `.datum!` ném `TypeError` khi SupplyState
// quay về không có inline datum. Đầu tệp `22_reserve_draw.ts` tự khai rằng màu của bước đó quyết
// định có phát hành hay không — nên một dấu ✅ đứng sau trạng thái mù là một khẳng định không
// phép đo nào đỡ.
//
// Bài chia hai phần, cố ý — cùng khuôn `floorLabel.test.ts`:
//   · phần VỊ TỪ    — `isWaitTimeout` phân loại đúng, chạy được ở mọi máy;
//   · phần CHỖ GỌI  — hai script THẬT SỰ rẽ nhánh theo nó, và KHÔNG in "Xong" ở nhánh mù.
// Phần thứ hai đọc VĂN BẢN NGUỒN vì hai script đó `import ./config.js`, mà `config.ts` ném lúc
// import khi môi trường chưa dựng (`SECRETS-001`). Đây là phép đo yếu hơn — nó chứng minh nhánh
// CÓ MẶT, không chứng minh nó chạy đúng lượt — và nói thẳng ra thế còn hơn im lặng. Nó vẫn là
// phần đáng giá nhất của bài: khuyết tật đắt nhất của đợt vá trước là một cổng viết đúng mà
// KHÔNG CHỖ NÀO GỌI, và đảo một thứ không được gọi thì không sinh ra tín hiệu nào.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WAIT_TIMEOUT_CODE, isWaitTimeout, waitTimeoutError } from "../scripts/_waitTimeout.js";

const doc = (p: string) => readFileSync(new URL(`../scripts/${p}`, import.meta.url), "utf8");

describe("WAIT-TIMEOUT-001 · vị từ phân loại ba trạng thái", () => {
  it("XANH: lỗi do chính `waitTimeoutError` dựng ⇒ là hết-giờ", () => {
    expect(isWaitTimeout(waitTimeoutError(60, "SupplyState mang số mới"))).toBe(true);
  });

  it("ĐỎ: SUPPLY NFT nhân đôi ⇒ KHÔNG phải hết-giờ, đây là hỏng thật", () => {
    // Nguyên văn câu mà `theOneHolding` ném ở cả hai script.
    const e = new Error("cần ĐÚNG 1 UTxO mang SUPPLY NFT (abc…), tìm thấy 2.");
    expect(isWaitTimeout(e)).toBe(false);
  });

  it("ĐỎ: datum vắng mặt ⇒ TypeError, KHÔNG phải hết-giờ", () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'datum')");
    expect(isWaitTimeout(e)).toBe(false);
  });

  it("ĐỎ: thứ ném ra không phải Error ⇒ không được đọc thành hết-giờ", () => {
    // Nhà cung cấp trả rác rồi có chỗ `throw` một chuỗi. Trạng thái mù phải kêu TO HƠN, nên
    // mặc định ở đây là "hỏng thật", không phải "chưa đo được".
    expect(isWaitTimeout(`${WAIT_TIMEOUT_CODE}: hết 60s chờ`)).toBe(false);
    expect(isWaitTimeout(undefined)).toBe(false);
    expect(isWaitTimeout(null)).toBe(false);
  });

  it("ĐỎ: mã nằm GIỮA câu ⇒ không tính — so tiền tố, không so chuỗi con", () => {
    // Đây là ca phân biệt được hai bên đột biến: đổi `startsWith` thành `includes` thì ca này
    // đỏ, và không ca nào khác trong bài đổi màu. Chiều hỏng của `includes` là chiều SAI —
    // nó biến một lỗi bọc lại thành một cảnh báo nhẹ.
    const boc = new Error(`đọc SupplyState hỏng — nguyên nhân gốc: ${WAIT_TIMEOUT_CODE}: hết 60s chờ`);
    expect(isWaitTimeout(boc)).toBe(false);
  });

  it("câu hết-giờ phải tự nói cách đo lại, không chỉ nói là đã hết giờ", () => {
    const msg = waitTimeoutError(60, "kho tăng ≥ 10000 oildrop").message;
    expect(msg).toContain("v2:verify");
    expect(msg).toContain("trước khi kết luận là hỏng");
  });
});

describe("WAIT-TIMEOUT-001 · hai script THẬT SỰ rẽ nhánh theo vị từ", () => {
  const scripts = ["21_vest_to_kho.ts", "22_reserve_draw.ts"] as const;

  for (const f of scripts) {
    it(`${f} gọi isWaitTimeout ở nhánh hậu-gửi`, () => {
      const src = doc(f);
      expect(src).toContain("isWaitTimeout(e)");
      // Hai mã thoát KHÁC NHAU — gộp một mã là quay lại đúng khuyết tật bài này canh.
      expect(src).toContain("process.exitCode = 2");
      expect(src).toContain("process.exitCode = 1");
    });

    it(`${f} KHÔNG in "Xong" khi phép đối chiếu chưa chạy hoặc chưa khớp`, () => {
      const src = doc(f);
      // Đo LỜI GỌI, không đo chuỗi ký tự: chữ "✅ Xong" cũng xuất hiện trong chú thích giải
      // thích chính chốt này, nên `indexOf` trên chuỗi trần bắt nhầm dòng chú thích và bài đỏ
      // trong khi mã đúng. Đại lượng cần đo là "câu lệnh in nằm sau cổng", không phải "chữ nằm
      // sau cổng".
      const goi = /console\.log\(`\\n✅ Xong/g;
      const chiSo = [...src.matchAll(goi)].map((m) => m.index!);
      expect(chiSo.length, "không tìm thấy lời gọi in ✅ Xong nào").toBeGreaterThan(0);

      const cong = src.indexOf("if (process.exitCode === undefined)");
      expect(cong, "không thấy cổng mã thoát").toBeGreaterThan(-1);
      // MỌI lời gọi phải nằm sau cổng — một lời gọi lọt ra ngoài là đủ để hỏng.
      for (const i of chiSo) expect(i).toBeGreaterThan(cong);
    });

    it(`${f} in nhánh HỎNG ra stderr, không ra stdout`, () => {
      // Một dòng hỏng đi ra stdout lẫn vào output bình thường và biến mất khi có ai lọc log.
      expect(doc(f)).toMatch(/console\.error\(\s*\n?\s*`\\n❌ HỎNG/);
    });
  }
});
