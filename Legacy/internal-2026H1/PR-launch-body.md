# Launch LAMP — ETD + Airdrop-v2 + SRCL (nền + checker + xác minh mainnet)

Bản này gom hạ tầng 3 đợt launch (ETD · Airdrop-v2 · SRCL), 2 fix bảo mật đường đăng ký
SPO, và kết quả xác minh đường lazy-mint LAMP trên mainnet. Không đụng token đã mint, không
mint thật, không ký gì trong CI.

## 1. ETD — Early TIGER Delegator (12M LAMP)

- Checker địa chỉ `TIGER/scripts/tiger_check.ts` + endpoint `LaunchAPI/src/etd.ts`
  (`GET /v1/launch/etd/check?address=…`): dán địa chỉ → LAMP dự kiến, read-only.
- Snapshot thật qua Koios: `TIGER/scripts/build_tiger_koios.ts` (360 owner — MỌI ai từng stake TIGER, kể cả đã rời pool (v2)).
- Cơ chế: Snapshot-Merkle, drip kiểu B (36 epoch, cliff). Validator tái dùng
  `Distribution/onchain/validators/claim_account.ak` (đã audit) — KHÔNG validator mới.
- Còn treo cho Tuân: set `CUTOFF_EPOCH_DEFAULT=637` (`TIGER/offchain/src/constants.ts` đang
  `0n` placeholder) → snapshot thật → seed batch claim_account + genesis D=1 → release kho→pot.
- Test: `TIGER/offchain` **47/47 pass** (check · snapshot · entitlement · dripB).

## 2. Airdrop-v2 — stake-weighted (120M LAMP)

Mô hình STAKE-WEIGHTED (chốt 2026-07-11, thay hoàn toàn CS log-score cũ): mọi pot chia
∝ trọng số stake — chi phí-giả-mạo cao, chống farmer.

| Pot | LAMP | Trọng số |
|---|---|---|
| Delegator | 100.000.000 | stake của chính delegator (mọi pool, đã đăng ký, cửa sổ `[E_open, E_cut)`) |
| SPO (Staking Pool Operator) | 5.000.000 | stake chảy vào pool |
| CS (Community Supporter) | 15.000.000 | bình chọn có-trọng-số-stake của người ủng hộ (dedupe qua DID) |

- Tỷ lệ SPO:CS = 5:15 = **25:75**. Tổng SPO+CS = 20M.
- 1 pot on-chain, tái dùng `Airdrop/onchain/validators/{airdrop_pool,airdrop_nft,airdrop_marker}.ak`
  — KHÔNG validator mới. Offchain: `cs_score.ts::splitByStake` tái dùng `computeEntitlements`
  của TIGER (1 nguồn thuật toán split-∝-stake).
- Đăng ký: Delegator/SPO ký reward stake key; CS cần DID sinh trắc (PhoenixKey) để dedupe
  người NHẬN. Spec: `Airdrop/SPO-CS-SPEC-Vi.md` + `Airdrop/AIRDROP-V2-SPEC-Vi.md`.

## 3. SRCL — staking-reward → LAMP (feasibility)

- Đợt-1 GreenSun: 360M LAMP / 36 epoch. Đợt-2 RedBack: >21M. Chi tiết:
  `SPEC/SRCL-Feasibility-Vi.md`.
- Validator `SRCL/onchain/validators/srcl_stake.ak` — **64/64 test**, ký-1-lần (nối stake-cred
  → script + uỷ quyền PhoenixKey), vốn gốc bất động, reward ép NET về pot. **PR #16 chờ merge.**
- Còn: merge #16 → pipeline đo-reward → entitlement ∝ reward → SetRoot → deploy Preview +
  evidence. Lưu ý PR #15 (∝ADA, bản A cũ) — soát chồng-lấn trước khi merge, bản B là canonical.

## 4. Hai fix bảo mật — đường đăng ký SPO (`Airdrop/scripts/verify_registration.ts`)

1. **Ed25519 verify one-shot.** Bug cũ dùng `createVerify` (streaming digest) → Node ném
   "Invalid digest" cho Ed25519 → **mọi chữ ký hợp lệ đều bị trả `false`** (chặn oan người
   đăng ký thật). Sửa: dùng `crypto.verify(null, msg, pk, sig)` one-shot đúng chuẩn Ed25519.
2. **Chống mạo-danh fail-closed.** `pubkey → stake addr` phải khớp `reward_account` on-chain
   (Blockfrost) — đưa vào nhóm **critical**. Pool không fetch được ⇒ `chainAddrMatch=false`
   ⇒ **INVALID** (fail-closed): không ai khai `payment_address` của mình rồi gán pool người
   khác để rút thưởng SPO. Registration INVALID KHÔNG được đưa vào snapshot.

## 5. Xác minh đường lazy-mint LAMP trên MAINNET ✓

Đọc on-chain read-only (`Genesis/scripts/verify_mainnet_supply.ts`, koios) — đường cap-36B
**ĐÃ wired trên mainnet**, không chỉ 1 mint tx genesis:

- Policy LAMP `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0`, asset `4c414d50`.
- supply_state UTxO `addr1wxz0dkz0v3rg6zeqz9c7cyxz9lg3ynkrlkqrapfkj7e5ppqexy5d3` giữ NFT
  "SUPPLY", inline datum Constr 0 4-field: `dist_minted=1e12` · `reserve_minted=0` ·
  `dist_cap=26,37B×10⁶` · `reserve_cap=9,63B×10⁶` → **tổng cap = 36 tỷ LAMP** ✓.
- KHO dist_treasury `addr1w827sry…` giữ 1e12 LAMP genesis.
- Codec byte-perfect: `Genesis/offchain/src/supply_state.ts` +
  `Genesis/tests/supply_state.test.ts` — bất biến `encodeSupplyState(state mainnet) === CBOR
  mainnet` XANH. Scaffold kế hoạch mint: `Genesis/scripts/mint_release_plan.ts` (DRY-RUN).
- Test Genesis codec: **41/41 pass** (gồm 7 test supply_state mới).

## 6. Test + việc còn lại cho Tuân

**Đã xanh:** ETD/TIGER 47/47 · Genesis codec 41/41 · SRCL `srcl_stake` 64/64 (PR #16) ·
verify script mainnet chạy read-only.

**Còn lại (Tuân):**
1. Xác nhận cơ chế WHO-gate THẬT của `lamp_mint` đã deploy mainnet (bootstrap authority-sig
   `[pkh]`/MultiSig hay reference registry NFT — tx genesis không lộ registry NFT).
2. Chốt khoá authority ai giữ (MultiSig 2/3 bootstrap → di trú OrgDID PhoenixKey trước khi
   nạp giá trị lớn).
3. Hoàn thiện builder `mint_release_plan.ts` → nối khoá + reference script + registry UTxO →
   dựng tx thật (tham chiếu `Genesis/offchain/src/mintBuilder.ts`).
4. Thứ tự mint 513M LAMP (ETD 12M + Airdrop 120M + SRCL ~381M) ≪ headroom distribution còn
   26,369 tỷ LAMP.
5. ETD: set cutoff=637 → snapshot → seed batch → release pot. Airdrop: deploy pool NFT →
   SetRoot theo epoch. SRCL: merge #16 → pipeline đo-reward → SetRoot.

Chi tiết bàn giao: [SPEC/HANDOFF-Tuan-Launch-2026-07-10.md](https://github.com/MagicLampNetwork/LAMP/blob/feat/launch-etd-airdrop-srcl/SPEC/HANDOFF-Tuan-Launch-2026-07-10.md).
