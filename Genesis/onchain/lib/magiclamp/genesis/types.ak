// Genesis types — mirror Treasury types.ak CustodyDatum (byte-perfect, cùng Constr
// index). Genesis KHÔNG sửa Treasury; tái khai báo cùng schema để self-contained on-chain
// (aiken chỉ hỗ trợ github dep, không local). Mọi pot custody dùng CHÍNH schema này nên
// custody.ak Treasury spend được UTxO genesis về sau.

/// Dòng sổ kế toán — số dư 1 asset trong 1 bucket. ADA: policy=#"" name=#"".
pub type LedgerEntry {
  bucket_id : Int,
  policy    : ByteArray,
  name      : ByteArray,
  amount    : Int,
}

/// Asset được nhận (đa thuê bao).
pub type AssetKey {
  policy : ByteArray,
  name   : ByteArray,
}

/// Datum custody — KHỚP byte-perfect Treasury CustodyDatum (7 field, Constr 0).
pub type CustodyDatum {
  instance_id        : ByteArray,
  accepted_assets    : List<AssetKey>,
  ledger             : List<LedgerEntry>,
  cut_bps            : Int,
  governance_ref     : ByteArray,
  epoch              : Int,
  consumed_proposals : List<ByteArray>,
}
