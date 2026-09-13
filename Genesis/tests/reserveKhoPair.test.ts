// Cổng APPLY-003 — ép `reserve_draw.kho_nft_*` (#6-7) TRÙNG `lamp_mint.reserve_kho_nft_*` (#13-14).
//
// VÌ SAO BÀI NÀY TỒN TẠI, VÀ VÌ SAO APPLY-001 KHÔNG THAY ĐƯỢC NÓ:
// `assertParamCount` (APPLY-001) chỉ ĐẾM. Ca hỏng ở đây có ĐỦ tham số — 12 cho `reserve_draw`,
// 14 cho `lamp_mint` — chỉ GIÁ TRỊ ở hai khe kho là trỏ hai instance custody khác nhau. Cổng
// đếm im lặng, `applyParamsToScript` trả về một script hash hoàn toàn hợp lệ, và trên chuỗi
// thì `lamp_mint` cho Δ rót vào kho A trong khi `reserve_draw` đòi tiêu NFT của kho B. Không
// tầng nào báo — đó là ý của câu "khoá ba tầng đứt ở tầng nối dây" trong
// `Reserve/onchain/validators/reserve_draw.ak` (chú thích khe `kho_nft_policy`).
//
// Bài này đo CẢ HAI CỰC, không chỉ cực đỏ:
//   · cặp KHỚP   → danh sách dựng được, apply thật ra định danh hex hợp lệ
//   · cặp LỆCH   → APPLY-003 ném TRƯỚC khi mảng tham số tồn tại
//   · KHÔNG ĐỌC ĐƯỢC (rỗng/undefined/sai hình dạng) → APPLY-003, KHÔNG cho qua
// và có một ca dựng mảng BẰNG TAY để chứng minh: bỏ cổng ra thì cặp lệch vẫn ra hash hợp lệ.
//
// ⚠ Phần dùng blueprint ĐỌC `onchain/plutus.json` — artefact `aiken build`, KHÔNG có trong repo
// (.gitignore). Thiếu blueprint thì phần đó KHÔNG ĐO ĐƯỢC và phải nói thế. Phần thuần (cổng
// APPLY-003) không cần blueprint nên chạy ở mọi máy.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyParamsToScript, mintingPolicyToId, validatorToScriptHash } from "@lucid-evolution/lucid";
import {
  assertReserveKhoPair, lampMintParamList, reserveDrawParamList,
  type KhoNftPair,
} from "../offchain/src/reserveKhoPair.js";
import { assertParamCount } from "../offchain/src/applyGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bpPath = (mod: string) => resolve(__dirname, `../../${mod}/onchain/plutus.json`);
const GENESIS_BP = bpPath("Genesis");
const RESERVE_BP = bpPath("Reserve");
const haveBlueprints = existsSync(GENESIS_BP) && existsSync(RESERVE_BP);

interface BpValidator { title: string; parameters?: unknown[]; compiledCode: string }
const load = (p: string): BpValidator[] =>
  (JSON.parse(readFileSync(p, "utf8")) as { validators: BpValidator[] }).validators;
const findBp = (vals: BpValidator[], title: string): BpValidator => {
  const v = vals.find((x) => x.title === title);
  if (!v) throw new Error(`APPLY-002: blueprint không khai validator "${title}".`);
  return v;
};

// ── Hằng tổng hợp: hình dạng ĐÚNG, giá trị vô nghĩa. Bài đo SỐ/THỨ TỰ/CẶP, không đo giá trị
// deploy — KHÔNG được dùng chúng cho bất cứ đường ghi lên chuỗi nào.
const THREAD_PID = "11".repeat(28);
const REG_PID = "22".repeat(28);
const DIST_KHO_PID = "33".repeat(28);   // kho DISTRIBUTION (#9-10) — một cái kho KHÁC
const MET_PID = "44".repeat(28);
const CUSTODY_SEED_PID = "55".repeat(28); // kho TREASURY CUSTODY (#13-14 / #6-7)
const LAMP_PID = "66".repeat(28);
const AUTH_PID = "77".repeat(28);
const GATE_HASH = "88".repeat(28);
const CUSTODY_HASH = "99".repeat(28);
const KHAC_PID = "ab".repeat(28);        // một custody_seed KHÁC — đúng hình dạng, sai instance

const SUPPLY_NAME = "535550504c59";      // "SUPPLY"
const REG_NAME = "524547";               // "REG"
const KHO_NAME = "54525359";             // "TRSY"
const MET_NAME = "4d4554";               // "MET"
const AUTH_NAME = "5450554c4c";          // "TPULL"
const TOKEN_TAG = "4c414d50";            // "LAMP"
const TOKEN_NAME = "744c414d50";         // "tLAMP"
const INSTANCE_ID = "6c616d702d72657365727665"; // "lamp-reserve"
const INSTANCE_KHAC = "6c616d702d7265736572766532";  // "lamp-reserve2"

const MS_PER_EPOCH = 432_000_000n;
const DIST_CAP = 26_370_000_000_000_000n;
const RESERVE_CAP = 9_630_000_000_000_000n;

const KHO_DUNG: KhoNftPair = { policy: CUSTODY_SEED_PID, name: INSTANCE_ID };

function lampMintArgs(reserveKhoNft: KhoNftPair) {
  return {
    threadNftPolicy: THREAD_PID, threadNftName: SUPPLY_NAME,
    tokenName: TOKEN_NAME,
    distCap: DIST_CAP, reserveCap: RESERVE_CAP,
    registryNftPolicy: REG_PID, registryNftName: REG_NAME,
    tokenTag: TOKEN_TAG,
    distKhoNftPolicy: DIST_KHO_PID, distKhoNftName: KHO_NAME,
    meterNftPolicy: MET_PID, meterNftName: MET_NAME,
    reserveKhoNft,
  };
}

function reserveDrawArgs(khoNft: KhoNftPair, lampMintReserveKhoNft: KhoNftPair) {
  return {
    lampPolicy: LAMP_PID, tokenName: TOKEN_NAME,
    reserveThreadPolicy: MET_PID, reserveThreadName: MET_NAME,
    msPerEpoch: MS_PER_EPOCH,
    khoNft,
    treasuryAuthPolicy: AUTH_PID, treasuryAuthName: AUTH_NAME,
    gateScriptHash: GATE_HASH,
    custodyScriptHash: CUSTODY_HASH,
    reserveCap: RESERVE_CAP,
    lampMintReserveKhoNft,
  };
}

describe("APPLY-003 — cặp NFT kho phải TRÙNG giữa lamp_mint (#13-14) và reserve_draw (#6-7)", () => {
  it("XANH: hai cặp khớp ⇒ im lặng", () => {
    expect(() => assertReserveKhoPair(KHO_DUNG, { ...KHO_DUNG })).not.toThrow();
    // Hex không phân biệt hoa thường — cùng bytes thì phải coi là khớp, không phải lệch.
    expect(() =>
      assertReserveKhoPair(KHO_DUNG, { policy: CUSTODY_SEED_PID.toUpperCase(), name: INSTANCE_ID }),
    ).not.toThrow();
  });

  it("ĐỎ: lệch POLICY (cùng name) bị chặn", () => {
    expect(() => assertReserveKhoPair(KHO_DUNG, { policy: KHAC_PID, name: INSTANCE_ID }))
      .toThrow(/APPLY-003/);
  });

  it("ĐỎ: lệch NAME (cùng policy) bị chặn — instance_id khác là một cái kho khác", () => {
    expect(() => assertReserveKhoPair(KHO_DUNG, { policy: CUSTODY_SEED_PID, name: INSTANCE_KHAC }))
      .toThrow(/APPLY-003/);
  });

  it("thông điệp nêu ĐỦ cả hai cặp để đối chiếu", () => {
    expect(() => assertReserveKhoPair(KHO_DUNG, { policy: KHAC_PID, name: INSTANCE_ID }))
      .toThrow(new RegExp(`${CUSTODY_SEED_PID}[\\s\\S]*${KHAC_PID}`));
  });

  it("ĐỎ: một vế KHÔNG ĐỌC ĐƯỢC ⇒ ném, KHÔNG cho qua (trạng thái mù ≠ trạng thái ổn)", () => {
    expect(() => assertReserveKhoPair(undefined, KHO_DUNG)).toThrow(/APPLY-003/);
    expect(() => assertReserveKhoPair(KHO_DUNG, undefined)).toThrow(/APPLY-003/);
    expect(() => assertReserveKhoPair({ policy: "", name: INSTANCE_ID }, KHO_DUNG)).toThrow(/APPLY-003/);
    expect(() => assertReserveKhoPair(KHO_DUNG, { policy: CUSTODY_SEED_PID, name: "" })).toThrow(/APPLY-003/);
    // Hình dạng sai (policy 27 byte) cũng là không đọc được — đừng đợi tới lúc so bằng.
    expect(() => assertReserveKhoPair(KHO_DUNG, { policy: "aa".repeat(27), name: INSTANCE_ID }))
      .toThrow(/APPLY-003/);
  });

  it("ĐỎ: CẢ HAI vế cùng rỗng vẫn ném — 'bằng nhau' không phải 'đã điền'", () => {
    // Ca nguy hiểm nhất mà một cổng chỉ-so-bằng sẽ cho qua: hai chỗ đều chưa điền thì chúng
    // so ra BẰNG NHAU. Cổng phải hỏi "đọc được không" TRƯỚC khi hỏi "có bằng nhau không".
    const rong: KhoNftPair = { policy: "", name: "" };
    expect(() => assertReserveKhoPair(rong, { ...rong })).toThrow(/APPLY-003/);
  });
});

describe("lampMintParamList — 14 khe, cặp #13-14 ở ĐÚNG chỗ", () => {
  it("trả về đúng 14 tham số", () => {
    expect(lampMintParamList(lampMintArgs(KHO_DUNG))).toHaveLength(14);
  });

  it("khe #13-14 là kho TREASURY CUSTODY, #9-10 là kho DISTRIBUTION — hai kho KHÁC NHAU", () => {
    // Ca này phân biệt được hai cực đột biến: hoán hai cặp cho nhau thì nó đỏ, dù số tham số
    // vẫn đủ 14 và apply vẫn ra một policy-id hợp lệ.
    const l = lampMintParamList(lampMintArgs(KHO_DUNG));
    expect(l[8]).toBe(DIST_KHO_PID);      // #9
    expect(l[9]).toBe(KHO_NAME);          // #10
    expect(l[10]).toBe(MET_PID);          // #11
    expect(l[11]).toBe(MET_NAME);         // #12
    expect(l[12]).toBe(CUSTODY_SEED_PID); // #13
    expect(l[13]).toBe(INSTANCE_ID);      // #14
    expect(l[12]).not.toBe(l[8]);
  });

  it("ĐỎ: cặp #13-14 không đọc được ⇒ KHÔNG dựng được danh sách", () => {
    expect(() => lampMintParamList(lampMintArgs({ policy: "", name: INSTANCE_ID })))
      .toThrow(/APPLY-003/);
    expect(() => lampMintParamList(lampMintArgs({ policy: "khong-phai-hex".repeat(4), name: INSTANCE_ID })))
      .toThrow(/APPLY-003/);
  });
});

describe("reserveDrawParamList — 12 khe, cổng chạy TRƯỚC khi mảng tồn tại", () => {
  it("XANH: cặp khớp ⇒ 12 tham số, kho ở khe #6-7", () => {
    const l = reserveDrawParamList(reserveDrawArgs(KHO_DUNG, { ...KHO_DUNG }));
    expect(l).toHaveLength(12);
    expect(l[5]).toBe(CUSTODY_SEED_PID); // #6
    expect(l[6]).toBe(INSTANCE_ID);      // #7
    expect(l[9]).toBe(GATE_HASH);        // #10
    expect(l[10]).toBe(CUSTODY_HASH);    // #11
    expect(l[11]).toBe(RESERVE_CAP);     // #12
  });

  // Khe #12 là một con số, không phải một hash — nên nó đi lọt mọi phép kiểm hình dạng hex.
  // `0n` ở đây không hỏng lúc apply: nó hỏng ở lượt rút ĐẦU TIÊN (Luật 1b), khi script hash
  // đã chốt và MET đã nằm dưới validator.
  it("ĐỎ: reserve_cap (#12) là giá trị chết ⇒ RESERVE-CAP-002, không dựng được danh sách", () => {
    expect(() => reserveDrawParamList({ ...reserveDrawArgs(KHO_DUNG, { ...KHO_DUNG }), reserveCap: 0n }))
      .toThrow(/RESERVE-CAP-002/);
    expect(() => reserveDrawParamList({ ...reserveDrawArgs(KHO_DUNG, { ...KHO_DUNG }), reserveCap: -1n }))
      .toThrow(/RESERVE-CAP-002/);
  });

  it("ĐỎ: ĐỦ tham số nhưng NHẦM CẶP ⇒ APPLY-003, không có mảng nào ra khỏi hàm", () => {
    // ĐÂY LÀ CA CHÍNH. Số tham số vẫn đủ 11 — APPLY-001 không có gì để bắt.
    expect(() => reserveDrawParamList(reserveDrawArgs({ policy: KHAC_PID, name: INSTANCE_ID }, KHO_DUNG)))
      .toThrow(/APPLY-003/);
    expect(() => reserveDrawParamList(reserveDrawArgs({ policy: CUSTODY_SEED_PID, name: INSTANCE_KHAC }, KHO_DUNG)))
      .toThrow(/APPLY-003/);
  });

  it("APPLY-001 KHÔNG bắt được ca nhầm cặp — đó là lý do APPLY-003 tồn tại", () => {
    // Dựng mảng 12 phần tử BẰNG TAY với cặp lệch: đủ số, nên cổng đếm im lặng.
    const lech = [
      LAMP_PID, TOKEN_NAME, MET_PID, MET_NAME, MS_PER_EPOCH,
      KHAC_PID, INSTANCE_ID,                 // ← kho của một instance custody KHÁC
      AUTH_PID, AUTH_NAME, GATE_HASH, CUSTODY_HASH, RESERVE_CAP,
    ];
    expect(lech).toHaveLength(12);
    expect(() => assertParamCount("reserve_draw.reserve_draw.spend", 12, lech.length)).not.toThrow();
  });
});

describe.skipIf(!haveBlueprints)("apply-param THẬT — danh sách dựng ra phải áp được", () => {
  const genesis = load(GENESIS_BP);
  const reserve = load(RESERVE_BP);

  it("blueprint khai đúng 14 / 12 tham số như chữ ký on-chain", () => {
    expect((findBp(genesis, "lamp_mint.lamp_mint.mint").parameters ?? []).length).toBe(14);
    expect((findBp(reserve, "reserve_draw.reserve_draw.spend").parameters ?? []).length).toBe(12);
  });

  it("lampMintParamList áp được ⇒ ra policy-id thật (đủ tham số, không còn hàm chờ đối số)", () => {
    const v = findBp(genesis, "lamp_mint.lamp_mint.mint");
    assertParamCount(v.title, (v.parameters ?? []).length, lampMintParamList(lampMintArgs(KHO_DUNG)).length);
    const script = applyParamsToScript(
      v.compiledCode, lampMintParamList(lampMintArgs(KHO_DUNG)) as never[],
    );
    expect(mintingPolicyToId({ type: "PlutusV3", script })).toMatch(/^[0-9a-f]{56}$/);
  });

  it("reserveDrawParamList áp được ⇒ ra script hash thật", () => {
    const v = findBp(reserve, "reserve_draw.reserve_draw.spend");
    const params = reserveDrawParamList(reserveDrawArgs(KHO_DUNG, { ...KHO_DUNG }));
    assertParamCount(v.title, (v.parameters ?? []).length, params.length);
    const script = applyParamsToScript(v.compiledCode, params as never[]);
    expect(validatorToScriptHash({ type: "PlutusV3", script })).toMatch(/^[0-9a-f]{56}$/);
  });

  it("BẰNG CHỨNG VÌ SAO CẦN CỔNG: cặp lệch vẫn ra một script hash HỢP LỆ, chỉ là hash KHÁC", () => {
    // Đây là thứ mua được cả bài: apply-param KHÔNG kêu ở ca nhầm cặp. Nó trả về một định danh
    // đúng hình dạng, khác giá trị — và một địa chỉ sai không tự khai là sai.
    const v = findBp(reserve, "reserve_draw.reserve_draw.spend");
    const dung = reserveDrawParamList(reserveDrawArgs(KHO_DUNG, { ...KHO_DUNG }));
    const lech = [...dung];
    lech[5] = KHAC_PID; // bỏ qua cổng bằng cách sửa mảng SAU khi đã dựng
    const hDung = validatorToScriptHash({ type: "PlutusV3", script: applyParamsToScript(v.compiledCode, dung as never[]) });
    const hLech = validatorToScriptHash({ type: "PlutusV3", script: applyParamsToScript(v.compiledCode, lech as never[]) });
    expect(hLech).toMatch(/^[0-9a-f]{56}$/);   // hợp lệ về hình dạng
    expect(hLech).not.toBe(hDung);             // nhưng là MỘT VALIDATOR KHÁC
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CHỖ GỌI có thật sự đi qua cổng không — ghim bằng VĂN BẢN, và nói rõ giới hạn.
//
// `scripts/_canonical_v2.ts` và `scripts/_reserve_layer2.ts` KHÔNG nạp được trong bài kiểm:
// cả hai import `scripts/config.ts`, mà tệp đó ném `SECRETS-001` ngay lúc import khi môi
// trường chưa dựng. Nên không có cách nào chạy `deriveReserveWiring()` ở đây.
//
// ⚠ ĐÂY LÀ GHIM VĂN BẢN, KHÔNG PHẢI GHIM HÀNH VI. Nó bắt được ca "ai đó quay lại gõ mảng
// tham số tại chỗ" — đúng cái đã che chỗ nối dây trước bản vá. Nó KHÔNG chứng minh giá trị
// truyền vào là đúng; phần đó do chính cổng APPLY-003 lo, và đã đo ở các nhóm trên.
// ────────────────────────────────────────────────────────────────────────────
describe("chỗ gọi apply-param đi qua bộ dựng tham số, không gõ mảng tại chỗ", () => {
  const doc = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

  it("_canonical_v2.ts dựng tham số lamp_mint qua lampMintParamList, có khe #13-14", () => {
    const s = doc("../scripts/_canonical_v2.ts");
    expect(s).toContain("lampMintParamList");
    expect(s).toContain("reserveKhoNft:");
  });

  it("_reserve_layer2.ts dựng tham số reserve_draw qua reserveDrawParamList, CÓ vế đối chiếu", () => {
    const s = doc("../scripts/_reserve_layer2.ts");
    expect(s).toContain("reserveDrawParamList");
    // Vế đối chiếu là thứ duy nhất biến cổng thành một phép ĐO. Thiếu nó thì hàm vẫn chạy,
    // vẫn dựng mảng 11 phần tử, và "ép hai chỗ khớp nhau" quay về một lời hứa bằng chữ.
    expect(s).toContain("lampMintReserveKhoNft:");
  });
});

// Không có blueprint thì KÊU, đừng để trạng thái mù lẫn vào màu xanh.
describe.skipIf(haveBlueprints)("apply-param THẬT — KHÔNG ĐO ĐƯỢC", () => {
  it("thiếu plutus.json ⇒ phần áp tham số không đo được (chạy `aiken build` ở Genesis/onchain + Reserve/onchain)", () => {
    expect(haveBlueprints).toBe(false);
    console.warn(
      "[KHÔNG ĐO ĐƯỢC] reserveKhoPair.test.ts bỏ qua phần blueprint: thiếu " +
      `${existsSync(GENESIS_BP) ? "" : GENESIS_BP + " "}${existsSync(RESERVE_BP) ? "" : RESERVE_BP}`,
    );
  });
});
