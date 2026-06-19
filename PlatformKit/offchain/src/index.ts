// @magiclamp/platform-kit — PlatformKit off-chain SDK (FRAMEWORK dùng chung).
//
// Onboarding cho MỖI platform Cardano bất kỳ (xem examples/ để biết mẫu config cụ thể):
// bootstrap Treasury custody instance + đăng ký entry vào Registry on-chain
// (registry_beacon + registry validator). Tái dùng Treasury SDK (datum codec AssetKey,
// seedBuilder, collectBuilder) — byte-perfect.
//
// Framework cấp: schema (types) + codec datum/redeemer + builder (register/update/onboard)
// + adapter-interface (collectAdapter) + query (discover/verify). Platform TỰ quyết pricing/
// tokenomics của mình — framework trung lập với chính sách giá (xem examples/_template.ts).

export * from "./types.js";
export * from "./encoding.js";
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
