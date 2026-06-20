# LAMP — Kế hoạch triển khai (cho DEV)

> Anh + Claude lo **spec + review**; **dev code + deploy + vận hành**. Mỗi task = **1 nhánh + 1 PR**.
> Spec nguồn: `Tokenomics/ALLOCATION-SPEC.md` (mint) · `LAMP-DISTRIBUTION-SPEC.md` (phân phối) · `LAMP-POT-CATALOG.md` (18 pot).

---

## 0. Cách dùng plan này (BẮT BUỘC đọc)

- **Định nghĩa-hoàn-thành (DoD)** của mỗi task là **đo được** (số test pass + tiêu chí). Task chỉ "xong" khi DoD xanh — không phải "code chạy".
- **Mỗi task ghi `Est. commit`** = số commit kỳ vọng. PR phải có commit history khớp các bước con (review được tiến độ theo ngày).
- **Tất định (vì sao 5 dev → 1 kết quả):** mỗi task neo vào (a) **interface contract byte-perfect** (datum/param/constr-index — đổi 1 phía là gãy decode 2 phía, P8), (b) **test vector normative** (số liệu cố định trong spec/test), (c) **DoD đo được**. Dev KHÔNG tự quyết datum/param/đơn-vị — đã chốt trong spec. Tự do chỉ ở *cách viết code*, không ở *interface/hành vi*.

---

## 1. Milestone + nhịp theo dõi

| MS | Nội dung | Est. ngày | Est. commit | Theo dõi |
|---|---|---:|---:|---|
| **M0** | Submit backend (D) + dry-run preprod chuỗi canonical | 3 | 12–18 | tx preprod mint tLAMP |
| **M1** | Migration GreenSun-DID mainnet (retire seed) | 2 | 6–10 | tx mainnet B1–B4 + C |
| **M2** | ETD deploy + redeem test toàn cầu | 3 | 10–15 | tx Preview redeem |
| **M3** | Airdrop (đăng ký + snapshot + Merkle claim) | 5 | 20–30 | tx Preview claim |
| **M4** | ISPO (Franken + ispo_pot + spo_registry + keeper) | 7 | 25–40 | tx Preview redirect+claim |
| **M5** | Reserve gate-Treasury + keeper-beacon-C + trần-pot | 6 | 20–30 | tx Preview auto-release |

> **Theo dõi hàng ngày:** mỗi dev commit ≥ 2–4 lần/ngày (mỗi commit = 1 bước con có test). Anh xem `git log --since=yesterday --oneline` để biết tiến độ vs Est.

---

## 2. Task cards (DoD đo được)

### T0 — Submit backend (D)  [MS M0]
- **Spec:** `ALLOCATION-SPEC §9` + runbook `PhoenixKeyDID/.../LAMP-DID-Mint-DEPLOY-RUNBOOK.md §D`.
- **Deliverable:** `scripts/launch/submit.ts` — fetch Blockfrost (UTxO+datum, ví thuần-ADA, params, slot) → evaluate-patch ExUnits (`POST /utils/txs/evaluate`) → submit → poll. Nháp tham chiếu: `launch_did_mint.ts` (worktree cũ).
- **DoD:** dry-run preprod: 4 tx setup + 1 mint **confirmed** (log tx hash). Unit test patch-ExUnits từ 1 CBOR mẫu.
- **Est. commit:** 12–18.

### T1 — Migration GreenSun-DID  [M1]
- **Spec:** `ALLOCATION-SPEC §2,§6,§8` + runbook §A–E. **Phụ thuộc:** root DID mainnet + key HSM (PhoenixKey), builder Core `feat/registry-mint-builders`.
- **Deliverable:** chuỗi tx B1 (genesis OrgDID) → B2 (registry) → B3 (entry LAMP MultiSig) → B4 (supply_state cap 36×10¹⁵) → C (mint test).
- **DoD:** mainnet: mint LAMP ký bằng **controller GreenSun** (sinh trắc) OK; verify policy mới = hash đúng thứ tự §2; **retire seed bootstrap** (chứng minh seed cũ không mint được nữa). Tài liệu điền `<TBD>` policy-id thật vào `ALLOCATION-SPEC §8`.
- **Est. commit:** 6–10.

### T2 — ETD (Early TIGER Delegation)  [M2]
- **Spec:** `DISTRIBUTION §6.1` + code tham chiếu `Distribution/ETD/`.
- **Deliverable:** deploy claim_account (vesting kiểu B, D=1) cho ETD; script snapshot stake TIGER + cấp entitlement.
- **DoD:** **34/34 test** ETD pass (đã có); Preview: redeem thật, verify `on-chain redeemed == off-chain vested`; budget=12 triệu LAMP, Σ E_i + leftover == budget (bất biến).
- **Est. commit:** 10–15.

### T3 — Airdrop 20:100  [M3]
- **Spec:** `DISTRIBUTION §6.2`.
- **Deliverable:** validator `airdrop_registry` (đăng-ký-pool on-chain, hạn epoch 4) + keeper snapshot stake → Merkle root → beacon + claim permissionless (tái dùng `claim_account` Merkle/marker).
- **DoD:** budget 120.000 nghìn = 5 epoch ×24.000; chia 20:100 (4.000 SPO + 20.000 Delegator/epoch) đúng test vector; Preview: 1 SPO + 1 delegator claim thật; vá Sybil (sàn stake + block/epoch) có test negative.
- **Est. commit:** 20–30.

### T4 — ISPO Franken  [M4]
- **Spec:** `DISTRIBUTION §6.3–6.4`.
- **Deliverable:** `ispo_stake_script` (Franken reward-only) + `ispo_pot` + `spo_registry` + keeper snapshot ADA→Merkle + màn "ISPO redirect" trong app.
- **DoD:** budget 360.000 nghìn = 36 epoch ×10.000; reward redirect %chọn vào pot (test: chỉ reward, KHÔNG vốn gốc); LAMP/pool ∝ ADA góp; SPO bonus theo rate tự đặt; vá front-run (flow theo epoch) + bait-switch (cooldown) có test; Preview: 1 delegator redirect + claim thật.
- **Est. commit:** 25–40.

### T5 — Reserve gate-Treasury + keeper + trần-pot  [M5]
- **Spec:** `DISTRIBUTION §4.1, §7`.
- **Deliverable:** validator Reserve gate-mức-Treasury (trần 2% / sàn 1% circulating, BỎ E/1000) + thưởng-keeper + keeper-beacon-C (chung trần-pot) + **SnapshotGen đọc beacon-cap** (MAGIC-dev, đụng T16).
- **DoD:** Preview: tx **permissionless** (không chữ ký authority) mint LAMP vào Treasury khi `parked < 2%·C` → link tx; test: `parked ≥ 2%·C` → reject; thưởng-keeper trích đúng; trần-pot: SnapshotGen scale khi Σpot > Σcommunity (test vector).
- **Est. commit:** 20–30.

---

## 3. Bàn giao (mỗi PR phải có)

1. Code + **test pass** (số khớp DoD) — CI xanh.
2. **Evidence tx** testnet (Preview/preprod) — link cexplorer trong PR body.
3. Cập nhật interface contract nếu đổi (datum/param) — **đồng bộ 2 phía** (aiken ↔ ts), nêu trong PR.
4. README module: cách deploy + cách trigger (cho người vận hành).

---

## 4. Platform/App (cho PlatformKit + kế toán MAGIC)

Định nghĩa: `PlatformKit/`. Platform-DID + App-DID = **PhoenixKey ServiceDID**.
| Dự án | Loại |
|---|---|
| LampNet · PhoenixKey · AffiSo · VeData · ProofChat · AladinWork · SuperApp · OriLife | **Platform** (dịch vụ, app khác tích hợp) |
| **Aladin App** | **App mẫu** (tích hợp tất cả platform) |
| **TonFarm** | **App** (quản lý nông trại / canh tác) |

---

## 5. Pending quyết định (anh chốt — chặn các MS)

- [M1] Gate LAMP nhận `Service` hay giữ `Org` (Platform-DID).
- [M5] Hàm `f(parked,C)` (trần 2%↔sàn 1%) + mức `keeper_fee`.
- [M5] Chấp nhận đụng SnapshotGen (T16) đọc beacon-cap cho trần-pot.
- [M0] Blockfrost preprod key + ai chạy verify testnet.
