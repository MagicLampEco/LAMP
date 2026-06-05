// Treasury onchain types — interface contract (CONTRACT §1, §3; TECH §3).
// Phải khớp byte-perfect với offchain types.ts (Constr index theo thứ tự khai báo).
//
// Phạm vi v1: validator COLLECT (nhánh `Collect` của Custody). Các nhánh
// Release/Rebalance/Migrate khai báo trong CustodyRedeemer để giữ index Constr
// ổn định cho offchain, nhưng v1 chỉ triển khai `Collect`.

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
}

/// Một micro-collect (gộp lô N item vào 1 settlement tx — anti-bloat).
pub type CollectItem {
  app_id   : ByteArray,   // ai trả (generators/OriLife/app) — receipt + tín dụng VP
  policy   : ByteArray,   // asset
  name     : ByteArray,
  amount   : Int,         // số đã định giá ở app (Treasury KHÔNG định giá)
  category : Int,         // bucket_id đích cho phần cut
}

pub type ReleaseDraw {
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
  amount    : Int,
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
  // CHI: release theo proposal đã pass (v1.x — chưa triển khai)
  Release { draws: List<ReleaseDraw> }
  // CHUYỂN nội bộ giữa bucket (v1.x — chưa triển khai)
  Rebalance { moves: List<BucketMove> }
  // MIGRATE value treasury cũ vào instance (v1.x — chưa triển khai)
  MigrateIn { source: ByteArray }
}
