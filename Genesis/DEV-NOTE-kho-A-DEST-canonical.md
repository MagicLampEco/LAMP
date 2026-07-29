# DEV NOTE — Kho A-DEST canonical (quyết định + trạng thái)

> Chốt 2026-07-13. Nguồn bất biến gốc: `ALLOCATION-SPEC.md §11`. Note này ghi QUYẾT ĐỊNH
> cụ thể (kho nào) + TRẠNG THÁI (mainnet đang vi phạm) để mọi dev tái dùng, không mint lại.

## Quyết định
Kho A-DEST (nơi `DistributionVest` bắt buộc rót toàn bộ LAMP) = **`Distribution/onchain/validators/treasury.ak`** — pool-treasury giữ+nhả có kiểm soát.

**KHÔNG dùng làm kho A-DEST:**
| Ứng viên | Vì sao loại |
|---|---|
| `Genesis/onchain/validators/dist_treasury.ak` (1-pkh) | 1 chữ ký rút sạch, không trần; mất khoá = kẹt vĩnh viễn (LAMP no-burn). Tự khai "BOOTSTRAP" (`dist_treasury.ak:6-7`). |
| native-sig script (keyHash = ví deploy) | Cùng nhược điểm single-key drain; hash phụ thuộc pkh người deploy → không tái dùng chung. |
| `Distribution/onchain/validators/claim_account.ak` | Ép `value == value` (`claim_account.ak:53`) — không giữ/nhả pool → dùng làm kho sẽ **strand** LAMP. Đây là slot-claim per-owner, KHÔNG phải kho. |

## Lý do (2 trục)
- **An toàn:** `treasury.ak:61` giữ pool thật với luật release, không single-key drain. 1-pkh = 1 điểm hỏng chí mạng cho kho giá-trị-lớn.
- **Phân kỳ mainnet↔preprod:** hash script (Plutus lẫn native) **độc lập mạng** — phân kỳ chỉ đến từ *apply-param*, không từ network. `lamp_mint` đọc hash kho **động** qua kho-NFT (`lib/.../util.ak:147-153`), nên **đổi kho KHÔNG buộc mint lại policy LAMP**. ⇒ Chọn `treasury.ak` (apply-param per token/mạng) là tái dùng được + trung thực mainnet.

## Cơ chế nhả của kho (vì sao an toàn) — QUAN TRỌNG cho người tích hợp
`treasury.ak` nhả LAMP **chỉ qua `claim_account` redeem** (`treasury.ak:53-61`): `released = ca_out.redeemed − ca_in.redeemed`, đúng 1 claim_account input+output/tx, bảo toàn mọi asset khác. **KHÔNG có đường "authority gửi tuỳ ý"** — đó chính là điều khiến nó không thể bị rút sạch. Hệ quả: đưa LAMP tới 1 địa chỉ = phải qua pipeline phân phối (entitlement → SetRoot/Merkle → claim → redeem), KHÔNG phải 1 lệnh transfer. Param kho: `treasury(claim_account_hash, lamp_policy, lamp_name)`.

## Cảnh báo no-burn (đọc kỹ trước khi mint)
Vì LAMP **no-burn**, mint LAMP vào kho SAI (1-pkh/placeholder/claim_account) = **kẹt vĩnh viễn**, phải mint BÙ lượng mới vào kho đúng (lượng cũ mất trắng). Đổi kho về sau rẻ (kho-NFT động) nhưng **giá trị đã rót nhầm thì không cứu được**. → Phải chốt kho đúng **NGAY từ lần mint đầu**.

## token_tag canonical — CHỐT
`token_tag = #"4c414d50"` ("LAMP") — là **param bake vào policy-id** của `lamp_mint` (`lamp_mint.ak:67`), phải khớp entry mà Core ghi (Core/HANDOFF dùng `4c414d50`). Hằng `#"4c414d50746167"` ("LAMPtag") ở `lamp_mint.ak:244` **chỉ là fixture test**, KHÔNG phải giá trị sản xuất. Deploy preprod + mainnet PHẢI dùng cùng `4c414d50`.

## Trạng thái hiện tại (2026-07-13)
- 🔴 **Mainnet ĐANG VI PHẠM:** kho A-DEST mainnet = `dist_treasury` 1-pkh (hash `d5e80c9a…`), đang giữ LAMP. Phải thay bằng `treasury.ak` TRƯỚC khi rót thêm giá trị.
- 🔴 **Preprod rehearsal:** phải dùng CÙNG `treasury.ak` (không native-sig) mới trung thực; hiện chưa dựng.
- ⬜ Thiếu: bước genesis đặt kho-NFT tại `treasury.ak` thật (thay placeholder `"ce"*28` ở `preview_registry_e2e.ts:32`); script deploy 12-param production (bản hiện là v1 8-param hoặc demo Preview khoá cứng).

— LampNet agent
