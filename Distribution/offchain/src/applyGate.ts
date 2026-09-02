// applyGate — cổng APPLY-001: ép ĐÚNG số tham số apply-param trước khi dựng script.
// Mang sang từ `Genesis/offchain/src/applyGate.ts` (cùng khuôn, cùng lý do tồn tại) —
// LampDistribution có đúng lớp lỗi này: `claim_account` (8 tham số) và `treasury`
// (6 tham số) đều lấy `account_nft_policy` thêm 2026-08-12 (PR #22, điểm 1), và
// `scripts/01_deploy.ts` + `scripts/config.ts::reapplyValidators` từng áp THIẾU đúng
// tham số đó ở CẢ HAI nơi — tự nhất quán với nhau nên phép so `scriptHash(...) !==
// state.claimAccount.hash` không bắt được (so một giá trị sai với chính nó).
//
// Vì sao tách khỏi `scripts/config.ts`: logic ném lỗi ở đó không kiểm tra được. Nó nằm
// trong một hàm private của một module vừa `dotenv.config()` vừa đọc `onchain/plutus.json`
// — mà plutus.json là artefact `aiken build`, KHÔNG có trong repo (.gitignore). Test muốn
// chạm tới cổng phải dựng cả môi trường .env lẫn blueprint. Tách phần THUẦN ra đây; phần
// đọc blueprint ở lại config.ts.
//
// ⚠ VÌ SAO CỔNG NÀY TỒN TẠI (đọc trước khi nới):
// `applyParamsToScript` KHÔNG báo lỗi khi thiếu tham số. Nó apply một phần rồi trả về một
// script hash / policy id **KHÁC**, im lặng. Tiền nạp vào địa chỉ script sai thì không ai
// mở được. TypeScript không bắt được vì tham số đi theo `unknown[]`.

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
