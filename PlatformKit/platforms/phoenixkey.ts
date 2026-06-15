// PlatformKit · Platform config: PhoenixKey (DID sinh trắc PhoenixKeyDID).
//
// PhoenixKey thu phí cho các thao tác DID: tạo DID, xoay khoá, khôi phục. Treasury custody
// instance của PhoenixKey nhận phí (ADA + MAGIC), chia về 3 bucket: ops / community / emergency.
//
// RANH GIỚI (quan trọng):
//   - Backend Java PhoenixKeyDID KHÔNG đụng (Claude không sửa PhoenixKey backend — CLAUDE.md).
//   - Đây là SDK phía CLIENT/SDK: app gọi adapter này để dựng CollectItem khi người dùng thực
//     hiện thao tác DID. Settlement on-chain do tx Treasury Collect (caller cấp ví + fund).
//   - Phí dưới đây là STUB (định giá mẫu). WIRE PHÍ THẬT sau: lấy từ PhoenixKey fee schedule
//     (governance) + tỉ giá oracle. Xem chú thích "WIRE FEE THẬT" tại từng map.

import type { PlatformConfig } from "../offchain/src/types.js";
import type { FeeEvent, PriceFn, PricedItem } from "../offchain/src/collectAdapter.js";
import { ADA, asciiToHex, magicAsset, padHash28 } from "./_common.js";

// ── Bucket map (id ổn định — khớp CustodyDatum.ledger.category) ──────────────
export const PHOENIXKEY_BUCKETS = {
  OPS:       0n,   // vận hành: hạ tầng, orchestrator
  COMMUNITY: 1n,   // cộng đồng: thưởng node/đóng góp
  EMERGENCY: 2n,   // dự phòng khẩn (recovery, sự cố)
} as const;

// ── Tham số định giá STUB (WIRE FEE THẬT sau) ────────────────────────────────
// Đơn vị: lovelace (ADA × 10^6) cho phần ADA; nanogic (MAGIC × 10^9) cho phần MAGIC.
// Số dưới đây là MẪU minh hoạ — production đọc từ PhoenixKey fee schedule + oracle tỉ giá.
const LOVELACE = 1_000_000n;       // 1 ADA
const NANOGIC = 1_000_000_000n;    // 1 MAGIC

/** Bảng phí STUB theo thao tác DID. WIRE FEE THẬT: thay bằng schedule governance thật. */
export const PHOENIXKEY_FEES_STUB = {
  // createDID: thu ADA (phí neo CIP-68) — 1.5 ADA mẫu, cut về OPS.
  createDID:  { asset: ADA, amount: 1_500_000n, bucket: PHOENIXKEY_BUCKETS.OPS },
  // rotateKey: thu MAGIC (tiêu MAGIC = governance C1) — 0.5 MAGIC mẫu, cut về COMMUNITY.
  rotateKey:  { asset: "MAGIC" as const, amount: 500_000_000n, bucket: PHOENIXKEY_BUCKETS.COMMUNITY },
  // recovery: thu ADA cao hơn (chống lạm dụng khôi phục) — 3 ADA mẫu, cut về EMERGENCY.
  recovery:   { asset: ADA, amount: 3_000_000n, bucket: PHOENIXKEY_BUCKETS.EMERGENCY },
} as const;

/**
 * Tạo PriceFn PhoenixKey (cần MAGIC policy thật runtime để dựng asset MAGIC).
 * STUB pricing — chỉ minh hoạ cấu trúc. WIRE FEE THẬT: bơm fee schedule + tỉ giá oracle.
 *
 * Sự kiện hỗ trợ: "createDID" (ADA), "rotateKey" (MAGIC), "recovery" (ADA).
 * Event ngoài danh sách → null (không thu phí ở adapter này).
 */
export function makePhoenixKeyPriceFn(magicPolicy: string): PriceFn {
  const magic = magicAsset(magicPolicy);
  return (event: FeeEvent): PricedItem | null => {
    switch (event.eventType) {
      case "createDID":
        return {
          asset: { ...PHOENIXKEY_FEES_STUB.createDID.asset },
          amount: PHOENIXKEY_FEES_STUB.createDID.amount,
          bucketCategory: PHOENIXKEY_FEES_STUB.createDID.bucket,
        };
      case "rotateKey":
        return {
          asset: magic,                                   // MAGIC policy thật runtime.
          amount: PHOENIXKEY_FEES_STUB.rotateKey.amount,
          bucketCategory: PHOENIXKEY_FEES_STUB.rotateKey.bucket,
        };
      case "recovery":
        return {
          asset: { ...PHOENIXKEY_FEES_STUB.recovery.asset },
          amount: PHOENIXKEY_FEES_STUB.recovery.amount,
          bucketCategory: PHOENIXKEY_FEES_STUB.recovery.bucket,
        };
      default:
        return null;   // sự kiện không thu phí qua adapter này.
    }
  };
}

/**
 * PlatformConfig PhoenixKey.
 * accepted = [ADA, LAMP, MAGIC]. cutBps 500 (5%) — mẫu. governanceRef = committee bootstrap
 * placeholder (WIRE: thay bằng script hash DAO/committee thật sau).
 *
 * @param opts params runtime (policy thật + authority + genesisRef + epoch param).
 */
export function phoenixKeyConfig(opts: {
  lampPolicy: string;
  magicPolicy: string;
  registryAuthority: string;     // key-hash committee→DAO (ký RegisterPlatform/UpdateEntry).
  msPerEpoch: bigint;
  reservedMinAda: bigint;
  genesisRef: { transaction_id: string; output_index: bigint };
  /** seed_policy custody (custody_seed đã apply) nếu biết trước. */
  seedPolicy?: string;
  /** governance_ref script hash thật (hex 28-byte). Trống → placeholder dev. */
  governanceRef?: string;
}): PlatformConfig {
  return {
    platformId: asciiToHex("PhoenixKey"),
    instanceId: asciiToHex("phoenixkey-custody-v1"),
    acceptedAssets: [
      { ...ADA },
      { policy: opts.lampPolicy.toLowerCase(), name: asciiToHex("LAMP") },
      { policy: opts.magicPolicy.toLowerCase(), name: asciiToHex("MAGIC") },
    ],
    buckets: [
      { id: PHOENIXKEY_BUCKETS.OPS,       label: "ops" },
      { id: PHOENIXKEY_BUCKETS.COMMUNITY, label: "community" },
      { id: PHOENIXKEY_BUCKETS.EMERGENCY, label: "emergency" },
    ],
    cutBps: 500n,                                   // 5% — mẫu (DAO chỉnh).
    // WIRE: governance_ref placeholder (committee bootstrap). Thay bằng hash DAO thật.
    governanceRef: opts.governanceRef ?? padHash28(asciiToHex("phoenixkey-committee")),
    ...(opts.seedPolicy !== undefined ? { seedPolicy: opts.seedPolicy } : {}),
    msPerEpoch: opts.msPerEpoch,
    reservedMinAda: opts.reservedMinAda,
    registryAuthority: opts.registryAuthority.toLowerCase(),
    genesisRef: opts.genesisRef,
  };
}

// (tránh unused warning cho LOVELACE/NANOGIC — phơi làm hằng tiện ích.)
export const PHOENIXKEY_UNITS = { LOVELACE, NANOGIC } as const;
