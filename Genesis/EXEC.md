# Genesis — EXEC: Lộ trình build / test / deploy

**Doctype:** MagicLamp Protocol — Genesis Spec (EXEC)
**Trạng thái:** 🟢 đã live Preview (deploy + lazy-mint + mint-thêm) — các tx ở §4 chạy qua **demo runner độc lập** `99_demoA_lazymint.ts` (ví ephemeral, submit thật); script module `01_deploy_lazymint.ts` là **template build-only** (`SUBMIT=false` mặc định), chưa dùng submit live. Bám [`CONTRACT.md`](./CONTRACT.md)
(khung lazy-mint đã ghim 2026-06-08) — KHÔNG mâu thuẫn. EXEC KHÔNG định nghĩa lại datum/bất biến
(việc của [TECH](./TECH.md)/[MATH](./MATH.md)) — chỉ định **thứ tự build, test, deploy, dẫn chứng
on-chain, và việc còn lại (gaps cần code)**.
**Cập nhật:** 2026-06-09

Nguồn chuẩn bắt buộc đọc trước: [`CONTRACT.md`](./CONTRACT.md). Spec anh em: [FEAT](./FEAT.md)
(hành vi phát hành), [MATH](./MATH.md) (chứng minh cap/monotonic/no-burn), [TECH](./TECH.md)
(validator + codec).

---

## 0. Mục tiêu & phạm vi

### 0.1 Mục tiêu

Đưa Genesis lazy-mint từ thiết kế (CONTRACT) tới **chạy thật trên Preview** với bằng chứng on-chain
rằng "fixed-supply 36 tỷ KHÔNG cần mint sẵn 36 tỷ". Cụ thể:

1. Ba script Aiken (`thread_nft` / `tlamp_mint` / `supply_state`) build sạch + test full A1–A12.
2. Lớp offchain (codec byte-perfect + cap math fail-fast + tx builder) test xanh.
3. Deploy SupplyState + lazy-mint thử trên Preview, chứng minh CAP nằm trong datum chứ không phải
   tổng token tồn tại.

Mục tiêu cuối dự án: **làm LAMP có giá trị**. Genesis neo niềm tin tổng cung (36 tỷ tuyệt đối, chứng
minh được on-chain) — nền cho định giá + governance + SDK bên thứ ba.

### 0.2 THUỘC EXEC / KHÔNG thuộc

- **THUỘC:** thứ tự build M0…M4, chiến lược test (Aiken unit + negative A1–A12 + offchain vitest +
  e2e Preview), dẫn chứng tx thật, gaps cần code.
- **KHÔNG:** datum/redeemer schema (TECH §2–3), chứng minh bất biến (MATH).

---

## 1. Lộ trình build (mốc)

| Mốc | Nội dung | Trạng thái |
|---|---|---|
| **M0** | lib `types.ak`/`constants.ak`/`util.ak` — datum/redeemer/helper + hằng số 36 tỷ | ✅ |
| **M1** | `thread_nft.ak` — policy one-shot SUPPLY NFT (tầng 1) | ✅ |
| **M2** | `tlamp_mint.ak` — policy lazy-mint, luật 1–8 (tầng 2) | ✅ |
| **M3** | `supply_state.ak` — spend giữ SupplyState, ủy quyền tlamp_mint (tầng 3) | ✅ |
| **M4** | offchain codec + cap math + mintBuilder + circulating + deploy script | ✅ |
| **M5** | e2e Preview: deploy + lazy-mint + mint-thêm | ✅ (dẫn chứng §4) |
| **M6** | Capped Drop redeem cho DistributionVest (per-user claim) | ⬜ **v1.1** |
| **M7** | nối ReserveDraw vào governance proposal thật | ⬜ **v1.1** |

---

## 2. Chiến lược test

### 2.1 Aiken unit + negative (đã có)

`aiken check` trong `onchain/`: **38 test pass, 0 fail** (chạy 2026-06-09).

| File | Pass | Phủ |
|---|---|---|
| `constants.ak` | 2 | `caps_sum_to_total`, `total_is_36b_lamp` |
| `util.ak` | 4 | `sigs_count/none`, `name_count_one/two` |
| `thread_nft.ak` | 5 | happy + `thread_without_genesis`/`mint_two_threads`/`thread_burn_rejected`/`thread_extra_name` (A3) |
| `supply_state.ak` | 3 | `spend_with_mint` + `spend_without_mint`(A12) + `spend_with_burn_attempt` |
| `tlamp_mint.ak` | 24 | happy 2 đường + biên cap + A1/A4/A5/A6/A7/A8/A9/A10/A11 + thread/datum guard |

Phủ vector tấn công CONTRACT §7 — **mọi A1–A12 có test negative `fail`**:

| Vector | Test | File |
|---|---|---|
| A1 | `mint_exceed_dist_cap`, `mint_exceed_reserve_cap` | tlamp_mint |
| A2 | `mint_no_supplystate`, `no_supplystate_output` | tlamp_mint |
| A3 | `thread_without_genesis`, `mint_two_threads` | thread_nft |
| A4 | `mint_rollback_dist` | tlamp_mint |
| A5 | `distvest_touches_reserve`, `reservedraw_touches_dist` | tlamp_mint |
| A6 | `mint_negative`, `mint_zero`, `thread_burn_rejected` | tlamp_mint / thread_nft |
| A7 | `two_supplystate_inputs` | tlamp_mint |
| A8 | `delta_mismatch` | tlamp_mint |
| A9 | `widen_dist_cap`, `widen_reserve_cap` | tlamp_mint |
| A10 | `mint_no_authority`, `reservedraw_wrong_authority` | tlamp_mint |
| A11 | `mint_extra_name` | tlamp_mint |
| A12 | `spend_without_mint` | supply_state |
| + | `thread_minted_in_tx`, `supplystate_moved_address`, `garbage_output_datum` (guard bổ sung) | tlamp_mint |

### 2.2 Offchain vitest (đã viết — chạy CI/local có deps)

`tests/`: `datum.test.ts` (codec round-trip + byte-perfect Constr index), `supplyState.test.ts`
(cap math happy + biên + A1/A6 offchain + immutable), `circulating.test.ts` (minted − Σ held, Reserve
không trừ, Σ held > minted throw).

> **Trạng thái run 2026-06-09:** trong môi trường audit này `vitest` chưa cài `node_modules`
> (offline) → chưa chạy được lệnh ở đây. Test code đã viết đầy đủ; cần `npm i && npx vitest run`
> trong `offchain/` để có evidence output (gap thực thi, không phải gap code).

### 2.3 e2e Preview (đã chạy — §4)

`scripts/01_deploy_lazymint.ts`: SUBMIT=false mặc định (build + eval + in CBOR, không gửi). SUBMIT=true
gửi thật. Tx A = deploy SupplyState (consume genesis_ref → mint SUPPLY NFT → tạo SupplyState UTxO).
Tx B = mint thử DistributionVest.

---

## 3. Cách chạy

```bash
# onchain
cd onchain && aiken build && aiken check          # 38 test pass

# offchain
cd offchain && npm i && npx vitest run            # codec + cap math + circulating

# deploy Preview (cần .env: BLOCKFROST_KEY + WALLET_SEED/PRIVATE_KEY)
cd scripts && npm run deploy                       # SUBMIT=false → build + in CBOR
SUBMIT=true npm run deploy                          # gửi thật
```

`.env` (gitignored) — KHÔNG hard-code secret (`config.ts:19–28`). SUBMIT=false an toàn: eval script
+ cân phí trước khi tốn tADA.

---

## 4. Dẫn chứng deploy Preview (tx thật)

Nguồn: `LAMP-DEMO-RESULTS-2026-06-08.md`. Ví ephemeral `eph2` sạch, mạng Cardano Preview, giao dịch
thật trên cardanoscan. tLAMP policy `8cfea80be7bd71c1fce45149c5f529c618300da52d67a35213f4b2b9`, name
`744c414d50`, oil 6 thập phân.

| Bước | Tx | Block | Kết quả |
|---|---|---|---|
| Deploy SupplyState (minted=0, dist_cap=34.2 tỷ, reserve_cap=1.8 tỷ) | `e21d2cb1…` | 4361134 | SupplyState UTxO + SUPPLY NFT tạo |
| Lazy-mint **100 tLAMP** DistributionVest | `e8135d28…` | 4361137 | dist_minted 0 → 100e6 |
| Mint thêm **60 tLAMP** | `ed7377fa…` | — | dist_minted 100e6 → 160e6; tLAMP total 100 → 160; **SUPPLY NFT `mint_or_burn_count` vẫn = 1** |

**Bằng chứng cốt lõi của lazy-mint:** sau 2 lần mint, tổng tLAMP on-chain = 160, nhưng datum vẫn ghi
cap 36 tỷ. `minted_total = 160 tLAMP ≪ 36 tỷ` (nhỏ hơn ~360 triệu lần). Phần còn lại = quota trong
SupplyState, **KHÔNG tồn tại on-chain** = không bị tấn công, không khóa min-ADA. SUPPLY NFT tái dùng
(count=1 suốt) chứng minh **Định lý 5.2** (thread bảo toàn qua mọi mint).

SupplyState UTxO còn trên Preview tại `addr_test1wphdua0zl60g7rrmjdf30yxtx6ne9m8lfeswe2607p6964gr5qgdr`
(datum dist_minted=100e6 tại thời điểm demo A; sau mint thêm = 160e6).

> **Lưu ý policy id:** demo dùng `8cfea80b…` (build trước). Policy id thật phụ thuộc params apply-time
> (`genesis_ref` + authority) → mỗi lần deploy với seed khác cho policy id khác. Đây là tính chất
> đúng của one-shot, không phải lỗi.

---

## 5. Việc còn lại (gaps cần code)

### 5.1 Capped Drop redeem cho DistributionVest — **MVP/stub, v1.1**

Hiện DistributionVest gate bằng **authority keyhash** (committee stub, `tlamp_mint.ak:87–92`). CONTRACT
§4b/§8 ghi rõ: v1.1 nối **Capped Drop redeem** (redeemer mang bằng chứng claim của user, thay chữ ký
committee). Cần:
- Mở rộng `TLampMintRedeemer::DistributionVest` mang payload claim (Merkle proof / beacon).
- Property mới: tổng Δ qua tất cả claim ≤ quota Distribution của user cụ thể (MATH §11 ghi là gap).

### 5.2 ReserveDraw → governance proposal thật — **MVP/stub, v1.1**

Hiện gate keyhash DAO stub. v1.1: đọc proposal Executed qua reference input/beacon (giống Treasury
release-gate), thay chữ ký trực tiếp.

### 5.3 Authority M-of-N thật

`count_sigs` + `auth_threshold` (`util.ak:62–64`, `tlamp_mint.ak:92`) đã hỗ trợ M-of-N. MVP deploy dùng
1-of-1 (ví deployer, `01_deploy_lazymint.ts:71–77`). Production cần param hóa list keyhash committee/DAO
thật + threshold > 1.

### 5.4 Offchain test evidence

Chạy `npx vitest run` trong `offchain/` (sau `npm i`) để có output pass/fail thật — code đã đủ, chỉ
thiếu lần chạy có deps (§2.2).

### 5.5 Liên hệ Test B (MAGIC) — ngoài Genesis nhưng cần biết

Generators MAGIC (Snapshot/Instant/Vacuum/Schedule) KHÔNG mint tMAGIC thành token — ghi MAGIC vào
datum vault (`magic_batches[]`), không có MagicMintingPolicy. "tLAMP sinh tMAGIC" = bản ghi kế toán
trong vault, không phải token chuyển được. Genesis chỉ phát hành tLAMP; tMAGIC là phạm vi MAGIC. Quyết
định hướng Test B cần anh chốt (ghi trong demo results 2026-06-08).

---

## 6. Tiêu chí "xong" (definition of done)

| Tiêu chí | Trạng thái |
|---|---|
| 3 validator build sạch (`aiken build`) | ✅ |
| 38 test Aiken pass, 0 fail (mọi A1–A12 negative) | ✅ |
| codec offchain byte-perfect (test viết) | ✅ code, ⬜ run evidence |
| deploy + lazy-mint live Preview (tx thật) | ✅ (§4) |
| chứng minh cap-trong-datum (mint nhiều lần, NFT count=1) | ✅ (`ed7377fa…`) |
| Capped Drop redeem (per-user) | ⬜ v1.1 |
| governance gate cho ReserveDraw | ⬜ v1.1 |

**Kết luận:** Genesis lazy-mint **v1.0 sẵn sàng** (onchain test full + live Preview chứng minh
fixed-supply không cần mint sẵn). Hai gap còn lại (Capped Drop, governance gate) là **mở rộng v1.1
có chủ đích**, không chặn v1.0 — gate hiện (authority keyhash) đủ an toàn cho phát hành có kiểm soát.
