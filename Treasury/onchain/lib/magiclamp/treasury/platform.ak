// PlatformKit — Registry on-chain: sổ đăng ký các Platform instance (khuôn mẫu
// onboarding). Mỗi platform (PhoenixKey, OriLife, ...) đăng ký một entry trỏ tới
// Treasury custody instance của mình → discoverable: "tất cả platform" = tập UTxO
// mang NFT của registry_beacon policy.
//
// FIRST-PRINCIPLES (vì sao beacon-per-platform + authority, KHÔNG registry UTxO trung tâm):
//   - Một registry UTxO trung tâm = điểm contention + bloat (bài học consumed_proposals
//     Treasury). Thay vào đó MỖI platform = 1 beacon NFT (name=platform_id) dưới MỘT
//     policy chung → query policy ra toàn bộ registry, không contention, không bloat.
//   - Tính DUY NHẤT platform_id: Cardano KHÔNG ép unique asset-name dưới 1 policy mà
//     không có state trung tâm. Dùng registry_authority (committee→DAO) ký mỗi đăng ký
//     → authority không ký trùng id. Đây là "đăng ký có kiểm duyệt" — đúng mô hình
//     platform onboarding (không permissionless để tránh chiếm tên + rác).
//   - Phá vòng beacon↔registry: registry_beacon chọn output entry bằng SELF-REF NFT
//     (output mang token vừa mint, ở Script) — KHÔNG param registry_hash. registry
//     spend validator param beacon_policy (chỉ phụ thuộc authority) → không vòng.

use cardano/assets.{Value}
use magiclamp/treasury/types.{AssetKey}

/// Vòng đời một platform trong registry. Constr index theo thứ tự khai báo (khớp offchain).
pub type PlatformStatus {
  Active
  Paused
  Retired
}

/// Một entry registry — trỏ platform_id → Treasury custody instance của nó.
/// platform_id == asset name của registry_beacon NFT (duy nhất, authority kiểm duyệt).
pub type PlatformEntry {
  platform_id     : ByteArray,        // định danh platform (= beacon NFT name)
  instance_id     : ByteArray,        // Treasury custody instance_id (= seed NFT name)
  custody_hash    : ByteArray,        // script hash custody.ak của platform
  seed_policy     : ByteArray,        // policy NFT authenticity custody (custody_seed)
  governance_ref  : ByteArray,        // script hash DAO/committee gác release
  accepted_assets : List<AssetKey>,   // assets platform thu (LAMP/ADA/token)
  cut_bps         : Int,              // protocol_cut_bps của instance
  created_epoch   : Int,              // epoch đăng ký
  status          : PlatformStatus,
}

/// Redeemer minting policy registry_beacon.
pub type RegistryBeaconRedeemer {
  // Đăng ký platform mới: mint 1 beacon NFT (name=platform_id), authority ký.
  RegisterPlatform
}

/// Redeemer spend validator registry (cập nhật entry đã đăng ký).
pub type RegistryRedeemer {
  // Cập nhật field khả biến (status / governance_ref / accepted / cut_bps); authority ký.
  // Identity bất biến: platform_id, instance_id, custody_hash, seed_policy, created_epoch.
  UpdateEntry
}

// ── Tính hợp lệ một entry tại đăng ký (S-REG-*) ──

/// Entry well-formed: mọi định danh khác rỗng, cut_bps trong dải, có asset, status Active.
pub fn entry_well_formed(e: PlatformEntry) -> Bool {
  e.platform_id != #"" && e.instance_id != #"" && e.custody_hash != #"" && e.governance_ref != #"" && e.seed_policy != #"" && e.accepted_assets != [] && e.cut_bps >= 0 && e.cut_bps <= 10000 && e.created_epoch >= 0 && e.status == Active
}

/// Identity (5 field) bảo toàn giữa entry_in và entry_out khi UpdateEntry.
pub fn identity_preserved(a: PlatformEntry, b: PlatformEntry) -> Bool {
  a.platform_id == b.platform_id && a.instance_id == b.instance_id && a.custody_hash == b.custody_hash && a.seed_policy == b.seed_policy && a.created_epoch == b.created_epoch
}

/// Field khả biến sau cập nhật vẫn hợp lệ (cut_bps dải, accepted không rỗng, gov khác rỗng).
pub fn mutable_fields_valid(e: PlatformEntry) -> Bool {
  e.governance_ref != #"" && e.accepted_assets != [] && e.cut_bps >= 0 && e.cut_bps <= 10000
}

/// Có đúng 1 token (policy, name) trong value (beacon NFT hiện diện).
pub fn has_one_nft(v: Value, policy: ByteArray, name: ByteArray) -> Bool {
  assets.quantity_of(v, policy, name) == 1
}
