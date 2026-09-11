// Cổng FLOOR-PAIR-001 — ép `reserve_auth.floor_oildrop` (#3) TRÙNG `reserve_gate.floor_oildrop` (#5).
//
// VÌ SAO BÀI NÀY TỒN TẠI, VÀ VÌ SAO ON-CHAIN KHÔNG THAY ĐƯỢC NÓ:
// `reserve_gate` nướng `auth_policy` (= policy-id của `reserve_auth`), nên `reserve_auth` KHÔNG
// nướng ngược `gate_script_hash` được — vòng apply-param. Chính validator ghi ra điều đó, khối
// `⚠ RESIDUAL` trong luật A-FLOOR-1 của `Treasury/onchain/validators/reserve_auth.ak`: truyền
// `floor_oildrop = 5` vào `reserve_auth` và `= 0` vào `reserve_gate` thì CẢ HAI SCRIPT VẪN ĐÚC
// ĐƯỢC và cổng cầu vẫn chết vĩnh viễn. Không validator nào phát hiện được — nên nó phải bị chặn
// ở đây, TRƯỚC khi dựng giao dịch.
//
// Bài đo CẢ BA trạng thái, không chỉ hai:
//   · khớp            → im lặng, danh sách tham số dựng được, apply thật ra định danh hex
//   · lệch            → FLOOR-PAIR-001 ném TRƯỚC khi mảng tham số tồn tại
//   · KHÔNG ĐỌC ĐƯỢC  → FLOOR-PAIR-001, KHÔNG cho qua
// Ba ca dưới đây là thứ phân biệt cổng thật với một phép so `===` trần: hai vế cùng `undefined`,
// hai vế cùng `0n`, và hai vế cùng một `number` — cả ba đều so ra BẰNG NHAU.
//
// ⚠ Phần dùng blueprint ĐỌC `onchain/plutus.json` — artefact `aiken build`, KHÔNG có trong repo
// (.gitignore). Thiếu blueprint thì phần đó KHÔNG ĐO ĐƯỢC và phải nói thế. Phần thuần (cổng
// FLOOR-PAIR-001) không cần blueprint nên chạy ở mọi máy.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Constr, applyParamsToScript, mintingPolicyToId, validatorToScriptHash } from "@lucid-evolution/lucid";
import {
  assertFloorPair, reserveAuthParamList, reserveGateParamList,
} from "../offchain/src/reserveFloorPair.js";
import { assertParamCount } from "../offchain/src/applyGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TREASURY_BP = resolve(__dirname, "../../Treasury/onchain/plutus.json");
const haveBlueprint = existsSync(TREASURY_BP);

interface BpValidator { title: string; parameters?: unknown[]; compiledCode: string }
const load = (p: string): BpValidator[] =>
  (JSON.parse(readFileSync(p, "utf8")) as { validators: BpValidator[] }).validators;
const findBp = (vals: BpValidator[], title: string): BpValidator => {
  const v = vals.find((x) => x.title === title);
  if (!v) throw new Error(`APPLY-002: blueprint không khai validator "${title}".`);
  return v;
};

// ── Hằng tổng hợp: hình dạng ĐÚNG, giá trị vô nghĩa. KHÔNG dùng cho đường ghi lên chuỗi nào.
const SEED_PID = "11".repeat(28);
const LAMP_PID = "22".repeat(28);
const AUTH_PID = "33".repeat(28);
const INSTANCE_ID = "6c616d702d72657365727665"; // "lamp-reserve"
const TOKEN_NAME = "744c414d50";                // "tLAMP"
const AUTH_NAME = "5450554c4c";                 // "TPULL"
const GENESIS_REF = new Constr(0, ["ab".repeat(32), 0n]);

const SAN = 1_000_000_000n;        // sàn "đúng"
const SAN_KHAC = 2_000_000_000n;   // một con số khác, cũng hợp lệ về hình dạng

function authArgs(floorOildrop: bigint, reserveGateFloorOildrop: bigint) {
  return { genesisRef: GENESIS_REF, authName: AUTH_NAME, floorOildrop, reserveGateFloorOildrop };
}

function gateArgs(floorOildrop: bigint, reserveAuthFloorOildrop: bigint) {
  return {
    custodyNftPolicy: SEED_PID, custodyNftName: INSTANCE_ID,
    lampPolicy: LAMP_PID, tokenName: TOKEN_NAME,
    floorOildrop,
    authPolicy: AUTH_PID, authName: AUTH_NAME,
    reserveAuthFloorOildrop,
  };
}

describe("FLOOR-PAIR-001 — sàn phải TRÙNG giữa reserve_auth (#3) và reserve_gate (#5)", () => {
  it("XANH: hai vế bằng nhau và dương ⇒ im lặng", () => {
    expect(() => assertFloorPair(SAN, SAN)).not.toThrow();
    expect(() => assertFloorPair(1n, 1n)).not.toThrow();
  });

  it("ĐỎ: ca của khối RESIDUAL — 5 ở auth, 0 ở gate ⇒ bị chặn", () => {
    // Đây là ca nguyên văn mà `reserve_auth.ak` mô tả: cả hai script vẫn đúc được, cổng cầu
    // vẫn chết. On-chain không có gì bắt; cổng này là chỗ DUY NHẤT.
    expect(() => assertFloorPair(5n, 0n)).toThrow(/FLOOR-PAIR-001/);
  });

  it("ĐỎ: lệch giữa hai giá trị đều HỢP LỆ ⇒ bị chặn", () => {
    expect(() => assertFloorPair(SAN, SAN_KHAC)).toThrow(/FLOOR-PAIR-001/);
    expect(() => assertFloorPair(SAN_KHAC, SAN)).toThrow(/FLOOR-PAIR-001/);
  });

  it("thông điệp nêu ĐỦ cả hai số để đối chiếu", () => {
    expect(() => assertFloorPair(SAN, SAN_KHAC))
      .toThrow(new RegExp(`${SAN}[\\s\\S]*${SAN_KHAC}`));
  });

  it("ĐỎ: một vế KHÔNG ĐỌC ĐƯỢC ⇒ ném, KHÔNG cho qua (trạng thái mù ≠ trạng thái ổn)", () => {
    expect(() => assertFloorPair(undefined, SAN)).toThrow(/FLOOR-PAIR-001/);
    expect(() => assertFloorPair(SAN, undefined)).toThrow(/FLOOR-PAIR-001/);
  });

  it("ĐỎ: CẢ HAI vế cùng undefined vẫn ném — 'bằng nhau' không phải 'đã điền'", () => {
    // Ca mà một cổng chỉ-so-bằng cho qua: `undefined === undefined` là TRUE.
    expect(() => assertFloorPair(undefined, undefined)).toThrow(/FLOOR-PAIR-001/);
  });

  it("ĐỎ: sàn <= 0 là GIÁ TRỊ CHẾT, kể cả khi hai vế bằng nhau", () => {
    // `parked < floor` với `parked >= 0` và `floor <= 0` không bao giờ đúng ⇒ auth NFT không
    // rời gate ⇒ đường Reserve chết hẳn. `0n === 0n` là TRUE, nên phép so bằng không thấy gì.
    expect(() => assertFloorPair(0n, 0n)).toThrow(/FLOOR-PAIR-001/);
    expect(() => assertFloorPair(-1n, -1n)).toThrow(/FLOOR-PAIR-001/);
    expect(() => assertFloorPair(0n, SAN)).toThrow(/FLOOR-PAIR-001/);
  });

  it("ĐỎ: `number` thay vì `bigint` là KHÔNG ĐỌC ĐƯỢC, kể cả khi hai vế bằng nhau", () => {
    // `1000 === 1000` là TRUE. Khe này là `Int` của Plutus; nhận một `number` JS là nhận một
    // giá trị chưa biết hình dạng đi thẳng vào bytecode.
    const n = 1_000_000_000 as unknown as bigint;
    expect(() => assertFloorPair(n, n)).toThrow(/FLOOR-PAIR-001/);
    expect(() => assertFloorPair(n, SAN)).toThrow(/FLOOR-PAIR-001/);
  });
});

describe("reserveAuthParamList — 3 khe, cổng chạy TRƯỚC khi mảng tồn tại", () => {
  it("XANH: sàn khớp ⇒ 3 tham số, sàn ở khe #3", () => {
    const l = reserveAuthParamList(authArgs(SAN, SAN));
    expect(l).toHaveLength(3);
    expect(l[0]).toBe(GENESIS_REF); // #1
    expect(l[1]).toBe(AUTH_NAME);   // #2
    expect(l[2]).toBe(SAN);         // #3
  });

  it("ĐỎ: sàn lệch ⇒ FLOOR-PAIR-001, không có mảng nào ra khỏi hàm", () => {
    expect(() => reserveAuthParamList(authArgs(5n, 0n))).toThrow(/FLOOR-PAIR-001/);
    expect(() => reserveAuthParamList(authArgs(SAN, SAN_KHAC))).toThrow(/FLOOR-PAIR-001/);
  });
});

describe("reserveGateParamList — 7 khe, cổng chạy TRƯỚC khi mảng tồn tại", () => {
  it("XANH: sàn khớp ⇒ 7 tham số, sàn ở khe #5", () => {
    const l = reserveGateParamList(gateArgs(SAN, SAN));
    expect(l).toHaveLength(7);
    expect(l[0]).toBe(SEED_PID);    // #1
    expect(l[1]).toBe(INSTANCE_ID); // #2
    expect(l[4]).toBe(SAN);         // #5
    expect(l[5]).toBe(AUTH_PID);    // #6
    expect(l[6]).toBe(AUTH_NAME);   // #7
  });

  it("ĐỎ: sàn lệch ⇒ FLOOR-PAIR-001, không có mảng nào ra khỏi hàm", () => {
    expect(() => reserveGateParamList(gateArgs(0n, 5n))).toThrow(/FLOOR-PAIR-001/);
  });

  it("APPLY-001 KHÔNG bắt được ca sàn lệch — đó là lý do FLOOR-PAIR-001 tồn tại", () => {
    // Dựng mảng BẰNG TAY với sàn 0: đủ 7 khe, nên cổng đếm im lặng.
    const chet = [SEED_PID, INSTANCE_ID, LAMP_PID, TOKEN_NAME, 0n, AUTH_PID, AUTH_NAME];
    expect(chet).toHaveLength(7);
    expect(() => assertParamCount("reserve_gate.reserve_gate.spend", 7, chet.length)).not.toThrow();
  });
});

describe.skipIf(!haveBlueprint)("apply-param THẬT — danh sách dựng ra phải áp được", () => {
  const treasury = load(TREASURY_BP);

  it("blueprint khai đúng 3 / 7 tham số như chữ ký on-chain", () => {
    expect((findBp(treasury, "reserve_auth.reserve_auth.mint").parameters ?? []).length).toBe(3);
    expect((findBp(treasury, "reserve_gate.reserve_gate.spend").parameters ?? []).length).toBe(7);
  });

  it("reserveAuthParamList áp được ⇒ ra policy-id thật", () => {
    const v = findBp(treasury, "reserve_auth.reserve_auth.mint");
    const params = reserveAuthParamList(authArgs(SAN, SAN));
    assertParamCount(v.title, (v.parameters ?? []).length, params.length);
    const script = applyParamsToScript(v.compiledCode, params as never[]);
    expect(mintingPolicyToId({ type: "PlutusV3", script })).toMatch(/^[0-9a-f]{56}$/);
  });

  it("reserveGateParamList áp được ⇒ ra script hash thật", () => {
    const v = findBp(treasury, "reserve_gate.reserve_gate.spend");
    const params = reserveGateParamList(gateArgs(SAN, SAN));
    assertParamCount(v.title, (v.parameters ?? []).length, params.length);
    const script = applyParamsToScript(v.compiledCode, params as never[]);
    expect(validatorToScriptHash({ type: "PlutusV3", script })).toMatch(/^[0-9a-f]{56}$/);
  });

  it("BẰNG CHỨNG VÌ SAO CẦN CỔNG: sàn 0 vẫn ra một policy-id HỢP LỆ, chỉ là policy KHÁC", () => {
    // Thứ mua được cả bài: apply-param KHÔNG kêu ở ca sàn chết. Nó trả về một định danh đúng
    // hình dạng, khác giá trị — và một cổng cầu đã chết không tự khai là đã chết.
    const v = findBp(treasury, "reserve_gate.reserve_gate.spend");
    const dung = reserveGateParamList(gateArgs(SAN, SAN));
    const chet = [...dung];
    chet[4] = 0n; // bỏ qua cổng bằng cách sửa mảng SAU khi đã dựng
    const hDung = validatorToScriptHash({ type: "PlutusV3", script: applyParamsToScript(v.compiledCode, dung as never[]) });
    const hChet = validatorToScriptHash({ type: "PlutusV3", script: applyParamsToScript(v.compiledCode, chet as never[]) });
    expect(hChet).toMatch(/^[0-9a-f]{56}$/);   // hợp lệ về hình dạng
    expect(hChet).not.toBe(hDung);             // nhưng là MỘT VALIDATOR KHÁC
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CHỖ GỌI có thật sự đi qua cổng không — ghim bằng VĂN BẢN, và nói rõ giới hạn.
//
// `scripts/_reserve_layer2.ts` KHÔNG nạp được trong bài kiểm: nó import `scripts/config.ts`,
// mà tệp đó ném `SECRETS-001` ngay lúc import khi môi trường chưa dựng.
//
// ⚠ ĐÂY LÀ GHIM VĂN BẢN, KHÔNG PHẢI GHIM HÀNH VI. Nó bắt được ca "ai đó quay lại gõ mảng tham
// số tại chỗ" và ca "ai đó gõ lại con số ở lời gọi thứ hai" — đúng hai cách mà residual này
// quay lại. Nó KHÔNG chứng minh giá trị truyền vào là đúng; phần đó do chính cổng lo.
// ────────────────────────────────────────────────────────────────────────────
describe("chỗ gọi apply-param đi qua bộ dựng tham số, và SÀN chỉ có MỘT nguồn", () => {
  const src = readFileSync(resolve(__dirname, "../scripts/_reserve_layer2.ts"), "utf8");

  it("_reserve_layer2.ts dựng tham số reserve_auth + reserve_gate qua bộ dựng, CÓ vế đối chiếu", () => {
    expect(src).toContain("reserveAuthParamList");
    expect(src).toContain("reserveGateParamList");
    // Vế đối chiếu là thứ duy nhất biến cổng thành một phép ĐO. Thiếu nó thì hàm vẫn chạy, vẫn
    // dựng đủ khe, và "ép hai chỗ khớp nhau" quay về một lời hứa bằng chữ.
    expect(src).toContain("reserveGateFloorOildrop:");
    expect(src).toContain("reserveAuthFloorOildrop:");
  });

  it("sàn khai ĐÚNG MỘT lần bằng số — mọi chỗ khác đọc lại biến, không gõ lại con số", () => {
    // Đếm các dòng có một literal số kiểu bigint đứng cạnh chữ "FLOOR"/"floor". Chỉ dòng khai
    // hằng `FLOOR_OILDROP` được phép; một dòng thứ hai nghĩa là con số đã có nguồn thứ hai.
    // Chú kiểu tường minh cho `d`: trong phạm vi này `node:fs` không có khai báo kiểu
    // (thiếu `@types/node`, nhiễu có sẵn của kho), nên `src` suy ra `any` và tham số lambda
    // thành implicit any — một lỗi tsc MỚI mọc ra từ một khuyết tật CŨ.
    const dong: string[] = String(src).split("\n");
    const dongGoSo = dong
      .filter((d: string) => /^\s*(export\s+)?const\s+\w*[Ff][Ll][Oo][Oo][Rr]\w*\s*[:=]/.test(d))
      .filter((d: string) => /[0-9][0-9_]*n\b/.test(d));
    expect(dongGoSo).toHaveLength(1);
    expect(dongGoSo[0]).toContain("FLOOR_OILDROP");
  });
});

// Không có blueprint thì KÊU, đừng để trạng thái mù lẫn vào màu xanh.
describe.skipIf(haveBlueprint)("apply-param THẬT — KHÔNG ĐO ĐƯỢC", () => {
  it("thiếu plutus.json ⇒ phần áp tham số không đo được (chạy `aiken build` ở Treasury/onchain)", () => {
    expect(haveBlueprint).toBe(false);
    console.warn(`[KHÔNG ĐO ĐƯỢC] reserveFloorPair.test.ts bỏ qua phần blueprint: thiếu ${TREASURY_BP}`);
  });
});
