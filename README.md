# LAMP — Token core của MagicLamp Network

Repo này chứa **logic lõi của token LAMP**: phát hành, phân bổ, kho bạc, quản trị.
Tách biệt với repo [`MAGIC`](https://github.com/MagicLampNetwork/MAGIC) (generators +
app SDK sinh/tiêu MAGIC từ LAMP).

## LAMP vs MAGIC (ranh giới)

```
   LAMP (repo này)                         MAGIC (repo kia)
   ─────────────────                       ─────────────────
   • Fixed supply 36×10^15 oil             • 4 generators (Snapshot/Instant/Vacuum/Schedule)
   • Phân bổ (Distribution)                • Vault sinh MAGIC từ LAMP
   • Kho bạc (Treasury)                    • AppEconomics / ConsumeMAGIC
   • Quản trị (Governance)                 • Integrator SDK (DID-agnostic)
                                  ▲
              MAGIC phụ thuộc LAMP (cần LAMP mới sinh MAGIC) — 1 chiều
```

LAMP = giá trị nền + quản trị. MAGIC = tiêu dùng tầng app. Phụ thuộc 1 chiều: MAGIC → LAMP.

## Cấu trúc

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `Utils/` | Primitive chung (Q-format, epoch math, clamp, Merkle helper) | ✅ |
| `Distribution/` | Cơ chế phân bổ LAMP (claim → vesting → redeem) + treasury pool | ✅ live Preview |
| `Treasury/` | 3 kho bạc Foundation (Community / Operational / Emergency), giải ngân theo governance | 🔜 spec |
| `Governance/` | iVoteSpace, bầu cử 3 hội đồng, Voting Power, Recall | 🔜 spec |

## Distribution — đã chạy thật trên Preview

Cơ chế phân bổ fixed-supply theo thời gian (5-10 năm), chống coordinated dump, công bằng
theo đóng góp, tự điều tiết theo cầu (P parameter). Đã deploy + chạy e2e thật trên Cardano
Preview (claim → phân bổ → redeem). Xem `Distribution/SPEC.md` + `Distribution/README.md`.

> **Đang tái thiết kế cơ chế phân bổ**: từ Drop Lottery (random) → **deterministic
> proportional vesting** (trả thẳng giá trị kỳ vọng) — minh bạch hơn, công bằng hơn, rẻ hơn,
> bỏ được toàn bộ máy random + Merkle. Xem `Distribution/SPEC.md` §thiết kế.

## Triết lý

LAMP **kiếm qua đóng góp, không mua** (không ICO/IDO). Người nhận LAMP là co-owner của
protocol. Tổng cung cố định tuyệt đối 36×10^15 oil = 36 tỷ LAMP.
