// Cổng apply-param cho ĐƯỜNG RÚT RESERVE — bốn validator, dựng THẬT, không mạng.
//
// VÌ SAO BÀI NÀY TỒN TẠI: `applyParamsToScript` KHÔNG ném khi thiếu/thừa tham số. Nó áp một
// phần rồi trả về một script-hash / policy-id KHÁC, im lặng. Đợt "Δ Reserve vào SỔ" đổi chữ ký
// của ba validator cùng lúc (`custody` 3→5, `custody_seed` 2→1, `reserve_draw` 9→11), nên mọi
// lời gọi off-chain cũ đều rơi đúng vào lớp lỗi đó. Đợt sau lại đổi hai cái nữa —
// `reserve_draw` 11→12 (`reserve_cap`, Luật 1b) và `reserve_auth` 2→3 (`floor_oildrop`,
// A-FLOOR-1) — và cổng này bắn đúng lúc, đó là tính năng chứ không phải hỏng.
//
// Bài chạy OFFLINE: apply-param là phép thuần trên compiledCode, không cần provider hay UTxO.
//
// ⚠ Bài này ĐỌC `onchain/plutus.json` — artefact `aiken build`, KHÔNG có trong repo
// (.gitignore). Thiếu blueprint thì bài KHÔNG ĐO ĐƯỢC và phải nói thế, không được im lặng
// bỏ qua rồi báo xanh: một cổng xanh vì "không có gì để đo" là cổng nói "tôi không biết"
// bằng giọng của "ổn".

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Constr, applyParamsToScript, mintingPolicyToId, validatorToScriptHash,
} from "@lucid-evolution/lucid";
// Bài đặt ở Genesis (không phải Treasury) vì cổng `assertParamCount` sống ở đây: import
// CỤC BỘ nằm trong `rootDir` của gói này, còn import chéo từ Treasury/tests vi phạm rootDir
// (TS6059). Blueprint của Treasury/Reserve chỉ đọc lúc CHẠY (JSON), không qua biên kiểu.
import { assertParamCount } from "../offchain/src/applyGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bpPath = (mod: string) => resolve(__dirname, `../../${mod}/onchain/plutus.json`);

const TREASURY_BP = bpPath("Treasury");
const RESERVE_BP = bpPath("Reserve");
const haveBlueprints = existsSync(TREASURY_BP) && existsSync(RESERVE_BP);

interface BpValidator { title: string; parameters?: unknown[]; compiledCode: string }
const load = (p: string): BpValidator[] =>
  (JSON.parse(readFileSync(p, "utf8")) as { validators: BpValidator[] }).validators;

/** Số tham số blueprint KHAI cho một title. Nguồn duy nhất — không gõ số từ trí nhớ. */
function declaredOf(vals: BpValidator[], title: string): number {
  const v = vals.find((x) => x.title === title);
  if (!v) throw new Error(`APPLY-002: blueprint không khai validator "${title}".`);
  if (!Array.isArray(v.parameters)) {
    throw new Error(`APPLY-001: blueprint KHÔNG khai 'parameters' cho "${title}" — không suy đoán.`);
  }
  return v.parameters.length;
}

/** Áp tham số QUA cổng — đúng khuôn `mkApply` của các script demo. */
function applyThroughGate(vals: BpValidator[], title: string, params: unknown[]): string {
  const v = vals.find((x) => x.title === title);
  if (!v) throw new Error(`APPLY-002: blueprint không khai validator "${title}".`);
  assertParamCount(title, (v.parameters ?? []).length, params.length);
  return applyParamsToScript(v.compiledCode, params as never[]);
}

// ── Giá trị tổng hợp: hình dạng ĐÚNG (28 byte hash / hex asset name), giá trị vô nghĩa.
// Bài này đo SỐ và THỨ TỰ tham số, không đo giá trị deploy — nên hằng tổng hợp là đủ, và
// KHÔNG được dùng chúng cho bất cứ đường ghi lên chuỗi nào.
const PROPOSAL_POLICY = "11".repeat(28);
const SEED_POLICY = "22".repeat(28);
const LAMP_POLICY = "33".repeat(28);
const AUTH_POLICY = "44".repeat(28);
const THREAD_POLICY = "55".repeat(28);
const GATE_HASH = "66".repeat(28);
const CUSTODY_HASH = "77".repeat(28);
const TOKEN_NAME = "744c414d50";       // "tLAMP"
const INSTANCE_ID = "435553";          // "CUS"
const AUTH_NAME = "5450554c4c";        // "TPULL"
const THREAD_NAME = "524553";          // "RES"
const MS_PER_EPOCH = 432_000_000n;
const FLOOR = 1_000_000n;
const RESERVE_CAP = 9_630_000_000_000_000n;
// `OutputReference` = Constr(0, [txHash 32 byte, index]) — phải là Constr THẬT, không phải
// một đối tượng cùng hình dạng: lucid serialize theo class, đối tượng thường ném "Unsupported type".
const GENESIS_REF = new Constr(0, ["ab".repeat(32), 0n]);

// Năm lời gọi apply-param của đường rút Reserve, ĐÚNG thứ tự chữ ký on-chain.
const CALLS: Array<{ mod: "Treasury" | "Reserve"; title: string; params: unknown[]; soCu: number }> = [
  {
    mod: "Treasury", title: "custody_seed.custody_seed.mint",
    // Chỉ `genesis_ref`. Khe `custody_script_hash` cũ đã BỎ — output custody nay chọn bằng
    // self-reference NFT, phá vòng seed↔custody.
    params: [GENESIS_REF],
    soCu: 2,
  },
  {
    mod: "Treasury", title: "custody.custody.spend",
    // +2 khe LAMP (#4-5) để nhánh MigrateIn đo Δ.
    params: [PROPOSAL_POLICY, SEED_POLICY, MS_PER_EPOCH, LAMP_POLICY, TOKEN_NAME],
    soCu: 2,
  },
  {
    mod: "Treasury", title: "reserve_gate.reserve_gate.spend",
    params: [SEED_POLICY, INSTANCE_ID, LAMP_POLICY, TOKEN_NAME, FLOOR, AUTH_POLICY, AUTH_NAME],
    soCu: 8,
  },
  {
    mod: "Reserve", title: "reserve_draw.reserve_draw.spend",
    // Khe #6 cũ là `reserve_dest: Address`. Ba khe thay nó: kho định danh bằng NFT (#6-7)
    // và ghim vào ĐÚNG validator giữ nó (#11). Khe #12 `reserve_cap` thêm sau đó (Luật 1b).
    params: [
      LAMP_POLICY, TOKEN_NAME,
      THREAD_POLICY, THREAD_NAME,
      MS_PER_EPOCH,
      SEED_POLICY, INSTANCE_ID,
      AUTH_POLICY, AUTH_NAME,
      GATE_HASH,
      CUSTODY_HASH,
      RESERVE_CAP,
    ],
    soCu: 11,
  },
  {
    // Khe #3 `floor_oildrop` thêm vào cùng đợt với luật A-FLOOR-1. Nó KHÔNG so sánh gì trong
    // `reserve_auth`; nó ở đó để nhánh SINH bác một cấu hình chết, và để có một vế cho cổng
    // FLOOR-PAIR-001 đo — chuỗi không khép được vòng `reserve_auth` ↔ `reserve_gate`.
    mod: "Treasury", title: "reserve_auth.reserve_auth.mint",
    params: [GENESIS_REF, AUTH_NAME, FLOOR],
    soCu: 2,
  },
];

describe.skipIf(!haveBlueprints)("apply-param đường rút Reserve — qua cổng APPLY-001", () => {
  const bp = { Treasury: load(TREASURY_BP), Reserve: load(RESERVE_BP) };

  it("số tham số blueprint khai đúng như chữ ký on-chain sau đợt vá", () => {
    expect(declaredOf(bp.Treasury, "custody_seed.custody_seed.mint")).toBe(1);
    expect(declaredOf(bp.Treasury, "custody.custody.spend")).toBe(5);
    expect(declaredOf(bp.Treasury, "reserve_gate.reserve_gate.spend")).toBe(7);
    expect(declaredOf(bp.Treasury, "reserve_auth.reserve_auth.mint")).toBe(3);
    expect(declaredOf(bp.Reserve, "reserve_draw.reserve_draw.spend")).toBe(12);
  });

  for (const c of CALLS) {
    it(`XANH: ${c.title} — apply ${c.params.length} tham số KHÔNG ném`, () => {
      const script = applyThroughGate(bp[c.mod], c.title, c.params);
      expect(typeof script).toBe("string");
      expect(script.length).toBeGreaterThan(0);
      // Dẫn ra được định danh thật ⇒ compiledCode đã áp đủ tham số, không còn hàm chờ đối số.
      const id = c.title.endsWith(".mint")
        ? mintingPolicyToId({ type: "PlutusV3", script })
        : validatorToScriptHash({ type: "PlutusV3", script });
      expect(id).toMatch(/^[0-9a-f]{56}$/);
    });

    // Vế ĐỎ là vế mua được thứ gì: nó chứng minh cổng THẬT SỰ chặn đúng con số cũ, chứ không
    // phải chỉ tình cờ xanh với con số mới.
    it(`ĐỎ: ${c.title} — số tham số CŨ (${c.soCu}) bị cổng chặn`, () => {
      const cu = c.params.slice(0, c.soCu);
      // Bổ sung nếu số cũ LỚN hơn số mới (reserve_gate 8 > 7, custody_seed 2 > 1).
      while (cu.length < c.soCu) cu.push("00".repeat(28));
      expect(() => applyThroughGate(bp[c.mod], c.title, cu)).toThrow(/APPLY-001/);
    });
  }

  it("ĐỎ: thừa MỘT tham số cũng bị chặn (không chỉ thiếu)", () => {
    const thua = [...CALLS[3]!.params, "ff".repeat(28)];
    expect(() => applyThroughGate(bp.Reserve, "reserve_draw.reserve_draw.spend", thua))
      .toThrow(/APPLY-001/);
  });

  it("ĐỎ: title không có trong blueprint → APPLY-002, không im lặng", () => {
    expect(() => applyThroughGate(bp.Treasury, "khong_ton_tai.khong_ton_tai.spend", []))
      .toThrow(/APPLY-002/);
  });
});

// Không có blueprint thì KÊU, đừng để trạng thái mù lẫn vào màu xanh.
describe.skipIf(haveBlueprints)("apply-param đường rút Reserve — KHÔNG ĐO ĐƯỢC", () => {
  it("thiếu plutus.json ⇒ bài không đo được (chạy `aiken build` ở Treasury/onchain + Reserve/onchain)", () => {
    expect(haveBlueprints).toBe(false);
    console.warn(
      "[KHÔNG ĐO ĐƯỢC] applyReservePath.test.ts bỏ qua: thiếu " +
      `${existsSync(TREASURY_BP) ? "" : TREASURY_BP + " "}${existsSync(RESERVE_BP) ? "" : RESERVE_BP}`,
    );
  });
});
