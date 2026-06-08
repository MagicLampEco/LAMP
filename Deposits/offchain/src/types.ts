// Deposits offchain types — mirror onchain lib/magiclamp/deposits/types.ak.
//
// PHẢI khớp byte-perfect với types.ak. Constr index = thứ tự khai báo trong
// types.ak (Aiken đánh số constructor từ 0 theo thứ tự xuất hiện).
//
// v2 (anh chốt 2026-06-08): DepositLine + classification; DepositParam beacon;
// Deposit redeemer mang phân loại + deposit_ref; Escheat redeemer mới.

/** OutputReference — mirror Plutus. txHash hex + index. */
export interface OutRef {
  txHash : string;   // hex (32 byte transaction id)
  index  : bigint;   // output index
}

/** Một dòng cọc trong sổ pot. Khóa = (entity_id, depositor, policy, name).
 *  amount > 0 luôn. ADA: policy="" name="". v2: lưu classification (audit). */
export interface DepositLine {
  entity_id       : string;   // hex — AssetDID con vật/cây / nhóm / hợp đồng
  depositor       : string;   // hex pkh — người TẠO (creator-refund)
  policy          : string;   // hex (policy id; "" cho lovelace)
  name            : string;   // hex (asset name; "" cho lovelace)
  amount          : bigint;
  epoch           : bigint;   // epoch gửi (mốc tính escheat)
  asset_type      : bigint;
  value_tier      : bigint;
  lifecycle_class : bigint;
}

/** Asset được nhận (đa thuê bao). Chỉ dùng (policy, name). */
export interface AssetKey {
  policy : string;   // hex
  name   : string;   // hex
}

/** Credential người — mirror Plutus `Credential`.
 *  Constr: VerificationKey(hash) = Constr(0,[bytes]); Script(hash) = Constr(1,[bytes]). */
export type Credential =
  | { kind: "VerificationKey"; hash: string }   // ví thường / council key (pkh)
  | { kind: "Script";          hash: string };  // validator lifecycle / Treasury (hash)

/** Một hàng bảng phí cọc (governance param). */
export interface DepositTier {
  asset_type      : bigint;
  value_tier      : bigint;
  lifecycle_class : bigint;
  base_deposit    : bigint;   // ≥ 0 (oil) — 0 hợp lệ (cọc ≈ 0)
}

/** Datum beacon DepositParam (reference input — CIP-31).
 *  required(tier) = base_deposit × demand_mult / Q (Q=1e9). */
export interface DepositParam {
  tiers       : DepositTier[];
  demand_mult : bigint;
  m_min       : bigint;
  m_max       : bigint;
  epoch       : bigint;
}

/** Datum pot — value bond đa-asset trong UTxO, sổ cọc là dòng trong datum.
 *  params bảo toàn qua mọi tx; chỉ ledger + epoch đổi. */
export interface PotDatum {
  instance_id          : string;         // hex — định danh instance
  accepted_assets      : AssetKey[];     // (policy,name) được nhận
  lifecycle_authority  : Credential;     // ai (ngoài depositor) được trigger Refund
  reserved_min_ada     : bigint;         // lovelace giữ min-UTxO, KHÔNG ghi sổ
  // v2 params:
  deposit_param_policy : string;         // hex — policy NFT xác thực beacon
  deposit_param_name   : string;         // hex — name NFT xác thực beacon
  treasury_credential  : Credential;     // đích escheat (Treasury/Reserve)
  escheat_after_epoch  : bigint;         // số epoch sau deposit mới được escheat
  ms_per_epoch         : bigint;         // POSIX ms / epoch
  // state:
  ledger               : DepositLine[];  // sổ cọc
  epoch                : bigint;         // epoch cập nhật gần nhất
}

/** DepositsRedeemer (mirror types.ak). Constr: Deposit=0, Refund=1, Escheat=2. */
export type DepositsRedeemer =
  | {
      kind: "Deposit";
      entity_id: string; depositor: string; policy: string; name: string;
      asset_type: bigint; value_tier: bigint; lifecycle_class: bigint;
      deposit_ref: OutRef;
    }
  | { kind: "Refund";  entity_id: string; depositor: string; policy: string; name: string }
  | { kind: "Escheat"; entity_id: string; depositor: string; policy: string; name: string };
