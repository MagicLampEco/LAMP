# LAMP — Tài liệu thuyết minh Policy

> Nội dung CÔNG KHAI cho cộng đồng. Viết tuân thủ: token tiện ích, không hứa giá, không "đầu tư/lợi nhuận".
> Cập nhật 2026-07-29: **chốt policy `55d3e01b…180f0` là token LAMP chính thức trên mainnet** — không
> có policy nào khác thay thế. Mọi số liệu cung ở đây đọc trực tiếp từ chuỗi, kiểm chứng được
> (`Genesis/scripts/verify_mainnet_supply.ts`, read-only, không cần khoá).

## 0. Tra cứu nhanh (on-chain, mainnet Cardano)

| Mục | Giá trị |
|---|---|
| **Policy LAMP** | `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0` |
| Link policy | https://cexplorer.io/policy/55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0 |
| Asset (LAMP) | `55d3e01b….4c414d50` |
| Tên hiển thị / mã | **MagicLamp** / **LAMP** |
| Tổng cung tối đa | **36.000.000.000 LAMP** (cố định, không đổi, không burn) |
| Trần ghi trong chuỗi | `dist_cap` **26.370.000.000** + `reserve_cap` **9.630.000.000** = **36 tỷ** |
| Đã mint tới nay | **1.000.000 LAMP** (nằm trong kho, chưa phân phối) |
| Đơn vị con | **oildrop** — 1 LAMP = 1.000.000 oildrop (decimals = 6) |
| Website | https://magiclamp.network/ |

Trần 36 tỷ **không nằm trong tài liệu này** — nó nằm trong dữ liệu (datum) của một UTxO trên chuỗi
mang thread NFT `SUPPLY`. Ai cũng đọc lại được, không cần tin lời chúng tôi.

---

## 1. LAMP là gì

LAMP là token chính thức của hệ sinh thái **MagicLamp** trên Cardano. Vai trò: hạ tầng tiện ích và quản trị. Mỗi epoch, LAMP **sinh ra MAGIC** — một *tín chỉ tiện ích không chuyển nhượng*, được **tiêu thụ** trong các ứng dụng của hệ sinh thái. LAMP **không** được mô tả như công cụ đầu tư; giá trị của nó là tiện ích trong hệ.

## 2. Tổng cung cố định & no-burn

- Tổng tối đa **36 tỷ LAMP — bất biến, khắc on-chain** (validator chặn mọi mint vượt 36 tỷ).
- **Không burn:** LAMP không bao giờ bị đốt. Giảm lưu hành = chuyển vào Treasury (kế toán), không tiêu hủy.
- Bộ đếm tổng phát hành (`SupplyState`) đảm bảo tổng lịch sử ≤ 36 tỷ, **đơn điệu tăng** (không rollback).

## 3. Lazy-mint — vì sao cung hiện thấp

"Cố định 36 tỷ" **không** nghĩa là 36 tỷ nằm sẵn on-chain. LAMP dùng **lazy-mint**: token chỉ được tạo (mint) khi cần, tổng lịch sử luôn ≤ cap. Token chưa mint = chưa tồn tại = không khóa min-ADA, không bị tấn công. Vì vậy lúc mới ra mắt, cung lưu hành rất nhỏ và tăng dần theo cơ chế phân phối.

## 4. Đơn vị "oildrop"

- 1 LAMP = 1.000.000 oildrop (10⁶). decimals = 6.
- "oildrop" tương tự lovelace của ADA, wei của ETH — đơn vị nhỏ nhất để tính toán chính xác (số nguyên, không sai số thập phân).

## 5. MAGIC — sinh & tiêu

- Mỗi epoch, LAMP **sinh MAGIC** (cơ chế per-epoch). MAGIC **không phải token/coin**, không chuyển nhượng tự do — nó là **tín chỉ tiện ích kế toán**, **tiêu hết** khi dùng trong ứng dụng.
- MAGIC dùng để: truy cập/sử dụng dịch vụ trong hệ, và là một tham số của quyền quản trị.
- Vì MAGIC tiêu-thụ chứ không phải tài sản giao dịch → khung pháp lý là *tiện ích*, không phải *chứng khoán/lợi nhuận*.

## 6. Quản trị — KHÔNG theo trọng số token

Quản trị MagicLamp dựa trên **cá nhân**, không phải số LAMP nắm giữ. Cử tri = cá nhân được xác thực qua **PhoenixKey DID** (định danh sinh trắc). Sức bỏ phiếu = tích của ≥4 tham số (MAGIC đã tiêu, LAMP cam kết, uy tín, LAMP nắm giữ — có trần). Nắm nhiều LAMP **không** cho nhiều quyền tỉ lệ → chống tập trung quyền lực, và giảm rủi ro bị xếp là chứng khoán.

## 7. Phân bổ — 18 pot (tổng 36 tỷ)

Phân bổ chia 18 "pot" (mục đích). Đặc điểm: pot đội ngũ (Aladin, GreenSun) **nhỏ giọt ngang cộng đồng** qua cơ chế on-chain (CappedDrop) — không ai xả sạch ngày đầu. Pot Foundation dự kiến **khóa principal vĩnh viễn** (làm quỹ vận hành/bảo chứng) nhưng vẫn sinh & dùng MAGIC. Chi tiết con số: xem bảng phân bổ v17 (tài liệu riêng).

## 8. Kho & cơ chế chống lạm quyền (A-DEST)

**Thiết kế:** LAMP mint ra bị ép chảy vào một **kho** (cơ chế **A-DEST**), không vào ví cá nhân.
Kho đích theo thiết kế là `treasury.ak` — kho này **không có đường "người có khoá gửi đi đâu tuỳ
ý"**: LAMP chỉ rời kho qua đúng một lối là quy trình phân phối (entitlement → Merkle → claim →
redeem). Đó mới là thứ khiến nó không thể bị rút sạch.

> ### Trạng thái thật hôm nay — đọc kỹ trước khi tin mục này
>
> **Kho đang giữ LAMP trên mainnet CHƯA phải kho thiết kế ở trên.** Nó là
> `dist_treasury` — một script **khởi tạo (bootstrap)** mà mã nguồn tự khai ngay dòng đầu là
> `BOOTSTRAP: authority = 1 pkh (ví bootstrap)`. Nghĩa là: **một chữ ký duy nhất chuyển được
> LAMP ra khỏi kho đó.** Không có trần, không có lịch, không có quy trình.
>
> Địa chỉ kho: `addr1w827sry6t2y9744ndkg4ks6nct57v7tm8pz46ywsq98dhdsf76slu`. Đang giữ **1.000.000
> LAMP** = 0,0028% tổng cung — lượng khởi tạo kỹ thuật, chưa phân phối cho ai.
>
> Việc phải làm, đã ghi thành điều kiện bắt buộc trong `Genesis/DEV-NOTE-kho-A-DEST-canonical.md`:
> **thay kho bằng `treasury.ak` TRƯỚC khi mint thêm bất kỳ lượng nào có giá trị.** Đổi kho không
> phải mint lại policy (kho được trỏ động qua kho-NFT), nên đây là việc làm được, không phải bế tắc.
>
> Ngoài ra, mã script `lamp_mint` đang chạy trên mainnet **chưa được đối chiếu từng byte** với mã
> nguồn trong repo. Việc đó cũng phải xong trước khi mint giá trị thật.
>
> Chúng tôi để nguyên đoạn này trong tài liệu công khai thay vì viết một câu nghe an toàn hơn.
> Ai đang cân nhắc tin vào LAMP thì cần biết đúng chỗ nó chưa xong.

## 9. Khóa vận hành

- Khoá được quyền mint đã **nướng vào chính policy** ngay khi tạo. Đây là đặc tính của Cardano:
  đổi tham số ⇒ đổi luôn policy ID ⇒ **thành một token khác**.
- ⇒ **Không thể xoay khoá mà vẫn giữ nguyên token này.** Chúng tôi chọn giữ nguyên policy
  `55d3e01b…` làm LAMP chính thức, nên chấp nhận ràng buộc đó thay vì phát hành lại token mới và
  bắt cộng đồng đổi.
- Bảo vệ thay thế cho việc không xoay được khoá: (a) trần 36 tỷ nằm trong chuỗi, khoá không phá
  được trần; (b) A-DEST ép token vừa mint vào kho script, không ra ví; (c) quy trình vận hành giữ
  khoá ngoại tuyến.
- Tổng cung 36 tỷ, no-burn, trần, đơn vị — **bất biến**. Tầng phân phối phía trên kho thì nâng cấp được.

## 10. Pháp lý & tuân thủ

- LAMP là **token tiện ích** trong hệ sinh thái MagicLamp, **không phải sản phẩm đầu tư**. Không
  hứa hẹn giá, không hứa lợi nhuận, không cam kết niêm yết.
- **Không bán token.** LAMP không được chào bán đổi lấy tiền hay tài sản của người dùng. Token
  được phân bổ theo công thức **ghi nhận đóng góp đã xảy ra**, công khai và ai cũng tính lại được.
- Quyền biểu quyết **không theo số token nắm giữ** (xem §6) — nắm nhiều token không mua được quyền lực.
- MAGIC tiêu-thụ (không chuyển nhượng) củng cố định vị tiện ích.
- Pháp nhân phát hành: **GreenSun Tech Inc** (Việt Nam).

## 11. Genesis 1.000.000 LAMP — vì sao con số đó

Đây là **lượng khởi tạo kỹ thuật** để policy hiện diện trên explorer + đính metadata (lazy-mint cần
≥1 lần mint). Nó **nằm trong kho, chưa phân phối**, bằng 0,0028% tổng cung. Không mang ý nghĩa
thiết kế và **không bị thu hồi** — phần còn lại của 36 tỷ được mint dần theo lịch phân phối, mỗi
lần đều làm tăng `dist_minted`/`reserve_minted` trong chuỗi nên ai cũng theo dõi được.

---

# 100 CÂU HỎI THƯỜNG GẶP (FAQ)

## A. Cơ bản về LAMP (1–12)

1. **LAMP là gì?** Token chính thức của hệ sinh thái MagicLamp trên Cardano — hạ tầng tiện ích & quản trị.
2. **MagicLamp và LAMP khác nhau thế nào?** MagicLamp là tên hệ sinh thái/dự án; LAMP là mã token (giống Cardano/ADA, Ethereum/ETH).
3. **Policy ID của LAMP?** `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0`.
4. **Xem LAMP ở đâu?** cexplorer.io/policy/55d3e01b… hoặc tra policy trên cardanoscan/pool.pm.
5. **LAMP chạy trên chain nào?** Cardano L1, hợp đồng PlutusV3.
6. **LAMP có phải NFT không?** Không — LAMP là token đồng nhất (fungible), có decimals.
7. **Tên hiển thị và mã?** Tên: MagicLamp. Mã: LAMP.
8. **Website chính thức?** https://magiclamp.network/.
9. **LAMP dùng để làm gì?** Tiện ích trong hệ (sinh MAGIC để tiêu trong ứng dụng) + tham gia quản trị.
10. **LAMP có phải tiền/coin thanh toán không?** Định vị là token tiện ích hệ sinh thái, không phải phương tiện thanh toán chung.
11. **Ai tạo ra LAMP?** Đội ngũ MagicLamp (các pháp nhân sáng lập: Aladin Contract, GreenSun Tech).
12. **LAMP ra mắt khi nào?** Policy thiết lập trên mainnet Cardano tháng 6/2026 (giai đoạn khởi tạo).

## B. Cung, đơn vị, no-burn (13–27)

13. **Tổng cung LAMP?** Tối đa 36.000.000.000 (36 tỷ) — cố định.
14. **Có thể tăng cung quá 36 tỷ không?** Không — validator chặn mọi mint vượt 36 tỷ.
15. **LAMP có bị lạm phát không?** Không có lạm phát quá cap; tổng tối đa bất biến.
16. **LAMP có burn không?** Không bao giờ burn. Giảm lưu hành = chuyển Treasury (kế toán).
17. **Vì sao cung hiện tại thấp?** Lazy-mint: token chỉ tạo khi cần; tổng lịch sử luôn ≤ 36 tỷ.
18. **Lazy-mint là gì?** Mint dần khi cần thay vì đúc sẵn 36 tỷ; token chưa mint = chưa tồn tại.
19. **Đơn vị nhỏ nhất của LAMP?** oildrop. 1 LAMP = 1.000.000 oildrop.
20. **decimals là bao nhiêu?** 6.
21. **Vì sao gọi là "oildrop"?** Đơn vị con (như lovelace/wei) để tính số nguyên chính xác.
22. **1 oildrop bằng bao nhiêu LAMP?** 0,000001 LAMP.
23. **Cung lưu hành hiện tại?** Rất nhỏ ở giai đoạn khởi tạo; tăng dần theo phân phối. Tra on-chain để biết chính xác.
24. **Cung tối đa có đổi được không?** Không — 36 tỷ khắc cố định on-chain.
25. **Có cơ chế "buyback & burn" không?** Không burn. Cơ chế điều tiết là chuyển Treasury.
26. **LAMP có chia tách (split) không?** Không cần — đã có decimals 6.
27. **Số LAMP của tôi có bị pha loãng không?** Tổng cap cố định; phát hành theo lịch công khai trong cap.

## C. MAGIC (28–40)

28. **MAGIC là gì?** Tín chỉ tiện ích, sinh ra từ LAMP, **tiêu thụ** trong ứng dụng hệ sinh thái.
29. **MAGIC có phải token không?** Không — MAGIC là tín chỉ kế toán, không chuyển nhượng tự do, không phải coin.
30. **MAGIC sinh ra thế nào?** Mỗi epoch, LAMP sinh MAGIC theo cơ chế của hệ.
31. **MAGIC dùng làm gì?** Truy cập/dùng dịch vụ trong ứng dụng, và là tham số quản trị.
32. **MAGIC có mua bán được không?** Không giao dịch tự do như token; nó tiêu-thụ, không phải tài sản đầu cơ.
33. **Giữ LAMP có "kiếm lời" không?** Không. LAMP sinh MAGIC để **dùng** (tiện ích), không phải để sinh lợi nhuận tài chính.
34. **MAGIC có giá không?** MAGIC là tín chỉ tiêu-thụ, không định giá như tài sản giao dịch.
35. **Tốc độ sinh MAGIC phụ thuộc gì?** Lượng LAMP và cơ chế per-epoch của hệ (xem spec MAGIC).
36. **Tiêu hết MAGIC thì sao?** MAGIC tiếp tục sinh mỗi epoch khi còn giữ LAMP.
37. **MAGIC có hết hạn không?** Theo cơ chế kế toán của hệ; xem spec MAGIC.
38. **Hệ MAGIC đã chạy chưa?** Đang phát triển; sẽ kích hoạt theo lộ trình. Hiện LAMP policy đã có; MAGIC triển khai sau.
39. **MAGIC khác token thưởng (reward) thế nào?** Không phải reward tài chính — là tín chỉ tiện ích tiêu-thụ.
40. **LAMP bị khóa có sinh MAGIC không?** Theo thiết kế, LAMP (kể cả khóa) vẫn được tính sinh MAGIC — chi tiết theo cơ chế từng vault.

## D. Quản trị (41–50)

41. **Quản trị MagicLamp theo gì?** Theo cá nhân (DID), KHÔNG theo trọng số token.
42. **Giữ nhiều LAMP = nhiều quyền bỏ phiếu?** Không tỉ lệ — có trần; quyền dựa trên nhiều tham số.
43. **Sức bỏ phiếu tính thế nào?** Tích ≥4 tham số: MAGIC đã tiêu, LAMP cam kết, uy tín, LAMP nắm giữ (cap).
44. **Cử tri là ai?** Cá nhân xác thực qua PhoenixKey DID (sinh trắc).
45. **Vì sao không token-weighted?** Chống tập trung quyền lực vào ví lớn + giảm rủi ro pháp lý.
46. **PhoenixKey DID là gì?** Hệ định danh phi tập trung dựa sinh trắc, dùng để xác thực cá nhân.
47. **Một người tạo nhiều ví để có nhiều phiếu được không?** Không — DID sinh trắc chống sybil (1 người = 1 danh tính).
48. **Ai kiểm soát quỹ Treasury?** Theo cơ chế quản trị; giai đoạn đầu bởi pháp nhân sáng lập tới khi lập Foundation.
49. **Có DAO chưa?** Quản trị đang xây; validator quản trị triển khai theo lộ trình.
50. **Quyết định lớn được thông qua thế nào?** Qua cơ chế bỏ phiếu cá-nhân (xem spec Governance).

## E. Phân bổ & công bằng (51–63)

51. **LAMP chia thế nào?** 18 pot mục đích, tổng 36 tỷ.
52. **Đội ngũ giữ bao nhiêu?** 2 cty sáng lập mỗi bên 6 tỷ; chi tiết ở bảng phân bổ.
53. **Đội ngũ có xả token ngay được không?** Không — pot đội ngũ nhỏ giọt on-chain (CappedDrop), ràng buộc theo epoch.
54. **"Nhỏ giọt ngang cộng đồng" nghĩa là gì?** Đội ngũ và cộng đồng cùng cơ chế giải phóng dần, không đặc quyền xả sớm.
55. **Pot Foundation là gì?** Quỹ vận hành dài hạn; dự kiến khóa principal vĩnh viễn (không rút gốc) nhưng vẫn dùng MAGIC.
56. **Có vesting/cliff cho đội ngũ không?** Cơ chế nhỏ giọt theo tham số (tốc độ/cliff) công bố công khai.
57. **Cộng đồng nhận LAMP bằng cách nào?** Qua các pot cộng đồng (Airdrop, SRCL, delegator…) theo tiêu chí công khai.
58. **Airdrop cho ai?** Theo danh sách/tiêu chí công bố; nhỏ giọt theo epoch.
59. **SRCL là gì?** Cơ chế phân phối qua reward-redirect staking (Staking Reward Contribution Launch); chi tiết theo chương trình.
60. **Phân bổ có thể đổi không?** Ngân sách từng pot điều chỉnh được trong cap 36 tỷ (off-chain), tổng không đổi.
61. **Pot nào "khóa", pot nào "nhỏ giọt"?** Mỗi pot cấu hình riêng (tốc độ/khóa/lịch) ở tầng phân phối.
62. **Có pre-sale/ICO không?** Không mở bán cho tới khi có pháp nhân phù hợp; định vị tiện ích.
63. **Số đã mint hiện nằm đâu?** Trong kho có kiểm soát, chưa phân phối ra cá nhân.

## F. Kỹ thuật & an toàn (64–78)

64. **LAMP dùng hợp đồng gì?** Aiken/PlutusV3 trên Cardano.
65. **Policy ID đến từ đâu?** Neo bởi một giao dịch genesis one-shot → DUY NHẤT, không trùng lặp được.
66. **Có thể giả LAMP không?** Kẻ xấu có thể đúc token TRÙNG TÊN nhưng **policy ID sẽ khác** — luôn xác minh theo policy ID `55d3e01b…`, không theo tên.
67. **Cap 36 tỷ enforce ở đâu?** On-chain trong validator mint (chặn vượt cap, no-burn, đơn điệu).
68. **A-DEST là gì?** Luật ép LAMP phân phối phải vào kho kiểm soát, không ra ví người vận hành.
69. **Người giữ khóa có tự mint cho mình được không?** Mint phân phối bị ép vào kho (A-DEST); không rút thẳng về ví.
70. **SupplyState là gì?** UTxO bộ đếm tổng phát hành, neo bởi NFT one-shot, chống mint lậu/đôi.
71. **Đã kiểm thử chưa?** Đã proven trên testnet Preview (mint sai → bị chặn, vượt cap → bị chặn) + audit nội bộ.
72. **Mã nguồn mở chưa?** Theo lộ trình công khai (mục tiêu open SDK cho mọi đội Cardano).
73. **Lỡ mint nhầm thì sao?** Validator chặn các trường hợp sai (Δ lệch, vượt cap, sai quota…).
74. **Reserve là gì?** Lớp đệm phát hành (9,63 tỷ) nhả có nhịp, có trần mỗi epoch, không ai rút tay.
75. **Token có thể bị đóng băng/khóa ví của tôi không?** Không — LAMP trong ví của bạn do bạn kiểm soát hoàn toàn.
76. **Hợp đồng có thể đổi sau khi deploy không?** Policy (cap/đơn vị) bất biến; tầng phân phối nâng cấp được mà không đụng policy.
77. **Có rủi ro hợp đồng không?** Như mọi smart contract; đã kiểm thử + audit, công khai mã theo lộ trình.
78. **Ví nào giữ được LAMP?** Mọi ví Cardano chuẩn (Eternl, Lace, Vespr…).

## G. Sở hữu, chuyển, giao dịch (79–88)

79. **Tôi mua LAMP ở đâu?** Hiện **chưa niêm yết** sàn nào; cảnh giác token giả mạo.
80. **Khi nào list DEX?** Khi có pháp nhân phát hành phù hợp; sẽ công bố chính thức.
81. **LAMP có giá bao nhiêu?** Dự án không công bố/hứa hẹn giá; LAMP định vị tiện ích.
82. **Chuyển LAMP cho người khác được không?** Được — LAMP là token chuẩn, chuyển tự do giữa ví.
83. **Phí chuyển LAMP?** Phí mạng Cardano thông thường (ADA), không phí riêng.
84. **Có token giả "LAMP/MagicLamp" không?** Có thể có — luôn xác minh **policy ID** `55d3e01b…`.
85. **Làm sao biết LAMP thật?** Đối chiếu policy ID trên explorer chính thức, không tin theo tên hiển thị.
86. **LAMP có stake/delegate được không?** LAMP là token; staking ADA của ví vẫn bình thường. LAMP tham gia hệ qua MAGIC/quản trị.
87. **Mất ví thì mất LAMP?** Như mọi tài sản Cardano — tự quản seed/khóa cẩn thận.
88. **Có airdrop "claim" giả mạo không?** Cảnh giác; chỉ dùng kênh chính thức magiclamp.network.

## H. Pháp lý & tuân thủ (89–95)

89. **LAMP có phải chứng khoán không?** Định vị là token **tiện ích**, không hứa lợi nhuận; MAGIC tiêu-thụ củng cố điều đó.
90. **Mua LAMP là đầu tư?** Dự án không định vị/khuyến nghị LAMP như sản phẩm đầu tư.
91. **Có whitepaper pháp lý không?** Tài liệu công bố theo lộ trình; tuân thủ quy định nơi phát hành.
92. **Dự án ở đâu?** Pháp nhân sáng lập (Aladin Contract, GreenSun Tech); cấu trúc pháp lý đang hoàn thiện.
93. **KYC có cần không?** Tùy chương trình/khu vực; tham gia quản trị qua DID.
94. **LAMP hợp pháp ở nước tôi?** Tùy quy định địa phương; người dùng tự kiểm tra.
95. **Dự án có tuân thủ chống rửa tiền không?** Tuân thủ quy định áp dụng khi có hoạt động phát hành/niêm yết chính thức.

## I. Lộ trình & tương lai (96–100)

96. **Bước tiếp theo của LAMP?** Hoàn thiện tầng phân phối (nhỏ giọt từng pot), kích hoạt MAGIC, di trú quản trị sang PhoenixKey.
97. **"Bootstrap" nghĩa là gì?** Giai đoạn khởi tạo trên mainnet; tầng vận hành sẽ nâng cấp trước khi mở rộng người dùng.
98. **Khi nào MAGIC hoạt động?** Theo lộ trình sau khi hạ tầng MAGIC lên mainnet.
99. **Foundation khi nào lập?** Theo lộ trình; tới đó pot Foundation mới khóa + vận hành chính thức.
100. **Theo dõi cập nhật ở đâu?** Kênh chính thức tại https://magiclamp.network/ và các kênh dự án công bố.

---

*Bản DRAFT. Mọi con số/cơ chế có thể tinh chỉnh trước công bố chính thức. Luôn xác minh theo policy ID on-chain.*
