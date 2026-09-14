// Cổng RANH-GIỚI-GÓI — `deriveCustody()` chạy THẬT, hết đường, ra địa chỉ kho.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// `deriveCustody()` là hàm duy nhất vắt qua ranh giới hai gói: nó sống ở `Genesis/scripts`
// nhưng gọi `treasuryStakeParamList` của `Treasury/offchain`. Hai thư mục có hai bản cài
// `@lucid-evolution/plutus` riêng — đó là gói giữ lớp `Constr`, KHÔNG phải
// `@lucid-evolution/lucid` — và chúng mang CÙNG số hiệu phiên bản, nên hai class khác danh
// tính mà không có gì trên bề mặt nói thế. Một `Constr` dựng ở gói kia đi vào
// `applyParamsToScript` của gói này ném:
//
//     Could not serialize the data: Error: Unsupported type
//
// Câu lỗi đó không nhắc một chữ nào tới hai bản cài, và nó nổ ở một tệp khác hẳn tệp có lỗi.
//
// ĐIỀU LÀM BÀI NÀY CẦN THIẾT: trước nó, KHÔNG tệp kiểm nào gọi `deriveCustody`. Mọi ca của
// `stakeBuilder.test.ts` chạy TRỌN VẸN TRONG gói Treasury — tức chúng xanh ở cả hai cực của
// đúng cái đột biến này, nên chúng không đo được nó. Lớp lỗi chỉ lộ ra ở một lần chạy thật
// trên chuỗi, sau khi đã tiêu phí.
//
// PHÉP ĐO ĐẢO: gỡ tham số `mkConstr` ở `Treasury/offchain/src/stakeBuilder.ts` rồi cho hàm
// tự dựng `new Constr(...)` của gói nó ⇒ ca đầu tiên dưới đây ĐỎ với đúng câu
// "Unsupported type". Đó là hai bên đột biến mà đầu vào của ca này phân biệt được.
import { describe, it, expect } from "vitest";
import { getAddressDetails, fromText } from "@lucid-evolution/lucid";
import { custodySeedPolicyId, deriveCustody } from "../scripts/_reserve_layer2.js";

/** UTxO hạt giống — giá trị bất kỳ, chỉ cần đúng hình dạng: 32 byte + chỉ số. */
const SEED_TX = "1".repeat(64);
const SEED_IX = 0;

/** policy id + asset name của tLAMP. Hai khe này nướng vào hash `custody`. */
const LAMP_PID = "aa".repeat(28);
const TLAMP_NAME = "744c414d50"; // "tLAMP"
/** pkh 28 byte được phép uỷ quyền phần stake. Nướng vào hash `treasury_stake`. */
const ADMIN_PKH = "5e".repeat(28);

const base = {
  lampPid: LAMP_PID,
  tokenName: TLAMP_NAME,
  network: "Preprod" as const,
  delegationAdminPkh: ADMIN_PKH,
};

describe("deriveCustody — lời gọi vắt qua ranh giới hai gói", () => {
  it("chạy hết đường và trả địa chỉ kho dạng BASE", async () => {
    const w = await deriveCustody(SEED_TX, SEED_IX, base);

    // Địa chỉ kho phải có ĐỦ HAI phần. Enterprise (thiếu phần stake) là một cái kho vĩnh
    // viễn không uỷ quyền được, và `custody.ak` ghim `cust_out.address == cust_in.address`
    // nên không tx nào dời nó sang base sau đó.
    const d = getAddressDetails(w.custodyAddr);
    expect(d.paymentCredential?.hash, "phần payment phải là hash `custody`").toBe(w.custodyHash);
    expect(d.stakeCredential?.hash, "ĐỊA CHỈ ENTERPRISE — thiếu phần stake").toBe(w.treasuryStakeHash);
    expect(d.stakeCredential?.type).toBe("Script");

    // Hash hợp lệ = 28 byte. Một script áp thiếu tham số vẫn ra hash, nên đây chỉ là chốt
    // hình dạng; chốt "đủ tham số" nằm ở cổng APPLY-001/002 trong chính `applyOf`.
    expect(w.custodyHash).toMatch(/^[0-9a-f]{56}$/);
    expect(w.treasuryStakeHash).toMatch(/^[0-9a-f]{56}$/);
    expect(w.custodySeedPid).toMatch(/^[0-9a-f]{56}$/);

    // KHÔNG kiểm `custodyNftUnit.startsWith(custodySeedPid)` — đó là hằng đúng theo dựng
    // (`custodyNftUnit = toUnit(custodySeedPid, INSTANCE_ID)`), không đột biến nào làm nó đỏ.
    // Thứ đo được là phần asset name: nó phải là `instance_id` thật, vì `custody_seed.ak`
    // luật S-PARAM-0 ép `datum.instance_id == nft_name`, hai chỗ lệch thì tx đúc bị từ chối.
    expect(w.custodyNftUnit.slice(56)).toBe(fromText("lamp-reserve"));
  });

  // `delegation_admin` nướng vào hash `treasury_stake` ⟹ vào PHẦN STAKE của địa chỉ kho.
  // Khe không thật sự đi vào hash thì hai instance khác quyền uỷ quyền dùng chung một kho,
  // và không có gì kêu. Ca này phân biệt hai cực đó.
  it("đổi delegation_admin ⇒ đổi phần stake ⇒ đổi địa chỉ kho", async () => {
    const a = await deriveCustody(SEED_TX, SEED_IX, base);
    const b = await deriveCustody(SEED_TX, SEED_IX, { ...base, delegationAdminPkh: "7c".repeat(28) });

    expect(b.custodyHash, "phần payment KHÔNG được đổi theo khe của treasury_stake")
      .toBe(a.custodyHash);
    expect(b.treasuryStakeHash).not.toBe(a.treasuryStakeHash);
    expect(b.custodyAddr).not.toBe(a.custodyAddr);
  });

  // `delegationAdminPkh` cố ý KHÔNG có mặc định: nó quyết ai được uỷ quyền phần stake của
  // kho. Một mặc định im lặng ở đây là một quyết định về quyền được đưa ra bởi việc KHÔNG
  // gõ gì.
  //
  // ⚠ MỖI CA PHẢI KHỚP CHÍNH MÃ LỖI CỦA CHỐT NÓ CANH. Bản đầu của ba ca dưới đây viết
  // `rejects.toThrow()` không mẫu, và phép đo đảo cho thấy nó KHÔNG ghim gì: gỡ HẲN cả hai
  // cổng `TSTAKE-ADMIN-001`/`-002` ở `_reserve_layer2.ts` rồi chạy trọn bộ kiểm Genesis vẫn
  // ra 262 passed | 3 skipped. Ngoại lệ trượt xuống `TSTAKE-005` bên gói Treasury (sai độ
  // dài) và chết ở đó — ĐÚNG MÀU, ĐÚNG TÊN BÀI, và chứng minh không điều gì.
  it("ĐỎ: thiếu delegation_admin — TSTAKE-ADMIN-001, không tự điền", async () => {
    await expect(deriveCustody(SEED_TX, SEED_IX, { ...base, delegationAdminPkh: "" }))
      .rejects.toThrow(/TSTAKE-ADMIN-001/);
  });

  // Giá trị CHẾT: đúng hình dạng, không có tiền ảnh blake2b-224 ⇒ không chữ ký nào thoả
  // nhánh `publish`. Cổng độ dài cho nó đi lọt, nên nó cần một chốt riêng và một ca riêng.
  it("ĐỎ: delegation_admin toàn 0 / toàn f — TSTAKE-ADMIN-002", async () => {
    for (const chet of ["0".repeat(56), "f".repeat(56)]) {
      await expect(deriveCustody(SEED_TX, SEED_IX, { ...base, delegationAdminPkh: chet }))
        .rejects.toThrow(/TSTAKE-ADMIN-002/);
    }
  });

  // POISON-002 fail-closed trên mạng thật. Mọi ca trên đặt `network: "Preprod"` nên nhánh
  // Mainnet không lượt nào chạm — tức chốt đó đang KHÔNG ĐO ĐƯỢC, không phải đang xanh.
  it("ĐỎ: chạy Mainnet với proposal_policy là giá trị chết — POISON-002", async () => {
    await expect(deriveCustody(SEED_TX, SEED_IX, { ...base, network: "Mainnet" }))
      .rejects.toThrow(/POISON-002/);
  });
});

// ══ `custodySeedPolicyId` — nguồn của cổng đối chứng RESERVE-KHO-003 ═══════════
//
// Cổng RESERVE-KHO-003 ở bước genesis so `RESERVE_KHO_NFT_POLICY` với giá trị hàm này trả về.
// Cổng ấy chỉ có nghĩa nếu giá trị nó đo TRÙNG giá trị thật sẽ được đúc ở bước Lớp 2 — nên
// hai bài dưới đây ghim đúng chỗ hai bên có thể trôi khỏi nhau.
describe("custodySeedPolicyId", () => {
  // ĐỘT BIẾN NÀY PHÂN BIỆT ĐƯỢC HAI CỰC: hiện thực lại phép dẫn xuất trong `custodySeedPolicyId`
  // (thay vì gọi chung `custodySeedScript`) ⇒ hai giá trị vẫn đều là hash 28 byte hợp lệ, mọi
  // bài kiểm định dạng vẫn xanh, và cổng đối chứng vẫn "khớp" — với một giá trị KHÔNG phải cái
  // được đúc.
  //
  // ĐÃ CHẠY THẬT, không phải suy luận (2026-09-14): cho `custodySeedPolicyId` dẫn xuất theo
  // `custodyIndex + 1` — vẫn ra một policy id 28 byte hợp lệ, chỉ khác cái `deriveCustody` dùng.
  // Chạy trọn bộ kiểm Genesis: `1 failed | 292 passed | 3 skipped (296)`, và ca đỏ duy nhất là
  // ca ngay dưới đây. Bản đầu của chú thích này khẳng định "chỉ ca này đỏ" mà CHƯA chạy phép
  // đo — đúng thứ mà "có bài đỏ ở chốt X ≠ chốt X được ghim" cảnh báo.
  it("TRÙNG KHÍT `deriveCustody().custodySeedPid` — cùng một nguồn dẫn xuất", async () => {
    const w = await deriveCustody(SEED_TX, SEED_IX, base);
    expect(await custodySeedPolicyId(SEED_TX, SEED_IX)).toBe(w.custodySeedPid);
  });

  // Hai nửa của `OutputReference`, mỗi nửa một ca. Khe nào không thật sự đi vào hash thì cổng
  // RESERVE-KHO-003 ở trên "khớp" cho cả những hạt giống nó phải từ chối.
  it("đổi hash HOẶC đổi chỉ số → policy id ĐỔI", async () => {
    const goc = await custodySeedPolicyId(SEED_TX, SEED_IX);
    expect(await custodySeedPolicyId("2".repeat(64), SEED_IX)).not.toBe(goc);
    expect(await custodySeedPolicyId(SEED_TX, SEED_IX + 1)).not.toBe(goc);
  });
});

// ══ NỐI THẬT: cổng khe #13-14 chạy với phép dẫn xuất THẬT ═══════════════════════
//
// VÌ SAO CẦN CA NÀY DÙ ĐÃ CÓ BÀI ĐƠN VỊ
// Bộ ca của `reserveKhoParamsFromEnv` ở `custodySeedRef.test.ts` truyền một nhà dẫn xuất DỰNG
// TẠI CHỖ. Nó đo được logic của cổng, và KHÔNG đo được thứ quan trọng không kém: hai đầu có
// khớp nhau không. Một cổng logic đúng, nối vào một nguồn sai, vẫn "khớp" — với một giá trị
// không phải cái sẽ được đúc. Đây là lớp lỗi mà mọi bài dùng hàng giả đều xanh ở cả hai cực.
//
// Ca này nối `custodySeedPolicyId` thật (đọc blueprint từ đĩa, apply-param thật) vào cổng thật,
// với `INSTANCE_ID` thật — tức đúng bộ ba mà `20_canonical_genesis.ts` truyền vào lúc chạy.
import { INSTANCE_ID } from "../scripts/_reserve_layer2.js";
import { reserveKhoParamsFromEnv } from "../scripts/_custodySeedRef.js";

describe("reserveKhoParamsFromEnv nối phép dẫn xuất THẬT", () => {
  const SEED = { txHash: SEED_TX, outputIndex: SEED_IX };
  const opts = { derivePid: custodySeedPolicyId, defaultName: INSTANCE_ID };

  it("policy ĐÚNG của hạt giống đang cầm → đi qua, và trả về đúng cặp #13-14", async () => {
    const pid = await custodySeedPolicyId(SEED_TX, SEED_IX);
    const r = await reserveKhoParamsFromEnv({ RESERVE_KHO_NFT_POLICY: pid }, SEED, opts);
    expect(r.pid).toBe(pid);
    expect(r.name).toBe(INSTANCE_ID);
  });

  // Ca hỏng THẬT của thực địa: chép policy từ một lượt chạy trước trong khi hạt giống đã đổi.
  // Giá trị chép về luôn đúng định dạng — vì nó từng là một giá trị thật.
  it("ĐỎ: policy của hạt giống KHÁC → RESERVE-KHO-003, dù đúng định dạng 56 hex", async () => {
    const pidKhac = await custodySeedPolicyId("7".repeat(64), SEED_IX);
    expect(pidKhac).toMatch(/^[0-9a-f]{56}$/);
    await expect(reserveKhoParamsFromEnv({ RESERVE_KHO_NFT_POLICY: pidKhac }, SEED, opts))
      .rejects.toThrow(/RESERVE-KHO-003/);
  });

  // Khe #14 nối thật: `INSTANCE_ID` là giá trị `custodySeedDatum()` gán cứng, và
  // `custody_seed.ak` luật S-PARAM-0 ép NFT mang đúng tên đó.
  it("ĐỎ: asset name khác INSTANCE_ID thật → RESERVE-KHO-004", async () => {
    const pid = await custodySeedPolicyId(SEED_TX, SEED_IX);
    await expect(
      reserveKhoParamsFromEnv(
        { RESERVE_KHO_NFT_POLICY: pid, RESERVE_KHO_NFT_NAME: "6c616d702d7265736572766f" },
        SEED, opts,
      ),
    ).rejects.toThrow(/RESERVE-KHO-004/);
  });
});
