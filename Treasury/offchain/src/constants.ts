// Hằng ghim theo onchain — BẢN SAO CÓ NHÃN.
//
// Nguồn duy nhất:
//   `Treasury/onchain/lib/magiclamp/treasury/migrate.ak`
//     • `reserve_inflow_bucket_id`
//     • `reserve_source_tag`
//   `Treasury/onchain/lib/magiclamp/treasury/stake_reward.ak`
//     • `stake_reward_bucket_id`
// Chép ở đây vì off-chain cần GIÁ TRỊ tại chỗ để dựng datum/redeemer, và không có bước
// sinh mã từ .ak. Đối chiếu lúc chép: 2026-09-12, nhánh `fix/reserve-delta-vao-so`.
//
// Tệp RIÊNG (không nằm trong `migrate.ts`) vì cả `migrate.ts` lẫn `collect.ts` đều cần —
// để chung một trong hai thì hai tệp import vòng nhau, và hằng top-level trong vòng import
// ESM đọc ra `undefined` mà không báo lỗi.
//
// ⚠ Hai hằng này ĐƯỢC CƯỠNG CHẾ on-chain (F4). Đổi một bên mà không đổi bên kia thì mọi tx
// MigrateIn bị từ chối; bài kiểm sẽ đỏ trước khi ra mạng.

/** bucket_id DÀNH RIÊNG cho Δ rút từ Reserve chảy vào kho.
 *
 *  Chỉ `MigrateIn` được ghi vào bucket này:
 *    • `collect.all_items_valid` từ chối mọi `CollectItem` mang `category` == id này
 *      ⇒ không đường `Collect` nào ghi lén vào dòng sổ Reserve-inflow;
 *    • `custody_seed` (S-LEDGER-RESERVED) từ chối sổ genesis chứa dòng mang bucket này
 *      ⇒ không seed nào khai khống một số dư Reserve-inflow chưa từng rút.
 *  ⟹ "kho đã nhận bao nhiêu từ Reserve" đọc được bằng đúng một phép tra sổ. */
export const RESERVE_INFLOW_BUCKET_ID = 1_000_000n;

/** Nhãn nguồn BẮT BUỘC trong `MigrateIn { source }` — hex của ASCII "reserve-draw".
 *  Ghim cứng → không đường nào dùng `MigrateIn` để nạp vào một bucket khác. */
export const RESERVE_SOURCE_TAG = "726573657276652d64726177";

/** bucket_id DÀNH RIÊNG cho thưởng uỷ quyền (staking) của CHÍNH kho chảy vào sổ.
 *
 *  Cưỡng chế ở đúng hai đầu như bucket Reserve, và vì cùng một lý do:
 *    • `collect.all_items_valid` (`collect.ak`) từ chối `CollectItem` mang `category` == id này;
 *    • `custody_seed` từ chối sổ genesis chứa dòng mang bucket này.
 *  ⟹ "kho đã nhận bao nhiêu thưởng uỷ quyền" đọc được bằng đúng một phép tra sổ, và không
 *  đường nào khai khống nó.
 *
 *  Chỉ nhận ADA: `stake_reward.reward_policy` là `#""`. Thưởng uỷ quyền trên Cardano không có
 *  biến thể nào khác, nên mở thêm asset chỉ mở bề mặt cho người dựng tx chọn. */
export const STAKE_REWARD_BUCKET_ID = 1_000_001n;
