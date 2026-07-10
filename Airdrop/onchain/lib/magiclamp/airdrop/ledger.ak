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
// KHÔNG truyền script-hash chéo giữa pool ↔ marker (gây vòng tròn không deploy
// được). GIẢI: 1 minting policy `airdrop_nft` (param: genesis_ref) đúc 2 loại:
//   - POOL NFT   ("APOOL", qty 1) — one-shot, nhận diện airdrop pool UTxO.
//   - CLAIM-SLOT NFT (name = leaf hash, qty 1) — 1 slot/leaf, đúc 1 lần ở SETUP,
//     ĐẶT SẴN ở địa chỉ registry (marker_dest). Claim PHẢI tiêu + BURN slot này.
//
// Marker validator (registry) param `airdrop_nft_policy` (1 chiều, không vòng):
// nó chỉ tham chiếu policy id, KHÔNG tham chiếu pool/treasury script-hash. Pool
// validator tham chiếu `airdrop_nft_policy` để nhận diện POOL NFT. CẢ HAI chỉ
// đọc 1 policy id → KHÔNG vòng tròn.
//
// ─────────────────────────────────────────────────────────────────────────
// CHỐNG DOUBLE-CLAIM — SPEND-ONCE per-leaf claim-slot UTxO (TRUSTLESS)
// ─────────────────────────────────────────────────────────────────────────
// Mỗi leaf (= hash(address|amount)) có ĐÚNG 1 "claim-slot" UTxO mang NFT
// (airdrop_nft_policy, name=leaf, qty 1), đặt ở địa chỉ registry (marker_dest).
// Slot được đúc 1 LẦN DUY NHẤT lúc SETUP (one-shot qua genesis_ref). Cơ chế:
//   1. Claim PHẢI consume slot UTxO của leaf mình + BURN NFT slot
//      (mint qty (policy, leaf) == -1). Slot tiêu rồi BIẾN MẤT khỏi registry.
//   2. Tái sinh slot? Phải re-mint NFT cùng (policy, leaf) — nhưng MintPool
//      one-shot đòi consume genesis_ref ĐÃ BỊ TIÊU lúc SETUP → KHÔNG thể đúc lại
//      → slot không tái sinh được. SPEND-ONCE tuyệt đối, KHÔNG cần indexer.
//   3. Claim 2 cho cùng leaf: slot UTxO đã biến mất ở bước 1 → KHÔNG có input để
//      consume → tx không build được. Onchain ép có-slot-consumed → reject.
//
// KHÁC THIẾT KẾ CŨ (đúc marker tại Claim, khóa ở no-spend): thiết kế cũ DỰA vào
// indexer off-chain để chặn re-claim (replay window). Thiết kế SPEND-ONCE này
// TRUSTLESS hoàn toàn — bảo đảm onchain bằng tính bất khả-tái-sinh của one-shot.
//
// ─────────────────────────────────────────────────────────────────────────
// MÔ HÌNH TIN CẬY (NÓI THẬT — không phóng đại trustless)
// ─────────────────────────────────────────────────────────────────────────
//   SETUP INTEGRITY = DEPLOYER-TRUSTED. Việc đúc ĐÚNG 1 slot/leaf, KHÔNG trùng
//   name, đủ N slot khớp snapshot — do committee deploy (nắm quỹ LAMP) dựng tất
//   định off-chain (deployBuilder). Onchain KHÔNG liệt kê từng leaf nên KHÔNG ép
//   được "đủ và đúng N slot" — committee được tin Ở GIAI ĐOẠN SETUP.
//
//   CHỐNG DOUBLE-CLAIM phía CLAIMER = TRUSTLESS ON-CHAIN. Hai khoá độc lập:
//     (a) SPEND-ONCE: slot đúc 1 lần, claim tiêu + burn, one-shot không tái sinh.
//     (b) GATE claimed_count == 0: MỌI tx đúc slot (genesis VÀ continuation) phải
//         tham chiếu POOL UTxO và ép claimed_count == 0. Burn slot CHỈ xảy ra lúc
//         claim (claimed_count tăng ≥1). Vậy SAU khi claim mở (count>0) KHÔNG AI —
//         kể cả kẻ cầm SETUP authority token — đúc lại được slot tên = leaf đã burn.
//     Continuation còn ép KHÔNG re-mint authority token (chống tự cấp authority mới).
//
//   YÊU CẦU VẬN HÀNH: committee PHẢI BURN SETUP authority token TRƯỚC KHI MỞ CLAIM
//   (tx cuối SETUP burn authority). Nếu không burn, authority còn sống chỉ cho phép
//   đúc thêm slot KHI claimed_count == 0 (chưa ai claim) — vẫn không double-claim
//   được, nhưng burn authority là kỷ luật vận hành chuẩn để đóng hẳn SETUP.
//
// LÝ DO CHỌN per-leaf slot UTxO thay nullifier-set/accumulator:
//   - eUTXO: pool permissionless, NHIỀU claimer song song. Accumulator (set trong
//     datum) → tuần tự hoá pool (1 claim/block) → nghẽn. Slot UTxO riêng từng leaf
//     cho phép claim SONG SONG (mỗi tx tiêu slot riêng), KHÔNG khoá pool theo thứ tự.
//   - Slot bất khả-tái-sinh (one-shot mint) = nullifier bền, không cần global scan
//     onchain (vốn bất khả thi trong eUTXO).
//
// ─────────────────────────────────────────────────────────────────────────
// ĐƠN VỊ (1 LAMP = 10^6 oil) — KHỚP @magiclamp/utils OIL_PER_LAMP.

use cardano/address.{Address}

/// Asset name POOL NFT = "APOOL" (#"41504f4f4c"). One-shot, đánh dấu airdrop pool.
pub const pool_nft_name: ByteArray = #"41504f4f4c"

/// Asset name SETUP authority token = "ASETUP" (#"415345545550"). Đúc cùng POOL
/// NFT ở tx SETUP đầu; nếu N leaf vượt 1 tx, các tx đúc slot tiếp theo đòi token
/// này làm input (ủy quyền SETUP), burn ở tx cuối. KHÁC pool_nft_name + leaf name.
pub const setup_authority_name: ByteArray = #"415345545550"

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
  /// Địa chỉ REGISTRY (marker validator) — nơi chứa toàn bộ claim-slot UTxO.
  /// (ĐỔI NGỮ NGHĨA so với bản cũ "đích đúc marker": nay là địa chỉ slot ngụ.)
  /// Cùng kiểu Address, cùng vị trí field → KHÔNG phá datum schema.
  marker_dest: Address,
  /// Số leaf đã claim (sổ kế toán; tăng +1 mỗi Claim). KHÔNG dùng làm nullifier
  /// (slot UTxO bị tiêu mới là nullifier) — chỉ để báo cáo + bất biến hoá pool flow.
  claimed_count: Int,
}

/// Redeemer của airdrop pool (spend).
pub type AirdropRedeemer {
  /// Claimer present Merkle proof (address, amount, proof) → nhận `amount` LAMP,
  /// tiêu + BURN claim-slot UTxO name=leaf. Permissionless (ai cũng build hộ,
  /// LAMP về đúng addr).
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
  /// SETUP one-shot: đúc POOL NFT + toàn bộ claim-slot (name = leaf). Tx ĐẦU phải
  /// consume genesis_ref; nếu N lớn vượt 1 tx → đúc kèm SETUP authority token, tx
  /// đúc slot tiếp theo đòi authority input, burn authority ở tx cuối. Constr 0.
  MintPool
  /// BurnSlot (GIỮ Constr index 1 để codec offchain không lệch): tiêu + BURN slot
  /// lúc Claim/Sweep. Ép quantity_of(mint, policy, name) == -1, có POOL input,
  /// KHÔNG đụng POOL NFT. (Tên cũ MintClaim đổi ngữ nghĩa: đúc → burn.)
  BurnSlot
}
