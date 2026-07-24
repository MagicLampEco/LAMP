// PlatformKit/scripts/02_deploy_registry.ts — Apply params registry + in beacon_policy
// + registry_address. Dry-run (apply-params KHÔNG cần mạng).
//
// Chạy: npm run deploy-registry   (hoặc: npx tsx 02_deploy_registry.ts)
//
// Registry là SINGLETON cho cả hệ sinh thái (1 authority committee→DAO). Mỗi platform
// là 1 entry UTxO RIÊNG ở registry address (no contention). Bước này chỉ APPLY params +
// tính địa chỉ; tạo entry là việc của 03_onboard (mint beacon NFT + entry datum).
//
// PHÁ VÒNG: registry_beacon(authority) → beacon_policy → registry(authority, beacon_policy).

import {
  NETWORK, MS_PER_EPOCH,
  resolveRegistryAuthority,
  applyRegistry,
  evaluateLiveGuards, warnLiveBlocked,
  saveRegistry, type RegistryState,
} from "./config.js";

async function main(): Promise<void> {
  console.log("=== PlatformKit Step 2: Deploy registry (apply-params) ===\n");

  const { authority, source } = resolveRegistryAuthority();

  // F14: chặn LIVE nếu registry_authority còn placeholder (source !== "env").
  const guard = evaluateLiveGuards([
    { name: "registry_authority", value: authority, placeholder: source !== "env" },
  ]);
  const dry = !guard.allowLive;

  console.log(`Network:            ${NETWORK}`);
  console.log(`ms_per_epoch:       ${MS_PER_EPOCH}`);
  console.log(`Mode:               ${dry ? "DRY (apply-params + in plan, không build tx)" : "LIVE (apply-params; registry là param-only — không có tx deploy riêng)"}`);
  console.log(`registry_authority: ${authority}  (${source})\n`);
  warnLiveBlocked(guard);

  // ── Apply (beacon trước → beacon_policy → registry) ───────────
  const r = await applyRegistry(authority);

  console.log("── Applied registry ──");
  console.log(`beacon_policy:      ${r.beaconPolicy}`);
  console.log(`   (= mintingPolicyToId(registry_beacon(authority)); CHỈ phụ thuộc authority)`);
  console.log(`registry hash:      ${r.registryHash}`);
  console.log(`registry address:   ${r.registryAddr}`);
  console.log();

  if (dry) {
    console.log("── DRY: registry chỉ là param-only (không có UTxO deploy riêng) ──");
    console.log("Beacon NFT + entry UTxO đầu tiên được tạo ở 03_onboard_platform.ts.");
    console.log("Cần BLOCKFROST_KEY + ví để 03 build tx thật (vẫn dry-run, KHÔNG submit).");
  }

  const state: RegistryState = {
    network:           NETWORK,
    registryAuthority: authority,
    authoritySource:   source,
    beaconPolicy:      r.beaconPolicy,
    registryHash:      r.registryHash,
    registryAddress:   r.registryAddr,
  };
  await saveRegistry(state);
  console.log("\n✅ Đã ghi registry.json (beacon_policy, registry_hash, registry_address).");
  console.log("Tiếp theo: npm run onboard -- <phoenixkey|orilife>");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
