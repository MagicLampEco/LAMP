// SRCL onchain types — reward-redirect SRCL cho LAMP.
//
// ─────────────────────────────────────────────────────────────────────────
// CƠ CHẾ (reward-redirect, per-epoch Merkle distribution)
// ─────────────────────────────────────────────────────────────────────────
// 2 công ty vận hành pool SPO. Delegator ủy thác ADA → reward ADA (margin) do
// 2 cty thu. ĐỔI LẠI: delegator nhận LAMP theo TỶ LỆ STAKE mỗi epoch.
//   Tổng 1 tỷ LAMP (1_000_000_000 × 10^6 oil) chia đều 36 epoch.
//   entitlement_e[addr] = (1e9/36) LAMP × stake_e[addr] / Σ stake_e
//
// Phần OFF-CHAIN (vận hành SPO + thu reward ADA) KHÔNG on-chain — là thao tác
// 2 cty. Phần ON-CHAIN = cơ chế phân phối LAMP cho delegator theo snapshot
// stake mỗi epoch, dùng Merkle proof per-epoch.
//
// ─────────────────────────────────────────────────────────────────────────
// KIẾN TRÚC NFT-BEACON (phá vòng hash-param chéo, như Faucet)
// ─────────────────────────────────────────────────────────────────────────
// 1 minting policy `srcl_nft` (param: genesis_ref) đúc 2 loại token:
//   - POOL NFT  ("SRCL", one-shot, qty 1) — nhận diện SRCL pool UTxO.
//   - SLOT NFT  (name = blake2b_256(epoch || addr), qty 1) — claim-slot DUY NHẤT
//     cho cặp (epoch, addr). Đúc kèm SetRoot epoch e (1 slot/owner), GIỮ ở
//     registry script (srcl_marker). Claim PHẢI consume + BURN slot.
//
// ─────────────────────────────────────────────────────────────────────────
// CHỐNG DOUBLE-CLAIM — 2 TẦNG, MỨC TIN CẬY KHÁC NHAU (đọc kỹ, KHÔNG phóng đại)
// ─────────────────────────────────────────────────────────────────────────
//   TẦNG 1 — phía CLAIMER = TRUSTLESS (spend-once, KHÔNG cần indexer off-chain):
//     Mỗi entitlement (epoch, owner) ↔ ĐÚNG 1 slot UTxO ở registry. Claim ép:
//       consume slot (epoch,owner) từ registry + BURN nó (mint qty −1). Slot đã
//       tiêu = UTxO biến mất → với BỘ SLOT CHO TRƯỚC, claimer KHÔNG thể claim
//       lại cặp (epoch,owner) đã burn. Tính duy-nhất phía claimer dựa SPEND-ONCE
//       của ledger eUTxO — KHÔNG cần thiện chí/indexer nào.
//
//   TẦNG 2 — slot-set integrity = ADMIN-THRESHOLD-TRUSTED (KHÔNG trustless tuyệt
//     đối, KHÔNG độc lập admin):
//       "Bộ slot đúc lúc SetRoot khớp ĐÚNG leaf của root e, và KHÔNG đúc lại slot
//       của epoch đã claim" được bảo đảm bởi NGƯỠNG admin ở SetRoot — cùng mức
//       tin cậy đã có khi admin nạp root. On-chain CHỈ ép: slot không rò ra ngoài
//       registry + không đụng POOL NFT. On-chain KHÔNG ép tên slot mã hoá đúng
//       epoch đang append (tên = blake2b hash → không có preimage để kiểm rẻ).
//       ⇒ Admin đủ ngưỡng, NẾU cấu kết, CÓ THỂ tại SetRoot epoch sau đúc lại slot
//       tên = marker_name(epoch_cũ, owner) đã burn → tái tạo nullifier → mở lại
//       double-claim epoch cũ. Đây là giả định admin-threshold, KHÔNG phải
//       trustless. Xem srcl_pool.ak §GIỚI HẠN để biết vì sao không siết rẻ on-chain.
//
// pool nhận diện slot/registry qua "srcl_nft_policy" + "slot_registry_hash"
// (param ≠ datum). KHÔNG bên nào ôm hash bên kia tạo vòng tròn:
//   srcl_nft(genesis_ref) → policy id → pool param + marker param;
//   pool param thêm slot_registry_hash (script srcl_marker) — 1 chiều.

/// Asset name POOL NFT = "SRCL" (#"5352434c"). One-shot, đánh dấu SRCL pool UTxO.
pub const pool_nft_name: ByteArray = #"5352434c"

/// Datum của SRCL pool UTxO. Giữ kho LAMP + sổ epoch_roots + đích Treasury.
///
///   SrclDatum{epoch_roots, distributed_total, end_epoch, treasury_dest, ms_per_epoch}
///     = Constr(0, [list<bytes>, int, int, bytes, int])
pub type SrclDatum {
  /// Danh sách Merkle root theo epoch (index 0 = epoch 0, …). Admin nạp root_e
  /// sau khi snapshot stake epoch e (SetRoot append). Claim epoch e tra root tại
  /// vị trí e. Mỗi root cam kết toàn bộ leaf (epoch, addr, amount) của epoch đó.
  epoch_roots: List<ByteArray>,
  /// Tổng LAMP (oil) đã phân phối khỏi pool (sổ kế toán, chỉ tăng).
  distributed_total: Int,
  /// Epoch cuối SRCL (= 35, hết 36 epoch 0..35). Sweep chỉ sau end_epoch.
  end_epoch: Int,
  /// payment-credential hash của Treasury (đích Sweep dư cuối SRCL).
  treasury_dest: ByteArray,
  /// ms mỗi epoch (network-specific) → quy đổi epoch từ validity_range.
  ms_per_epoch: Int,
}

/// Một mục claim: delegator chứng minh entitlement epoch e.
///
///   ClaimProof{epoch, owner, amount, proof} = Constr(0, [int, bytes, int, list<MerkleStep>])
pub type ClaimProof {
  /// Epoch của entitlement (0..35).
  epoch: Int,
  /// payment-credential hash (pkh) của delegator — đích nhận LAMP.
  owner: ByteArray,
  /// Lượng LAMP (oil) entitlement của (epoch, owner).
  amount: Int,
  /// Đường Merkle từ leaf tới root (mỗi bước = hash anh-em + bên trái/phải).
  proof: List<MerkleStep>,
}

/// Một bước trên đường Merkle. `hash` = digest anh-em; `left` = anh-em ở BÊN
/// TRÁI (True) hay BÊN PHẢI (False) của node hiện tại.
///
///   MerkleStep{hash, left} = Constr(0, [bytes, bool])
pub type MerkleStep {
  hash: ByteArray,
  left: Bool,
}

/// Redeemer của srcl pool (spend).
pub type SrclRedeemer {
  /// Admin nạp Merkle root cho epoch kế tiếp (append vào epoch_roots).
  SetRoot { root: ByteArray }
  /// Delegator claim LAMP epoch e (Merkle proof + đúc marker chống double-claim).
  Claim { claim: ClaimProof }
  /// Sau end_epoch: quét LAMP dư về Treasury.
  Sweep
}

/// Redeemer của srcl_nft minting policy.
///
///   MintPool=Constr(0,[]), MintSlots=Constr(1,[]), BurnSlot=Constr(2,[])
///   (redeemer mint KHÔNG phải datum → đổi index không phá interface contract;
///    offchain datum.ts đồng bộ index.)
pub type SrclNftRedeemer {
  /// Đúc POOL NFT one-shot (deploy pool). Bắt buộc consume genesis_ref.
  MintPool
  /// Đúc BỘ SLOT NFT lúc SetRoot epoch e (1 slot/owner, qty +1 mỗi name).
  /// Bắt buộc tx có POOL NFT input (pool đang spend SetRoot ủy quyền).
  MintSlots
  /// BURN 1 SLOT NFT lúc Claim (qty −1). Bắt buộc tx có POOL NFT input
  /// (pool đang spend Claim ủy quyền). KHÔNG đụng POOL NFT.
  BurnSlot
}
