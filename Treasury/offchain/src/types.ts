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
  // SINGLE-USE marker chống replay proposal (HARD BLOCKER finding 7, TECH §7.2).
  // proposal_id (hex) đã chi — Release append id mới, chặn dùng lại cùng proposal.
  consumed_proposals : string[];   // hex[] — proposal_id đã chi (đơn điệu tăng)
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

/** Credential người nhận — mirror Plutus `Credential`.
 *  Constr: VerificationKey(hash) = Constr(0,[bytes]); Script(hash) = Constr(1,[bytes]). */
export type Credential =
  | { kind: "VerificationKey"; hash: string }   // ví thường (pkh)
  | { kind: "Script";          hash: string };  // script (validator hash)

/** Stake credential (chỉ Inline trong v1 — Pointer hiếm, không hỗ trợ).
 *  Inline(Credential) = Constr(0,[Credential]). */
export type StakeCredential = { kind: "Inline"; credential: Credential };

/** Địa chỉ người nhận — mirror Plutus `Address` onchain (cardano/address.Address).
 *  Address = Constr(0,[PaymentCredential, Option<StakeCredential>]).
 *  Option: Some(x)=Constr(0,[x]); None=Constr(1,[]). */
export interface Address {
  payment_credential : Credential;
  stake_credential   : StakeCredential | null;   // null = None (không stake)
}

/** Một dòng chi (release): rút `amount` của asset từ `bucket_id` gửi tới `to`.
 *  `to` KHÓA vào spend_spec_hash — proposal cam kết ai/bao nhiêu. */
export interface ReleaseDraw {
  bucket_id : bigint;
  policy    : string;
  name      : string;
  amount    : bigint;
  to        : Address;
}

/** Trạng thái proposal (mirror Governance ProposalDatum.status).
 *  Constr index theo thứ tự khai báo: Open=0, Tallied=1, Executed=2, Rejected=3. */
export type ProposalStatus = "Open" | "Tallied" | "Executed" | "Rejected";

/** Beacon kết quả Governance — phơi ở Proposal UTxO mang Proposal NFT one-shot.
 *  Release ĐỌC qua REFERENCE INPUT (CIP-31), KHÔNG tiêu. Mirror types.ak ProposalResult. */
export interface ProposalResult {
  proposal_id         : string;          // hex
  status              : ProposalStatus;
  spend_spec_hash     : string;          // hex — blake2b_256 canonical danh sách draw
  execute_after_epoch : bigint;          // time-lock
  released_cumulative : bigint;          // chống chi vượt qua nhiều tx (vesting)
}

export interface BucketMove {
  from_bucket : bigint;
  to_bucket   : bigint;
  policy      : string;
  name        : string;
  amount      : bigint;
}

/** Tham chiếu UTxO — mirror Plutus `OutputReference`.
 *  Constr(0, [transaction_id:bytes, output_index:int]). */
export interface OutputReference {
  transaction_id : string;   // hex tx hash
  output_index   : bigint;
}

/** CustodyRedeemer variants (mirror types.ak khai báo).
 *  Release nay mang proposal_ref (reference input beacon) + draws (đích chi). */
export type CustodyRedeemer =
  | { kind: "Collect";   items: CollectItem[] }
  | { kind: "Release";   proposal_ref: OutputReference; draws: ReleaseDraw[] }
  | { kind: "Rebalance"; moves: BucketMove[] }
  | { kind: "MigrateIn"; source: string };
