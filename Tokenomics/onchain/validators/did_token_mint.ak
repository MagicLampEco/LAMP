// did_token_mint — minting policy TỔNG QUÁT cho token do DID quản qua bảng.
//
// Tổng quát hoá lamp_mint: thay vì neo trực tiếp vào DID anchor, neo vào MỘT
// dòng (token_tag) trong Mint-Authority Registry. Một OrgDID phát hành NHIỀU
// token, mỗi token một policy `did_token_mint` (bake token_tag + asset-name
// riêng), quyền mint mỗi token tra trong bảng theo token_tag — đổi quyền
// (Single→Multi→Revoked) = sửa bảng, KHÔNG redeploy policy nào, KHÔNG đẻ khoá.
//
// Quyền mint KHÔNG neo public-key cố định: bảng đọc động qua reference input
// (CIP-31). Authority dòng token có thể là một khoá / multisig / đã thu hồi.
//
// GIỚI HẠN (như lamp_mint): policy gate AI mint (authority qua bảng) + AI tên
// token (asset-name = token_asset_name), KHÔNG gate BAO NHIÊU (cap supply phải
// compose riêng nếu cần).
//
// Tham số bake tại deploy:
//   registry_nft_policy — policy-id registry NFT (= mint_registry script hash).
//   registry_nft_name   — asset-name registry NFT (= blake2b_256(governing_did)).
//   token_tag           — định danh logic dòng token (khoá tra cứu trong bảng).
//   token_asset_name    — asset-name HỢP LỆ DUY NHẤT dưới policy này (khoá C-1).
//
// Aiken 1.1.x / Plutus V3.

use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Transaction}
use magiclamp/tokenomics/registry

/// Redeemer trống — toàn bộ authority neo vào bảng (reference input). Một biến
/// thể để CBOR redeemer xác định.
pub type DidTokenMintRedeemer {
  Mint
}

validator did_token_mint(
  registry_nft_policy: PolicyId,
  registry_nft_name: AssetName,
  token_tag: ByteArray,
  token_asset_name: AssetName,
) {
  mint(_redeemer: DidTokenMintRedeemer, own_policy: PolicyId, self: Transaction) {
    registry.validate_token_mint(
      own_policy,
      registry_nft_policy,
      registry_nft_name,
      token_tag,
      token_asset_name,
      self,
    )
  }

  else(_) {
    fail
  }
}
