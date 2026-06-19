# Onboarding một platform vào PlatformKit

Guide từng bước để bất kỳ team Cardano nào đưa platform của mình vào hệ sinh thái MagicLamp:
mỗi platform có một Treasury custody instance riêng + một entry trong Registry on-chain.

PlatformKit là **framework dùng chung**. Nó KHÔNG quyết economics của bạn. Bạn chỉ điền config
+ pricing; phần còn lại (schema, validator gương, builder tx, adapter) framework lo.

---

## Ranh giới: framework lo gì, bạn lo gì

| Framework cấp | Platform tự quyết |
|---|---|
| Schema datum/redeemer (`PlatformEntry`, `CustodyDatum`) + codec byte-perfect | `platform_id` / `instance_id` của bạn |
| Validator on-chain (registry_beacon, registry, custody) + gương off-chain (R-WF, R-BIND, U-ID, ...) | Pricing / tokenomics (PriceFn) — **định giá ở app, framework không quyết** |
| Builder tx: `planSeed`/`buildSeedTx`, `planRegister`, `planUpdateEntry`, `onboardPlatform` | Danh sách asset chấp nhận, các bucket kế toán, `cut_bps` |
| Adapter-interface thu phí: `eventToCollectItem`, `buildCollectFromEvents` | `governance_ref` (DAO/committee của bạn) |
| Discover + đối soát: `discoverPlatforms`, `verifyEntryAgainstCustody` | Authority ký đăng ký (multisig trước mainnet) |

Nguyên tắc cố định:
- **Mỗi instance có `governance_ref` RIÊNG** (#1B) — không dùng chung gác release giữa các platform.
- **Authority đăng ký PHẢI là multisig/committee trước mainnet.** Hiện registry_beacon param 1 key-hash
  (single point of failure: 1 khoá rò = chiếm tên/onboard rác). Nâng lên native/Plutus multisig (M-of-N)
  hoặc DAO gate trước khi lên mainnet.
- **Định giá luôn ở app.** Framework chỉ nhận `amount` đã tính (BigInt, đơn vị nhỏ nhất) — Treasury
  KHÔNG định giá.

---

## (a) Copy template → viết PlatformConfig

```bash
cp examples/_template.ts examples/<your-platform>.ts
```

Mở file vừa copy, điền 3 phần (template đánh dấu "ĐIỀN" từng chỗ):

1. **Bucket map** — các khoang kế toán của custody (id bigint ổn định + nhãn). id khớp
   `CustodyDatum.ledger.category` + `CollectItem.category` on-chain. Đừng đổi nghĩa id sau khi đăng ký.
2. **PriceFn** — xem mục (b).
3. **`<your>Config(...)`** — trả `PlatformConfig`: `platformId`, `instanceId`, `acceptedAssets`,
   `buckets`, `cutBps` ∈ [0,10000], `governanceRef`, `msPerEpoch`, `reservedMinAda`,
   `registryAuthority`, `genesisRef`. Chi tiết từng field xem `offchain/src/types.ts` (`PlatformConfig`).

Tham khảo 2 ví dụ thật trong `examples/`: `phoenixkey.ts` (phí cố định theo sự kiện DID) và
`orilife.ts` (value-based theo loài/giá trị). **Đây là VÍ DỤ THAM CHIẾU — số liệu là minh hoạ.**

Helper generic dùng chung lấy từ lõi framework: `offchain/src/encoding.ts`
(`asciiToHex`, `padHash28`, `ADA`, `lampAsset`, `magicAsset`, `LOVELACE`, `NANOGIC`).

## (b) Viết PriceFn / collect-adapter

PriceFn dịch một `FeeEvent` của bạn → `PricedItem` (asset + amount + bucket đích cut):

```ts
export type PriceFn = (event: FeeEvent) => PricedItem | null;
```

- `amount` luôn **BigInt**, đơn vị nhỏ nhất (lovelace = ADA×10⁶, nanogic = MAGIC×10⁹, oil = LAMP×10⁶).
  KHÔNG dùng `Number` (chống overflow/làm tròn).
- Trả `null` = sự kiện KHÔNG thu phí qua adapter này (bị bỏ qua).
- **Framework trung lập với chính sách giá** — bạn tự quyết công thức (cố định / value-based / oracle).
  WIRE giá thật: đọc fee schedule + tỉ giá oracle của bạn, đừng hard-code production.

Định nghĩa `FeeEvent` / `PricedItem` ở `offchain/src/collectAdapter.ts`.

## (c) Seed Treasury custody (one-shot)

Trước khi đăng ký, custody instance phải tồn tại trên chain. Treasury SDK lo bước này:

1. `applyCustodySeed(compiledCode, genesisRef)` → custody_seed minting policy (apply UTxO genesis one-shot).
2. `seedPolicyId(custodySeed)` → `seed_policy` (NFT authenticity policy id).
3. `planSeed(custodyDatum, seedPolicy, reservedMinAda)` → kiểm gương `seedDatumOk` + dựng custody value
   (mint đúng 1 NFT authenticity `(seed_policy, instance_id)`).
4. `buildSeedTx(...)` → tx thật; submit bằng ví của bạn.

`onboardPlatform()` (mục (d)) tự gọi `planSeed` cho bạn và trả `OnboardPlan.seed` — bạn chỉ cần
`buildSeedTx` + submit, rồi **giữ lại `txHash#outputIndex` của output custody** (cần cho R-BIND ở (d)).

## (d) Đăng ký vào Registry (authority ký, R-BIND ép custody thật)

```ts
import { onboardPlatform } from "@magiclamp/platform-kit"; // offchain/src/index.ts

const plan = onboardPlatform({
  config,                    // PlatformConfig của bạn (mục a)
  beaconPolicy,              // = hash(registry_beacon(authority)) — sau aiken build + apply
  custodyHash,               // script hash custody.ak của bạn (đã apply)
  seedPolicy,                // = seedPolicyId(custodySeed)  (mục c)
  createdEpoch,              // epoch đăng ký
  custodyOutRef,             // txHash#idx output custody bước (c) — điền SAU khi seed đã submit
});
```

`onboardPlatform` trả plan 2 bước (`seed` rồi `register`) + tự kiểm mọi gương validator fail-fast:
- **R-WF** (`entryWellFormed`): entry well-formed (id/instance/custody/gov/seed khác rỗng, accepted khác rỗng,
  cut_bps ∈ [0,10000], status=Active).
- **R-NAME**: `entry.platform_id` == beacon NFT name.
- **R-BIND** (`verifyCustodyBinding`): tx đăng ký PHẢI reference custody UTxO mang đúng 1 NFT authenticity
  `(seed_policy, instance_id)` ở đúng `Script(custody_hash)`. → **custody phải seed + submit TRƯỚC** khi đăng ký.

Thứ tự BẮT BUỘC: **BƯỚC 1 (seed) submit trước → BƯỚC 2 (register)**. Đăng ký trước khi seed = entry trỏ
vào instance không tồn tại. `register` cần `registryAuthority` (trong config) **ký** tx (R-SIG).

Builder thuần (`planRegister`) trả datum + value map + redeemer cbor + required signer; deploy script của bạn
dựng tx thật từ plan. Xem `scripts/03_onboard_platform.ts` (dùng config từ `examples/`) làm mẫu end-to-end.

Cập nhật entry về sau (đổi `status`/`governance_ref`/`accepted_assets`/`cut_bps`): `planUpdateEntry(...)`.
5 field identity (platform_id, instance_id, custody_hash, seed_policy, created_epoch) **bất biến** (U-ID);
`Retired` là trạng thái cuối, không revive (U-TERMINAL).

## (e) Tích hợp collect (adapter → collectBuilder)

Khi app phát sinh sự kiện chịu phí, dịch sang CollectItem rồi build tx collect của Treasury:

```ts
import { buildCollectFromEvents } from "@magiclamp/platform-kit";

const result = await buildCollectFromEvents({
  events,        // FeeEvent[] của bạn
  priceFn,       // PriceFn (mục b)
  ...txParams,   // tham số tx Treasury (custody UTxO, ví, ...) trừ items
});
```

Adapter gọi `priceFn` định giá → `CollectItem[]` → `buildCollectTx` của Treasury. Muốn chỉ lấy items
(không build tx, vd để test/kiểm): `eventsToCollectItems(events, priceFn)`.

## (f) Discover + đối soát TRƯỚC khi route phí

Trước khi tin một entry để route phí, đối soát với custody UTxO THẬT — discover chỉ đọc datum, KHÔNG đủ tin:

```ts
const platforms = discoverPlatforms(utxos, beaconPolicy, { registryScriptHash });
const p = findPlatform(platforms, asciiToHex("YourPlatform"));

// Bắt buộc kiểm trước khi route phí:
const dups = findDuplicatePlatformIds(platforms);   // #2: authority lỗi → 2 entry trùng id
if (dups.size > 0) { /* từ chối / xử lý */ }
if (p?.foreignScript) { /* #3: beacon NFT nằm ngoài registry validator thật */ }

const ok = verifyEntryAgainstCustody(p!.entry, custodyUtxo);  // #6: gương R-BIND hậu kỳ
if (!ok.ok) { /* entry "nói dối" custody — KHÔNG route phí */ }
```

`verifyEntryAgainstCustody` kiểm: custody UTxO mang đúng 1 NFT authenticity `(seed_policy, instance_id)`
VÀ payment credential (script hash) == `entry.custody_hash`. Chỉ route phí khi đã verify.

---

## Tóm tắt vòng đời

```
copy _template.ts → viết Config + PriceFn          (a, b)
        │
        ▼
seed custody (planSeed/buildSeedTx) → SUBMIT       (c)  ← giữ txHash#idx
        │
        ▼
register entry (onboardPlatform/planRegister)      (d)  ← authority ký, R-BIND
        │
        ▼
collect phí (buildCollectFromEvents)               (e)
        │
        ▼
discover + verifyEntryAgainstCustody trước route   (f)
```

Tài liệu liên quan: `offchain/src/types.ts` (schema), `examples/` (mẫu thật),
`scripts/03_onboard_platform.ts` (deploy end-to-end), `CONTRACT.md` / `TECH.md` (đặc tả đầy đủ).
