# KẾ HOẠCH TRIỂN KHAI MAINNET — mint LAMP canonical v2 vào kho

> Soạn 2026-07-13. Trạng thái: **CHƯA SẴN SÀNG**. Đây là việc phải làm theo thứ tự.
> Căn cứ: verify on-chain + 4 agent (auditor kho / LAMP / SuperApp / PhoenixKey readiness).

## Sự thật cứng (đã verify on-chain)
- Mainnet LAMP hiện tại `55d3e01b…180f0` = **1e12 base (1 triệu LAMP), `mint_or_burn_count=1`** → **CỐ ĐỊNH, không mint thêm**. Đây KHÔNG phải token 36 tỷ canonical.
- Policy `lamp_mint` (cap 36 tỷ, mintable, registry-gate + A-DEST) **CHƯA deploy mainnet**.
- ⇒ "Mint LAMP vào kho mainnet" = **deploy policy `lamp_mint` MỚI (policy-id mới)** + quyết token này thay/bổ sung `55d3e01b` ra sao.

## A. Quyết định chiến lược (anh + đội chốt trước)
1. **Token mainnet chính thức**: `lamp_mint` mới (pid mới, mintable, cap 36 tỷ) làm "LAMP chính thức"? `55d3e01b` (1M cố định) xử lý sao — giữ làm bootstrap / migrate / khai tử? (thương hiệu + kế toán).
2. **token_tag = `4c414d50`** — đã phân tích, chốt (xem `DEV-NOTE-kho-A-DEST-canonical.md`).
3. **Kho A-DEST = `treasury.ak` vesting** — đã chốt. Kho mainnet hiện tại là `dist_treasury` 1-pkh (giữ 1e12) → **phải thay bằng `treasury.ak` TRƯỚC khi mint giá trị**.
4. **Authority entry LAMP**: `SinglePkh` hay `MultiSig` M-of-N. Spec §11 khuyến nghị **MultiSig (vd 3-of-5)** — 1 khoá lộ không mint tới cap.

## B. Code phải merge (hiện ở nhánh/worktree, chưa lên main)
5. **LAMP**: merge `feat/lamp-mint-compose-anchor-cap` → main (lamp_mint 12-param + registry read-side).
6. **LAMP**: dựng script deploy 12-param **production** (hiện chỉ có demo Preview khoá cứng + bản v1 8-param) — gồm bước phá-vòng + đặt kho-NFT tại `treasury.ak`.
7. **LAMP**: dựng **route kho→pot** (nối Genesis mint ↔ Distribution treasury) — item #9, chưa có. (Chính là pipeline đang diễn tập trên Preprod.)
8. **PhoenixKey-Core**: merge `registry_mint.rs` (write-side, đã có 4-field) → main; build + deploy Registry NFT cho OrgDID.
9. **SuperApp**: đồng bộ enclave core copy sang **4-field** (bản hiện 3-field → sẽ bị validator chặn); ráp `buildAndSignTx` native (Thư); bật cờ `ORG_MINT_ENABLED`.
10. **Backend (Long)**: merge endpoint `mint-lamp` + `submit-tx` + `claim/vesting-release`.

## C. Diễn tập Preprod (GATE — phải xanh mới lên mainnet)
11. Chạy **trọn pipeline canonical** trên Preprod: deploy (thread + lamp_mint 12-param + registry NFT + supply_state + treasury.ak kho + kho-NFT) → mint DistributionVest → kho → claim entitlement → post beacon → redeem → treasury nhả tLAMP về ví. Verify byte-perfect với thiết kế mainnet. **(đang dựng)**

## D. Deploy mainnet (CHỈ sau A–C xanh)
12. TAAD anchor OrgDID **Active trên mainnet** (PhoenixKey-Validator/Core).
13. Runbook mainnet phá-vòng: taad → registry NFT (entry `LAMP`→authority) → `treasury.ak` kho + kho-NFT → thread NFT + `lamp_mint` policy + SupplyState datum (cap 36 tỷ).
14. Mint thật: `DistributionVest`, authority M-of-N ký → LAMP vào kho.
15. Verify on-chain + publish artefacts (policy-id, kho addr, registry NFT) cho SuperApp / PhoenixKey / Long ráp + bật cờ.

## Anh cần làm gì (tóm tắt)
- **Chốt A1–A4** (chiến lược — không ai quyết thay được).
- **Duyệt merge B5–B10** (điều phối nhiều đội: LAMP/Tuân, Core/Thư, SuperApp, Long).
- **Chờ Preprod rehearsal xanh (C11)**.
- **Rồi mới D12–D15.**

Em (agent) KHÔNG thực thi bước mainnet nào (token thật, bất khả nghịch) — anh + đội làm, em chuẩn bị code + verify + diễn tập Preprod.

— LampNet agent
