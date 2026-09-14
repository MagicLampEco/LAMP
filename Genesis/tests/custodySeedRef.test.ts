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
  assertCustodyKhoPair, assertSeedNotCustody, assertSeedNotSpent, custodySeedRefFromEnv,
  custodySeedRefFromState, refKey, sameRef, txInputKeys,
  reserveKhoParamsFromEnv, type BuiltTx, type DeriveSeedPolicyId, type OutputRef,
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

// ══ CỔNG RESERVE-KHO-003 — đối chứng khe #13 với hạt giống ═══════════════════
//
// VÌ SAO BÀI NÀY TỒN TẠI, VÀ NÓ KHÁC CUSTODY-REF-001 Ở ĐÂU
// CUSTODY-REF-001 chạy ở bước Lớp 2, so cặp dẫn xuất với cặp ĐÃ NƯỚNG trong state — tức sau
// khi giao dịch genesis đã lên chuỗi. Cổng dưới đây chạy TẠI bước genesis, so cặp dẫn xuất
// với BIẾN MÔI TRƯỜNG, trước khi có gì được gửi. Cùng phép đo, hai thời điểm; chỉ cái thứ hai
// còn quay lui được.
//
// Trước bản này, bước genesis chỉ kiểm ĐỊNH DẠNG của `RESERVE_KHO_NFT_POLICY`. Ca
// "policy hợp lệ nhưng của hạt giống KHÁC" bên dưới là ca DUY NHẤT phân biệt được hai cực đó:
// nó ĐỎ với cổng đối chứng, và nó XANH với mọi phép kiểm định dạng.
describe("reserveKhoParamsFromEnv — RESERVE-KHO-001/002/003", () => {
  const SEED = { txHash: TX_A, outputIndex: 3 };
  /** Nhà dẫn xuất giả: policy CHỈ phụ thuộc hạt giống, đúng như `custody_seed` thật. */
  const derivePid: DeriveSeedPolicyId = async (tx, ix) => (tx === TX_A && ix === 3 ? PID_A : PID_B);
  const opts = { derivePid, defaultName: NAME_A };

  it("khớp: trả về cặp đã chuẩn hoá, không ném", async () => {
    await expect(
      reserveKhoParamsFromEnv({ RESERVE_KHO_NFT_POLICY: PID_A.toUpperCase() }, SEED, opts),
    ).resolves.toEqual({ pid: PID_A, name: NAME_A });
  });

  it("ĐỎ: policy ĐÚNG ĐỊNH DẠNG nhưng của hạt giống KHÁC — RESERVE-KHO-003", async () => {
    // PID_B đủ 56 ký tự hex ⇒ qua sạch RESERVE-KHO-001. Chỉ đối chứng mới thấy nó sai.
    await expect(reserveKhoParamsFromEnv({ RESERVE_KHO_NFT_POLICY: PID_B }, SEED, opts))
      .rejects.toThrow(/RESERVE-KHO-003/);
  });

  it("ĐỎ: cùng hạt giống nhưng lệch CHỈ SỐ ⇒ policy khác ⇒ RESERVE-KHO-003", async () => {
    // Chỉ số là một nửa của `OutputReference`. Lệch một đơn vị là ra một policy id khác, và
    // không dòng nào kêu nếu chỉ kiểm định dạng.
    await expect(
      reserveKhoParamsFromEnv(
        { RESERVE_KHO_NFT_POLICY: PID_A }, { txHash: TX_A, outputIndex: 4 }, opts,
      ),
    ).rejects.toThrow(/RESERVE-KHO-003/);
  });

  it("câu lỗi RESERVE-KHO-003 nói CẢ HAI vế và đưa giá trị đúng để dán vào", async () => {
    const loi = await reserveKhoParamsFromEnv({ RESERVE_KHO_NFT_POLICY: PID_B }, SEED, opts)
      .then(() => "", (e: Error) => e.message);
    expect(loi).toContain(`${TX_A}#3`);                        // hạt giống nào
    expect(loi).toContain(PID_B);                              // giá trị đang đặt
    expect(loi).toContain(`RESERVE_KHO_NFT_POLICY=${PID_A}`);  // giá trị đúng, dán được
  });

  it("ĐỎ: chưa đặt policy — RESERVE-KHO-001, và KHÔNG chạy phép dẫn xuất", async () => {
    let goi = 0;
    const dem: DeriveSeedPolicyId = async (tx, ix) => { goi++; return derivePid(tx, ix); };
    await expect(reserveKhoParamsFromEnv({}, SEED, { ...opts, derivePid: dem }))
      .rejects.toThrow(/RESERVE-KHO-001/);
    expect(goi, "cổng định dạng phải chặn TRƯỚC khi chạy phép dẫn xuất").toBe(0);
  });

  it("ĐỎ: asset name không phải hex chẵn byte — RESERVE-KHO-002", async () => {
    await expect(
      reserveKhoParamsFromEnv(
        { RESERVE_KHO_NFT_POLICY: PID_A, RESERVE_KHO_NFT_NAME: "abc" }, SEED, opts,
      ),
    ).rejects.toThrow(/RESERVE-KHO-002/);
  });
});

// ══ SEED-CHON-DONG-001 / -003 — hạt giống phải SỐNG SÓT qua mọi bước trước L2a ══
//
// VÌ SAO BÀI NÀY TỒN TẠI
// Cổng canh chọn-đồng trước đây chỉ có ở `20_canonical_genesis.ts`, tức bước ĐẦU. Giữa nó và
// bước L2a (chỗ hạt giống ĐƯỢC PHÉP tiêu) còn ba giao dịch có gửi thật — `20b` · `21` · `22` —
// và cả ba gọi `.complete()`, tức chạy chọn-đồng mặc định trên toàn bộ ví. Tiêu nhầm ở một
// trong ba bước đó thì bước ấy vẫn thành công, và policy khe #13 chết vĩnh viễn.
//
// (`23_prove_oneshot.ts` KHÔNG nằm trong danh sách: nó dựng giao dịch trong `try` rồi cố ý
// không ký và không gửi — đo được, 0 lần `.submit()`, 0 lần `sign.withWallet`.)
//
// ĐỘT BIẾN PHÂN BIỆT ĐƯỢC HAI CỰC: gỡ `assertSeedNotSpent` ở bất kỳ bước nào ⇒ giao dịch tiêu
// hạt giống đi lọt, và không phép kiểm định dạng nào kêu vì mọi giá trị đều đúng hình dạng.

/** Một `TxInputList` giả lập từ danh sách khoá `txHash#index`. */
const danhSach = (keys: string[]) => {
  const list = keys.map((k) => {
    const [h, i] = k.split("#");
    return { transaction_id: () => ({ to_hex: () => h as string }), index: () => Number(i) };
  });
  return { len: () => list.length, get: (n: number) => list[n]! };
};

function txVoi(...keys: string[]): BuiltTx {
  return { toTransaction: () => ({ body: () => ({ inputs: () => danhSach(keys) }) }) };
}

/**
 * Giao dịch có CẢ HAI trường: input chi tiêu và input collateral.
 *
 * Phải dựng riêng vì `collateral_inputs` là accessor TÙY CHỌN trên `BuiltTx` — một stub chỉ khai
 * `inputs()` vẫn hợp kiểu, và đó đúng là hình dạng làm cổng collateral xanh ở cả hai cực nếu
 * không có ca nào đưa vào trường thứ hai.
 */
function txVoiTheChap(chiTieu: string[], theChap: string[]): BuiltTx {
  return {
    toTransaction: () => ({
      body: () => ({
        inputs: () => danhSach(chiTieu),
        collateral_inputs: () => danhSach(theChap),
      }),
    }),
  };
}

const KHAC = "9".repeat(64);
const SEED_REF: OutputRef = { txHash: TX_A, outputIndex: 3 };

describe("txInputKeys + assertSeedNotSpent — SEED-CHON-DONG-001", () => {
  it("đọc ĐỦ mọi input, đúng thứ tự, và chuẩn hoá chữ hoa", () => {
    expect(txInputKeys(txVoi(`${TX_A.toUpperCase()}#0`, `${KHAC}#7`)))
      .toEqual([`${TX_A}#0`, `${KHAC}#7`]);
  });

  it("giao dịch KHÔNG chạm hạt giống → im", () => {
    expect(() => assertSeedNotSpent(txVoi(`${KHAC}#3`, `${TX_A}#4`), SEED_REF, "b")).not.toThrow();
  });

  // Hai ca dưới là hai nửa của `OutputReference`. Bỏ một nửa khỏi phép so thì cổng vẫn xanh ở
  // ca kia, và người đọc thấy đúng màu.
  it("ĐỎ: input trùng CẢ hash lẫn chỉ số — SEED-CHON-DONG-001", () => {
    expect(() => assertSeedNotSpent(txVoi(`${KHAC}#0`, `${TX_A}#3`), SEED_REF, "Tx B"))
      .toThrow(/SEED-CHON-DONG-001/);
  });

  it("trùng hash mà LỆCH chỉ số → KHÔNG phải hạt giống, phải im", () => {
    expect(() => assertSeedNotSpent(txVoi(`${TX_A}#2`), SEED_REF, "b")).not.toThrow();
  });

  it("câu lỗi nêu TÊN BƯỚC và liệt kê input — đủ để biết hỏng ở đâu", () => {
    const loi = (() => {
      try { assertSeedNotSpent(txVoi(`${TX_A}#3`), SEED_REF, "Tx C (22 ReserveDraw)"); return ""; }
      catch (e) { return e instanceof Error ? e.message : String(e); }
    })();
    expect(loi).toContain("Tx C (22 ReserveDraw)");
    expect(loi).toContain(refKey(SEED_REF));
  });

  // ── Đường TIÊU thứ hai: collateral ────────────────────────────────────────
  //
  // `collateral_inputs` là trường RIÊNG, không nằm trong `inputs()`. Nó chỉ bị ledger nuốt khi
  // giao dịch trượt pha 2 — nhánh thất bại, nhánh không ai nhìn. Bộ chọn collateral của thư viện
  // quét toàn bộ UTxO ví và không biết gì về hạt giống custody.
  it("ĐỎ: hạt giống bị ghim làm COLLATERAL ⇒ SEED-CHON-DONG-004, dù KHÔNG bị chi tiêu", () => {
    // Đây là hình dạng đã tái hiện trên Emulator: inputs trỏ một UTxO khác, collateral trỏ
    // đúng hạt giống. Cổng chỉ đọc `inputs()` im lặng ở đúng ca này.
    expect(() =>
      assertSeedNotSpent(txVoiTheChap([`${KHAC}#1`], [`${TX_A}#3`]), SEED_REF, "Tx B (21 vest → kho)"),
    ).toThrow(/SEED-CHON-DONG-004/);
  });

  it("câu lỗi collateral phải nói CÁCH SỬA khác với ca chi tiêu", () => {
    // Hai ca cần hai hành động khác nhau: chi tiêu thì gộp ADA cho chọn-đồng; collateral thì
    // phải cho ví một UTxO thuần ADA khác để bộ chọn bám vào. Một câu lỗi chung cho cả hai là
    // gửi người chạy đi sửa sai chỗ.
    const loi = (() => {
      try { assertSeedNotSpent(txVoiTheChap([`${KHAC}#1`], [`${TX_A}#3`]), SEED_REF, "b"); return ""; }
      catch (e) { return e instanceof Error ? e.message : String(e); }
    })();
    expect(loi).toContain("collateral");
    expect(loi).toContain("trượt pha 2");
  });

  it("collateral trỏ UTxO KHÁC → im, cổng không bắt bừa mọi collateral", () => {
    expect(() =>
      assertSeedNotSpent(txVoiTheChap([`${KHAC}#1`], [`${KHAC}#0`]), SEED_REF, "b"),
    ).not.toThrow();
  });

  it("giao dịch KHÔNG khai collateral (accessor vắng mặt) vẫn đi qua được", () => {
    // `txVoi` không khai `collateral_inputs`. Vắng accessor ≠ collateral rỗng ≠ hạt giống nằm
    // trong collateral — ca này giữ cho phép đọc tùy chọn không biến thành lỗi cho mọi bước.
    expect(() => assertSeedNotSpent(txVoi(`${KHAC}#1`), SEED_REF, "b")).not.toThrow();
  });

  // ── Trạng thái MÙ ─────────────────────────────────────────────────────────
  it("ĐỎ: danh sách input RỖNG ⇒ SEED-CHON-DONG-002, không được đọc thành 'sạch'", () => {
    // Một tx đã `.complete()` luôn có ≥1 input. Rỗng nghĩa là phép đọc hỏng — và `includes`
    // trên mảng rỗng trả `false`, tức cổng nói "ổn" bằng đúng giọng của trạng thái không biết.
    expect(() => assertSeedNotSpent(txVoi(), SEED_REF, "Tx A (genesis)"))
      .toThrow(/SEED-CHON-DONG-002/);
  });
});

describe("custodySeedRefFromState — SEED-CHON-DONG-003", () => {
  it("state có ghi → đó là nguồn, và nói rõ nguồn là state", () => {
    const r = custodySeedRefFromState(SEED_REF, {});
    expect(r.source).toBe("state");
    expect(refKey(r.ref)).toBe(refKey(SEED_REF));
  });

  it("state có ghi + env TRÙNG → im, vẫn dùng state", () => {
    const r = custodySeedRefFromState(SEED_REF, { CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "3" });
    expect(r.source).toBe("state");
  });

  // Ca này là toàn bộ điểm của cổng -003: hai nguồn bất đồng là trạng thái MÙ. Cổng không được
  // tự chọn hộ — chọn hộ là biến một lần gõ sai thành một quyết định im lặng.
  it("ĐỎ: state và env LỆCH chỉ số → SEED-CHON-DONG-003, không tự chọn hộ", () => {
    expect(() => custodySeedRefFromState(SEED_REF, { CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "4" }))
      .toThrow(/SEED-CHON-DONG-003/);
  });

  it("ĐỎ: state và env LỆCH hash → SEED-CHON-DONG-003", () => {
    expect(() => custodySeedRefFromState(SEED_REF, { CUSTODY_SEED_TX: KHAC, CUSTODY_SEED_IDX: "3" }))
      .toThrow(/SEED-CHON-DONG-003/);
  });

  // State ghi TRƯỚC đợt vá này không có trường đó. Đường lùi là env — và env tự ném khi trống,
  // nên không có đường nào đi tiếp mà KHÔNG có hạt giống.
  it("state thiếu trường → lùi về env, và khai rõ nguồn là env", () => {
    const r = custodySeedRefFromState(undefined, { CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "3" });
    expect(r.source).toBe("env");
    expect(refKey(r.ref)).toBe(refKey(SEED_REF));
  });

  it("ĐỎ: state thiếu VÀ env trống → CUSTODY-SEED-001, không có đường đi tiếp", () => {
    expect(() => custodySeedRefFromState(undefined, {})).toThrow(/CUSTODY-SEED-001/);
  });

  // Hình dạng hỏng trong state KHÔNG được đọc thành "có giá trị", VÀ KHÔNG được lùi im lặng
  // về env. Bản đầu của ca này khẳng định `source === "env"` là đúng ý đồ — nó ghim một hành vi
  // fail-open: phép đối chiếu -003 nằm BÊN TRONG nhánh state-đọc-được, nên state hỏng cộng env
  // trỏ một hạt giống KHÁC thì không vế nào bất đồng với vế nào, và ba bước sau canh nhầm một
  // UTxO đã chết. Nay tách: vắng mặt → lùi (đúng); có mặt mà hỏng → ném.
  it("ĐỎ: state có trường nhưng hash SAI HÌNH DẠNG ⇒ SEED-CHON-DONG-005, KHÔNG lùi về env", () => {
    expect(() =>
      custodySeedRefFromState(
        { txHash: "abc", outputIndex: 3 }, { CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "3" },
      ),
    ).toThrow(/SEED-CHON-DONG-005/);
  });

  // Ca này phân biệt hai cực mà ca trên KHÔNG phân biệt: env ở đây trỏ ĐÚNG hạt giống của
  // state. Một cổng "lùi về env rồi so" sẽ thấy hai vế khớp và im. Chỉ cổng ném-khi-state-hỏng
  // mới đỏ ở đây — tức nó đo "state có đọc được không", không đo "hai vế có khớp không".
  it("ĐỎ: state hỏng vẫn ném kể cả khi env trỏ đúng giá trị mong đợi", () => {
    expect(() =>
      custodySeedRefFromState(
        { txHash: `${TX_A}ff`, outputIndex: 0 }, { CUSTODY_SEED_TX: TX_A, CUSTODY_SEED_IDX: "0" },
      ),
    ).toThrow(/SEED-CHON-DONG-005/);
  });

  it("ĐỎ: state có trường nhưng chỉ số ÂM ⇒ SEED-CHON-DONG-005, không phải CUSTODY-SEED-001", () => {
    // Bản đầu ném CUSTODY-SEED-001 — câu lỗi đó chỉ nói về `CUSTODY_SEED_TX`/`IDX`, tức bảo
    // người chạy đi sửa env trong khi thứ hỏng là tệp trạng thái. Nhãn phải mang đúng nguyên
    // nhân, không mang nguyên nhân của nhánh kế bên.
    expect(() => custodySeedRefFromState({ txHash: TX_A, outputIndex: -1 }, {}))
      .toThrow(/SEED-CHON-DONG-005/);
  });

  // `envSet` phải đo CẢ CẶP biến. Đo mỗi `CUSTODY_SEED_TX` thì đặt lẻ `CUSTODY_SEED_IDX` làm
  // cổng đối chiếu tắt im lặng. Đột biến phân biệt được: đổi `envSet` sang chỉ đo `TX` ⇒ ca này
  // chuyển từ ném sang trả về state, tức xanh sai.
  it("ĐỎ: env đặt LẺ nửa chỉ số (thiếu CUSTODY_SEED_TX) vẫn phải kích hoạt phép đối chiếu", () => {
    expect(() =>
      custodySeedRefFromState({ txHash: TX_A, outputIndex: 0 }, { CUSTODY_SEED_IDX: "0" }),
    ).toThrow(/CUSTODY-SEED-001/);
  });
});
