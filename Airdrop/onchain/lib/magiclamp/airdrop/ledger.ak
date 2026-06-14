// TIGER Airdrop onchain types — Merkle-airdrop chuẩn, RETRO cho delegator pool TIGER.
//
// ─────────────────────────────────────────────────────────────────────────
// MỤC TIÊU (TOKENOMICS §TIGER Airdrop)
//   0,1 tỷ LAMP = 100_000_000 LAMP = 100_000_000 × 10^6 oil airdrop retro cho
//   delegator TIGER pool theo snapshot. Claim mở 360 epoch sau 29/7; phần DƯ
//   (không ai claim) → hoàn về Treasury. 1 địa chỉ/DID claim đúng phần snapshot,
//   KHÔNG double-claim.
//
// ─────────────────────────────────────────────────────────────────────────
// KIẾN TRÚC NFT-BEACON (phá vòng hash-param chéo — bài học Faucet/Allocation)
// ─────────────────────────────────────────────────────────────────────────
// KHÔNG truyền script-hash chéo giữa pool ↔ marker policy (gây vòng tròn không
// deploy được). GIẢI: 1 minting policy `airdrop_nft` (param: genesis_ref) đúc 2 loại:
//   - POOL NFT   ("APOOL", qty 1) — one-shot, nhận diện airdrop pool UTxO.
//   - CLAIM NFT  (name = leaf hash, qty 1) — nullifier per-leaf (chống double-claim).
//
// Pool validator nhận diện chính nó qua "POOL NFT cùng airdrop_nft_policy".
// Pool ép mỗi Claim ĐÚC đúng 1 CLAIM marker (name = leaf của claimer) → marker
// policy ép leaf khớp. CẢ HAI chỉ tham chiếu `airdrop_nft_policy` → KHÔNG vòng.
//
// ─────────────────────────────────────────────────────────────────────────
// CHỐNG DOUBLE-CLAIM — CLAIM-MARKER NFT làm NULLIFIER (per-leaf)
// ─────────────────────────────────────────────────────────────────────────
// Mỗi leaf (= hash(address|amount)) chỉ claim ĐÚNG 1 lần. Cơ chế:
//   1. Claim ép ĐÚC 1 CLAIM NFT name == leaf của proof, gửi vào `marker_dest`
//      (script KHÔNG có spend path → marker bị KHÓA VĨNH VIỄN → nullifier bất biến).
//   2. Marker policy (MintClaim) ép: name == leaf, qty == +1, KHÔNG đụng POOL NFT,
//      và pool đang được spend (có POOL NFT input) → ủy quyền pool kiểm proof.
//   3. Lần claim 2 cho cùng leaf: ledger Cardano cấm 2 UTxO mang CÙNG (policy,name)
//      cùng tồn tại? KHÔNG — nhưng marker đã bị khóa ở marker_dest VĨNH VIỄN; pool
//      ép marker MỚI phải tới marker_dest. Indexer luôn thấy marker cũ → off-chain
//      từ chối build. Onchain: pool ép `claimed_count` tăng đúng +1 và marker mint
//      qty đúng +1 — cung LAMP bảo toàn tuyệt đối (pool chỉ nhả đúng `amount` mỗi
//      CLAIM marker mới đúc). Xem GHI CHÚ REPLAY ở README.
//
// LÝ DO CHỌN marker-NFT thay nullifier-set/accumulator:
//   - eUTXO: pool permissionless, NHIỀU claimer song song. Accumulator (set trong
//     datum) → tuần tự hoá pool (1 claim/block) → nghẽn. Marker NFT cho phép claim
//     SONG SONG (mỗi tx đúc marker riêng), KHÔNG khoá pool theo thứ tự.
//   - Marker bất biến (no-spend script) = nullifier bền, không cần global scan
//     onchain (vốn bất khả thi trong eUTXO).
//
// ─────────────────────────────────────────────────────────────────────────
// ĐƠN VỊ (1 LAMP = 10^6 oil) — KHỚP @magiclamp/utils OIL_PER_LAMP.

use cardano/address.{Address}

/// Asset name POOL NFT = "APOOL" (#"41504f4f4c"). One-shot, đánh dấu airdrop pool.
pub const pool_nft_name: ByteArray = #"41504f4f4c"

/// Datum của airdrop POOL UTxO. Giữ kho LAMP + tham số airdrop.
///
///   AirdropPool{merkle_root, deadline_epoch, treasury_dest, marker_dest, claimed_count}
///     = Constr(0, [bytes, int, Address, Address, int])
pub type AirdropPool {
  /// Gốc cây Merkle của snapshot (leaf = blake2b_256(address_bytes | amount_le)).
  merkle_root: ByteArray,
  /// Epoch (POSIX-derived) HẾT HẠN claim. Sau mốc này: chỉ Sweep được. Claim ép
  /// now < deadline_epoch. = (epoch 29/7) + 360.
  deadline_epoch: Int,
  /// Địa chỉ Treasury custody — Sweep hoàn LAMP dư về đây sau deadline.
  treasury_dest: Address,
  /// Địa chỉ marker script (no-spend) — CLAIM marker NFT bị khóa vĩnh viễn ở đây.
  marker_dest: Address,
  /// Số leaf đã claim (sổ kế toán; tăng +1 mỗi Claim). KHÔNG dùng làm nullifier
  /// (marker NFT mới là nullifier) — chỉ để báo cáo + bất biến hoá pool flow.
  claimed_count: Int,
}

/// Redeemer của airdrop pool (spend).
pub type AirdropRedeemer {
  /// Claimer present Merkle proof (address, amount, proof) → nhận `amount` LAMP,
  /// đúc CLAIM marker name=leaf. Permissionless (ai cũng build hộ, LAMP về đúng addr).
  Claim {
    /// Address của claimer (khớp leaf + khớp output nhận LAMP).
    claimer: Address,
    /// Lượng LAMP (oil) claimer được nhận (khớp leaf).
    amount: Int,
    /// Merkle proof: list các (is_left, sibling_hash) từ leaf → root.
    proof: List<ProofStep>,
  }
  /// Sau deadline_epoch → toàn bộ LAMP dư về treasury_dest. Permissionless.
  Sweep
}

/// 1 bước Merkle proof: hash anh em + vị trí (sibling bên trái hay phải).
///
///   ProofStep{is_left, hash} = Constr(0, [bool, bytes])
/// is_left = True  → sibling nằm BÊN TRÁI: parent = hash(sibling | current).
/// is_left = False → sibling nằm BÊN PHẢI: parent = hash(current | sibling).
pub type ProofStep {
  is_left: Bool,
  hash: ByteArray,
}

/// Redeemer của airdrop_nft minting policy.
pub type AirdropNftRedeemer {
  /// Đúc POOL NFT one-shot (deploy pool). Bắt buộc consume genesis_ref.
  MintPool
  /// Đúc CLAIM marker (lúc Claim). name == leaf; bắt buộc tx có POOL NFT input.
  MintClaim
}
