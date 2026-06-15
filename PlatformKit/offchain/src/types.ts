// PlatformKit offchain types — mirror onchain lib/magiclamp/treasury/platform.ak.
//
// PHẢI khớp byte-perfect với platform.ak. Constr index = thứ tự khai báo trong
// platform.ak (Aiken đánh số constructor từ 0 theo thứ tự xuất hiện).
//
// PlatformEntry  = Constr(0, [platform_id:bytes, instance_id:bytes, custody_hash:bytes,
//                             seed_policy:bytes, governance_ref:bytes,
//                             accepted_assets:List<AssetKey>, cut_bps:int,
//                             created_epoch:int, status:PlatformStatus])
// PlatformStatus : Active=Constr(0,[]), Paused=Constr(1,[]), Retired=Constr(2,[])
// AssetKey       = Constr(0, [policy:bytes, name:bytes])  (TÁI DÙNG từ Treasury datum.ts)
// RegisterPlatform = Constr(0,[])  ;  UpdateEntry = Constr(0,[])

// TÁI DÙNG AssetKey từ Treasury SDK (cùng codec, byte-perfect). KHÔNG khai lại type
// để tránh hai định nghĩa lệch nhau.
import type { AssetKey } from "../../../Treasury/offchain/src/types.js";

export type { AssetKey };

/** Vòng đời một platform trong registry — Constr theo thứ tự khai báo platform.ak. */
export type PlatformStatus = "Active" | "Paused" | "Retired";

/** Một entry registry — trỏ platform_id → Treasury custody instance của platform.
 *  Mọi bytes là HEX trần (lowercase) để khớp Plutus bytes (như Treasury datum.ts). */
export interface PlatformEntry {
  platform_id     : string;        // hex — định danh platform (= beacon NFT name)
  instance_id     : string;        // hex — Treasury custody instance_id (= seed NFT name)
  custody_hash    : string;        // hex — script hash custody.ak của platform
  seed_policy     : string;        // hex — policy NFT authenticity custody (custody_seed)
  governance_ref  : string;        // hex — script hash DAO/committee gác release
  accepted_assets : AssetKey[];    // assets platform thu (LAMP/ADA/token)
  cut_bps         : bigint;        // protocol_cut_bps của instance ∈ [0,10000]
  created_epoch   : bigint;        // epoch đăng ký
  status          : PlatformStatus;
}

/** Một bucket kế toán trong custody của platform (id + nhãn người đọc).
 *  bucket_id là Int dùng trong CustodyDatum.ledger + CollectItem.category. */
export interface BucketSpec {
  id    : bigint;   // bucket_id (khớp ledger.category on-chain)
  label : string;   // nhãn người đọc (KHÔNG lên chain — chỉ tài liệu/SDK)
}

/** Tham chiếu UTxO genesis seed (one-shot custody_seed). Mirror OutputReference. */
export interface GenesisRef {
  transaction_id : string;   // hex tx hash
  output_index   : bigint;
}

/**
 * Toàn bộ tham số một platform — đầu vào onboard.
 * platformId / instanceId là HEX trần (encode tên platform sang hex trước khi truyền,
 * hoặc dùng asciiToHex helper). registryAuthority là payment key-hash (28-byte hex) của
 * committee→DAO ký mỗi đăng ký/cập nhật.
 */
export interface PlatformConfig {
  /** Định danh platform — = beacon NFT name (hex). Duy nhất (authority kiểm duyệt). */
  platformId: string;
  /** Treasury custody instance_id (hex) = seed NFT name. */
  instanceId: string;

  /** Assets platform chấp nhận thu (ADA = {policy:"",name:""}). */
  acceptedAssets: AssetKey[];
  /** Các bucket kế toán của custody (ops/community/... — id + nhãn). */
  buckets: BucketSpec[];

  /** protocol_cut_bps ∈ [0,10000] (vd 700 = 7%). */
  cutBps: bigint;
  /** script hash DAO/committee gác release của platform này (hex). */
  governanceRef: string;

  /** seed_policy nếu đã biết trước (hex). Nếu trống → suy từ custody_seed đã apply genesisRef. */
  seedPolicy?: string;

  /** POSIX ms ↔ epoch (mirror onchain ms_per_epoch). */
  msPerEpoch: bigint;
  /** lovelace giữ cho min-UTxO seed (≥ 0, KHÔNG ghi sổ). */
  reservedMinAda: bigint;

  /** registry_authority payment key-hash (28-byte hex) — ký RegisterPlatform/UpdateEntry. */
  registryAuthority: string;

  /** UTxO genesis tiêu khi seed custody (one-shot). */
  genesisRef: GenesisRef;
}
