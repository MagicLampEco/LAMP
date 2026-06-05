// Treasury onchain types — interface contract (CONTRACT §1, §3; TECH §3).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).
//
// Phạm vi v1: validator COLLECT (nhánh `Collect`) + RELEASE (nhánh `Release`,
// Model A — đọc kết quả Governance qua reference input beacon ProposalResult).
// Các nhánh Rebalance/Migrate khai báo trong CustodyRedeemer để giữ index Constr
// ổn định cho offchain, nhưng chưa triển khai.

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
  governance_ref  : ByteArray,        // script hash Governance gắn với treasury này
  epoch           : Int,              // epoch cập nhật gần nhất
  // SINGLE-USE marker chống replay proposal (HARD BLOCKER finding 7, TECH §7.2 / câu treo #2).
  // v1 KHÔNG vesting: mỗi proposal chi ĐÚNG MỘT LẦN → released_cumulative ngầm = toàn bộ.
  // Reference input (Model A) đọc lại được vô hạn → custody PHẢI nhớ proposal đã dùng.
  // Release ép proposal_id ∉ consumed_proposals (chưa dùng) rồi append id vào out_datum.
  // Tách khỏi `ledger` → KHÔNG đụng bất biến sổ↔value (T3); Collect chỉ bảo toàn list này.
  consumed_proposals : List<ByteArray>,// proposal_id đã chi (đơn điệu tăng, không xóa)
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
  // MIGRATE value treasury cũ vào instance (v1.x — chưa triển khai)
  MigrateIn { source: ByteArray }
}
