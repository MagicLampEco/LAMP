# LAMP — Tài liệu thuyết minh Policy

> Nội dung CÔNG KHAI cho cộng đồng. Viết tuân thủ: token tiện ích, không hứa giá, không "đầu tư/lợi nhuận".
>
> **Trạng thái hiện tại (2026-09-27).** Đây là một hành động CHỦ ĐỘNG đóng một bản triển khai thử
> nghiệm ban đầu — không phải sự cố. Số LAMP nhắc tới dưới đây **chưa từng đến tay ai**: toàn bộ số
> đúc dưới bản này nằm nguyên trong kho của giao thức từ đầu cho tới lúc đóng.
>
> Policy (mã định danh loại token) LAMP **bản khởi tạo** `55d3e01b…180f0` — bản duy nhất từng chạy
> trên mainnet (mạng chính thức của Cardano) — **đã đóng vĩnh viễn trên chuỗi ngày 2026-09-27**: hai
> giao dịch (`9d0724bd…`, `8cb8e9ab…`) đúc nốt phần quota còn lại rồi chuyển toàn bộ 26.370.000.000
> LAMP sang địa chỉ script `lock_vault` — script chỉ trả `False` khi bị tiêu, nên số đó nằm lại
> vĩnh viễn, không ai (kể cả người từng giữ khoá) rút ra được. Policy này không đúc thêm được nữa và
> **hiện không ai nắm giữ LAMP của nó**.
>
> **Policy LAMP chính thức — token sẽ lưu hành — chưa phát hành trên mainnet, và chưa có ngày.**
> Bản khởi tạo ở trên chỉ là giai đoạn kỹ thuật ban đầu; lý do nó bị đóng thay vì dùng tiếp (không
> rút được 9,63 tỷ LAMP phần Reserve) nằm ở §8. Đối chiếu policy ID mới nhất luôn bằng bảng §0 ngay
> dưới đây; kiểm chứng độc lập trên chuỗi: `Genesis/scripts/verify_mainnet_supply.ts` (read-only,
> không cần khoá).

## 0. Tra cứu nhanh (on-chain, mainnet Cardano)

| Mục | Giá trị |
|---|---|
| **Policy LAMP bản khởi tạo** (**ĐÃ ĐÓNG 2026-09-27** — không đúc thêm được, không ai nắm giữ; xem ghi chú đầu tài liệu) | `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` |
| Link policy (bản khởi tạo, đã đóng) | https://cexplorer.io/policy/55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0 |
| Asset (LAMP, bản khởi tạo, đã đóng) | `55d3e01b….4c414d50` |
| **Policy LAMP chính thức** (token sẽ lưu hành) | **Chưa phát hành, chưa có ngày** |
| Tên hiển thị / mã | **MagicLamp** / **LAMP** |
| Tổng cung tối đa | **36.000.000.000 LAMP** — trần tối đa, cố định, không đổi, không burn; đúc dần theo lịch phân phối, không nằm sẵn on-chain (chi tiết ở §3) |
| Trần ghi trong chuỗi | `dist_cap` **26.370.000.000.000.000 oildrop** (= 26,37 tỷ LAMP) + `reserve_cap` **9.630.000.000.000.000 oildrop** (= 9,63 tỷ LAMP) = **36 tỷ LAMP**. Bản khởi tạo (đã đóng): trần này là một **hằng trong mã nguồn** của đúng phiên bản validator đã đóng đó. Policy chính thức (chưa phát hành): trần sẽ là **tham số khắc cố định vào chính policy ID lúc tạo** (giá trị lấy từ `dist_cap_oildrop`/`reserve_cap_oildrop` trong `Genesis/onchain/lib/magiclamp/genesis/constants.ak`) — đổi trần = đổi policy ID = token khác; `lamp_mint.ak` từ chối mọi datum khai trần khác tham số đã khắc |
| Trần đúc được THẬT trên policy khởi tạo | **26.370.000.000 LAMP** — phần `reserve_cap` không rút được qua policy này (§8) |
| Đã đúc dưới policy khởi tạo (đã đóng) | **26.370.000.000 LAMP** — toàn bộ đã chuyển vĩnh viễn vào `lock_vault`, không tính vào lưu hành, không ai nắm giữ |
| Đơn vị con | **oildrop** — 1 LAMP = 1.000.000 oildrop (decimals = 6) |
| Website | https://magiclamp.network/ |

**Cách đối chiếu policy ID (3 bước):**
1. Mở một trang tra cứu Cardano độc lập, ví dụ cexplorer.io — chỉ dùng link lấy từ chính tài liệu
   này, không bấm link nhận qua tin nhắn hay quảng cáo.
2. Dán policy ID lấy từ bảng trên vào ô tìm kiếm của trang đó.
3. So khớp đủ **56 ký tự hex**, không dừng ở vài ký tự đầu — token giả có thể trùng vài ký tự đầu
   nhưng khác policy ID thật.

**Một vài thuật ngữ dùng trong tài liệu này:** *mainnet* — mạng chính thức của Cardano (khác mạng
thử nghiệm); *policy* — mã định danh loại token, gắn cố định với cách token đó được tạo ra;
*on-chain* — ghi trực tiếp trên sổ cái của chuỗi khối, ai cũng đọc lại được; *tích* (trong công
thức) — phép nhân.

Trần 36 tỷ **không nằm trong tài liệu này** — nó là tham số khắc cố định vào chính policy ID lúc tạo
(đổi trần = đổi policy ID = token khác), và giá trị đó cũng được ghi vào dữ liệu (datum) của một UTxO
trên chuỗi mang thread NFT `SUPPLY` để ai cũng đọc lại được, không cần tin lời chúng tôi.

Policy ID và trạng thái đọc bằng hàm, không chép tay: sổ policy ở `Genesis/offchain/src/lampPolicies.ts`
(hàm `activeLampPolicyId(network)`). Sổ đó phân biệt BA trạng thái cho mỗi bản ghi: `ACTIVE` (bản
canonical hiện tại của một mạng — mỗi mạng nhiều nhất một bản), `SUPERSEDED` (đã bị một bản khác thay;
token vẫn còn trên chuỗi nhưng không dùng cho tích hợp mới), và `PENDING-MINT` (đã chốt sẽ đúc, chưa có
policy id). **Lưu ý đọc nhãn `ACTIVE` cho đúng:** bản ghi mainnet hiện mang trạng thái `ACTIVE` chỉ vì
mainnet CHƯA có bản thay thế — bản ghi đó tự khai trong trường `caveats` là đã **đóng vĩnh viễn ngày
2026-09-27** (xem đầu tài liệu này). `ACTIVE` ở đây nghĩa là "chưa có bản canonical khác", không phải
"đang đúc được". Tham số + bằng chứng đối chiếu byte đầy đủ của bản ghi mainnet nằm ở
`Genesis/offchain/src/deployed.ts` khối `LAMP_MAINNET`. Bảng ở §0 là bản chép có nhãn của giá trị đó tại
thời điểm cập nhật ghi ở đầu tài liệu; lệch thì hai tệp mã đó thắng, không phải nhãn `ACTIVE` một mình.

---

## 1. LAMP là gì

LAMP là token chính thức của hệ sinh thái **MagicLamp** trên Cardano. Vai trò: hạ tầng tiện ích và quản trị. Khi nằm trong một **vault gắn DID** (cá nhân, tổ chức, hoặc dịch vụ), LAMP **sinh ra MAGIC** mỗi epoch — một *tín chỉ tiện ích không chuyển nhượng*, được **tiêu thụ** trong các ứng dụng của hệ sinh thái. LAMP nằm trong một ví thường, chưa gắn vault-DID, **không** sinh MAGIC. LAMP **không** được mô tả như công cụ đầu tư; giá trị của nó là tiện ích trong hệ.

## 2. Tổng cung cố định & no-burn

- Tổng tối đa **36 tỷ LAMP — bất biến, khắc on-chain**: validator mint của policy chính thức sẽ chặn
  mọi mint vượt 36 tỷ (ràng buộc đã ép sẵn trong mã; policy đó chưa phát hành nên chưa có dữ liệu thật
  để đối chiếu).
- **Không burn:** LAMP không bao giờ bị đốt. Giảm lưu hành = chuyển vào Treasury (kế toán), không tiêu hủy.
- `SupplyState` là bộ đếm tổng phát hành: mỗi policy có một bộ đếm `SupplyState` riêng, đảm bảo tổng
  lịch sử của CHÍNH policy đó ≤ trần đã khắc, **đơn điệu tăng** (không rollback).
- Trần 36 tỷ áp cho **mỗi policy** qua bộ đếm `SupplyState` của chính policy đó. Bản khởi tạo đã đóng có
  bộ đếm riêng; 26,37 tỷ của nó nằm vĩnh viễn ở `lock_vault` — không lưu hành, không ai nắm giữ, và không
  trừ vào 36 tỷ của policy chính thức. LAMP lưu hành chỉ đếm dưới policy chính thức.

## 3. Lazy-mint — vì sao cung hiện thấp

"Cố định 36 tỷ" **không** nghĩa là 36 tỷ nằm sẵn on-chain. LAMP dùng **lazy-mint**: token chỉ được tạo (mint) khi cần, tổng lịch sử luôn ≤ cap. Token chưa mint = chưa tồn tại = không khóa min-ADA, không bị tấn công. Vì vậy lúc mới ra mắt, cung lưu hành rất nhỏ và tăng dần theo cơ chế phân phối.

## 4. Đơn vị "oildrop"

- 1 LAMP = 1.000.000 oildrop (10⁶). decimals = 6.
- "oildrop" tương tự lovelace của ADA, wei của ETH — đơn vị nhỏ nhất để tính toán chính xác (số nguyên, không sai số thập phân).

## 5. MAGIC — sinh & tiêu

- Mỗi epoch, LAMP **sinh MAGIC** (cơ chế per-epoch). MAGIC **không phải token/coin**, không chuyển nhượng tự do — nó là **tín chỉ tiện ích kế toán**, **tiêu hết** khi dùng trong ứng dụng.
- MAGIC dùng để: truy cập/sử dụng dịch vụ trong hệ, và là một tham số của quyền quản trị.
- MAGIC không chuyển nhượng tự do và **tiêu hết** khi dùng trong ứng dụng. Nó không được thiết kế để mua bán hay nắm giữ chờ tăng giá; dự án không vận hành và không hỗ trợ thị trường thứ cấp cho MAGIC.

## 6. Quản trị — KHÔNG theo trọng số token

Quản trị MagicLamp dựa trên **cá nhân**, không phải số LAMP nắm giữ. Cử tri = cá nhân được xác thực qua **PhoenixKey DID** (định danh sinh trắc). Sức bỏ phiếu = tích có trọng số (phép nhân) của ≥4 tham số (MAGIC đã tiêu, LAMP cam kết, uy tín, LAMP nắm giữ), **mỗi tham số đều có trần riêng**. Cách đo uy tín (C3) chưa công bố. Công thức là phép nhân và mọi tham số phải mang trọng số dương — ràng buộc này được ép trên chuỗi — nên không cấu hình nào bỏ được uy tín ra khỏi công thức. Vì vậy công thức sức bỏ phiếu chỉ được áp dụng sau khi cách đo uy tín được công bố. Trần và trọng số từng tham số do DAO điều chỉnh. Nguồn: `Governance/VotingPower/CONTRACT.md`. Nắm nhiều LAMP **không** cho nhiều quyền tỉ lệ → chống tập trung quyền lực, và giảm rủi ro bị xếp là chứng khoán.

## 7. Phân bổ — 18 pot (tổng 36 tỷ)

Phân bổ chia 18 "pot" (mục đích). Đặc điểm: pot đội ngũ (Aladin, GreenSun) đi **đúng engine CappedDrop như pot cộng đồng** — cùng công thức trần tích luỹ, cùng phép cắt ngọn, không có nhánh tắt riêng; tham số nhịp của từng pot nằm trên chuỗi, đọc lại được, công bố khi phát hành — không ai xả sạch ngày đầu. Pot Foundation khoá gốc vĩnh viễn sau khi lập pháp nhân: LAMP nằm trong két của DID Foundation và bị khoá số dư (không rút gốc), nên vẫn sinh MAGIC như LAMP của các tổ chức khác; cơ chế khoá được hiện thực cùng lúc lập pháp nhân. Chi tiết con số: xem `Papers/pot-catalog.md` §1.

## 8. Kho & cơ chế chống lạm quyền (A-DEST)

**Thiết kế:** LAMP mint ra bị ép chảy vào một **kho** (cơ chế **A-DEST**), không vào ví cá nhân.
Kho đích theo thiết kế là `Distribution/onchain/validators/treasury.ak` — kho này **không có đường
"người có khoá gửi đi đâu tuỳ ý"**: LAMP chỉ rời kho qua một trong hai đường phân phối — CappedDrop
(entitlement → `claim_account` → redeem) hoặc Snapshot (Merkle → claim). Đó mới là thứ khiến nó không
thể bị rút sạch.

> ### Vì sao bản khởi tạo bị đóng thay vì dùng tiếp
>
> **Kết luận trước.** Bản khởi tạo `55d3e01b…180f0` (chạy mainnet từ 2026-06-18) dùng một kho
> KHÔNG đạt thiết kế A-DEST ở trên, và không thể rút được 9,63 tỷ LAMP phần Reserve. Hai lỗ này
> không vá được trên một policy đã phát hành — đổi tham số là đổi luôn policy ID, tức thành một
> token khác — nên bản khởi tạo được đóng vĩnh viễn ngày 2026-09-27 thay vì sửa: hai giao dịch đúc
> nốt phần quota còn lại rồi chuyển toàn bộ 26,37 tỷ LAMP sang `lock_vault`, script chỉ trả `False`
> khi bị tiêu nên số đó nằm lại vĩnh viễn, không tính vào lưu hành.
>
> Policy chính thức sẽ dùng `Distribution/onchain/validators/treasury.ak` làm kho — không có lối "người giữ khoá gửi đi đâu tuỳ ý"
> — và quyền đúc đọc từ một bảng uỷ quyền do OrgDID quản, thay vì khắc cố định một khoá.
>
> **Chi tiết kỹ thuật.** Kho của bản khởi tạo, `dist_treasury`, là một script khởi tạo (bootstrap):
> mã nguồn tự khai ngay đầu tệp quyền chi chỉ cần một chữ ký — kỹ thuật gọi là `pkh` (public key
> hash, mã định danh của một khoá) — không trần, không lịch, không quy trình; khoá đó cũng trùng
> khoá được quyền mint, nên lớp bảo vệ A-DEST ở bản này chỉ là một khúc vòng hai giao dịch, không
> phải một lớp bảo vệ thứ hai. Lỗ thứ hai: tham số `meter_nft_policy` (dùng để policy nhận diện
> đúng kho khi đúc phần Reserve) của policy này là 28 byte 0 — không phải kết quả băm của script
> nào — nên nhánh mint `ReserveDraw` không bao giờ thoả được; trần đúc thật của policy này chỉ
> 26,37 tỷ, không phải 36 tỷ toàn hệ. Đối chiếu mã nguồn: `lamp_mint` và `supply_state` của bản
> khởi tạo đã đối chiếu trùng byte với commit `457f312` (băm định danh phiên bản mã nguồn,
> 2026-08-09 và 2026-08-12); kho `dist_treasury` đối chiếu bằng hash dựng lại (từ `60f7e3a` ⇒ ra
> đúng `d5e80c9a…`) — không so được byte vì kho đó chưa từng bị tiêu trước lượt đóng, và trên
> Cardano byte của một script chỉ lên chuỗi khi được tiêu. Nguồn số: `Genesis/offchain/src/deployed.ts`
> khối `provenance` và `closure`.

## 9. Khóa vận hành

- Khoá được quyền mint đã **khắc cố định vào chính policy** ngay khi tạo. Đây là đặc tính của Cardano:
  đổi tham số ⇒ đổi luôn policy ID ⇒ **thành một token khác**. Vì vậy không xoay được khoá của
  một policy đã phát hành mà vẫn giữ nguyên token đó.
- Bản khởi tạo `55d3e01b…180f0` khoá quyền mint vào đúng **một chữ ký (1-of-1)**, và chữ ký đó
  trùng với chữ ký rút kho (§8) — đây là một trong hai lý do bản đó bị đóng thay vì giữ dùng lâu
  dài (lý do kia: không rút được 9,63 tỷ LAMP phần Reserve).
- Policy chính thức sẽ đọc quyền đúc từ một bảng uỷ quyền do OrgDID quản (registry), theo mô hình
  dự kiến **M-of-N** — cấu hình cụ thể (số lượng và danh sách người giữ khoá vận hành) công bố khi
  policy phát hành.
- Trong phạm vi MỘT policy, trần 36 tỷ · no-burn · đơn vị oildrop không sửa được sau khi phát hành:
  trần nằm trong tham số tạo policy nên đổi nó là đổi policy ID, tức thành một token khác. Mã không
  buộc một policy thay thế trong tương lai phải mang cùng trần; dự án cam kết mọi lần thay policy đều
  công bố ở bảng §0 kèm policy ID đủ 56 ký tự để người đọc tự đối chiếu. Tầng phân phối phía trên kho
  nâng cấp được mà không đụng policy.

## 10. Pháp lý & tuân thủ

- LAMP được thiết kế làm **token tiện ích** trong hệ sinh thái MagicLamp. Dự án **không** định vị
  LAMP là sản phẩm đầu tư, **không** hứa hẹn giá, **không** hứa lợi nhuận, **không** cam kết niêm yết.
- **Không bán token đổi lấy tiền.** LAMP không được chào bán đổi lấy tiền pháp định hay tiền mã hoá
  của người dùng. Token được phân bổ theo công thức **ghi nhận đóng góp đã xảy ra**, công khai và
  ai cũng tính lại được.
- **Nói rõ một chỗ dễ bị đọc nhầm:** trong chương trình SRCL, người tham gia định tuyến **phần
  thưởng staking của chính mình** — đó là **tài sản của họ**, và việc định tuyến nó là một hành vi
  định đoạt tài sản có giá trị kinh tế. Tài liệu này **không** mô tả SRCL như "không nhận gì của
  người dùng". Vốn gốc thì không rời ví; phần thưởng thì có. Hai việc khác nhau, và tài liệu nêu
  cả hai.
- Quyền biểu quyết **không theo số token nắm giữ** (xem §6) — nắm nhiều token không mua được quyền lực.
- MAGIC tiêu-thụ (không chuyển nhượng) củng cố định vị tiện ích.
- Pháp nhân phát hành: **GreenSun Tech** (Việt Nam).

## 11. Vì sao bản khởi tạo đúc đủ quota rồi khoá lại, thay vì để lửng

Lượng khởi tạo kỹ thuật ban đầu (1.000.000 LAMP, 0,0028% tổng cung) chỉ có một mục đích: đưa
policy hiện diện trên explorer — lazy-mint cần ít nhất một lần mint. Khi đóng bản khởi tạo ngày
2026-09-27, quy trình đóng đúc nốt phần quota còn lại (`dist_cap − dist_minted`) rồi gom toàn bộ
**26.370.000.000 LAMP** — kể cả 1 triệu ban đầu — vào `lock_vault`. Lý do phải đúc hết rồi khoá,
thay vì để nguyên: LAMP **không đốt được** (validator chặn mọi lượt đúc âm), nên không có cách
"trả lại" phần quota chưa đúc; đúc nốt rồi khoá đứng ở một script không ai tiêu được là cách duy
nhất chặn dứt điểm một policy đã lỗi thời. Số này không tính vào lưu hành và không ai nắm giữ.

Phần còn lại của 36 tỷ — 9,63 tỷ Reserve chưa từng đúc được qua bản khởi tạo — sẽ mint dần theo lịch
phân phối khi policy chính thức phát hành, cùng với toàn bộ 26,37 tỷ Distribution (bản khởi tạo đã
đúc đủ phần Distribution của chính nó rồi khoá; policy chính thức có `SupplyState` riêng, trần là
tham số khắc cố định vào chính policy ID của nó lúc tạo — giá trị lấy từ
`dist_cap_oildrop`/`reserve_cap_oildrop` trong `Genesis/onchain/lib/magiclamp/genesis/constants.ak` —
đổi trần = đổi policy ID = token khác; `lamp_mint.ak` từ chối mọi datum khai trần khác tham số đã
khắc). Mỗi lần mint đều làm tăng `dist_minted`/`reserve_minted` trong chuỗi nên ai cũng theo dõi được.

---

# CÂU HỎI THƯỜNG GẶP (FAQ)

## A. Cơ bản về LAMP (1–12)

1. **LAMP là gì?** Token chính thức của hệ sinh thái MagicLamp trên Cardano — hạ tầng tiện ích & quản trị.
2. **MagicLamp và LAMP khác nhau thế nào?** MagicLamp là tên hệ sinh thái/dự án; LAMP là mã token (giống Cardano/ADA, Ethereum/ETH).
3. **Policy ID của LAMP?** Policy chính thức chưa phát hành trên mainnet. Policy bản khởi tạo ở bảng §0 đã đóng ngày 2026-09-27 và không còn là LAMP đang lưu hành. Khi policy chính thức phát hành, giá trị đọc từ `Genesis/offchain/src/deployed.ts`.
4. **Xem LAMP ở đâu?** Dán policy ID lấy từ bảng §0 vào cexplorer.io/policy/… hoặc tra trên cardanoscan/pool.pm.
5. **LAMP chạy trên chain nào?** Cardano L1, hợp đồng PlutusV3.
6. **LAMP có phải NFT không?** Không — LAMP là token đồng nhất (fungible), có decimals.
7. **Tên hiển thị và mã?** Tên: MagicLamp. Mã: LAMP.
8. **Website chính thức?** https://magiclamp.network/.
9. **LAMP dùng để làm gì?** Tiện ích trong hệ (sinh MAGIC để tiêu trong ứng dụng) + tham gia quản trị.
10. **LAMP có phải tiền/coin thanh toán không?** Định vị là token tiện ích hệ sinh thái, không phải phương tiện thanh toán chung.
11. **Ai tạo ra LAMP?** Đội ngũ MagicLamp (các pháp nhân sáng lập: Aladin Contract, GreenSun Tech).
12. **LAMP ra mắt khi nào?** Bản khởi tạo (nay đã đóng) thiết lập trên mainnet Cardano tháng 6/2026, nhưng đó không phải LAMP đang lưu hành. Policy LAMP chính thức — token sẽ lưu hành — chưa phát hành, chưa có ngày (xem §0).

## B. Cung, đơn vị, no-burn (13–27)

13. **Tổng cung LAMP?** Tối đa 36.000.000.000 (36 tỷ) — cố định.
14. **Có thể tăng cung quá 36 tỷ không?** Không — mỗi policy có bộ đếm `SupplyState` riêng, validator chặn mọi mint vượt trần của policy đó; policy đã đóng (như bản khởi tạo) không cộng dồn vào trần của policy đang hoạt động.
15. **LAMP có bị lạm phát không?** Không có lạm phát quá cap; tổng tối đa bất biến.
16. **LAMP có burn không?** Không bao giờ burn. Giảm lưu hành = chuyển Treasury (kế toán).
17. **Vì sao cung hiện tại thấp?** Lazy-mint: token chỉ tạo khi cần; tổng lịch sử luôn ≤ 36 tỷ.
18. **Lazy-mint là gì?** Mint dần khi cần thay vì đúc sẵn 36 tỷ; token chưa mint = chưa tồn tại.
19. **Đơn vị nhỏ nhất của LAMP?** oildrop. 1 LAMP = 1.000.000 oildrop.
20. **decimals là bao nhiêu?** 6.
21. **Vì sao gọi là "oildrop"?** Đơn vị con (như lovelace/wei) để tính số nguyên chính xác.
22. **1 oildrop bằng bao nhiêu LAMP?** 0,000001 LAMP.
23. **Cung lưu hành hiện tại?** 0. Toàn bộ LAMP đã đúc dưới bản khởi tạo nằm vĩnh viễn ở `lock_vault`, không tính vào lưu hành. Policy LAMP chính thức chưa phát hành.
24. **Cung tối đa có đổi được không?** Không — khi policy chính thức phát hành, 36 tỷ sẽ được khắc cố định on-chain qua bộ đếm `SupplyState` của chính policy đó.
25. **Có cơ chế "buyback & burn" không?** Không burn. Cơ chế điều tiết là chuyển Treasury.
26. **LAMP có chia tách (split) không?** Không cần — đã có decimals 6.
27. **Số LAMP của tôi có bị pha loãng không?** Tổng cap cố định; phát hành theo lịch công khai trong cap.

## C. MAGIC (28–40, gồm 40b)

28. **MAGIC là gì?** Tín chỉ tiện ích, sinh ra từ LAMP, **tiêu thụ** trong ứng dụng hệ sinh thái.
29. **MAGIC có phải token không?** Không — MAGIC là tín chỉ kế toán, không chuyển nhượng tự do, không phải coin.
30. **MAGIC sinh ra thế nào?** Mỗi epoch, LAMP sinh MAGIC theo cơ chế của hệ.
31. **MAGIC dùng làm gì?** Truy cập/dùng dịch vụ trong ứng dụng, và là tham số quản trị.
32. **MAGIC có mua bán được không?** Không giao dịch tự do như token; nó tiêu-thụ, không phải tài sản đầu cơ.
33. **Giữ LAMP có "kiếm lời" không?** Không. LAMP sinh MAGIC để **dùng** (tiện ích), không phải để sinh lợi nhuận tài chính.
34. **MAGIC có giá không?** MAGIC là tín chỉ tiêu-thụ, không định giá như tài sản giao dịch.
35. **Tốc độ sinh MAGIC phụ thuộc gì?** Lượng LAMP và cơ chế per-epoch của hệ (xem spec MAGIC).
36. **Tiêu hết MAGIC thì sao?** MAGIC tiếp tục sinh mỗi epoch khi LAMP còn nằm trong vault gắn DID.
37. **MAGIC có hết hạn không?** Theo cơ chế kế toán của hệ; xem spec MAGIC.
38. **Hệ MAGIC đã chạy chưa?** Đang phát triển; sẽ kích hoạt theo lộ trình. Policy LAMP chính thức chưa phát hành; MAGIC triển khai sau khi có policy đó.
39. **MAGIC khác token thưởng (reward) thế nào?** Không phải reward tài chính — là tín chỉ tiện ích tiêu-thụ.
40. **LAMP bị khóa có sinh MAGIC không?** Có, nếu LAMP (kể cả phần khoá) đang nằm trong vault gắn DID — khoá không cản việc sinh MAGIC. Chi tiết theo cơ chế từng vault.
40b. **LAMP nằm trong ví thường (chưa gắn vault-DID) có sinh MAGIC không?** Không. MAGIC chỉ sinh khi LAMP nằm trong vault gắn một DID; giữ LAMP ở ví thông thường không tự động sinh MAGIC.

## D. Quản trị (41–50)

41. **Quản trị MagicLamp theo gì?** Theo cá nhân (DID), KHÔNG theo trọng số token.
42. **Giữ nhiều LAMP = nhiều quyền bỏ phiếu?** Không tỉ lệ — có trần; quyền dựa trên nhiều tham số.
43. **Sức bỏ phiếu tính thế nào?** Tích có trọng số (phép nhân) của ≥4 tham số: MAGIC đã tiêu, LAMP cam kết, uy tín, LAMP nắm giữ — mỗi tham số có trần riêng. Cách đo uy tín (C3) chưa công bố; công thức là phép nhân và mọi tham số phải mang trọng số dương (ép trên chuỗi) nên công thức sức bỏ phiếu chỉ áp dụng sau khi cách đo uy tín được công bố.
44. **Cử tri là ai?** Cá nhân xác thực qua PhoenixKey DID (sinh trắc).
45. **Vì sao không token-weighted?** Chống tập trung quyền lực vào ví lớn + giảm rủi ro pháp lý.
46. **PhoenixKey DID là gì?** Hệ định danh phi tập trung dựa sinh trắc, dùng để xác thực cá nhân.
47. **Một người tạo nhiều ví để có nhiều phiếu được không?** Không — DID sinh trắc chống sybil (1 người = 1 danh tính).
48. **Ai kiểm soát quỹ Treasury?** Theo thiết kế: DAO quản; giai đoạn đầu pháp nhân sáng lập vận hành, chuyển DAO theo lộ trình.
49. **Có DAO chưa?** Quản trị đang xây; validator quản trị triển khai theo lộ trình.
50. **Quyết định lớn được thông qua thế nào?** Qua cơ chế bỏ phiếu cá-nhân (xem spec Governance).

## E. Phân bổ & công bằng (51–63)

51. **LAMP chia thế nào?** 18 pot mục đích, tổng 36 tỷ.
52. **Đội ngũ giữ bao nhiêu?** 2 cty sáng lập mỗi bên 6 tỷ; chi tiết ở `Papers/pot-catalog.md` §1.
53. **Đội ngũ có xả token ngay được không?** Không — pot đội ngũ nhỏ giọt on-chain (CappedDrop), ràng buộc theo epoch.
54. **"Nhỏ giọt ngang cộng đồng" nghĩa là gì?** Đội ngũ đi đúng engine CappedDrop như pot cộng đồng — cùng công thức trần tích luỹ, cùng phép cắt ngọn — không có nhánh tắt hay đặc quyền xả sớm; tham số nhịp riêng của từng pot công bố khi phát hành.
55. **Pot Foundation là gì?** Quỹ vận hành dài hạn; khoá gốc vĩnh viễn sau khi lập pháp nhân (không rút gốc). Cách khoá: LAMP nằm trong két của DID Foundation và bị khoá số dư, nên vẫn sinh MAGIC; cơ chế khoá được hiện thực cùng lúc lập pháp nhân.
56. **Có vesting/cliff cho đội ngũ không?** Cơ chế nhỏ giọt theo tham số (tốc độ/cliff) công bố công khai.
57. **Cộng đồng nhận LAMP bằng cách nào?** Qua các pot cộng đồng (Airdrop, SRCL, delegator…) theo tiêu chí công khai.
58. **Airdrop cho ai?** Theo danh sách/tiêu chí công bố; nhỏ giọt theo epoch. Mục đích chính của đợt này **không phải phân phối token** mà là **tạo ra cộng đồng DAO** — tập hợp đủ người nhận việc vận hành để lập MagicLamp Foundation (câu 99). Phân phối là phương tiện, không phải đích.
59. **SRCL là gì?** Cơ chế phân phối qua reward-redirect staking (Staking Reward Contribution Launch); chi tiết theo chương trình.
60. **Phân bổ có thể đổi không?** Mỗi pot CappedDrop là một cụm triển khai riêng; ngân sách là sổ quyền nhận không vượt số LAMP thật trong kho của cụm — đổi ngân sách một pot nghĩa là triển khai lại cụm đó, không phải chỉnh một tham số ngoài chuỗi. Tổng 36 tỷ không đổi.
61. **Pot nào "khóa", pot nào "nhỏ giọt"?** Mỗi pot cấu hình riêng (tốc độ/khóa/lịch) ở tầng phân phối.
62. **Có pre-sale/ICO không?** Không. Dự án **không chào bán** LAMP đổi lấy tiền hay tài sản của người dùng, và **không có kế hoạch** chào bán. LAMP chỉ được ghi nhận cho đóng góp đã xảy ra, theo công thức công khai.
63. **Số đã mint hiện nằm đâu?** Số đúc dưới bản khởi tạo (đã đóng 2026-09-27, 26,37 tỷ LAMP) nằm
    vĩnh viễn ở `lock_vault`, không tính vào lưu hành và không đi vào phân phối. LAMP mint dưới
    policy chính thức, khi phát hành, sẽ vào kho có kiểm soát (`Distribution/onchain/validators/treasury.ak`)
    rồi ra tới cá nhân qua một trong hai đường: CappedDrop (entitlement → `claim_account` → redeem)
    hoặc Snapshot (Merkle) (§8).

## F. Kỹ thuật & an toàn (64–78, gồm 76b · 76c)

64. **LAMP dùng hợp đồng gì?** Aiken/PlutusV3 trên Cardano.
65. **Policy ID đến từ đâu?** Neo bởi một giao dịch genesis one-shot → DUY NHẤT, không trùng lặp được.
66. **Có thể giả LAMP không?** Kẻ xấu có thể đúc token TRÙNG TÊN nhưng **policy ID sẽ khác** — luôn
    đối chiếu **đủ 56 ký tự hex** của policy ID (bảng ở §0), không dừng ở vài ký tự đầu
    (`55d3e01b…` chỉ là cách viết tắt cho dễ đọc — so 8 ký tự đầu tương đương 32 bit, máy để bàn
    dựng được va chạm tiền ảnh cỡ đó trong vài phút), và không xác minh theo tên hiển thị.
67. **Cap 36 tỷ enforce ở đâu?** On-chain trong validator mint của từng policy — mỗi policy có một bộ đếm `SupplyState` riêng, chặn mint vượt trần của chính policy đó (no-burn, đơn điệu).
68. **A-DEST là gì?** Luật ép LAMP phân phối phải vào kho kiểm soát, không ra ví người vận hành.
69. **Người giữ khóa có tự mint cho mình được không?** Mint phân phối bị ép vào kho (A-DEST); không rút thẳng về ví.
70. **SupplyState là gì?** UTxO bộ đếm tổng phát hành, neo bởi NFT one-shot, chống mint lậu/đôi.
71. **Đã kiểm thử chưa?** Đã kiểm thử trên testnet Preview (mint sai → bị chặn, vượt cap → bị chặn); đã rà soát nội bộ, chưa có audit độc lập.
72. **Mã nguồn mở chưa?** Theo lộ trình công khai (mục tiêu open SDK cho mọi đội Cardano).
73. **Lỡ mint nhầm thì sao?** Validator chặn các trường hợp sai (Δ lệch, vượt cap, sai quota…).
74. **Reserve là gì?** Theo thiết kế, lớp đệm phát hành (9,63 tỷ) nhả có nhịp, có trần mỗi epoch,
    không ai rút tay bằng một chữ ký đơn — cơ chế này tên là `ReserveDraw`. Trên policy khởi tạo
    (đã đóng vĩnh viễn 2026-09-27), nhánh `ReserveDraw` **không bao giờ dùng được**: tham số
    `meter_nft_policy` bị khắc cố định bằng 28 byte 0 (không có tiền ảnh), nên điều kiện bắt buộc
    của nhánh này không bao giờ thoả. Toàn bộ 9,63 tỷ Reserve **chưa từng được đúc** qua policy đó,
    và chỉ mint được khi policy chính thức phát hành. Nguồn: `Genesis/offchain/src/deployed.ts`
    khối `mintParams` (`meter_nft_policy`) và khối `closure`.
75. **Token có thể bị đóng băng/khóa ví của tôi không?** Không — LAMP trong ví của bạn do bạn kiểm soát hoàn toàn.
76. **Hợp đồng có thể đổi sau khi deploy không?** Một policy đã phát hành thì **không sửa được** —
    trên Cardano, đổi tham số là đổi luôn policy ID, tức thành một token khác. Tầng phân phối phía
    trên thì nâng cấp được mà không đụng policy.
76b. **Vậy policy `55d3e01b…` có được giữ mãi không?** Không, và việc này đã xảy ra rồi: bản khởi
    tạo đã bị **đóng vĩnh viễn trên chuỗi ngày 2026-09-27** — đúng theo lý do đã nêu (không rút
    được 9,63 tỷ LAMP phần Reserve, §8 và câu 74). Policy đó không đúc thêm được nữa. Policy chính
    thức thay thế nó **chưa phát hành, chưa có ngày**.
76c. **Khi có policy mới thì làm sao biết cái nào là LAMP thật?** Tài liệu này sẽ ghi policy ID mới
    ở bảng §0 khi phát hành. Trong lúc chờ, **đừng tin một policy ID chỉ vì nó xuất hiện ở đâu
    đó** — đối chiếu đủ 56 ký tự hex với bảng §0 của bản tài liệu mới nhất. Toàn bộ 26.370.000.000
    LAMP đã đúc dưới bản khởi tạo (không thể đốt) hiện nằm vĩnh viễn ở `lock_vault` — script chỉ
    trả `False` khi bị tiêu, nên không ai, kể cả người giữ khoá cũ, rút ra được. Số đó không tính
    vào lưu hành và không phải LAMP đang lưu hành.
77. **Có rủi ro hợp đồng không?** Như mọi smart contract. Đã kiểm thử + rà soát nội bộ; chưa có audit độc lập. Mã công khai theo lộ trình.
78. **Ví nào giữ được LAMP?** Mọi ví Cardano chuẩn (Eternl, Lace, Vespr…).

## G. Sở hữu, chuyển, giao dịch (79–88)

79. **Tôi nhận LAMP bằng cách nào?** LAMP **không được chào bán**. Cách duy nhất để nhận là qua các cơ chế ghi nhận đóng góp công khai. Cảnh giác với mọi lời chào mua/bán LAMP — đó không phải kênh của dự án; và cảnh giác token giả mạo, hãy đối chiếu policy id.
80. **LAMP có được niêm yết ở đâu không?** Dự án **không niêm yết** LAMP và **không cam kết** gì về việc niêm yết trong tương lai. Nếu thấy LAMP xuất hiện ở đâu đó, hãy hiểu rằng dự án không đứng sau hoạt động đó.
81. **LAMP có giá bao nhiêu?** Dự án không công bố/hứa hẹn giá; LAMP định vị tiện ích.
82. **Chuyển LAMP cho người khác được không?** Được — LAMP là token chuẩn, chuyển tự do giữa ví.
83. **Phí chuyển LAMP?** Phí mạng Cardano thông thường (ADA), không phí riêng.
84. **Có token giả "LAMP/MagicLamp" không?** Có thể có — luôn đối chiếu **đủ 56 ký tự hex** của
    policy ID (bảng ở §0), không dừng ở vài ký tự đầu (`55d3e01b…` là cách viết tắt, không đủ để
    xác minh — xem câu 66).
85. **Làm sao biết LAMP thật?** Đối chiếu policy ID trên explorer chính thức, không tin theo tên hiển thị.
86. **LAMP có stake/delegate được không?** LAMP là token; staking ADA của ví vẫn bình thường. LAMP tham gia hệ qua MAGIC/quản trị.
87. **Mất ví thì mất LAMP?** Như mọi tài sản Cardano — tự quản seed/khóa cẩn thận.
88. **Có airdrop "claim" giả mạo không?** Cảnh giác; chỉ dùng kênh chính thức magiclamp.network.

## H. Pháp lý & tuân thủ (89–95)

89. **LAMP được thiết kế như thế nào?** LAMP được thiết kế làm token **tiện ích** trong hệ: dùng để sinh MAGIC và tham gia quản trị theo cơ chế không dựa trên trọng số token. Dự án không cam kết, không dự báo và không khuyến nghị về giá hoặc lợi nhuận, và không vận hành thị trường thứ cấp. Phân loại pháp lý của một tài sản mã hoá do pháp luật từng khu vực quyết định, không do tổ chức phát hành tự xác định; người tham gia ở mỗi khu vực tự kiểm tra hoặc hỏi tư vấn pháp lý của mình.
90. **LAMP có phải sản phẩm đầu tư không?** Không. Dự án không định vị, không khuyến nghị, và không mô tả LAMP như sản phẩm đầu tư.
91. **Có whitepaper pháp lý không?** Tài liệu công bố theo lộ trình; tuân thủ quy định nơi phát hành.
92. **Dự án ở đâu?** Pháp nhân sáng lập (Aladin Contract, GreenSun Tech); cấu trúc pháp lý đang hoàn thiện.
93. **KYC có cần không?** Tùy chương trình/khu vực; tham gia quản trị qua DID.
94. **LAMP hợp pháp ở nước tôi?** Tùy quy định địa phương; người dùng tự kiểm tra.
95. **Dự án có tuân thủ chống rửa tiền không?** Các pháp nhân vận hành tuân thủ pháp luật Việt Nam áp dụng cho hoạt động của mình. Ở các chương trình có tiếp nhận tài sản từ người tham gia, dự án áp dụng định danh người tham gia qua PhoenixKey DID, giới hạn theo vùng pháp lý, và lưu vết giao dịch trên chuỗi. Việc một chương trình cụ thể thuộc phạm vi điều chỉnh nào được xác định theo pháp luật của từng khu vực và theo tư vấn pháp lý tại khu vực đó; dự án không đưa ra kết luận thay cơ quan có thẩm quyền.

## I. Lộ trình & tương lai (96–100)

96. **Bước tiếp theo của LAMP?** Hoàn thiện tầng phân phối (nhỏ giọt từng pot), kích hoạt MAGIC, di trú quản trị sang PhoenixKey.
97. **"Bootstrap" nghĩa là gì?** Giai đoạn khởi tạo trên mainnet; tầng vận hành sẽ nâng cấp trước khi mở rộng người dùng.
98. **Khi nào MAGIC hoạt động?** Theo lộ trình sau khi hạ tầng MAGIC lên mainnet.
99. **Foundation khi nào lập?** Theo lộ trình; tới đó pot Foundation mới khóa + vận hành chính thức. Pháp nhân này **đặt ở nước ngoài**, do **cộng đồng DAO hình thành từ đợt Airdrop** lập ra chứ không do hai công ty sáng lập lập ra, và vai của nó là **đại diện pháp lý** cho hệ. Quốc gia, hình thức pháp nhân và quy chế chưa công bố — chừng nào chưa công bố, không tài liệu nào của dự án được mô tả Foundation như một pháp nhân đang tồn tại (`PHAP-NHAN-001`, `Papers/pot-catalog.md` mục "Cổng pháp lý theo pot").
100. **Theo dõi cập nhật ở đâu?** Kênh chính thức tại https://magiclamp.network/ và các kênh dự án công bố.

---

*Cập nhật lần cuối: 2026-09-27. Mọi con số/cơ chế có thể tinh chỉnh trước khi policy chính thức phát hành. Luôn xác minh theo policy ID on-chain.*
