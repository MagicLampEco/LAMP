// blueprintSource — nối cổng đếm khe (`applyGate.ts`) vào một tệp `plutus.json` cụ thể.
//
// VÌ SAO TÁCH KHỎI `applyGate.ts`: tệp kia THUẦN — không chạm đĩa, không `.env` — nên bài
// kiểm chạm được nó mà không cần `aiken build`. Tệp NÀY là phần chạm đĩa. Giữ hai phần ở
// hai tệp để phần luật (đếm, so, thông điệp lỗi) vẫn kiểm được độc lập với việc cây đã
// dựng hay chưa.
//
// VÌ SAO CÓ TỆP NÀY (đọc trước khi bỏ qua): số khe apply-param phải ĐỌC từ blueprint, không
// được gõ tay. Mỗi module trong kho tự viết lại đoạn "đọc plutus.json → đếm parameters" thì
// đoạn đó lệch nhau theo từng nơi — đã đo được ba mức lỏng khác nhau cùng tồn tại: có nơi
// ép đủ (`Genesis/scripts/config.ts`), có nơi ép nhưng fail-open khi không tra được
// (`Distribution/scripts/blueprint.ts::assertParamCount` trả về khi `meta` rỗng), có nơi
// không ép gì (`Treasury/scripts/config.ts` áp 3 tham số vào validator khai 5).
//
// Blueprint là artefact `aiken build` và bị `.gitignore` chặn (`.gitignore:9`) ⇒ ca "tệp
// không có" xảy ra thật ở mọi cây chưa dựng. Ca đó là KHÔNG ĐO ĐƯỢC, không phải "khớp":
// cổng phải ném, và thông điệp phải nói rõ là không đo được chứ không nói "ổn".

import { readFileSync } from "node:fs";

import { assertParamCount, assertParamCountFromBlueprint, declaredParamCount } from "./applyGate.js";

/** Cổng đếm khe đã gắn với MỘT blueprint. Đọc tệp lazy — lần apply đầu tiên, không lúc import. */
export interface BlueprintGate {
  /** Nhãn nguồn (tên module) — đi vào mọi thông điệp lỗi. */
  readonly source: string;
  /** Đường dẫn tệp blueprint. */
  readonly path: string;
  /** Ép số tham số khớp số khe blueprint khai cho `title`. */
  assertParamCount(title: string, provided: number): void;
  /** Như trên nhưng tra theo `compiledCode` — dùng ở chỗ gọi chỉ cầm bytecode, không cầm tên. */
  assertParamCountOfCode(compiledCode: string, provided: number): void;
  /** Số khe blueprint khai (dùng cho bài kiểm và cho chỗ muốn tự soát trước khi apply). */
  declaredParamCountOf(title: string, provided?: number): number;
}

/**
 * Đọc `plutus.json` — ném APPLY-002 khi tệp không có hoặc không parse được.
 *
 * KHÔNG nuốt lỗi thành `null`: "chưa dựng cây" và "blueprint hỏng" đều là KHÔNG ĐO ĐƯỢC, và
 * cả hai phải kêu. Thông điệp giữ nguyên câu của hệ thống tệp — nó nói được người đọc phải
 * làm gì (`aiken build`), câu "có lỗi xảy ra" thì không.
 */
function readBlueprintFile(path: string, source: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(
      `APPLY-002: không đọc được blueprint '${source}' tại ${path} — ${(e as Error).message}. ` +
      `Blueprint là artefact 'aiken build' và KHÔNG nằm trong kho (.gitignore), nên cây chưa ` +
      `dựng thì cổng đếm khe KHÔNG ĐO ĐƯỢC ⇒ DỪNG (fail-closed). Chạy 'aiken build' trong ` +
      `onchain/ rồi thử lại.`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `APPLY-002: blueprint '${source}' tại ${path} không parse được JSON — ${(e as Error).message}. ` +
      `Cổng đếm khe KHÔNG ĐO ĐƯỢC ⇒ DỪNG (fail-closed); dựng lại bằng 'aiken build'.`,
    );
  }
}

interface CodeEntry { title: string; n: number | null }

/** Bảng tra `compiledCode` → số khe. `n === null` ⇔ blueprint không khai `parameters`. */
function indexByCode(blueprint: unknown): Map<string, CodeEntry> {
  const byCode = new Map<string, CodeEntry>();
  const validators = (blueprint as { validators?: unknown } | null)?.validators;
  if (!Array.isArray(validators)) return byCode;
  for (const v of validators) {
    if (v === null || typeof v !== "object") continue;
    const { title, compiledCode, parameters } = v as {
      title?: unknown; compiledCode?: unknown; parameters?: unknown;
    };
    if (typeof title !== "string" || typeof compiledCode !== "string") continue;
    // `.mint`/`.spend` và `.else` dùng CHUNG compiledCode; giữ tên bản chính để thông điệp
    // lỗi đọc ra đúng validator, không phải nhánh `.else`.
    if (title.endsWith(".else") && byCode.has(compiledCode)) continue;
    byCode.set(compiledCode, { title, n: Array.isArray(parameters) ? parameters.length : null });
  }
  return byCode;
}

/**
 * Dựng cổng đếm khe cho một blueprint.
 *
 * @param path   đường dẫn tuyệt đối tới `plutus.json`
 * @param source nhãn module đi vào thông điệp lỗi (vd `Treasury`, `Faucet`)
 */
export function blueprintGate(path: string, source: string): BlueprintGate {
  let blueprint: unknown;
  let byCode: Map<string, CodeEntry> | undefined;

  function loaded(): unknown {
    if (byCode === undefined) {
      blueprint = readBlueprintFile(path, source);
      byCode = indexByCode(blueprint);
    }
    return blueprint;
  }

  return {
    source,
    path,
    assertParamCount(title: string, provided: number): void {
      assertParamCountFromBlueprint(loaded(), title, source, provided);
    },
    assertParamCountOfCode(compiledCode: string, provided: number): void {
      loaded();
      const meta = byCode!.get(compiledCode);
      if (!meta) {
        // FAIL-CLOSED. Không tra được compiledCode CHÍNH LÀ ca nguy hiểm nhất: không biết
        // blueprint khai bao nhiêu khe thì apply thiếu vẫn chạy trơn và sinh script hash
        // khác, im lặng. Không tra được ⇒ DỪNG, không đoán.
        throw new Error(
          `APPLY-002: compiledCode (chỗ gọi truyền ${provided} tham số) không có trong blueprint ` +
          `'${source}' (${path}) — cổng đếm khe KHÔNG ĐO ĐƯỢC ⇒ DỪNG (fail-closed). Lấy ` +
          `compiledCode từ chính blueprint này, hoặc gọi assertParamCount(title, n) với đúng nguồn.`,
        );
      }
      if (meta.n === null) {
        if (provided === 0) return;   // validator không tham số — xem ghi chú ở applyGate.ts
        throw new Error(
          `APPLY-002: blueprint '${source}' KHÔNG khai 'parameters' cho '${meta.title}' trong khi ` +
          `chỗ gọi truyền ${provided} tham số — cổng đếm khe KHÔNG ĐO ĐƯỢC ⇒ DỪNG (fail-closed).`,
        );
      }
      assertParamCount(`${source}:${meta.title}`, meta.n, provided);
    },
    declaredParamCountOf(title: string, provided = -1): number {
      return declaredParamCount(loaded(), title, source, provided);
    },
  };
}
