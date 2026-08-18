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
