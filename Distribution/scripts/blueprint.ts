// Distribution/scripts/blueprint.ts — đọc `onchain/plutus.json` + cổng APPLY-001.
//
// TÁCH RIÊNG khỏi `config.ts` có chủ đích: `config.ts` nạp `.env` (khoá Blockfrost, seed
// ví) ngay lúc import. Cổng an toàn quan trọng nhất của tầng off-chain không được kéo
// theo secret mới chạy được — tách ra đây thì test tự động kiểm được nó mà không đụng
// vào bất kỳ tệp bí mật nào. `config.ts` re-export lại toàn bộ, nên mọi chỗ gọi cũ giữ
// nguyên đường import.
//
// Module này CHỈ phụ thuộc: node:fs, node:url/path, và hàm apply của Lucid.

import {
  applyParamsToScript,
  type Validator, type MintingPolicy,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PLUTUS_JSON_PATH = resolve(__dirname, "../onchain/plutus.json");

export interface RawValidator {
  title: string;
  compiledCode: string;
  hash: string;
  parameters?: unknown[];
}

/** Số tham số blueprint KHAI, tra theo compiledCode. Nạp một lần, giữ trong bộ nhớ. */
const paramCountByCode = new Map<string, { title: string; n: number }>();

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  const vs = json.validators as RawValidator[];
  for (const v of vs) {
    // `.mint`/`.spend` và `.else` dùng CHUNG compiledCode; giữ tên bản chính để thông
    // điệp lỗi đọc ra đúng validator, không phải nhánh `.else`.
    if (v.title.endsWith(".else") && paramCountByCode.has(v.compiledCode)) continue;
    paramCountByCode.set(v.compiledCode, { title: v.title, n: (v.parameters ?? []).length });
  }
  return vs;
}

/** Lấy compiledCode chưa apply cho validator theo title (spend/mint variant). */
export async function rawValidator(title: string): Promise<RawValidator> {
  const vs = await loadBlueprint();
  const v = vs.find((x) => x.title === title);
  if (!v) {
    throw new Error(
      `validator '${title}' không có trong onchain/plutus.json — chạy 'aiken build' trong onchain/ trước.`,
    );
  }
  return v;
}

/**
 * ÉP đủ số tham số blueprint khai, TRƯỚC khi apply.
 *
 * `applyParamsToScript` KHÔNG báo lỗi khi truyền THIẾU tham số: nó apply một phần rồi trả
 * về script hash / policy id **KHÁC**, im lặng. TypeScript không bắt được vì tham số đi
 * theo `unknown[]`. Hậu quả cụ thể ở đây: `claim_account` nay 8 tham số và `treasury` nay
 * 6 (thêm `account_nft_policy` ở cuối) — mọi chỗ gọi còn giữ danh sách 7/5 cũ sẽ deploy ra
 * MỘT BỘ ĐỊA CHỈ KHÁC hẳn bộ mà validator thật cấp phép, và LAMP rót vào đó không burn
 * được, không lấy lại được. Fail-closed ở đây rẻ hơn vô cùng so với phát hiện sau khi rót.
 *
 * Cùng cơ chế đã dùng ở `Genesis/scripts/config.ts` — chốt ở tầng helper để MỌI script
 * Distribution hưởng, không phải nhớ từng chỗ gọi.
 *
 * Lưu ý: cổng chỉ biết những compiledCode đã đi qua `rawValidator` (tức đã nạp blueprint).
 * Code lạ → không đoán, cho qua.
 */
export function assertParamCount(compiledCode: string, params: unknown[]): void {
  const meta = paramCountByCode.get(compiledCode);
  if (!meta) return; // code không từ blueprint này — không đoán.
  if (params.length !== meta.n) {
    throw new Error(
      `APPLY-001: ${meta.title} khai ${meta.n} tham số, chỗ gọi truyền ${params.length}. ` +
      `Apply thiếu tham số KHÔNG báo lỗi — nó sinh policy id/script hash khác, im lặng. ` +
      `Cập nhật danh sách tham số cho khớp blueprint trước khi chạy tiếp.`,
    );
  }
}

/** Plutus Data hex của 1 param list → applied Validator (có cổng APPLY-001). */
export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  assertParamCount(compiledCode, params);
  return {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode, params as never),
  };
}

/** Minting policy đã apply params (cùng cơ chế + cùng cổng APPLY-001). */
export function applyPolicy(compiledCode: string, params: unknown[]): MintingPolicy {
  assertParamCount(compiledCode, params);
  return {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode, params as never),
  };
}

/**
 * Số tham số blueprint khai cho một validator (đọc từ plutus.json, KHÔNG hardcode).
 * Dùng cho kiểm thử cổng APPLY-001 và cho script muốn tự soát trước khi apply.
 */
export async function paramCountOf(title: string): Promise<number> {
  const v = await rawValidator(title);
  return (v.parameters ?? []).length;
}
