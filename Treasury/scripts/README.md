# Treasury — deploy scripts (Preprod)

Apply-params + seed (bootstrap) MỘT custody instance của Treasury. Mẫu theo
`Distribution/scripts`. KHÔNG đụng `onchain/` hay `offchain/src` (đã chốt).

> **Mạng:** đặt `NETWORK=Preprod`. Mặc định trong `config.ts` vẫn là `Preview`. Preview đã có gốc
> lưới cửa sổ (`Specs/Window/CONTRACT.md` v1.2 §2) nhưng chưa có tLAMP (`Genesis/offchain/src/lampPolicies.ts`,
> mục Preview), nên custody chỉ gieo được trên Preprod. Mạng nào đã có custody chạy thật: xem bảng
> module ở `README.md` gốc và sổ `Genesis/offchain/src/lampPolicies.ts`, đừng suy từ tệp này.

## Điều kiện

- `onchain/plutus.json` phải có ba validator mà script này apply: `custody`, `custody_seed`,
  `treasury_stake` (tên tra trong `custodyParams.ts` ▸ `CUSTODY_TITLE`, `CUSTODY_SEED_TITLE`,
  `TREASURY_STAKE_TITLE`). Nếu thiếu → chạy `aiken build` trong `Treasury/onchain/` trước.
- `node_modules` đã link `@magiclamp/treasury-sdk` (→ `../offchain`) +
  `@magiclamp/utils`. Nếu trống → `npm install`.

## Chạy

```bash
cd Treasury/scripts
npm install            # nếu node_modules trống
npm run seed           # = npx tsx 01_seed_custody.ts
```

### Hai chế độ (tự nhận theo biến môi trường)

- **DRY** (thiếu `BLOCKFROST_KEY` / `PRIVATE_KEY`, hoặc còn tham số placeholder): apply-params +
  dựng `planSeed` (tự kiểm `seedDatumOk`) + in `seed_policy` / `custody hash` / `custody address` /
  datum CBOR. KHÔNG cần mạng. Đủ để kiểm hash/address/datum.
- **LIVE** (đủ credential, không còn placeholder): thêm bước `buildSeedTx` dry-run — `.complete()`
  build tx thật NHƯNG **KHÔNG submit** (ký + submit thủ công sau khi duyệt). Van chặn placeholder:
  `config.ts` ▸ `evaluateLiveGuards`.

## Env

Xem `.env.example`. Tối thiểu để LIVE: `BLOCKFROST_KEY` + (`PRIVATE_KEY` hoặc
`WALLET_SEED`) + `NETWORK=Preprod`. Ngoài ra `proposal_policy` (`PROPOSAL_POLICY_ID`) và
`delegation_admin` (`DELEGATION_ADMIN`) phải là giá trị thật — để trống thì script dùng placeholder
và ép về DRY. `lamp_policy` lấy theo thứ tự: biến `LAMP_POLICY_ID` → bản `ACTIVE` của mạng trong sổ
`Genesis/offchain/src/lampPolicies.ts` → placeholder (`custodyParams.ts` ▸ `resolveLampPolicy`).
DRY mode không cần gì (dùng default dev + placeholder).

Biến môi trường đi thẳng vào tiến trình; script không đọc tệp `.env`.

## Output

`seeded.json` — kiểu `SeededInstance` trong `config.ts` (mạng, `msPerEpoch`, `windowOriginMs`,
`instanceId`, `custodyHash`, `custodyAddress`, `stakeHash`, `seedPolicy`, `proposalPolicy`,
`lampPolicy`, `genesisRef`, `datumCbor`, `dryRun`, …). PlatformKit `03_onboard_platform.ts`
đọc `seedPolicy` + `custodyHash` từ đây (hoặc tự apply lại).

## Thứ tự dependency (apply-params)

1. `custody_seed(genesis_ref)` → `seed_policy = mintingPolicyToId(custody_seed)`.
2. `custody(pointer_policy, seed_policy, ms_per_epoch, lamp_policy, token_name, window_origin_ms)`
   → custody hash. **6 tham số** — nguồn: chữ ký `validator custody(` trong
   `Treasury/onchain/validators/custody.ak`. Script gọi tham số đầu là `proposalPolicy`; ở
   validator nó tên `pointer_policy`. Truyền thiếu tham số: `config.ts` ▸ `applyValidator` chặn
   bằng cổng đếm khe; một đường apply không qua cổng thì KHÔNG báo lỗi, nó ra một script hash khác
   một cách im lặng ⇒ một địa chỉ custody khác.
3. `treasury_stake(instance_id, reward_cred, delegation_admin)` — apply SAU `custody` vì
   `reward_cred` là credential thanh toán của kho. Địa chỉ kho là địa chỉ **base**
   (custody hash + stake hash), và `seeded.json` ghi địa chỉ đó (`stakeBuilder.ts` ▸
   `custodyBaseAddress`).

`custody` cần `seed_policy` ⇒ apply `custody_seed` TRƯỚC. `lamp_policy` là policy id của
`Genesis/onchain/validators/lamp_mint.ak` sau apply-param ⇒ apply `lamp_mint` TRƯỚC `custody`.
Đổi bất kỳ tham số nào của `custody` thì đổi địa chỉ kho — mọi thay đổi validator phải xong TRƯỚC
lượt gieo.
