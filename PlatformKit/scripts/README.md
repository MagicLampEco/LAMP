# PlatformKit — deploy scripts (Preprod)

Apply-params Registry + onboard MỘT platform (PhoenixKey/OriLife) vào hệ sinh thái.
Mẫu theo `Distribution/scripts`. KHÔNG đụng `onchain/` (registry validator nằm trong
**Treasury** onchain) hay `offchain/src` (đã chốt).

> **Mạng:** đặt `NETWORK=Preprod`. Mặc định trong `config.ts` vẫn là `Preview`; trên Preview,
> `03_onboard` dừng bằng lỗi vì mạng này chưa có gốc lưới cửa sổ (`config.ts` ▸ `windowOrigin`,
> `WIN-PREVIEW` trong `Specs/Window/CONTRACT.md`). Registry và PlatformKit chưa có bản ghi triển
> khai nào trong kho — bộ script này dựng và kiểm kế hoạch, không phải bằng chứng đã chạy.

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
   `seed_policy`; `custody(pointer_policy, seed_policy, ms_per_epoch, lamp_policy, token_name,
   window_origin_ms)` → `custody_hash`; **6 tham số**, danh sách dựng bằng
   `Treasury/scripts/custodyParams.ts` ▸ `custodyParamList`, chữ ký gốc ở `Treasury/onchain/validators/custody.ak`;
   script này không apply `treasury_stake`, nên địa chỉ custody in ra là địa chỉ script trần, chưa
   kèm phần stake mà `Treasury/scripts/01_seed_custody.ts` dựng), rồi `onboardPlatform` plan 2 bước:
   - **BƯỚC 1 SEED** custody instance (mint seed NFT + custody UTxO).
   - **BƯỚC 2 REGISTER** entry (mint beacon NFT + entry UTxO ở registry address).
   - BƯỚC 1 PHẢI confirm trước BƯỚC 2 (entry trỏ vào instance đã seed).

   Ghi `onboarded.json`.

## Env

Xem `.env.example`. DRY mode không cần gì (default dev + placeholder). LIVE cần
`BLOCKFROST_KEY` + ví + `REGISTRY_AUTHORITY` (ký mint beacon NFT), và mọi tham số then chốt
(`registry_authority`, `proposal_policy`, `genesis_ref`, `lamp_policy`) phải là giá trị thật —
còn placeholder thì script tự ép về DRY. `lamp_policy` lấy theo thứ tự biến `LAMP_POLICY_ID` → bản
`ACTIVE` của mạng trong `Genesis/offchain/src/lampPolicies.ts` → placeholder.

## Ghi chú class-identity

Param `registry`/`registry_beacon` đều phẳng (hex) → apply bằng lucid của
`scripts/node_modules` an toàn. Param `custody_seed` là `OutputReference` (Constr) →
DÙNG `applyCustodySeed` của Treasury SDK (dựng Constr nội bộ) để tránh lệch class giữa
hai bản `@lucid-evolution/lucid`.
