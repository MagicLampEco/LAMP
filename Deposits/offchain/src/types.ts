// Deposits offchain types — mirror onchain lib/magiclamp/deposits/types.ak.
//
// PHẢI khớp byte-perfect với types.ak. Constr index = thứ tự khai báo trong
// types.ak (Aiken đánh số constructor từ 0 theo thứ tự xuất hiện).

/** Một dòng cọc trong sổ pot. Khóa = (entity_id, depositor, policy, name).
 *  amount > 0 luôn. ADA: policy="" name="". */
export interface DepositLine {
  entity_id : string;   // hex — AssetDID con vật/cây / nhóm / hợp đồng
  depositor : string;   // hex pkh — người DUY NHẤT được hoàn
  policy    : string;   // hex (policy id; "" cho lovelace)
  name      : string;   // hex (asset name; "" cho lovelace)
  amount    : bigint;
  epoch     : bigint;
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
  | { kind: "Script";          hash: string };  // validator lifecycle (hash)

/** Datum pot — value bond đa-asset trong UTxO, sổ cọc là dòng trong datum.
 *  params (instance_id, accepted_assets, lifecycle_authority, reserved_min_ada)
 *  bảo toàn qua mọi tx; chỉ ledger + epoch đổi. */
export interface PotDatum {
  instance_id         : string;         // hex — định danh instance
  accepted_assets     : AssetKey[];     // (policy,name) được nhận
  lifecycle_authority : Credential;     // ai (ngoài depositor) được trigger Refund
  reserved_min_ada    : bigint;         // lovelace giữ min-UTxO, KHÔNG ghi sổ
  ledger              : DepositLine[];  // sổ cọc
  epoch               : bigint;         // epoch cập nhật gần nhất
}

/** DepositsRedeemer (mirror types.ak). Constr: Deposit=0, Refund=1. */
export type DepositsRedeemer =
  | { kind: "Deposit"; entity_id: string; depositor: string; policy: string; name: string; amount: bigint }
  | { kind: "Refund";  entity_id: string; depositor: string; policy: string; name: string };
