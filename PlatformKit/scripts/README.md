# PlatformKit — deploy scripts (Cardano Preview)

Apply-params Registry + onboard MỘT platform (PhoenixKey/OriLife) vào hệ sinh thái.
Mẫu theo `Distribution/scripts`. KHÔNG đụng `onchain/` (registry validator nằm trong
**Treasury** onchain) hay `offchain/src` (đã chốt).

## Kiến trúc on-chain

Registry validator (`registry`, `registry_beacon`) ở **Treasury** blueprint —
`Treasury/onchain/plutus.json`. PlatformKit = SDK off-chain + platform config; dùng
chung blueprint Treasury. Nếu plutus.json thiếu 4 validator (`custody`, `custody_seed`,
`registry`, `registry_beacon`) → chạy `aiken build` trong `Treasury/onchain/`.

## Chạy

```bash
cd PlatformKit/scripts
npm install                          # cài lucid/tsx/utils
npm run deploy-registry              # = npx tsx 02_deploy_registry.ts → registry.json
npm run onboard -- phoenixkey        # = npx tsx 03_onboard_platform.ts phoenixkey
npm run onboard -- orilife           #   (chạy được cho cả 2 platform)
```

### Hai chế độ (tự nhận theo .env)

- **DRY** (thiếu credential): apply-params + dựng plan onboard 2 bước (tự kiểm 2 gương
  validator: `seedDatumOk` + `entryWellFormed`) + in `beacon_policy` / `registry address`
  / `custody hash` / `seed_policy` / datum CBOR / required signer. KHÔNG cần mạng.
- **LIVE** (đủ credential): thêm build 2 tx dry-run (`buildSeedTx` + register tx
  `.complete()`) — **KHÔNG submit**. Authority placeholder không ký được; production
  truyền `REGISTRY_AUTHORITY` thật (ví committee→DAO).

## Thứ tự chạy + dependency

1. `02_deploy_registry` — PHÁ VÒNG: `registry_beacon(authority)` → `beacon_policy`
   (chỉ phụ thuộc authority) → `registry(authority, beacon_policy)`. Ghi `registry.json`.
2. `03_onboard <platform>` — apply Treasury custody (`custody_seed(genesis_ref)` →
   `seed_policy`; `custody(proposal_policy, seed_policy, ms_per_epoch)` → `custody_hash`),
   rồi `onboardPlatform` plan 2 bước:
   - **BƯỚC 1 SEED** custody instance (mint seed NFT + custody UTxO).
   - **BƯỚC 2 REGISTER** entry (mint beacon NFT + entry UTxO ở registry address).
   - BƯỚC 1 PHẢI confirm trước BƯỚC 2 (entry trỏ vào instance đã seed).

   Ghi `onboarded.json`.

## Env

Xem `.env.example`. DRY mode không cần gì (default dev + placeholder). LIVE cần
`BLOCKFROST_KEY` + ví + `REGISTRY_AUTHORITY` (ký mint beacon NFT).

## Ghi chú class-identity

Param `registry`/`registry_beacon` đều phẳng (hex) → apply bằng lucid của
`scripts/node_modules` an toàn. Param `custody_seed` là `OutputReference` (Constr) →
DÙNG `applyCustodySeed` của Treasury SDK (dựng Constr nội bộ) để tránh lệch class giữa
hai bản `@lucid-evolution/lucid`.
