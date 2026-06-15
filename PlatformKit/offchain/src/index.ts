// @magiclamp/platform-kit — PlatformKit off-chain SDK.
//
// Onboarding cho mỗi Platform (PhoenixKey, OriLife, ...): bootstrap Treasury custody
// instance + đăng ký entry vào Registry on-chain (registry_beacon + registry validator).
// Tái dùng Treasury SDK (datum codec AssetKey, seedBuilder, collectBuilder) — byte-perfect.

export * from "./types.js";
export * from "./registryDatum.js";
export * from "./registrationBuilder.js";
export * from "./onboard.js";
export * from "./collectAdapter.js";
export * from "./registryQuery.js";

// Re-export một số kiểu Treasury hay dùng phía caller (tiện import 1 chỗ).
// (AssetKey đã re-export qua ./types.js — không lặp ở đây để tránh trùng tên.)
export type {
  CollectItem, CustodyDatum, LedgerEntry,
} from "../../../Treasury/offchain/src/types.js";
