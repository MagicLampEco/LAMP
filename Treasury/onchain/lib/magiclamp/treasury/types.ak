// Treasury onchain types — interface contract (CONTRACT §1, §3; TECH §3).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).
//
// Phạm vi v1: nhánh `Collect`, `Release` (Model A — đọc kết quả Governance qua reference
// input beacon ProposalResult), `MigrateIn` (nạp Δ LAMP vừa đúc từ Reserve), `StakeRewardIn`
// và `Deposit`. Riêng `Rebalance` khai báo trong CustodyRedeemer để giữ index Constr ổn
// định cho offchain, nhưng chưa triển khai.

use cardano/address.{Address}
use cardano/transaction.{OutputReference}

/// Một dòng sổ kế toán: số dư của 1 asset trong 1 bucket.
/// ADA: policy = #"" , name = #"". Sổ = List các dòng này (KHÔNG mỗi bucket 1 UTxO).
/// Bất biến nền: ∀a Σ_b balances[(b,a)] == custody.value(a) − reserved_min_ada(a).
pub type LedgerEntry {
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
  amount    : Int,
}

/// Asset được nhận (đa thuê bao). Chỉ dùng (policy, name).
pub type AssetKey {
  policy : ByteArray,
  name   : ByteArray,
}

/// Datum custody — value đa-asset nằm trong UTxO, bucket là sổ trong datum.
/// (TECH §3: cut_bps/governance_ref ở DATUM, KHÔNG ở param — để DAO chỉnh.)
pub type CustodyDatum {
  instance_id     : ByteArray,        // định danh instance (đa thuê bao, audit)
  accepted_assets : List<AssetKey>,   // (policy,name) được nhận
  ledger          : List<LedgerEntry>,// sổ kế toán đa-asset × bucket
  cut_bps         : Int,              // bps cắt về bucket (DAO chỉnh)
  governance_ref  : ByteArray,        // policy id NFT con trỏ governance (== tham số pointer_policy của custody; KHÔNG phải script Governance — GovernancePointer.md)
  epoch           : Int,              // epoch cập nhật gần nhất
  // SINGLE-USE marker chống replay proposal (HARD BLOCKER finding 7, TECH §7.2 / câu treo #2).
  // v1 KHÔNG vesting: mỗi proposal chi ĐÚNG MỘT LẦN → released_cumulative ngầm = toàn bộ.
  // Reference input (Model A) đọc lại được vô hạn → custody PHẢI nhớ proposal đã dùng.
  // Release ép proposal_id ∉ consumed_proposals (chưa dùng) rồi append id vào out_datum.
  // Tách khỏi `ledger` → KHÔNG đụng bất biến sổ↔value (T3); Collect chỉ bảo toàn list này.
  consumed_proposals : List<ByteArray>,// proposal_id đã chi (đơn điệu tăng, không xóa)
  // DANH SÁCH ĐÓNG các bucket_id mà `Collect` được ghi vào (S-BUCKETS-*, C-COL-CAT).
  // `CONTRACT.md §1` đã khai `buckets[]` là tham số instance nằm ở DATUM từ đầu; trường này
  // là chỗ nó thật sự sống, trước đây thiếu nên `CollectItem.category` là một `Int` TỰ DO.
  //
  // VÌ SAO Ở CUỐI, không chèn vào giữa cho gần `accepted_assets`/`cut_bps`: thứ tự trường
  // quyết định layout CBOR của datum. Chèn giữa làm mọi `CustodyDatum` đã mã hoá trỏ sai
  // trường, và nó KHÔNG lỗi lúc build — nó lỗi lúc validator giải mã. Thêm ở cuối giữ
  // nguyên chỉ số 0..6, y lý lẽ đã dùng cho `StakeRewardIn` (index Constr 4) dưới đây.
  // Lúc thêm trường này chưa instance nào được gieo, nên khi đó hai cách đều chạy được;
  // đã chọn cách không phụ thuộc vào dữ kiện đó. Nay đã có instance gieo trên chuỗi
  // (Preprod), nên mọi thay đổi layout từ đây đều đòi di trú datum.
  //
  // Bất biến đời instance: ép MỘT LẦN tại `custody_seed` (khác rỗng, tăng nghiêm ngặt,
  // không chứa bucket dành riêng) rồi mọi nhánh tiêu kho ghim `out.buckets == in.buckets`.
  buckets            : List<Int>,      // bucket_id hợp lệ cho Collect (tăng nghiêm ngặt)
}

/// Một micro-collect (gộp lô N item vào 1 settlement tx — anti-bloat).
pub type CollectItem {
  app_id   : ByteArray,   // ai trả (generators/OriLife/app) — receipt + tín dụng VP
  policy   : ByteArray,   // asset
  name     : ByteArray,
  amount   : Int,         // số đã định giá ở app (Treasury KHÔNG định giá)
  category : Int,         // bucket_id đích cho phần cut
}

/// Một dòng chi (release): rút `amount` của asset từ `bucket_id` gửi tới `to`.
/// `to` là Address người nhận — KHÓA vào spend_spec_hash (proposal cam kết ai/bao nhiêu).
pub type ReleaseDraw {
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
  amount    : Int,
  to        : Address,
}

/// Trạng thái proposal (mirror Governance ProposalDatum.status). Release chỉ chi khi
/// == Executed (Model A — Governance đã ép ngưỡng + chuyển Tallied→Executed ở tx riêng).
/// Constr index theo thứ tự khai báo — phải khớp Governance.
pub type ProposalStatus {
  Open
  Tallied
  Executed
  Rejected
}

/// Beacon kết quả Governance — phơi ở Proposal UTxO mang Proposal authenticity NFT
/// one-shot (mẫu beacon_nft.ak). Release ĐỌC qua REFERENCE INPUT (CIP-31), KHÔNG tiêu
/// (nhiều release/vesting đọc song song). v1: type + giả lập trong test (chưa cần
/// validator Governance thật). spend_spec_hash = blake2b_256 canonical danh sách draw.
pub type ProposalResult {
  proposal_id         : ByteArray,
  status              : ProposalStatus,
  spend_spec_hash     : ByteArray,
  execute_after_epoch : Int,
  released_cumulative : Int,
}

pub type BucketMove {
  from_bucket : Int,
  to_bucket   : Int,
  policy      : ByteArray,
  name        : ByteArray,
  amount      : Int,
}

pub type CustodyRedeemer {
  // THU: gộp lô N collect vào 1 settlement tx (v1 — triển khai)
  Collect { items: List<CollectItem> }
  // CHI: release theo proposal đã Executed. proposal_ref trỏ reference input mang
  // Proposal NFT + ProposalResult; draws = danh sách rút thực tế (khớp spend_spec_hash).
  Release { proposal_ref: OutputReference, draws: List<ReleaseDraw> }
  // CHUYỂN nội bộ giữa bucket (v1.x — chưa triển khai)
  Rebalance { moves: List<BucketMove> }
  // NẠP Δ LAMP vừa đúc từ Reserve (nhánh ReserveDraw) vào value VÀ sổ — đã triển khai,
  // xem `migrate.ak`. (Thiết kế cũ "migrate treasury cũ" không được hiện thực.)
  MigrateIn { source: ByteArray }
  // NẠP phần thưởng uỷ quyền của chính kho vào value VÀ vào SỔ (v1.x — triển khai).
  // `amount` = Δ lovelace KHAI BÁO; validator ép nó khớp ĐẲNG THỨC với độ tăng lovelace
  // thực của UTxO kho, nên khai dối chỉ làm tx bị từ chối, không rút thêm được gì.
  // ⚠ Constr index 4 — thêm Ở CUỐI để index 0..3 (Collect/Release/Rebalance/MigrateIn)
  // giữ nguyên với offchain `encodeCustodyRedeemer` (Treasury/tests/datum.test.ts).
  StakeRewardIn { amount: Int }
  // NẠP 100% vào kho (P7, CONTRACT §15.2): khoản phải vào kho TRỌN VẸN — ADA thưởng staking của
  // SRCL, LAMP dư khi Sweep, số dư quét từ kho cũ khi chuyển pha governance. PERMISSIONLESS như
  // `Collect`, cùng mọi ràng buộc của nó, nhưng mỗi item vào sổ ĐỦ `amount` (không cắt `cut_bps`)
  // và `amount > 0` (chặt hơn `≥ 0` của Collect).
  // Tái dùng `CollectItem` chứ không đặt `DepositItem`: cần đúng năm trường ấy (asset, amount,
  // category + `app_id` làm nhãn nguồn cho kiểm toán), và nhờ đó `collect.all_items_valid` /
  // `ledger_ok` / `value_ok` áp NGUYÊN VĂN với cut_bps = 10000 — một nguồn logic, không bản sao
  // nào trôi riêng. ⚠ `app_id` ở đây KHÔNG phải tín dụng VP (CONTRACT §3.4 F8 vẫn áp).
  // ⚠ Constr index 5 — thêm Ở CUỐI để 0..4 giữ nguyên.
  Deposit { items: List<CollectItem> }
}

// ── NFT con trỏ governance (Treasury/GovernancePointer.md v0.1) ─────────────────
// `CustodyDatum.governance_ref` mang policy id của NFT con trỏ; custody đọc
// `PointerDatum.governance_hash` qua reference input để biết governance nào đang có quyền
// duyệt Release. Thứ tự trường và thứ tự Constr là hợp đồng với off-chain
// (`Treasury/offchain/src/datum.ts` ▸ `pointerDatumToCbor`, `pointerRedeemerToCbor`).

/// Thay đổi con trỏ đang chờ hết hạn trễ (`CommitteePropose` → `ApplyPending`).
pub type Pending {
  new_hash           : ByteArray,
  effective_after_ms : Int,
}

/// Datum inline của UTxO mang NFT con trỏ.
pub type PointerDatum {
  governance_hash : ByteArray,                 // 28 byte, hoặc rỗng khi chưa có governance chạy được
  committee       : List<ByteArray>,           // VerificationKeyHash, 28 byte, không trùng
  threshold       : Int,                       // 1 ≤ threshold ≤ |committee|
  sealed          : Bool,                      // niêm phong một chiều: committee mất quyền
  pending         : Option<Pending>,
}

pub type PointerRedeemer {
  CommitteePropose { new_hash: ByteArray }
  ApplyPending
  CommitteeCancel
  Seal
  GovernanceSet { new_hash: ByteArray, proposal_ref: OutputReference }
}
