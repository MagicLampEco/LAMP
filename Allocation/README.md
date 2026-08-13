# LAMP Allocation — phân bổ per-channel (HARD-CAP 2 lớp)

> Module phân bổ rổ Distribution (26,370 tỷ LAMP) ra các **kênh thưởng**, mỗi kênh
> có trần cứng độc lập + nhả nhỏ giọt (Capped Drop). KHÔNG phải toàn bộ "tokenomics"
> (bức tranh tổng ở `Papers/pot-catalog.md` + `Papers/distribution.md`). Đơn vị oildrop: 1 LAMP = 10⁶ oildrop.

## Vì sao tên "Allocation" (không phải "Tokenomics")
Module này CHỈ làm phân bổ kênh. "Tokenomics" = toàn bộ thiết kế kinh tế = chính repo.
Bức tranh tổng (cung, phát hành, điều tiết, pháp lý): `Papers/pot-catalog.md`, `Papers/distribution.md`, `Papers/Whitepaper.md`.

## HARD-CAP 2 lớp phòng thủ (vá lỗ committee cấp vượt ngân sách)
- **Lớp A (kế toán, mềm):** `ChannelBudget` beacon NFT mang `remaining_oildrop`. Mỗi Claim
  PHẢI consume + tái tạo beacon, trừ `remaining_oildrop`; reject khi amount > remaining.
  → Σ entitlement đã cấp ≤ budget gốc (bất biến số học).
- **Lớp B (vật lý, cứng):** treasury con PER-CHANNEL, value LAMP = ĐÚNG budget kênh.
  Cạn UTxO = hết ngân sách vật lý, bất khả vượt kể cả Lớp A lỗi.
- **Khoá chéo:** `claim_account` ↔ `channel_budget` BẮT BUỘC cùng tx.

## Validators (onchain)
| File | Vai trò |
|---|---|
| `channel_budget.ak` | beacon `remaining_oildrop` mỗi kênh (Decrement khi Claim) |
| `budget_nft.ak` | mint NFT chính danh mỗi kênh (name = channel_id) |
| `claim_account.ak` | tài khoản Capped Drop mỗi người nhận (Claim/Redeem) |
| `treasury.ak` | sub-pool LAMP per-channel (ReleaseForRedeem) |

Công thức vested: `vested(t) = min(entitlement, drop_value · drops_per_epoch · max(0, t − start_epoch))`
(drop_value = D, param validator claim_account); `redeemable = vested − redeemed`. Cliff = đặt lùi
`start_epoch` (không cần field riêng).

> ⚠️ **Engine vested là FORK từ Distribution** (math.ak đồng nhất, claim_account ~85% chung;
> KHÔNG `use magiclamp/lampdist`). Đồng bộ **THỦ CÔNG** cho tới khi hợp nhất `magiclamp/common` (sau 18/6).

## Các kênh (allocation v3) — khởi tạo per-channel

> ⚠️ **Bảng dưới là số liệu LỊCH SỬ của tokenomics v3, ĐÃ BỊ THAY.** Tên kênh và con số hiệu lực
> lấy theo [`Papers/pot-catalog.md`](../Papers/pot-catalog.md) (bảng 18 pot) và
> [`Papers/distribution.md`](../Papers/distribution.md). Bảng này giữ lại để hiểu
> cấu trúc per-channel mà code đang hiện thực, **không phải để lấy số**.
| Kênh (channel_id) | LAMP | Cơ chế |
|---|---:|---|
| TEAM | 12 tỷ | Capped Drop, D nhỏ + start_epoch lùi |
| DEVELOPMENT | 2 tỷ | Capped Drop (2 cty vận hành) |
| TREASURY (seed) | 1 tỷ | Capped Drop (vốn mồi điều tiết) |
| AFFILIATE / SCAVENGER | 1 + 1 tỷ | Capped Drop, committee/DID (→ 27/9) |
| PLATFORM | 5 tỷ | Capped Drop theo MAGIC tiêu thụ (→ 27/9) |
| Wakeme | 1,001 tỷ | Vault-vesting mỗi PersonDID ≤1001 LAMP + anti-idle (xem POT-CATALOG #6) |

> **Đổi tên 2026-08-12:** kênh `NEWUSER` của v3 (4,001 tỷ = 1,001 tỷ đèn-mượn + 3 tỷ "user-sau
> √×MAGIC") **không còn**. v17 chỉ giữ pot **Wakeme = 1,001 tỷ**; **không có pot "user-sau 3 tỷ"**
> nào trong bảng 18 pot. Đừng lấy lại con số 4,001 tỷ từ bất kỳ bản v3 nào.

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
onchain `aiken check` **75 pass** · offchain vitest **68 pass** (đo 2026-07-29). Xem `tests/` + `offchain/src/`.
