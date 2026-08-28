# `excluded` — LUẬT loại trừ khỏi Airdrop

**Quyết định (LAMP agent, 2026-08-18):** danh sách `excluded` chứa **đúng những địa chỉ mà
chính dự án kiểm soát** — ví dự án và pool do dự án vận hành. **Không có ai khác trong danh
sách này.**

## Vì sao luật này, chứ không phải một danh sách do người chọn tay

Câu này trước đây bị treo với lý do *"danh sách loại trừ là quyết định chính trị"*. Đúng —
nhưng chỉ đúng với một loại danh sách. Tách ra thì hết treo:

- **Loại người thứ ba theo phán đoán** ("ví này có vẻ là cá voi", "nhóm này đã nhận đợt
  trước") — đây mới là quyết định chính trị: không có tiêu chí kiểm chứng được, người bị
  loại không có cách nào đối chiếu, và mỗi lần thêm một cái tên là một lần phải bảo vệ.
- **Loại chính mình** — mechanical. Tiêu chí là *"khoá này có nằm trong bộ khoá dự án
  không"*, một câu hỏi có đúng một câu trả lời và ai cũng đối chiếu được với bảng khoá đã
  công bố.

Mục đích của đợt phát là **chia ra ngoài**. Ví dự án nhận phần từ pot của chính dự án không
phải là phân phối, nó là chuyển sổ — và nó là điểm dễ công kích nhất trong toàn bộ đợt, vì
người ngoài chỉ cần một truy vấn explorer là dựng được câu chuyện.

⇒ Luật: **loại đúng phần mình, không loại ai khác.** Câu hỏi chính trị biến mất vì không còn
phán đoán nào phải đưa ra.

## Phải điền gì vào `excluded-self.json`

Mảng JSON các chuỗi địa chỉ — **stake address hoặc payment address đều nhận**
(`build_delegator_snapshot.ts` lọc theo cả hai).

Phải có mặt:
1. Mọi ví do dự án giữ khoá (quỹ, vận hành, kho, ví thử nghiệm còn sống).
2. Mọi stake address ủy thác vào pool do dự án vận hành **mà khoá thuộc dự án**
   (ủy thác của người ngoài vào pool dự án thì **KHÔNG** loại — họ là người nhận hợp lệ).

## Vì sao tệp `.json` chưa có trong repo

Danh sách phải dựng từ **bảng khoá của dự án**, không dựng được từ mã. Bên này không đọc
khoá để suy ra địa chỉ, nên không tự sinh tệp.

Cho tới khi tệp được điền, `build_delegator_snapshot.ts` **dừng và báo lỗi** — đó là hành vi
đúng. Ba cửa, đều tường minh:

- `--excluded <file>` với tệp **có nội dung** → chạy theo danh sách đó;
- tệp **rỗng** → **từ chối chạy** (tệp rỗng là danh sách chưa điền, không phải quyết định);
- `--no-excluded` (hoặc `excluded_file: null` ở campaign record) → chạy, tường minh không
  loại ai, có người chịu trách nhiệm cho lựa chọn đó.
