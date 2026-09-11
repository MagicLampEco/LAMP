// applyGate — cổng APPLY-001: ép ĐÚNG số tham số apply-param trước khi dựng script.
//
// Vì sao tách khỏi `scripts/config.ts`: logic ném lỗi ở đó không kiểm tra được. Nó nằm
// trong một hàm private của một module vừa `dotenv.config()` vừa đọc `onchain/plutus.json`
// — mà plutus.json là artefact `aiken build`, KHÔNG có trong repo (.gitignore). Test muốn
// chạm tới cổng phải dựng cả môi trường .env lẫn blueprint. Kết quả: cổng đắt nhất trong
// Genesis chưa từng có test nào. Tách phần THUẦN ra đây; phần đọc blueprint ở lại config.ts.
//
// ⚠ VÌ SAO CỔNG NÀY TỒN TẠI (đọc trước khi nới):
// `applyParamsToScript` KHÔNG báo lỗi khi thiếu tham số. Nó apply một phần rồi trả về một
// script hash / policy id **KHÁC**, im lặng. Với `lamp_mint` nghĩa là đúc LAMP dưới một
// policy id sai — và LAMP **không burn được** (`Treasury/CONTRACT.md §5`), nên sai là không
// sửa được, chỉ còn cách bỏ token. TypeScript không bắt được vì tham số đi theo `unknown[]`.
//
// Đây chính là lỗi làm `01_deploy_lazymint.ts` truyền 8 tham số v1 vào validator 12 tham số
// suốt một thời gian mà không ai thấy.

/**
 * Ném APPLY-001 khi số tham số truyền vào KHÁC số blueprint khai.
 *
 * @param title    tên validator trong blueprint (để thông điệp lỗi chỉ đúng chỗ)
 * @param declared số tham số blueprint khai (`parameters.length` trong plutus.json)
 * @param provided số tham số chỗ gọi thật sự truyền
 */
export function assertParamCount(title: string, declared: number, provided: number): void {
  if (provided !== declared) {
    throw new Error(
      `APPLY-001: ${title} khai ${declared} tham số, chỗ gọi truyền ${provided}. ` +
      `Apply thiếu tham số KHÔNG báo lỗi — nó sinh policy id/script hash khác, im lặng. ` +
      `Cập nhật danh sách tham số cho khớp blueprint trước khi chạy tiếp.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐỌC SỐ KHE TỪ BLUEPRINT — ba trạng thái, trạng thái thứ ba kêu TO HƠN trạng thái thứ hai
//
// `assertParamCount` ở trên nhận `declared` như một CON SỐ. Con số đó phải tới từ blueprint,
// nhưng chữ ký hàm không ép được điều đó: gõ tay `12` vào cũng đi lọt, và lúc validator lên
// 14 khe thì cổng vẫn xanh trong khi nó đang canh một con số đã chết. Phần dưới đây đóng
// đúng lỗ đó — số khe chỉ ĐỌC được từ blueprint, không có đường truyền tay.
//
// Ba trạng thái phải phân biệt được:
//   • khớp            → im lặng, apply tiếp.
//   • lệch            → APPLY-001, thông điệp in CẢ HAI số + tên validator.
//   • KHÔNG ĐO ĐƯỢC   → APPLY-002. Thiếu blueprint · blueprint hỏng · validator không có
//                       trong blueprint · `parameters` vắng mặt trong khi chỗ gọi truyền
//                       tham số. Trạng thái này KHÔNG được đọc thành "khớp": không đo được
//                       mà im lặng cho qua thì màu xanh của cổng chỉ có nghĩa "tôi không
//                       biết", nói bằng giọng của "ổn". Blueprint bị `.gitignore` (nó là
//                       artefact `aiken build`) nên ca này xảy ra thật ở mọi cây chưa dựng.
//
// `parameters` vắng mặt mà chỗ gọi truyền 0 tham số thì KHÔNG ném — đó là hình dạng hợp lệ
// của blueprint Aiken cho validator không có tham số (đo 2026-09-11: `lock_vault.lock_vault
// .spend` trong `Genesis/onchain/plutus.json` không có khoá `parameters`). Và ở đúng ca đó
// không có gì để hỏng: apply 0 tham số là phép đồng nhất, không sinh được script hash khác.
// Rủi ro chỉ xuất hiện khi có ÍT NHẤT một tham số đi vào — nên cổng đo đúng đại lượng đó.
// ─────────────────────────────────────────────────────────────────────────────

/** Một mục validator trong blueprint, đọc ở mức lỏng nhất đủ để đếm khe. */
interface BlueprintValidatorEntry {
  title?: unknown;
  parameters?: unknown;
}

function apply002(message: string): Error {
  return new Error(
    `APPLY-002: ${message} Cổng đếm khe KHÔNG ĐO ĐƯỢC ⇒ DỪNG (fail-closed). ` +
    `Apply thiếu/thừa tham số KHÔNG báo lỗi — nó sinh policy id/script hash khác, im lặng, ` +
    `và tài sản rót vào địa chỉ đó thì không ai mở được.`,
  );
}

/**
 * Số khe apply-param mà blueprint KHAI cho một validator.
 *
 * @param blueprint nội dung `plutus.json` đã parse (KHÔNG nhận đường dẫn — hàm này thuần,
 *                  không đụng đĩa, để bài kiểm chạm được mà không cần `aiken build`)
 * @param title     tên validator trong blueprint, vd `custody.custody.spend`
 * @param source    nhãn nguồn blueprint để thông điệp lỗi chỉ đúng module (vd `Treasury`)
 * @param provided  số tham số chỗ gọi sắp truyền — chỉ dùng để phân biệt ca `parameters`
 *                  vắng mặt hợp lệ (0 khe) với ca không đo được
 */
export function declaredParamCount(
  blueprint: unknown,
  title: string,
  source: string,
  provided: number,
): number {
  if (blueprint === null || typeof blueprint !== "object") {
    throw apply002(
      `blueprint '${source}' không đọc được thành đối tượng (nhận ${blueprint === null ? "null" : typeof blueprint}) ` +
      `nên không tra được số khe của '${title}'.`,
    );
  }
  const validators = (blueprint as { validators?: unknown }).validators;
  if (!Array.isArray(validators)) {
    throw apply002(
      `blueprint '${source}' không có mảng 'validators' nên không tra được số khe của '${title}'.`,
    );
  }
  const entry = validators.find(
    (v): v is BlueprintValidatorEntry =>
      v !== null && typeof v === "object" && (v as BlueprintValidatorEntry).title === title,
  );
  if (!entry) {
    const known = validators
      .map((v) => (v !== null && typeof v === "object" ? (v as BlueprintValidatorEntry).title : undefined))
      .filter((t): t is string => typeof t === "string");
    throw apply002(
      `blueprint '${source}' KHÔNG khai validator '${title}'. Blueprint hiện khai: ` +
      `${known.length ? known.join(", ") : "(không validator nào)"}.`,
    );
  }
  const params = entry.parameters;
  if (Array.isArray(params)) return params.length;
  if (provided === 0) return 0;   // validator không tham số — hình dạng blueprint hợp lệ
  throw apply002(
    `blueprint '${source}' KHÔNG khai 'parameters' cho '${title}' (đọc ra ${typeof params}), ` +
    `trong khi chỗ gọi truyền ${provided} tham số — không suy đoán số khe.`,
  );
}

/**
 * Cổng ĐẦY ĐỦ: đọc số khe từ blueprint rồi ép khớp. Đây là đường mà mọi chỗ apply-param
 * nên đi — nó không có tham số nào cho phép gõ tay số khe.
 */
export function assertParamCountFromBlueprint(
  blueprint: unknown,
  title: string,
  source: string,
  provided: number,
): void {
  assertParamCount(`${source}:${title}`, declaredParamCount(blueprint, title, source, provided), provided);
}
