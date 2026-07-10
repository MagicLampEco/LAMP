# tLAMP + Faucet — EXEC: Lộ trình build / test / deploy

**Trạng thái:** draft 2026-06-09. Bám [`CONTRACT.md`](./CONTRACT.md) (interface đã chốt) — KHÔNG
mâu thuẫn. EXEC không định nghĩa lại datum/bất biến (việc của [TECH](./TECH.md)/[MATH](./MATH.md)) —
chỉ định **thứ tự build, test, deploy, trạng thái thật hiện tại, dẫn chứng, việc còn lại**.

Nguồn chuẩn đọc trước: [CONTRACT.md](./CONTRACT.md), hành vi [FEAT.md](./FEAT.md). Mẫu 4-spec đã
chạy ở [`Treasury`](../Treasury/) và [`Governance/VotingPower`](../Governance/VotingPower/).

---

## 0. Mục tiêu & phạm vi

### 0.1 Mục tiêu

Đưa Faucet từ code tới **chạy thật trên Preview**: deploy 1 pool tLAMP one-shot, rồi mọi dev claim
100 tLAMP. Token test canonical thay token cũ phân mảnh — phục vụ mục tiêu cuối **làm LAMP có giá
trị** (open SDK: 1 policy id tLAMP chia sẻ toàn mạng test cho mọi Cardano team — [CONTRACT §6](./CONTRACT.md)).

### 0.2 Thuộc EXEC

- Lộ trình build theo mốc M0…M4 + thứ tự phụ thuộc.
- Test plan: unit Aiken (đã có, đã pass), unit offchain (đã có), e2e Preview (gaps).
- Trạng thái thật hiện tại (bám git/test, không trí nhớ).
- Harness deploy `00→01→02` + cách bật SUBMIT.
- Negative test đã có + còn thiếu; việc còn lại (gaps cần code/deploy).

### 0.3 KHÔNG thuộc EXEC

| Hạng mục | Thuộc |
|---|---|
| Datum/redeemer, validator, bất biến on-chain map dòng | [TECH](./TECH.md) |
| Chứng minh one-shot / value-preservation / no-burn | [MATH](./MATH.md) |
| Vai caller, luồng deploy/claim, trạng thái trước/sau | [FEAT](./FEAT.md) |
| Cooldown per-address | v1.1, chưa code ([CONTRACT §3](./CONTRACT.md)) |

---

## 1. Trạng thái thật hiện tại (bám sự thật, verify được)

| Thành phần | Trạng thái | Bằng chứng |
|---|---|---|
| `tlamp_policy.ak` | ✅ code xong + test pass | [`onchain/validators/tlamp_policy.ak`](./onchain/validators/tlamp_policy.ak) |
| `faucet.ak` | ✅ code xong + test pass | [`onchain/validators/faucet.ak`](./onchain/validators/faucet.ak) |
| `util.ak` / `types.ak` | ✅ code xong | [`onchain/lib/magiclamp/faucet/`](./onchain/lib/magiclamp/faucet/) |
| Unit test Aiken | ✅ **27/27 pass** (`aiken check` exit 0) | §3.1 |
| SDK offchain (datum/mint/claim builder) | ✅ code xong + test viết | [`offchain/src/`](./offchain/src/), [`tests/`](./tests/) |
| Unit test offchain (vitest) | ⚠️ **chưa chạy được trong sandbox** (vitest chưa cài) | §3.2 |
| Harness deploy `00/01/02` | ✅ code xong, **SUBMIT=false mặc định** | [`scripts/`](./scripts/) |
| Deploy live Preview | ❌ **CHƯA chạy** — chưa có `deployed-faucet.json`, chưa có tx hash | §5 (gap) |

> **Lưu ý quan trọng — KHÔNG có tx hash thật.** Khác với mô tả "dẫn chứng deploy Preview" trong
> task, **module này CHƯA deploy live**: `scripts/deployed-faucet.json` chưa tồn tại (gitignored,
> sinh khi chạy `01_mint_pool.ts`), `01_mint_pool.ts` mặc định `SUBMIT=false` (chỉ build + log, ghi
> state khô — [`01_mint_pool.ts:71-76`](./scripts/01_mint_pool.ts)). Không bịa tx hash. Việc deploy
> + lấy tx hash là **gap còn lại** ở §5.

---

## 2. Lộ trình build — mốc M0…M4

| Mốc | Nội dung | Phụ thuộc | Trạng thái |
|---|---|---|---|
| **M0** | Types + util (datum, redeemer, đếm script hash) | — | ✅ xong |
| **M1** | `tlamp_policy.mint` one-shot + 10 test (mint + red-team) | M0 | ✅ xong, pass |
| **M2** | `faucet.spend` pool + 17 test (claim + red-team) | M0 | ✅ xong, pass |
| **M3** | SDK offchain: datum codec, `buildMintPoolTx`, `buildClaimTx` + test | M1, M2 | ✅ code xong |
| **M4** | Deploy Preview: preflight → mint pool → claim e2e, verify on-chain | M3 + credential | ❌ **chưa chạy** |

---

## 3. Test plan + dẫn chứng

### 3.1 Unit Aiken — ĐÃ CHẠY, PASS FULL

Lệnh: `cd onchain && aiken check`. Kết quả: **exit 0**, không test fail. 27 test (10 cho
`tlamp_policy`, 17 cho `faucet`). Tất cả `"on_failure": "succeed_eventually"` cho test `fail`,
`status: pass` cho happy.

**tLAMP policy (10):**

| Test | Phủ |
|---|---|
| `mint_full_supply_happy` | happy: consume genesis + đúng `T` |
| `mint_without_genesis` | one-shot reject |
| `mint_wrong_quantity_less` / `_more` | sai tổng cung |
| `mint_negative_burn` | no-burn |
| `mint_extra_asset_name` | dict.size == 1 |
| `rt_mint_lamp_plus_negative_other` | name lạ qty âm → size 2 |
| `rt_mint_zero_qty` | qty 0 không tạo entry → size 0 |
| `rt_mint_genesis_wrong_index` | off-by-one output_index |
| `rt_mint_only_fake_name` | mạo danh name lạ |

**Faucet (17):**

| Test | Phủ |
|---|---|
| `claim_happy`, `rt_happy_with_dust` | happy + ôm dust hợp lệ |
| `claim_too_much` / `_too_little` | nhả ≠ 100 |
| `claim_drain_ada` | rút ADA |
| `claim_steal_other_asset`, `rt_steal_dust` | cuỗm dust |
| `rt_negative_effective_claim` | bơm ngược |
| `claim_mint_rejected`, `rt_mint_other_policy` | mint khi claim |
| `claim_datum_tamper`, `rt_pool_out_no_datum` | datum tamper / mất datum |
| `claim_zero_amount_datum`, `rt_negative_claim_amount` | `claim_amount ≤ 0` |
| `claim_double_satisfaction` | 2 pool input |
| `rt_two_pool_outputs` | 2 pool output |
| `rt_own_ref_not_script` | own_ref non-script |

> Map đầy đủ test ↔ property ở [MATH §5](./MATH.md).

### 3.2 Unit offchain (vitest) — viết xong, CHƯA chạy được trong sandbox

Test tồn tại: [`tests/datum.test.ts`](./tests/datum.test.ts) (codec round-trip + redeemer
`d87980` + constants), [`tests/builders.test.ts`](./tests/builders.test.ts) (mock Lucid tx-builder:
mint full supply / consume genesis / pool nhận hết; claim nhả đúng 100 + bảo toàn ADA/dust/datum +
`pool_out + claimer == pool_in` + pool cạn + reject datum 0 / no datum).

Lệnh dự kiến: `cd offchain && npm test` (vitest). **Gap môi trường:** trong sandbox `/tmp` chưa
`npm install` (vitest chưa có) → `npx vitest run` báo `Cannot find package 'vitest'`. Đây là **thiếu
môi trường, KHÔNG phải lỗi code** — test files đầy đủ, logic đúng theo review. Việc còn lại: chạy
`npm install && npm test` ở môi trường có mạng.

### 3.3 E2e Preview — CHƯA chạy (gap M4)

Harness 3 bước ([`scripts/`](./scripts/)), đọc `.env` từ `MAGIC/.env`
(`BLOCKFROST_TOKEN_GREENSUN` + `VEDATA_WALLET_MNEMONIC` — [`config.ts:22-29`](./scripts/config.ts)):

1. **`00_preflight.ts`** — kiểm tra `.env`, kết nối Blockfrost, ví ≥ 10 tADA, `plutus.json` có 2
   validator. KHÔNG build/submit. ([`00_preflight.ts`](./scripts/00_preflight.ts))
2. **`01_mint_pool.ts`** — chọn UTxO lớn nhất làm genesis → apply policy + faucet → `buildMintPoolTx`
   → ghi `deployed-faucet.json`. `SUBMIT=true` mới gửi live. ([`01_mint_pool.ts`](./scripts/01_mint_pool.ts))
3. **`02_claim.ts`** — đọc state, resolve pool UTxO, `buildClaimTx` nhả 100 tLAMP cho ví. `SUBMIT=true`
   mới gửi. ([`02_claim.ts`](./scripts/02_claim.ts))

Mặc định `SUBMIT=false` ⇒ chỉ build + log, **không gửi tx** ([`config.ts:31-32`](./scripts/config.ts)).
Bật thật: `SUBMIT=true tsx 01_mint_pool.ts`.

---

## 4. Cách deploy live (khi có credential)

```bash
cd Faucet/onchain && aiken build                 # sinh plutus.json
cd ../scripts
tsx 00_preflight.ts                              # verify env + ví đủ tADA
SUBMIT=true tsx 01_mint_pool.ts                  # one-shot mint + deploy pool (ghi tx hash)
SUBMIT=true tsx 02_claim.ts                      # claim 100 tLAMP e2e
```

Sau `01` (SUBMIT=true): `deployed-faucet.json` chứa `tlamp.policyId`, `faucet.address`,
`poolUtxo.{txHash,outputIndex}` ([`config.ts:103-114`](./scripts/config.ts)). Explorer link tự in
qua `explorerTx` (cardanoscan Preview, [`config.ts:128-130`](./scripts/config.ts)).

**Verify on-chain sau deploy (cần làm để đóng MATH §6 CONSERVE):**
- Pool UTxO tại `faucet.address` có `tLAMP = TOTAL_SUPPLY_OIL`, inline datum đúng.
- Sau claim: pool giảm đúng `100 × 10^6` oil; ví dev `+100 tLAMP`; `tx.mint` rỗng.
- Genesis UTxO biến mất → thử mint lại phải fail (one-shot).

---

## 5. Việc còn lại (gaps cần code/deploy)

| # | Gap | Loại | Ưu tiên |
|---|---|---|---|
| G1 | **Deploy live Preview** chưa chạy — chưa có `deployed-faucet.json` + tx hash thật | deploy (cần credential + tADA) | cao |
| G2 | **Vitest offchain chưa chạy** trong sandbox (vitest chưa cài) — cần `npm install && npm test` | môi trường | cao |
| G3 | **Verify CONSERVE end-to-end onchain** (dev nhận đúng `c`): validator KHÔNG kiểm output dev (cố ý, tối ưu eUTXO) → chỉ e2e Preview phủ được ([MATH §3.2, §6](./MATH.md)) | e2e | cao |
| G4 | **Test chuỗi claim lặp tới cạn** (monotonic `P→P−c→…→0`) chưa có onchain | test | trung |
| G5 | **CIP-25 metadata (label 721)** cho tên/logo tLAMP ở ví/explorer — chưa đính, MVP chưa bắt buộc ([CONTRACT §2](./CONTRACT.md)) | nice-to-have | thấp |
| G6 | **Cooldown per-address (v1.1)** chống cạn pool — marker UTxO "đã claim epoch N", KHÔNG thuộc MVP ([CONTRACT §3](./CONTRACT.md)) | v1.1, chưa code | thấp |
| G7 | **Trỏ module test khác** (Distribution/Treasury/Governance) sang `deployed-faucet.json.tlamp.policyId` thay sig policy cũ deprecated ([CONTRACT §6](./CONTRACT.md)) | tích hợp | trung |

---

## 6. Tiêu chí "xong" (DoD)

- [x] 2 validator code xong, build sạch.
- [x] Unit Aiken **27/27 pass** (đã chạy, exit 0).
- [x] SDK offchain + harness deploy code xong.
- [ ] Unit offchain vitest chạy pass (G2).
- [ ] Deploy live Preview, có tx hash mint + claim thật (G1).
- [ ] Verify on-chain: pool đầy → claim → pool `−c`, ví `+c`, no mint, genesis locked (G3).
- [ ] Module test khác trỏ tới tLAMP canonical (G7).

**Hiện trạng:** onchain **sẵn sàng** (test pass full). Offchain code xong, chờ chạy vitest + deploy
live. Không tuyên bố "live" cho tới khi G1+G3 có bằng chứng tx hash thật trên cardanoscan Preview.
