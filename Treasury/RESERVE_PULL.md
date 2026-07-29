# Treasury-pull — cầu Reserve ↔ Treasury (nhả khi dưới sàn)

Cơ chế cho phép **Reserve nhả LAMP CHỈ KHI Treasury parked dưới sàn**. Gồm 1 cặp on-chain
mới (THÊM, không sửa custody/collect/release) + builder off-chain.

## Thành phần

| File | Vai trò |
|---|---|
| `onchain/validators/reserve_auth.ak` | Minting policy ONE-SHOT đúc 1 **Treasury-pull auth NFT** — credential "kéo" Reserve. |
| `onchain/validators/reserve_gate.ak` | Spend validator GIỮ auth NFT; chỉ cho spend khi `parked < floor_oil`. |
| `offchain/src/reserveAuthBuilder.ts` | Dựng tx mint auth one-shot (gửi tới gate). |
| `offchain/src/reserveGateBuilder.ts` | Dựng/gộp phần GATE của tx Treasury-pull (spend auth + reference custody + re-output auth). |

## Luật reserve_gate (spend auth UTxO)

- **G-AUTH-1** own input mang auth NFT `(auth_policy, auth_name)` qty == 1 — authenticity.
- **G-CUST-1** tx có **reference input** là custody UTxO THẬT (mang custody NFT
  `(custody_nft_policy, custody_nft_name)` qty == 1). CIP-31, KHÔNG tiêu custody.
- **G-FLOOR-1** `parked = quantity_of(custody_ref.value, lamp_policy, token_name) < floor_oil`.
  CHỈ cho kéo khi dưới sàn (cận chặt: `parked == floor` → reject).
- **G-REOUT-1** auth NFT **re-output về chính gate script** (cùng payment script hash), qty == 1.
- **G-NOBURN-1** auth NFT KHÔNG mint/burn trong tx (qty mint == 0).
- **G-DS-1** đúng 1 input + đúng 1 output mang auth NFT (chống double-satisfaction).

Permissionless: bất kỳ ai cũng trigger được KHI `parked < floor`.

## Flow 1 tx (Reserve draw + gate spend + custody reference)

Treasury-pull thực thi trong **MỘT tx duy nhất**, 2 validator chạy đồng thời:

```
                ┌─────────────────────── 1 TX ───────────────────────┐
 INPUTS:        │  • auth UTxO (tại reserve_gate)   ── reserve_gate ──│ ép SÀN
                │  • ReserveState UTxO (reserve NFT) ── reserve_draw ─│ ép trần epoch
                │  • SupplyState UTxO (Genesis)      ── lamp_mint ────│ kế toán supply
 REFERENCE:     │  • custody UTxO (custody NFT)  ←── đọc parked (CIP-31, KHÔNG tiêu)
 MINT:          │  • delta LAMP (route ReserveDraw)
 OUTPUTS:       │  • auth NFT re-output VỀ reserve_gate (tái dùng)
                │  • ReserveState' (drawn += delta, last_epoch := t)
                │  • SupplyState'  (reserve_minted += delta)
                │  • delta LAMP → reserve_dest (= địa chỉ custody Treasury)
                └─────────────────────────────────────────────────────┘
```

- `reserve_gate` đọc `parked` từ custody reference, ép `parked < floor`, giữ auth NFT.
- Khi gate spend → auth NFT thành **input** → thỏa điều kiện "treasury_auth NFT input qty ≥ 1"
  của `reserve_draw` (Luật 5). Reserve nhả ⟺ Treasury thực sự dưới sàn.
- `reserve_gate` KHÔNG kiểm chi tiết draw của Reserve (reserve_draw tự ép trần/kế toán);
  `reserve_draw` KHÔNG kiểm sàn (gate tự ép). Phân tách trách nhiệm sạch.

Off-chain: gọi `attachGateSpend(txb, gateParams)` để thêm phần gate vào `buildDrawTx`
(Reserve SDK) đang dựng dở, rồi `.complete()` MỘT lần → 1 tx gộp.

## Interface contract (orchestrator chốt khi apply-param)

`reserve_auth` đúc auth NFT; policy id + name của nó PHẢI khớp param của CẢ HAI:

```
reserve_auth.policy_id           == reserve_gate.auth_policy           == reserve_draw.treasury_auth_policy
reserve_auth.auth_name           == reserve_gate.auth_name             == reserve_draw.treasury_auth_name
reserve_gate.custody_nft_policy/name == custody_seed.policy_id / instance_id (custody authenticity NFT)
reserve_gate.lamp_policy/token_name  == lamp_mint.policy / "tLAMP"(testnet) | "LAMP"(mainnet)
reserve_draw.reserve_dest        == địa chỉ custody Treasury (LAMP nhả về custody)
```

## Lưu ý (ngoài phạm vi cầu này)

LAMP nhả từ Reserve đi vào địa chỉ custody Treasury (`reserve_dest`) dưới dạng value THÔ —
**chưa được ghi vào ledger kế toán** của custody. Một tx **Collect** SAU đó (custody.ak nhánh
Collect) phải settle phần LAMP mới này vào sổ (bucket tương ứng) để bất biến
`value == Σ ledger + min_ada` được tái lập. Việc cập nhật sổ là của **collect path** — KHÔNG
thuộc cầu Treasury-pull. Gate chỉ ép SÀN + giữ auth; Reserve chỉ ép trần + chuyển value.
