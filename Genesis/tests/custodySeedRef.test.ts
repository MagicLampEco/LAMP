// Cổng CUSTODY-REF-001 / CUSTODY-SEED-001 / SEED-002 — hạt giống custody.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// Khe #13 `reserve_kho_nft_policy` của `lamp_mint` là policy id của `custody_seed` áp trên MỘT
// UTxO cụ thể, và nó nướng vào policy-id lúc apply-param. Bước Lớp 2 phải tiêu ĐÚNG UTxO đó.
// Bản trước để `24_reserve_layer2_init.ts` tự chọn hạt giống; chọn trượt thì cả hai lượt đúc
// vẫn thành công, chỉ có điều policy trong khe #13 không bao giờ đúc được nữa và nhánh
// `ReserveDraw` của token vừa đúc chết vĩnh viễn — không cổng nào kêu.
//
// Cổng APPLY-003 (`offchain/src/reserveKhoPair.ts`) đo cùng chuyện đó nhưng chạy ở bước L2b,
// tức SAU khi L2a đã đúc custody NFT lên chuỗi. Cổng đo đúng đặt sai chỗ thì nó là bản cáo phó.
//
// BA TRẠNG THÁI, VÀ CÁI BẪY Ở TRẠNG THÁI THỨ BA
// Bài đo cả ba: khớp (im) · lệch (ném) · KHÔNG ĐỌC ĐƯỢC (ném). Ca quan trọng nhất là
// "hai vế cùng rỗng": một phép so `===` trần trả về BẰNG NHAU ở đúng ca đó, nên một cổng viết
// bằng `===` sẽ xanh trong khi nó chưa đo được gì. Ca đó có bài riêng bên dưới, và nó là ca
// DUY NHẤT phân biệt được cổng thật với một phép so trần.
import { describe, it, expect } from "vitest";
import {
  assertCustodyKhoPair, assertSeedNotCustody, custodySeedRefFromEnv, refKey, sameRef,
} from "../scripts/_custodySeedRef.js";

/** policy id 28 byte hợp lệ (56 hex). Hai cái KHÁC NHAU để phân biệt được hai cực. */
const PID_A = "aa".repeat(28);
const PID_B = "bb".repeat(28);
/** `instance_id` = asset name kho, hex của "lamp-reserve". */
const NAME_A = "6c616d702d72657365727665";
const NAME_B = "6c616d702d7265736572766f"; // lệch ĐÚNG một byte cuối

const TX_A = "1".repeat(64);
const TX_B = "2".repeat(64);

describe("CUSTODY-REF-001 — cặp kho dẫn xuất phải trùng cặp đã nướng vào lamp_mint", () => {
  it("KHỚP: không ném", () => {
    expect(() =>
      assertCustodyKhoPair({ policy: PID_A, name: NAME_A }, { policy: PID_A, name: NAME_A }),
    ).not.toThrow();
  });

  it("KHỚP dù hoa/thường khác nhau: hex không phân biệt hoa thường, bytes vẫn y hệt", () => {
    expect(() =>
      assertCustodyKhoPair(
        { policy: PID_A.toUpperCase(), name: NAME_A.toUpperCase() },
        { policy: PID_A, name: NAME_A },
      ),
    ).not.toThrow();
  });

  it("LỆCH policy: ném CUSTODY-REF-001 và nói rõ là LỆCH", () => {
    expect(() =>
      assertCustodyKhoPair({ policy: PID_A, name: NAME_A }, { policy: PID_B, name: NAME_A }),
    ).toThrow(/CUSTODY-REF-001.*LỆCH/s);
  });

  it("LỆCH name một byte: vẫn ném — đây là ca APPLY-001 đếm tham số không thấy gì", () => {
    expect(() =>
      assertCustodyKhoPair({ policy: PID_A, name: NAME_A }, { policy: PID_A, name: NAME_B }),
    ).toThrow(/CUSTODY-REF-001.*LỆCH/s);
  });

  // ⚠ CA QUYẾT ĐỊNH. Đây là ca duy nhất phân biệt cổng thật với một phép so `===` trần:
  // `"" === ""` là `true`, nên một cổng so trần sẽ IM LẶNG cho qua đúng lúc cả hai chỗ đều
  // chưa điền. Hai chỗ chưa điền không phải "khớp", nó là trạng thái MÙ.
  it("HAI VẾ CÙNG RỖNG: ném KHÔNG ĐỌC ĐƯỢC, KHÔNG được đọc thành khớp", () => {
    expect(() =>
      assertCustodyKhoPair({ policy: "", name: "" }, { policy: "", name: "" }),
    ).toThrow(/CUSTODY-REF-001.*KHÔNG ĐỌC ĐƯỢC/s);
  });

  it("HAI VẾ CÙNG undefined: cũng là trạng thái mù, ném", () => {
    expect(() => assertCustodyKhoPair(undefined, undefined))
      .toThrow(/CUSTODY-REF-001.*KHÔNG ĐỌC ĐƯỢC/s);
  });

  it("vế dẫn xuất rỗng còn vế đã nướng đủ: ném KHÔNG ĐỌC ĐƯỢC (không phải LỆCH)", () => {
    expect(() => assertCustodyKhoPair({ policy: "", name: "" }, { policy: PID_A, name: NAME_A }))
      .toThrow(/KHÔNG ĐỌC ĐƯỢC/);
  });

  it("policy đúng hex nhưng 27 byte: sai hình dạng ⇒ KHÔNG ĐỌC ĐƯỢC", () => {
    expect(() =>
      assertCustodyKhoPair({ policy: "aa".repeat(27), name: NAME_A }, { policy: PID_A, name: NAME_A }),
    ).toThrow(/KHÔNG ĐỌC ĐƯỢC/);
  });

  it("name độ dài lẻ: không phải hex byte ⇒ KHÔNG ĐỌC ĐƯỢC", () => {
    expect(() =>
      assertCustodyKhoPair({ policy: PID_A, name: "abc" }, { policy: PID_A, name: "abc" }),
    ).toThrow(/KHÔNG ĐỌC ĐƯỢC/);
  });

  it("vế đã nướng thiếu hẳn (state cũ chưa có khe #13-14): ném, không bù giá trị", () => {
    expect(() => assertCustodyKhoPair({ policy: PID_A, name: NAME_A }, undefined))
      .toThrow(/lamp_mint\.reserve_kho_nft \(#13-14\) KHÔNG có/);
  });
});

describe("CUSTODY-SEED-001 — đọc hạt giống custody từ biến môi trường", () => {
  it("đủ và đúng hình dạng: trả về OutputRef", () => {
    expect(custodySeedRefFromEnv({ CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "3" }))
      .toEqual({ txHash: TX_A, outputIndex: 3 });
  });

  it("chỉ số 0 là giá trị HỢP LỆ, không được lẫn với 'chưa đặt'", () => {
    expect(custodySeedRefFromEnv({ CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "0" }).outputIndex)
      .toBe(0);
  });

  it("hash viết HOA: chuẩn hoá về thường, không ném", () => {
    expect(custodySeedRefFromEnv({ CUSTODY_SEED_TX: "AB".repeat(32), CUSTODY_SEED_IDX: "1" }).txHash)
      .toBe("ab".repeat(32));
  });

  it("thiếu hẳn CUSTODY_SEED_TX: ném CUSTODY-SEED-001", () => {
    expect(() => custodySeedRefFromEnv({ CUSTODY_SEED_IDX: "0" }))
      .toThrow(/CUSTODY-SEED-001.*CUSTODY_SEED_TX/s);
  });

  it("CUSTODY_SEED_TX rỗng: ném — rỗng KHÔNG phải mặc định", () => {
    expect(() => custodySeedRefFromEnv({ CUSTODY_SEED_TX: "", CUSTODY_SEED_IDX: "0" }))
      .toThrow(/CUSTODY-SEED-001/);
  });

  it("CUSTODY_SEED_TX 63 ký tự: đúng loại ký tự, sai độ dài ⇒ vẫn ném", () => {
    expect(() => custodySeedRefFromEnv({ CUSTODY_SEED_TX: "a".repeat(63), CUSTODY_SEED_IDX: "0" }))
      .toThrow(/CUSTODY-SEED-001/);
  });

  it("thiếu CUSTODY_SEED_IDX: ném — KHÔNG mặc định về 0", () => {
    expect(() => custodySeedRefFromEnv({ CUSTODY_SEED_TX: TX_A }))
      .toThrow(/CUSTODY-SEED-001.*CUSTODY_SEED_IDX/s);
  });

  it("CUSTODY_SEED_IDX âm: ném", () => {
    expect(() => custodySeedRefFromEnv({ CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "-1" }))
      .toThrow(/CUSTODY-SEED-001/);
  });

  it("CUSTODY_SEED_IDX không phải số: ném", () => {
    expect(() => custodySeedRefFromEnv({ CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "1a" }))
      .toThrow(/CUSTODY-SEED-001/);
  });
});

describe("SEED-002 — hạt giống khác không được trùng hạt giống custody", () => {
  it("khác UTxO: im lặng", () => {
    expect(() =>
      assertSeedNotCustody(
        { txHash: TX_B, outputIndex: 0 }, { txHash: TX_A, outputIndex: 0 }, "hạt giống genesis",
      ),
    ).not.toThrow();
  });

  // Hai cực phân biệt được: cùng hash, KHÁC chỉ số ⇒ hai UTxO khác nhau ⇒ hợp lệ.
  // Không có ca này thì một cổng so mỗi `txHash` cũng xanh hết.
  it("cùng txHash nhưng khác outputIndex: là HAI UTxO ⇒ im lặng", () => {
    expect(() =>
      assertSeedNotCustody(
        { txHash: TX_A, outputIndex: 1 }, { txHash: TX_A, outputIndex: 0 }, "hạt giống genesis",
      ),
    ).not.toThrow();
  });

  it("trùng hệt: ném SEED-002 kèm khoá UTxO đọc được", () => {
    expect(() =>
      assertSeedNotCustody(
        { txHash: TX_A, outputIndex: 2 }, { txHash: TX_A, outputIndex: 2 }, "hạt giống genesis",
      ),
    ).toThrow(/SEED-002.*hạt giống genesis.*#2/s);
  });
});

describe("refKey / sameRef — khuôn so UTxO dùng chung", () => {
  it("refKey ra dạng txHash#index và chuẩn hoá hoa thường", () => {
    expect(refKey({ txHash: TX_A.toUpperCase(), outputIndex: 7 })).toBe(`${TX_A}#7`);
  });

  it("sameRef phân biệt chỉ số", () => {
    expect(sameRef({ txHash: TX_A, outputIndex: 0 }, { txHash: TX_A, outputIndex: 0 })).toBe(true);
    expect(sameRef({ txHash: TX_A, outputIndex: 0 }, { txHash: TX_A, outputIndex: 1 })).toBe(false);
  });
});
