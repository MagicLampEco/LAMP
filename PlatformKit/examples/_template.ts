// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ TEMPLATE RỖNG — copy file này thành examples/<your-platform>.ts rồi điền.   ║
// ║ Đây là KHUNG generic (không platform thật). Mọi giá trị bên dưới là CHỖ     ║
// ║ ĐIỀN — đổi theo platform của bạn. Framework KHÔNG quyết pricing/tokenomics; ║
// ║ bạn tự định nghĩa PriceFn + PlatformConfig của mình.                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// HƯỚNG DẪN: xem PlatformKit/ONBOARDING.md để biết toàn bộ quy trình onboard
// (copy template → viết config → seed custody → đăng ký registry → tích hợp collect).
//
// Hai thứ phải định nghĩa cho platform của bạn:
//   1. PriceFn  — định giá: FeeEvent → PricedItem (asset + amount + bucket đích).
//   2. PlatformConfig — khai báo instance: platform_id, accepted assets, buckets, cut, ...

import type { PlatformConfig } from "../offchain/src/types.js";
import type { FeeEvent, PriceFn, PricedItem } from "../offchain/src/collectAdapter.js";
import { ADA, asciiToHex, padHash28, LOVELACE, NANOGIC } from "../offchain/src/encoding.js";

// ── BƯỚC A: Bucket map ───────────────────────────────────────────────────────
// Mỗi bucket = 1 khoang kế toán trong custody của bạn (id bigint + nhãn người đọc).
// id PHẢI khớp CustodyDatum.ledger.category on-chain + CollectItem.category. Giữ id ỔN ĐỊNH
// (đừng đổi nghĩa số sau khi đã đăng ký — sổ kế toán tham chiếu theo id).
export const EXAMPLE_BUCKETS = {
  // ĐIỀN: đặt tên + id các khoang của bạn. Ví dụ:
  MAIN:    0n,   // khoang chính (vận hành)
  RESERVE: 1n,   // khoang dự phòng
} as const;

// ── BƯỚC B: PriceFn (định giá) ───────────────────────────────────────────────
// Framework trung lập với chính sách giá: BẠN tính amount (đơn vị nhỏ nhất, BigInt),
// chọn asset (ADA / LAMP / MAGIC / token của bạn), và bucket đích cho phần cut.
// Trả null = sự kiện KHÔNG thu phí qua adapter này (bị bỏ qua).
//
// Đơn vị: LOVELACE = 1 ADA (10^6); NANOGIC = 1 MAGIC (10^9). Tự định đơn vị token của bạn.
// KHÔNG dùng Number cho amount — luôn BigInt (chống overflow/làm tròn).
export function makeExamplePriceFn(opts: {
  // ĐIỀN: tham số runtime bạn cần để định giá. Ví dụ:
  tokenPolicy?: string;     // policy token bạn thu (nếu không phải ADA).
}): PriceFn {
  // Ví dụ dựng asset của bạn từ policy thật (bỏ nếu chỉ thu ADA):
  const tokenAsset = opts.tokenPolicy !== undefined
    ? { policy: opts.tokenPolicy.toLowerCase(), name: asciiToHex("TOKEN") }
    : ADA;

  return (event: FeeEvent): PricedItem | null => {
    switch (event.eventType) {
      // ĐIỀN: mỗi loại sự kiện chịu phí của bạn 1 case.
      case "example.action":
        return {
          asset: ADA,                          // ĐIỀN: asset thu (ADA / tokenAsset / ...).
          amount: 1n * LOVELACE,               // ĐIỀN: số tiền (đơn vị nhỏ nhất, BigInt).
          bucketCategory: EXAMPLE_BUCKETS.MAIN, // ĐIỀN: bucket đích cho phần cut.
        };
      case "example.premium":
        return {
          asset: tokenAsset,                   // ví dụ thu token thay vì ADA.
          amount: 5n * NANOGIC,
          bucketCategory: EXAMPLE_BUCKETS.RESERVE,
        };
      default:
        return null;   // sự kiện không thu phí qua adapter này.
    }
  };
}

// ── BƯỚC C: PlatformConfig (khai báo instance) ───────────────────────────────
// Toàn bộ tham số một platform — đầu vào onboardPlatform(). Xem offchain/src/types.ts
// (PlatformConfig) để biết chi tiết từng field + ràng buộc.
export function exampleConfig(opts: {
  registryAuthority: string;     // ĐIỀN: payment key-hash (28-byte hex) authority ký đăng ký.
                                 //   PRODUCTION: PHẢI là multisig/committee (xem ONBOARDING.md).
  msPerEpoch: bigint;            // ĐIỀN: POSIX ms ↔ epoch của mạng (Preview/Mainnet khác nhau).
  reservedMinAda: bigint;        // ĐIỀN: lovelace giữ min-UTxO cho seed (≥ 0, KHÔNG ghi sổ).
  genesisRef: { transaction_id: string; output_index: bigint };  // UTxO one-shot tiêu khi seed.
  /** seed_policy custody nếu biết trước (hex). Trống → suy từ custody_seed đã apply genesisRef. */
  seedPolicy?: string;
  /** governance_ref script hash THẬT (hex 28-byte) — DAO/committee gác release. Trống → placeholder dev. */
  governanceRef?: string;
}): PlatformConfig {
  return {
    // platform_id = beacon NFT name (hex), DUY NHẤT (authority kiểm duyệt). ĐIỀN tên platform.
    platformId: asciiToHex("ExamplePlatform"),
    // instance_id = seed NFT name (hex) = Treasury custody instance. ĐIỀN.
    instanceId: asciiToHex("example-custody-v1"),
    // accepted assets: danh sách asset platform CHẤP NHẬN thu. ADA = {policy:"",name:""}.
    acceptedAssets: [
      { ...ADA },
      // ĐIỀN thêm: { policy: lampPolicy, name: asciiToHex("LAMP") }, ... nếu thu token.
    ],
    // buckets: khai báo các khoang kế toán (khớp EXAMPLE_BUCKETS). ĐIỀN.
    buckets: [
      { id: EXAMPLE_BUCKETS.MAIN,    label: "main" },
      { id: EXAMPLE_BUCKETS.RESERVE, label: "reserve" },
    ],
    // protocol_cut_bps ∈ [0,10000] (vd 500 = 5%). ĐIỀN tỉ lệ cut của bạn.
    cutBps: 500n,
    // governance_ref: script hash DAO/committee gác release. Trống → placeholder dev (KHÔNG cho mainnet).
    governanceRef: opts.governanceRef ?? padHash28(asciiToHex("example-committee")),
    ...(opts.seedPolicy !== undefined ? { seedPolicy: opts.seedPolicy } : {}),
    msPerEpoch: opts.msPerEpoch,
    reservedMinAda: opts.reservedMinAda,
    registryAuthority: opts.registryAuthority.toLowerCase(),
    genesisRef: opts.genesisRef,
  };
}

// ── Placeholder hợp lệ để TEMPLATE typecheck/biên dịch ───────────────────────
// Chỉ là giá trị mẫu cho compiler — KHÔNG dùng làm config thật. Khi điền xong, gọi
// exampleConfig(...) với tham số runtime của bạn thay cho placeholder này.
export const exampleTemplateConfig: PlatformConfig = exampleConfig({
  registryAuthority: "00".repeat(28),                              // placeholder.
  msPerEpoch: 86_400_000n,                                         // 1 ngày (Preview ví dụ).
  reservedMinAda: 2_000_000n,                                      // 2 ADA min-UTxO.
  genesisRef: { transaction_id: "00".repeat(32), output_index: 0n },
});
