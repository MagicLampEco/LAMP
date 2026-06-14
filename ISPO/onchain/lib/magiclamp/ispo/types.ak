// ISPO onchain types — reward-redirect ISPO cho LAMP.
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
// 1 minting policy `ispo_nft` (param: genesis_ref) đúc 2 loại token:
//   - POOL NFT   ("ISPO", one-shot, qty 1) — nhận diện ISPO pool UTxO.
//   - MARKER NFT (name = blake2b_256(epoch || addr), qty 1) — bằng-chứng-claim
//     duy-nhất cho cặp (epoch, addr). CHỐNG DOUBLE-CLAIM: name marker là hàm
//     thuần của (epoch, addr) → mint 2 lần CÙNG (epoch,addr) = đúc trùng NFT,
//     ledger Cardano CẤM (NFT bất khả phân, supply mỗi name ≤ tổng đã đúc; pool
//     ép đúng +1 mỗi Claim → cặp (epoch,addr) chỉ claim được 1 lần VĨNH VIỄN).
//
// pool nhận diện marker qua "ispo_nft_policy" (1 param chung tính từ genesis_ref).
// KHÔNG bên nào ôm hash bên kia → KHÔNG vòng tròn.

/// Asset name POOL NFT = "ISPO" (#"4953504f"). One-shot, đánh dấu ISPO pool UTxO.
pub const pool_nft_name: ByteArray = #"4953504f"

/// Datum của ISPO pool UTxO. Giữ kho LAMP + sổ epoch_roots + đích Treasury.
///
///   IspoDatum{epoch_roots, distributed_total, end_epoch, treasury_dest, ms_per_epoch}
///     = Constr(0, [list<bytes>, int, int, bytes, int])
pub type IspoDatum {
  /// Danh sách Merkle root theo epoch (index 0 = epoch 0, …). Admin nạp root_e
  /// sau khi snapshot stake epoch e (SetRoot append). Claim epoch e tra root tại
  /// vị trí e. Mỗi root cam kết toàn bộ leaf (epoch, addr, amount) của epoch đó.
  epoch_roots: List<ByteArray>,
  /// Tổng LAMP (oil) đã phân phối khỏi pool (sổ kế toán, chỉ tăng).
  distributed_total: Int,
  /// Epoch cuối ISPO (= 35, hết 36 epoch 0..35). Sweep chỉ sau end_epoch.
  end_epoch: Int,
  /// payment-credential hash của Treasury (đích Sweep dư cuối ISPO).
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

/// Redeemer của ispo pool (spend).
pub type IspoRedeemer {
  /// Admin nạp Merkle root cho epoch kế tiếp (append vào epoch_roots).
  SetRoot { root: ByteArray }
  /// Delegator claim LAMP epoch e (Merkle proof + đúc marker chống double-claim).
  Claim { claim: ClaimProof }
  /// Sau end_epoch: quét LAMP dư về Treasury.
  Sweep
}

/// Redeemer của ispo_nft minting policy.
pub type IspoNftRedeemer {
  /// Đúc POOL NFT one-shot (deploy pool). Bắt buộc consume genesis_ref.
  MintPool
  /// Đúc MARKER NFT (lúc Claim). Bắt buộc tx có POOL NFT (pool đang được spend).
  MintMarker
}
