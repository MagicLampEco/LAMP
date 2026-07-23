# LAMP Allocation — phân bổ per-channel (HARD-CAP 2 lớp)

> Module phân bổ rổ Distribution (26,370 tỷ LAMP) ra các **kênh thưởng**, mỗi kênh
> có trần cứng độc lập + nhả nhỏ giọt (Capped Drop). KHÔNG phải toàn bộ "tokenomics"
> (umbrella = `/TOKENOMICS.md` ở gốc repo). Đơn vị oil: 1 LAMP = 10⁶ oil.

## Vì sao tên "Allocation" (không phải "Tokenomics")
Module này CHỈ làm phân bổ kênh. "Tokenomics" = toàn bộ thiết kế kinh tế = chính repo.
Xem `/TOKENOMICS.md` cho bức tranh tổng (cung, phát hành, điều tiết, pháp lý).

## HARD-CAP 2 lớp phòng thủ (vá lỗ committee cấp vượt ngân sách)
- **Lớp A (kế toán, mềm):** `ChannelBudget` beacon NFT mang `remaining_oil`. Mỗi Claim
  PHẢI consume + tái tạo beacon, trừ `remaining_oil`; reject khi amount > remaining.
  → Σ entitlement đã cấp ≤ budget gốc (bất biến số học).
- **Lớp B (vật lý, cứng):** treasury con PER-CHANNEL, value LAMP = ĐÚNG budget kênh.
  Cạn UTxO = hết ngân sách vật lý, bất khả vượt kể cả Lớp A lỗi.
- **Khoá chéo:** `claim_account` ↔ `channel_budget` BẮT BUỘC cùng tx.

## Validators (onchain)
| File | Vai trò |
|---|---|
| `channel_budget.ak` | beacon `remaining_oil` mỗi kênh (Decrement khi Claim) |
| `budget_nft.ak` | mint NFT chính danh mỗi kênh (name = channel_id) |
| `claim_account.ak` | tài khoản Capped Drop mỗi người nhận (Claim/Redeem) |
| `treasury.ak` | sub-pool LAMP per-channel (ReleaseForRedeem) |

Công thức vested: `vested(t) = min(entitlement, drop_value · drops_per_epoch · max(0, t − start_epoch))`
(drop_value = D, param validator claim_account); `redeemable = vested − redeemed`. Cliff = đặt lùi
`start_epoch` (không cần field riêng).

> ⚠️ **Engine vested là FORK từ Distribution** (math.ak đồng nhất, claim_account ~85% chung;
> KHÔNG `use magiclamp/lampdist`). Đồng bộ **THỦ CÔNG** cho tới khi hợp nhất `magiclamp/common` (sau 18/6).

## Các kênh (allocation v3) — khởi tạo per-channel
| Kênh (channel_id) | LAMP | Cơ chế |
|---|---:|---|
| TEAM | 12 tỷ | Capped Drop, D nhỏ + start_epoch lùi |
| DEVELOPMENT | 2 tỷ | Capped Drop (2 cty vận hành) |
| TREASURY (seed) | 1 tỷ | Capped Drop (vốn mồi điều tiết) |
| AFFILIATE / SCAVENGER | 1 + 1 tỷ | Capped Drop, committee/DID (→ 27/9) |
| PLATFORM | 5 tỷ | Capped Drop theo MAGIC tiêu thụ (→ 27/9) |
| NEWUSER | 4,001 tỷ | DID × 1001 (**= pot Wakeme**, xem POT-CATALOG #6) + thuật toán √×MAGIC (→ 27/9) |

(RESERVE 9,630 tỷ KHÔNG qua kênh này — nó ở rổ Reserve, nhả bởi `Reserve/` engine.)

## Setup 1 kênh (one-shot)
`setupBuilder.ts` → `buildSetupChannelTx()`: consume genesis_ref, mint budget NFT
(name = channel_id), tạo ChannelBudget beacon + treasury con (value = budget). Lặp per kênh.

## Offchain SDK (`@magiclamp/allocation-sdk`)
- `setupBuilder` — khởi tạo kênh.
- `claimBuilder` — committee cấp/tăng entitlement (co-spend account + beacon).
- `redeemBuilder` — user rút LAMP đã vested (permissionless; tự suy epoch từ validFromMs/msPerEpoch).
- `datum`/`math`/`committee` — codec Constr byte-perfect + vested + M-of-N.

## Giả định bảo mật
Setup kênh là thao tác committee tin-cậy (one-shot, nắm `genesis_ref` + chữ ký). `budget_nft`
ép beacon + treasury con ở **Script credential** (chặn ví thường), nhưng **KHÔNG** pin
script-hash cụ thể (tránh vòng phụ thuộc). Committee chịu trách nhiệm đặt đúng
`channel_budget`/`treasury` script khi setup.

## Test
onchain `aiken check` 67 · offchain vitest 63. Xem `tests/` + `offchain/src/`.
