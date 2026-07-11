# Bàn giao Tuân — Triển khai TOÀN BỘ Launch LAMP

> 2026-07-10. Anh giao Tuân dựng toàn bộ launch. Bản này gom bối cảnh đã chốt, việc phải
> xác minh trước, 3 đợt launch song song, thứ tự deploy, bảng ai-làm-gì, và checker công
> khai. Giọng cộng sự — vào thẳng việc. Không tự post GitHub; mọi content public anh duyệt.

---

## 1. Bối cảnh đã chốt

**Policy LAMP canonical (mainnet):**
`55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0`
- PlutusV3, cap-36B lazy-mint, decimals = 6 (1 LAMP = 10⁶ oildrop).
- Genesis đã mint **1e12 base = 1.000.000 LAMP** — nằm trong **kho script** (`addr1w827sry…`),
  chưa phân phối. Đây là lượng khởi tạo kỹ thuật (0,0028% cap), không mang ý nghĩa thiết kế.
- Nguồn: `docs/LAMP-POLICY-EXPLAINER.md`.

**Model mint = cap-36B OrgDID lazy-mint, validator bản B:**
- `Genesis/onchain/validators/lamp_mint.ak` — redeemer `DistributionVest` / `ReserveDraw`.
- WHO-gate qua `registry.validate_mint` (`Genesis/onchain/lib/magiclamp/genesis/registry.ak`):
  `token_tag` → SinglePkh / MultiSig / Revoked.
- **A-DEST ép on-chain:** Δ mint bắt buộc chảy vào kho NFT, không ra ví người vận hành.
- **SupplyState 4-field:** bộ đếm tổng phát hành, đơn điệu tăng, ≤ 36B, chống mint đôi.
- `ReserveDraw` permissionless (spend meter/reserve_thread NFT, δ ≤ E/1000).

**Authority mint:** MultiSig **2/3 bootstrap** → **di trú OrgDID** (PhoenixKey) TRƯỚC khi nạp
giá trị lớn. **KHÔNG dùng 1 pkh nóng.** Ký để mint = authority trong registry entry
(controller OrgDID), không phải khoá riêng của LAMP policy.

> ⚠️ Phân biệt 2 policy:
> - `55d3e01b…180f0` = policy mainnet **đúc-một-lần cố định 1e12** → KHÔNG mint thêm.
> - Đường `lamp_mint` + SupplyState cap-36B là **policy KHÁC** (mintable). Xem việc xác minh #1.

---

## 2. VIỆC XÁC MINH #1 — ĐÃ XÁC MINH ✓ (lazy-mint ĐÃ wired trên MAINNET)

**Câu hỏi:** đường lazy-mint (supply_state counter + kho + cap-36B) đã wired trên **MAINNET**
chưa, hay mới chỉ ở **Preview**?

**KẾT QUẢ (đọc on-chain qua koios, read-only — `Genesis/scripts/verify_mainnet_supply.ts`):**

> **ĐÃ wired trên MAINNET.** Không chỉ 1 mint tx genesis — supply_state counter 4-field +
> kho dist_treasury đều đã có mặt trên mainnet, cap tổng = **36 tỷ LAMP** đúng allocation v17.

Bằng chứng (tx genesis `db0610c2…`):

| Thành phần | Giá trị on-chain (mainnet) |
|---|---|
| Policy LAMP | `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0`, asset `4c414d50` ("LAMP") |
| supply_state UTxO | `addr1wxz0dkz0v3rg6zeqz9c7cyxz9lg3ynkrlkqrapfkj7e5ppqexy5d3` (script hash `84f6d84f64468d0b201171ec10c22fd1124ec3fd803e853697b34084`), giữ NFT "SUPPLY" (`535550504c59`) |
| supply_state datum | **inline**, Constr 0, 4 field oildrop: `dist_minted=1_000_000_000_000` · `reserve_minted=0` · `dist_cap=26_370_000_000_000_000` · `reserve_cap=9_630_000_000_000_000` (26,37B + 9,63B = **36B**) |
| CBOR datum | `d8799f1b000000e8d4a51000001b005daf6012ba20001b0022366f192fe000ff` |
| KHO (dist_treasury) | `addr1w827sry6t2y9744ndkg4ks6nct57v7tm8pz46ywsq98dhdsf76slu` (hash `d5e80c9a5a885f56b36d915b4353c2e9e6797b38455d11d0014edbb6`), giữ **1e12 LAMP** genesis (= 1.000.000 LAMP) |

Codec đối chiếu byte đã kết tinh: `Genesis/offchain/src/supply_state.ts` +
test `Genesis/tests/supply_state.test.ts` — bất biến then chốt
`encodeSupplyState(state mainnet) === CBOR mainnet` **XANH** (byte-perfect với on-chain).

**⇒ KHÔNG phải deploy lại registry/supply_state/kho.** Runbook phá-vòng cũ (deploy từ đầu)
KHÔNG còn cần. Đường găng thu hẹp còn 4 việc dưới.

**Việc CÒN LẠI chính xác (Tuân):**

1. **Xác nhận cơ chế WHO-gate THẬT của `lamp_mint` đã deploy mainnet.** Tx genesis KHÔNG lộ
   registry NFT ⇒ chưa rõ mint-more gate bằng **bootstrap authority-sig** (`[pkh]` / MultiSig
   2/3 trong param apply — như `03_mint_more.ts` Preview dùng `[pkh],1n`) hay bằng **reference
   registry NFT** (`token_tag` → SinglePkh/MultiSig/Revoked qua `registry.validate_mint`).
   Tra `koios /script_info?_script_hashes=[<lamp_mint hash>]` lấy CBOR + soi param apply.
2. **Khoá authority ai giữ** — theo HANDOFF §1: MultiSig **2/3 bootstrap** → di trú OrgDID
   (PhoenixKey) TRƯỚC khi nạp giá trị lớn. Chốt danh tính người giữ + quy trình ký.
3. **Hoàn thiện builder mint_release** — `Genesis/scripts/mint_release_plan.ts` (SCAFFOLD
   DRY-RUN, đã in kế hoạch datum cũ→mới + A-DEST + redeemer cho từng đợt) → nối khoá (b) +
   reference script (a) + registry UTxO (c nếu có) → dựng tx thật (tham chiếu `mintBuilder.ts`).
4. **Thứ tự mint 513M LAMP** (ETD 12M + Airdrop 120M + SRCL ~381M) — tổng **513M** ≪ headroom
   distribution còn **26,369 tỷ LAMP** (dist_cap − dist_minted). Kế hoạch từng bước:
   `npx tsx Genesis/scripts/mint_release_plan.ts` in ra datum cũ→mới mỗi đợt.

*(Còn treo cần anh chốt nếu WHO-gate dùng registry NFT: registry write-side .ak ai giữ +
compile CBOR + hash; giá trị byte `token_tag` cho LAMP. Nếu dùng bootstrap authority-sig thì
KHÔNG cần registry — Tuân xác nhận ở việc #1.)*

---

## 3. Ba launch song song

### 3.1 ETD — Early TIGER Delegator (12M LAMP)

| | |
|---|---|
| Pot | 12.000.000 LAMP, TIGER retroactive |
| Cutoff | epoch **637** (18/6 UTC) — hiện `CUTOFF_EPOCH_DEFAULT=0n` placeholder ở `TIGER/offchain/src/constants.ts:26`, phải set 637 |
| Cơ chế | Snapshot-Merkle, drip kiểu B (36 epoch, cliff) |
| Offchain | `TIGER/offchain/src/` — **47/47 test pass** |
| Validator | tái dùng `Distribution/onchain/validators/claim_account.ak` (audit OK) |
| Dữ liệu thật | đã build qua Koios: `TIGER/scripts/build_tiger_koios.ts` → **106 delegator** |
| API | `LaunchAPI/src/etd.ts` — `GET /v1/launch/etd/check?address=…` |
| E2E | `Distribution/scripts/05_tiger_redeem.ts` (bit-identity Preview) |

**Còn:** set cutoff=637 → chạy snapshot thật → **seed batch claim_account** + genesis D=1 →
**release kho → pot ETD** (bước tách LAMP từ kho ra pot — phụ thuộc việc xác minh #1).

### 3.2 Airdrop-v2 (120M LAMP = 100M delegator + 20M SPO/CS)

| | |
|---|---|
| Delegator | 100M, ∝ stake **ĐĂNG KÝ** (mọi pool, không chỉ TIGER) |
| SPO/CS | 20M, base:CS = 30:70, cổng kích hoạt "whale-no-CS = 0" |
| Spec | `Airdrop/SPO-CS-SPEC-Vi.md` (có) + `Airdrop/AIRDROP-V2-SPEC-Vi.md` (**đang viết** — agent khác) |
| On-chain | tái dùng `Airdrop/onchain/validators/`: `airdrop_pool.ak` (SetRoot/Claim/Sweep) + `airdrop_nft.ak` + `airdrop_marker.ak` — **KHÔNG validator mới** |
| Offchain có sẵn | `Airdrop/offchain/src/`: merkle, datum, claimBuilder, deployBuilder, sweepBuilder, snapshotTool |
| Offchain MỚI (agent viết) | `delegator_register`, `cs_score`, `delegator_entitlement` — **chưa có trong `Airdrop/offchain/src/`**, chờ nạp |
| Đăng ký SPO | `Airdrop/scripts/spo_register.ts` (có) + bổ sung cổng §3 |

**Mô hình:** 1 pot on-chain, 2 nguồn snapshot (delegator ∝stake · SPO/CS). ProofChat build
nhóm chat + đo **D/A/G/R**; AffiSo xuất metric thô theo schema §8 + đặt **bond** (slash nếu
gian lận). **Còn:** deploy pool NFT → nạp SetRoot theo epoch (T=20) → API proof/inclusion →
cửa sổ khiếu nại 1 epoch trước mint.

### 3.3 SRCL (bản B — PR #16 chờ merge)

Chi tiết đầy đủ: **[`SRCL-Feasibility-Vi.md`](./SRCL-Feasibility-Vi.md)**. Tóm:
- Pot đợt-1 GreenSun: 360M LAMP, 36 epoch. Đợt-2 RedBack: >21M.
- Validator `ISPO/onchain/validators/srcl_stake.ak` — 64/64 test, Tuân duyệt, **chờ anh merge**.
- Ký-1-lần (nối stake-cred → script + uỷ quyền PhoenixKey); vốn gốc bất động; reward ép NET
  về pot (F1/F2 đã vá).
- **Còn:** merge #16 → pipeline đo-reward→entitlement∝reward→SetRoot → deploy Preview +
  evidence → PhoenixKey claim → freeze param GreenSun → public source + verify hash.

> ⚠️ **PR #15 (Tuân, T4)** = ISPO distribution ∝**ADA** (nhánh bản A cũ). Soát chồng-lấn với
> #16 (∝reward bản B) TRƯỚC khi merge cả hai — bản B là canonical, đừng để bản A ghi đè.

---

## 4. Thứ tự deploy

```
0. [ĐƯỜNG GĂNG] Xác minh #1: registry + supply_state + kho trên mainnet?  → nếu thiếu, deploy
1. Kho dist_treasury + kho_nft + SupplyState datum 4-field  (nền chung cho cả 3 đợt)
2. Route vesting-release: kho → pot (ETD / Airdrop / SRCL)   ← bước tách LAMP ra pot
3a. ETD:   set cutoff=637 → snapshot → seed claim_account + genesis D → release pot
3b. Airdrop: deploy pool NFT → nạp code delegator_register/cs_score → SetRoot theo epoch
3c. SRCL:  merge #16 → deploy SRCL script + pool Preview → pipeline đo-reward → SetRoot
4. API checker công khai (ETD có; thêm airdrop/srcl) + affiso.net/launch
5. PhoenixKey claim cho cả 3 đợt (nhả dần, chống double-claim)
```

Bước 1-2 chặn cả 3 đợt → làm trước. 3a/3b/3c chạy song song sau khi có kho + route.

---

## 5. Ai làm gì

| Người / nhóm | Việc |
|---|---|
| **Tuân** | Onchain + deploy: xác minh #1, deploy registry/supply_state/kho, merge #16, deploy pool 3 đợt, seed batch, route kho→pot, evidence Preview |
| **AffiSo** | Frontend `affiso.net/launch/<đợt>` + đo lường: xuất metric thô (schema SPO/CS §8), render checker JSON, bond+slash, thông báo |
| **ProofChat** | Nhóm chat Launch trong SuperApp + đo **D/A/G/R** (Airdrop CS) + hiển thị số dư/địa chỉ |
| **PhoenixKey** | DID sinh trắc + liveness + ký uỷ quyền (SRCL 1 lần) + ký claim cả 3 đợt (chống sybil, 1 người 1 DID) |
| **Long (PhoenixKey-Core)** | Registry **write-side** (`registry_mint.rs`) — ghi entry OrgDID/authority; chốt ai giữ code .ak + CBOR + hash |
| **Anh** | Duyệt content public, bấm merge PR #16/#15, chốt param freeze, chốt cutoff=637, chốt pháp nhân VN/DAO |

---

## 6. Checker công khai (read-only mainnet)

Dán địa chỉ → LAMP dự kiến. **KHÔNG đụng LAMP đã mint, KHÔNG ký gì.**

- Nền tảng: `LaunchAPI/src/` — ETD đã có `etd.ts` (`GET /v1/launch/etd/check`). Thêm
  `airdrop/check` + `srcl/check` cùng khuôn (đọc Blockfrost/Koios → math canonical LAMP-side
  P8, tái dùng lõi offchain từng module → trả JSON; AffiSo chỉ render).
- Giao diện: `affiso.net/launch` — người dùng dán address/stake_addr → xem "đã đóng góp / đủ
  điều kiện / LAMP dự kiến" từng đợt.
- Nguyên tắc: entitlement math **canonical ở LAMP-side**, AffiSo KHÔNG tự tính LAMP.

---

## 7. File spec / code liên quan

**Spec:**
- `SPEC/SRCL-Spec-Vi.md` — cơ chế SRCL bản B (khái niệm).
- `SPEC/SRCL-Feasibility-Vi.md` — đánh giá khả thi SRCL (kèm bản này).
- `SPEC/Launch-Framework-Vi.md`, `SPEC/AffiSo-Launch-Requirements-Vi.md` — khung Launch.
- `Airdrop/SPO-CS-SPEC-Vi.md` — đặc tả SPO/CS (có).
- `Airdrop/AIRDROP-V2-SPEC-Vi.md` — spec Airdrop-v2 (**đang viết**, agent khác).
- `docs/LAMP-POLICY-EXPLAINER.md` — policy mainnet + FAQ công khai.
- `SESSION-STATE-lamp-mint-canonical.md` — state mint canonical + ETD + SRCL.

**Code on-chain:**
- `Genesis/onchain/validators/lamp_mint.ak` + `lib/magiclamp/genesis/registry.ak` — mint bản B.
- `Distribution/onchain/validators/claim_account.ak` — claim (ETD tái dùng).
- `Airdrop/onchain/validators/{airdrop_pool,airdrop_nft,airdrop_marker}.ak`.
- `ISPO/onchain/validators/srcl_stake.ak` — **PR #16, chờ merge** (chưa trong cây làm việc).
- `ISPO/onchain/validators/ispo_pool.ak` (SetRoot/Claim/Sweep) — tầng nhả SRCL.

**Code off-chain / scripts:**
- `TIGER/offchain/src/` (47/47) + `TIGER/scripts/build_tiger_koios.ts` (106 delegator).
- `Airdrop/offchain/src/` (merkle/datum/claimBuilder/…) + `Airdrop/scripts/spo_register.ts`.
- `LaunchAPI/src/etd.ts` (+ airdrop/srcl sắp thêm), `LaunchAPI/src/server.ts`.
- `Distribution/scripts/05_tiger_redeem.ts` — E2E ETD Preview.

---

*Blocker cần anh: merge #16/#15, chốt cutoff=637, freeze param GreenSun, chốt pháp nhân
phát hành. Tuân bắt đầu ở việc xác minh #1 (đường găng).*
