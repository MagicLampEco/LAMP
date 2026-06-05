// Treasury offchain types — mirror onchain lib/magiclamp/treasury/types.ak.
//
// PHẢI khớp byte-perfect với types.ak. Constr index = thứ tự khai báo trong
// types.ak (Aiken đánh số constructor từ 0 theo thứ tự xuất hiện).

/** Một dòng sổ kế toán: số dư của 1 asset trong 1 bucket.
 *  ADA: policy = "" (rỗng), name = "". */
export interface LedgerEntry {
  bucket_id : bigint;
  policy    : string;   // hex (policy id; "" cho lovelace)
  name      : string;   // hex (asset name; "" cho lovelace)
  amount    : bigint;
}

/** Asset được nhận (đa thuê bao). Chỉ dùng (policy, name). */
export interface AssetKey {
  policy : string;   // hex
  name   : string;   // hex
}

/** Datum custody — value đa-asset trong UTxO, bucket là sổ trong datum.
 *  cut_bps + governance_ref ở DATUM (DAO chỉnh), KHÔNG ở param. */
export interface CustodyDatum {
  instance_id     : string;        // hex — định danh instance (đa thuê bao)
  accepted_assets : AssetKey[];    // (policy,name) được nhận
  ledger          : LedgerEntry[]; // sổ kế toán đa-asset × bucket
  cut_bps         : bigint;        // bps cắt về bucket (DAO chỉnh) ∈ [0,10000]
  governance_ref  : string;        // hex — script hash Governance gắn treasury này
  epoch           : bigint;        // epoch cập nhật gần nhất
}

/** Một micro-collect (gộp lô N item vào 1 settlement tx — anti-bloat).
 *  amount đã được app định giá (Treasury KHÔNG định giá). */
export interface CollectItem {
  app_id   : string;   // hex — ai trả (generators/OriLife/app)
  policy   : string;   // hex — asset
  name     : string;   // hex
  amount   : bigint;   // số đã định giá ở app
  category : bigint;   // bucket_id đích cho phần cut
}

export interface ReleaseDraw {
  bucket_id : bigint;
  policy    : string;
  name      : string;
  amount    : bigint;
}

export interface BucketMove {
  from_bucket : bigint;
  to_bucket   : bigint;
  policy      : string;
  name        : string;
  amount      : bigint;
}

/** CustodyRedeemer variants (mirror types.ak khai báo). */
export type CustodyRedeemer =
  | { kind: "Collect";   items: CollectItem[] }
  | { kind: "Release";   draws: ReleaseDraw[] }
  | { kind: "Rebalance"; moves: BucketMove[] }
  | { kind: "MigrateIn"; source: string };
