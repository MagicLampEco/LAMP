# DEV NOTE — Kho A-DEST canonical (quyết định + trạng thái)

> Chốt 2026-07-13. Nguồn bất biến gốc: `CONTRACT.md §11`. Note này ghi QUYẾT ĐỊNH
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
- **Phân kỳ mainnet↔preprod:** hash script (Plutus lẫn native) **độc lập mạng** — phân kỳ chỉ đến từ *apply-param*, không từ network. `lamp_mint` bản HEAD đọc hash kho **động** qua kho-NFT (`lib/.../util.ak:147-153`), nên với bản đó đổi kho không buộc mint lại policy. ⇒ Chọn `treasury.ak` (apply-param per token/mạng) là tái dùng được + trung thực mainnet.

  > 🔴 **ĐÍNH CHÍNH 2026-08-12 — câu trên KHÔNG áp cho policy đang chạy.** Mainnet chạy bản **MỒI 8
  > tham số** (`55d3e01b…180f0`, tái lập từ commit `457f312`, CBOR trùng byte): nó **nướng cứng
  > `dist_dest`** vào tham số, không có kho-NFT động. Tham số đi vào hash ⇒ **đổi kho = đổi script
  > hash = policy-id KHÁC**. Với policy đang chạy, "đổi kho" là **mint lại policy**, không phải trỏ
  > lại con trỏ. Kho-NFT động chỉ tồn tại ở bản **12 tham số CHƯA phát hành**.

## Cơ chế nhả của kho (vì sao an toàn) — QUAN TRỌNG cho người tích hợp
`treasury.ak` nhả LAMP **chỉ qua `claim_account` redeem** (`treasury.ak:53-61`): `released = ca_out.redeemed − ca_in.redeemed`, đúng 1 claim_account input+output/tx, bảo toàn mọi asset khác. **KHÔNG có đường "authority gửi tuỳ ý"** — đó chính là điều khiến nó không thể bị rút sạch. Hệ quả: đưa LAMP tới 1 địa chỉ = phải qua pipeline phân phối (entitlement → SetRoot/Merkle → claim → redeem), KHÔNG phải 1 lệnh transfer. Param kho: `treasury(claim_account_hash, lamp_policy, lamp_name)`.

## Cảnh báo no-burn (đọc kỹ trước khi mint)
Vì LAMP **no-burn**, mint LAMP vào kho SAI (1-pkh/placeholder/claim_account) = **kẹt vĩnh viễn**, phải mint BÙ lượng mới vào kho đúng (lượng cũ mất trắng). **Đổi kho KHÔNG rẻ với policy đang chạy** — xem đính chính 2026-08-12 ở trên: bản 8 tham số nướng cứng `dist_dest`, đổi kho ⇒ policy-id mới ⇒ token cũ và token mới là **hai tài sản khác nhau**. Và **giá trị đã rót nhầm thì không cứu được**. → Phải chốt kho đúng **NGAY từ lần mint đầu**.

## token_tag canonical — CHỐT
`token_tag = #"4c414d50"` ("LAMP") — là **param bake vào policy-id** của `lamp_mint` (`lamp_mint.ak:67`), phải khớp entry mà Core ghi (Core/HANDOFF dùng `4c414d50`). Hằng `#"4c414d50746167"` ("LAMPtag") ở `lamp_mint.ak:244` **chỉ là fixture test**, KHÔNG phải giá trị sản xuất. Deploy preprod + mainnet PHẢI dùng cùng `4c414d50`.

## Trạng thái hiện tại (2026-07-13)
- 🔴 **Mainnet ĐANG VI PHẠM:** kho A-DEST mainnet = `dist_treasury` 1-pkh (hash `d5e80c9a…`), đang giữ LAMP. ~~Phải thay bằng `treasury.ak` TRƯỚC khi rót thêm giá trị.~~
  > ⚠️ **ĐÍNH CHÍNH 2026-08-12 — câu gạch trên KHÔNG thực hiện được, và cũng không cần thiết.**
  > **Không thực hiện được:** `dist_dest` nướng vào tham số ⇒ đổi kho = đổi script hash = policy-id
  > khác = token khác. Thêm nữa `treasury.ak` nhận `lamp_policy` làm tham số
  > (`Distribution/onchain/validators/treasury.ak:16-19`) mà `lamp_policy` lại cần `dist_dest` =
  > hash treasury ⇒ **vòng apply-param không giải được**.
  > **Không cần thiết:** A-DEST chỉ ràng buộc TRONG tx đúc. Kho chi ra tự do bằng một chữ ký
  > (`dist_treasury.ak:21`) nên nó làm **TRẠM TRUNG CHUYỂN** được — chính repo đã viết đường đó ở
  > `Genesis/scripts/mint_release_plan.ts:160`.
  > **Và đây mới là vấn đề thật, nặng hơn:** `dist_authority[0]` và `authority` của kho là **CÙNG
  > MỘT pkh** `180a5c17…ee0441` (đo bằng cách đọc ngược bytecode cả hai script, 2026-08-12) ⇒
  > A-DEST **không chia quyền cho ai**, nó là khúc vòng hai giao dịch. Đổi kho sang `treasury.ak`
  > cũng không sửa được điều đó, chỉ đổi "một khoá rút ngay" thành "M-of-N rút dần".
  > **Chi tiết + hai lựa chọn cần chủ dự án chốt: `Genesis/duong-toi-duc-lamp.md` §4.**
- 🔴 **Preprod rehearsal:** phải dùng CÙNG `treasury.ak` (không native-sig) mới trung thực; hiện chưa dựng.
- ⬜ Thiếu: bước genesis đặt kho-NFT tại `treasury.ak` thật (thay placeholder `"ce"*28` ở `preview_registry_e2e.ts:32`); script deploy 12-param production (bản hiện là v1 8-param hoặc demo Preview khoá cứng).

— LampNet agent
