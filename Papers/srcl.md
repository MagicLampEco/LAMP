# SRCL — Staking Reward Contribution Launch

> **Paper class**: A — Positioning — giải thích cơ chế SRCL cho người tham gia.
> Đây là tài liệu **đối ngoại** (bản phái sinh), không phải đặc tả nội bộ. Chuẩn: `../CONVENTIONS.md`.

> Một cơ chế ra-mắt của hệ sinh thái MagicLamp: người đang ủy thác ADA trên Cardano **đóng góp phần thưởng staking** của mình cho một đợt Launch, và được **ghi nhận** bằng **LAMP** theo tỉ lệ đóng góp. Vốn ADA gốc luôn thuộc về người tham gia. Một cơ chế của khung [Launch](./launch-framework.md).

---

## 1. Hiểu trong một phút

Khi bạn ủy thác (delegate) ADA vào một stake pool trên Cardano, mỗi epoch (**5 ngày** trên mạng chính Cardano) mạng trả cho bạn một khoản **phần thưởng staking** — một ít ADA, sinh ra từ việc bạn góp phần bảo mật mạng. Vốn ADA bạn ủy thác **không đi đâu cả**, vẫn nằm trong ví bạn.

SRCL cho phép bạn **đóng góp phần thưởng staking đó** (không phải vốn gốc) cho một đợt Launch. Hệ đo phần thưởng bạn đóng góp mỗi epoch, và trả lại cho bạn **LAMP** theo tỉ lệ. Bạn ký uỷ quyền **một lần**, sau đó mỗi epoch hệ tự động ghi nhận.

> Bạn không bỏ vốn, không mua gì. Bạn đóng góp phần thưởng tương lai của việc staking, và được ghi nhận bằng LAMP.

**Vị trí trong lộ trình:** SRCL là **đợt phân phối thứ ba**, sau Airdrop khởi động. Nó không chạy
trước khi cộng đồng có người vận hành: điều kiện kích hoạt là đạt một **số thành viên tối thiểu
đồng ý tham gia thành lập DAO để VẬN HÀNH cộng đồng** — không phải để hưởng thụ kho. Đạt ngưỡng
rồi, SRCL có thể chạy **song song** với Airdrop, **tiếp nối ngay** khi Airdrop kết thúc, hoặc ở
**một thời điểm sau đó**; quy chế từng đợt ấn định.

**Ngưỡng kích hoạt đo bằng gì.** Đại lượng đếm là **số thành viên đã ký một văn kiện thành lập**
— văn kiện lâm thời, nhưng phải nêu rõ quyền và nghĩa vụ của người ký, và người ký phải đọc được
nó trước khi ký. **Không** đếm lượt bấm "đồng ý" với một bản điều khoản dài. Lý do nằm ở đại lượng
chứ không ở hình thức: một lượt bấm đo được sự có mặt, không đo được sự cam kết, mà thứ SRCL cần
trước khi chạy là người **nhận việc vận hành**. Ngưỡng này đặt **cao hơn** ngưỡng lập ban quản trị
DAO — ban quản trị là một nhóm nhỏ điều phối, còn đây là số người chịu trách nhiệm vận hành.

| mã | trạng thái đang mở | ràng buộc TẠM đang có hiệu lực (fail-closed) | khai ở |
|---|---|---|---|
| `SRCL-KICH-HOAT-001` | con số ngưỡng, và nội dung văn kiện lâm thời | đại lượng đã định (số người ký văn kiện thành lập); con số và văn kiện chưa công bố ⇒ SRCL **không kích hoạt** | mục này |
| `SRCL-ADMIN-002` | ai giữ `delegation_admin`, lộ trình chuyển giao | chưa công bố ⇒ **cấm** mô tả cơ chế là "bất biến" hoặc "không có admin" trong mọi tài liệu | §8 |
| `SRCL-UYTHAC-003` | nhánh `publish` của `srcl_stake.ak` nhận mọi certificate ngoài huỷ-đăng-ký, không đòi chữ ký | ⇒ **cấm** mô tả đóng góp của người tham gia là "được bảo đảm" hoặc "không ai can thiệp được" | §8 |
| `SRCL-QUANTRI-004` | tầng quản trị chưa dựng được giao dịch (`Governance/SPEC.md`), khoá `authority` còn 1-of-1 (`Treasury/CONTRACT.md` ▸ F12) | ⇒ **cấm** mô tả việc chi tiêu là "đã được cộng đồng kiểm soát"; đúng mức chỉ nói *cổng có trong mã, tầng quản trị chưa chạy* | §5 |

---

## 2. Vì sao vốn gốc an toàn

Một địa chỉ Cardano có hai phần: phần **chi tiêu** (payment) và phần **ủy thác** (stake). SRCL chỉ chạm phần ủy thác:

- **Phần chi tiêu** vẫn là khoá của bạn → chỉ bạn mới tiêu được ADA gốc.
- **Phần ủy thác** được nối tới một script chỉ làm một việc: chuyển phần thưởng staking về pot của đợt Launch.

Mạng Cardano trả phần thưởng vào "tài khoản thưởng" gắn với phần ủy thác. Script rút phần thưởng đó về pot. Vì script **chỉ điều khiển phần thưởng, không điều khiển phần chi tiêu**, nên dù script có lỗi hay bị tấn công, **không ai chạm được vốn gốc của bạn**.

---

## 3. Cơ chế

```
Vốn ADA gốc        →  ở lại ví bạn (không đụng)
Phần thưởng staking →  mỗi epoch, mạng trả vào tài khoản thưởng → script chuyển về pot đợt Launch
LAMP               →  hệ chia cho bạn ∝ phần thưởng bạn đã đóng góp, nhả dần theo lịch
```

**Đo lường:** mỗi epoch, hệ ghi nhận số ADA phần-thưởng mỗi người đóng góp. Đây là đại lượng đo
đóng góp. Cụ thể hơn, vì chỗ này quyết định bằng chứng nào được dùng: đại lượng đếm là **số ADA
đã RÚT** khỏi tài khoản thưởng của người đó về pot, không phải số dư còn tồn trong tài khoản
thưởng. Rút định kỳ, nên mỗi lượt rút là một sự kiện trên chuỗi ai cũng kiểm lại được — đó là lý
do chọn đại lượng này thay vì đọc số dư, dù đọc số dư thì đỡ vài lượt phí.

**Phân bổ:** pot LAMP của đợt được chia cho người tham gia theo tỉ lệ phần thưởng họ đóng góp, **tất định** (ai cũng tính lại ra cùng kết quả) và **bảo toàn** (tổng LAMP chia ra đúng bằng pot). Cách chia dùng phương pháp số nguyên dư-lớn-nhất nên không tạo hay mất một đơn vị nào.

**Nhận:** người tham gia nhận LAMP, nhả dần theo lịch của đợt (ví dụ đều trong N epoch). Mỗi lần nhận, người tham gia ký qua PhoenixKey.

---

## 4. Cấu hình mỗi đợt

SRCL chạy **nhiều đợt**, mỗi đợt một pot riêng. Tuy cùng một cơ chế (đóng phần thưởng staking → nhận LAMP), các đợt khác nhau ở:

| Tham số | Ý nghĩa |
|---|---|
| `pot_lamp` | Số LAMP của đợt |
| `lamp_source` | LAMP lấy từ nguồn nào (quỹ nào trong hệ) |
| `duration_epochs` | Đợt kéo dài bao nhiêu epoch |
| `beneficiary` | ADA phần-thưởng thu về **đi đâu** |
| `operator` | Ai vận hành / có quyền với ADA thu về |
| `rules` | Quy chế riêng của đợt (trần mỗi người, cổng tham gia, vùng pháp lý) |

---

## 5. Hai đợt ví dụ

**Đợt 1:**
- `pot_lamp` = 360.000.000 LAMP
- `duration_epochs` = 36 — **tức 180 ngày, khoảng 6 tháng** (epoch Cardano dài 5 ngày). Con số
  epoch được ghi kèm số ngày ở mọi nơi tài liệu nêu nó, vì "36" đọc trơ rất dễ hiểu thành 36 ngày.
- `beneficiary` = **kho cộng đồng** (community treasury). Nhánh rút của kho bắt buộc dẫn chiếu một
  đề xuất quản trị đã kiểm phiếu (`proposal_ref` — `Treasury/onchain/validators/custody.ak`, nhánh
  `Release`).
  > **Ràng buộc phải nói kèm, nếu không câu trên gây hiểu sai.** Cổng `Release` là thật trong mã,
  > nhưng nó **uỷ thác** cho tầng quản trị, và tầng đó chưa chạy được: `Governance/SPEC.md` ghi
  > thẳng *"không có tx hợp lệ nào, kể cả trên testnet"*. Thêm nữa, khoá `authority`/`committee`
  > hiện là **1-of-1**, chưa phải M-of-N (`Treasury/CONTRACT.md` ▸ known-gap **F12**). Hệ quả
  > đúng, nói cả hai chiều: chừng nào quản trị chưa dựng được giao dịch thì ADA trong kho
  > **không ra được** — an toàn theo chiều đóng, nhưng đó là *kẹt*, không phải *được canh*. Và
  > câu "không tồn tại đường rút bằng một chữ ký" **chỉ đúng cho `custody.ak`**; một kho khác
  > trong hệ (`Genesis/onchain/validators/dist_treasury.ak`) đúng là rút được bằng một chữ ký
  > (`list.has(self.extra_signatories, authority)`). Hai kho khác nhau, đừng đọc gộp.
- **Chi tiêu theo biểu quyết.** ADA trong kho chỉ ra khỏi kho qua một đề xuất đã kiểm phiếu; không
  có hạn mức chi tự động, không có khoản chi định kỳ nào chạy mà không qua phiếu. Mục đích chi
  được phép, công bố trước: **bổ sung quỹ Feecover** (trả phí mạng thay người dùng) và **phòng thủ
  peg** của cơ chế ổn định giá. Mục đích ngoài danh sách này phải mở bằng một đề xuất sửa quy chế,
  không mở bằng một đề xuất chi.
- ADA trong kho **không sinh entitlement** ở bất kỳ đợt SRCL nào (xem bất biến ở §7) — kể cả khi
  phần ADA đó được đem uỷ thác để sinh thưởng.
- ADA phần-thưởng chuyển hướng **KHÔNG phải doanh thu vận hành** của GreenSun Tech hay Aladin
  Contract, và không được mô tả như vậy ở bất kỳ đâu. Hai công ty sáng lập là bên **đóng góp
  công nghệ**; họ không phải bên thụ hưởng của dòng tài sản này.
- Đóng góp phần thưởng staking trong 36 epoch được **ghi nhận** bằng LAMP từ pot 360 triệu, chia
  theo công thức tất định ∝ đóng góp. Công thức **không phụ thuộc** doanh thu hay lãi lỗ của
  bất kỳ pháp nhân nào — nên đây không phải quan hệ góp vốn, không chia sẻ kết quả kinh doanh.

**Đợt 2 — kế tiếp:**
- `pot_lamp` = hơn 21.000.000 LAMP, nguồn từ pot **RedBack** (pot #17)
- `beneficiary` = pot **RedBack** (quỹ phòng-thủ-peg của MAGIC); `operator` = tự động, không ai rút
- ADA phần-thưởng vào thẳng quỹ phòng-thủ chung. (Nguồn LAMP và bên hưởng thụ cùng là RedBack — kho RedBack cấp LAMP mở thanh khoản, ADA thưởng quay về nuôi quỹ.)

Hai đợt cùng cơ chế, khác pot / nguồn LAMP / bên hưởng thụ / quy chế.

---

## 6. Người tham gia làm gì

1. Vào trang đợt Launch tại `affiso.net/launch/<đợt>` — đọc tài liệu, vào kênh chat (nhóm Launch trên Chat của SuperApp).
2. **Ký một lần** trên ví hiện có (Lace, Eternl, ...) để uỷ quyền: nối phần ủy thác của mình tới script của đợt, và uỷ quyền cho PhoenixKey ký các bước sau. Vốn gốc không chuyển đi đâu.
3. Mỗi epoch, hệ tự ghi nhận phần thưởng đóng góp. Không cần thao tác thêm.
4. Nhận LAMP theo lịch — PhoenixKey ký claim. Số dư hiển thị trong Chat SuperApp; thông báo trên AffiSo.

---

## 7. Bất biến (điều luôn đúng)

- **Vốn gốc bất khả xâm phạm** — cơ chế không bao giờ chi tiêu phần chi tiêu của người tham gia.
- **Một người một DID** — mỗi người nhận LAMP gắn một DID PhoenixKey sinh trắc; không ai claim hai lần.
- **Ghi nhận theo việc đã xảy ra** — LAMP chia theo phần thưởng đã đóng góp thật, không theo cam kết tương lai.
- **Bảo toàn** — tổng LAMP chia ra + phần còn dư = đúng pot; LAMP không bị đốt, phần dư về kho.
- **Duy nhất một lần** — tính duy nhất của mỗi lần nhận được ép trên chuỗi.
- **Bên thụ hưởng tách khỏi bên đóng góp** — DID/OrgDID kiểm soát `beneficiary` của một đợt, và
  mọi DID uỷ quyền cho nó (kể cả proxy, pool chung, đơn vị liên kết), **không được ghi nhận LAMP**
  cho phần thưởng đóng góp vào chính đợt đó. ADA do quỹ của đợt nắm giữ **không sinh entitlement**
  trong bất kỳ đợt SRCL nào.
  > Vì sao bất biến này là điều kiện CẦN, không phải điều làm thêm cho đẹp: thiếu nó, một bên vừa
  > kiểm soát đích ADA vừa được ghi nhận LAMP sẽ có lợi nhuận **dương bất kể tỉ lệ quy đổi tồi tới
  > đâu** — ADA chảy về chính mình, còn LAMP thì lấy từ pot chung. Chi phí ròng của vòng đó bằng
  > phí mạng. Ràng buộc này đóng vòng đó cho **mọi** bên, kể cả bên sáng lập.

---

## 8. Pháp lý

- **Văn bản Việt Nam đang điều chỉnh lĩnh vực này** — nêu để người đọc tự đối chiếu, không kèm
  kết luận nào về chương trình này:

  | văn bản | điều khoản đáng đọc |
  |---|---|
  | **Luật số 71/2025/QH15** — Công nghiệp công nghệ số, ký 14/6/2025, hiệu lực **01/01/2026** | Điều 46 định nghĩa tài sản số; Điều 47 phân loại và loại trừ chứng khoán; Điều 48 giao Chính phủ quy định điều kiện kinh doanh dịch vụ tài sản mã hoá |
  | **Nghị quyết số 05/2025/NQ-CP** — thí điểm thị trường tài sản mã hoá, ký 09/9/2025, thí điểm **5 năm** | Điều 3 khoản 2 (định nghĩa) · Điều 4 khoản 7 và khoản 9 · Điều 5 khoản 1 và 2 (điều kiện tổ chức phát hành) · Điều 6 khoản 1 và 2 (đối tượng được chào bán) · Điều 7 khoản 2 · Điều 8 khoản 2 |
  | **Thông tư 32/2026/TT-BTC** (27/3/2026) · **41/2026/TT-BTC** (09/4/2026) · **15/2026/TT-BTC** | thuế GTGT/TNDN/TNCN · kê khai, khấu trừ tại nguồn, quyết toán · nguyên tắc kế toán |
  | **Luật số 109/2025/QH15** — Thuế TNCN, hiệu lực 01/7/2026 | bổ sung "thu nhập từ chuyển nhượng tài sản số" vào thu nhập chịu thuế |
  | **Luật số 14/2022/QH15** — Phòng chống rửa tiền | Điều 4 (đối tượng báo cáo) |
  | **Luật Doanh nghiệp số 59/2020/QH14** | Điều 12 (người đại diện theo pháp luật là **một cá nhân**) · Điều 74 · Điều 120 |

- **Khung thí điểm đặt ra những điều kiện mà tài liệu này nêu thẳng, không diễn giải.** Trích
  nguyên văn Nghị quyết 05/2025/NQ-CP, bản ký số của Văn phòng Chính phủ ngày 10/9/2025:
  - Điều 5 khoản 1: *"Tổ chức phát hành tài sản mã hóa là doanh nghiệp Việt Nam, đăng ký hoạt
    động dưới hình thức công ty trách nhiệm hữu hạn hoặc công ty cổ phần theo Luật Doanh nghiệp."*
  - Điều 5 khoản 2: *"Tài sản mã hóa phải được phát hành dựa trên **tài sản cơ sở là tài sản
    thực**, không bao gồm tài sản là chứng khoán, tiền pháp định."*
  - Điều 6 khoản 1: *"Tài sản mã hóa **chỉ được chào bán, phát hành cho nhà đầu tư nước ngoài**."*
  - Điều 4 khoản 7: *"Việc chào bán, phát hành, giao dịch, thanh toán tài sản mã hóa phải được
    thực hiện **bằng Đồng Việt Nam**."*
  - Điều 4 khoản 9: *"Chính sách thuế đối với giao dịch, chuyển nhượng, kinh doanh tài sản mã hóa
    được áp dụng **như các quy định về thuế đối với chứng khoán** cho đến khi có chính sách thuế
    đối với thị trường tài sản mã hóa tại Việt Nam."*

  **Đọc cho đúng loại: đây là điều kiện GIA NHẬP một thị trường, không phải lệnh cấm áp cho mọi
  người.** Nghị quyết 05 dựng một thị trường thí điểm ba bên — tổ chức phát hành · tổ chức cung
  cấp dịch vụ được cấp phép · nhà đầu tư — và mọi nghĩa vụ trong đó đều chạy qua bên được cấp
  phép. Ba chỗ trong chính văn bản cho thấy tính tự-giới-hạn đó:
  - Điều 3 khoản 8 định nghĩa *tổ chức phát hành* là tổ chức chào bán, phát hành **thông qua nền
    tảng phát hành tài sản mã hóa** — tức định nghĩa đã gắn sẵn vào việc đi qua một nền tảng được
    cấp phép. Không đi qua nền tảng nào thì không rơi vào định nghĩa này.
  - Điều 17 khoản 1 điểm đ: Bộ Tài chính lựa chọn **tối đa 05** tổ chức cung cấp dịch vụ. Một thị
    trường có trần năm chỗ ngồi thì nó là một thị trường cụ thể, không phải toàn bộ không gian.
  - Từ vựng xuyên suốt là *nhà đầu tư*, *Bản cáo bạch chào bán*, *tài khoản*, *giá dịch vụ*,
    *mua, bán*, và Điều 4 khoản 8 ghi tài sản trong phạm vi này *"được sử dụng cho mục đích trao
    đổi hoặc đầu tư"*.

  **Và Nghị quyết 05 KHÔNG định nghĩa riêng "chào bán" hay "phát hành".** Điều 3 có mười khoản
  giải thích từ ngữ, không khoản nào định nghĩa hai từ đó — chúng luôn đi thành cặp và luôn gắn
  với nền tảng, cáo bạch, nhà đầu tư. Nên hai từ đó mang nghĩa thông thường cộng với nghĩa ở luật
  khác, và ở luật khác thì *chào bán* là hành vi **đưa ra để bán**.

  Hệ quả, nói thẳng và không vòng: **một đợt phân phối mà bên phân phối KHÔNG nhận lại giá trị
  nào** — người dùng tự claim, không trả tiền, không chuyển tài sản cho ai — thì không có bên mua,
  không có giá, không có cáo bạch, không có nền tảng được cấp phép, và không có nhà đầu tư theo
  nghĩa văn bản này dùng. Bốn điều kiện của đường thí điểm không chặn một đợt như vậy; chúng chỉ
  mô tả điều kiện để **đi vào thị trường thí điểm**, mà đợt như vậy không đi vào.

  **Chỗ ranh giới thật, và nó nằm ở SRCL chứ không ở các đợt kia.** Trong SRCL, người tham gia
  định tuyến phần thưởng staking của chính mình về một quỹ — **có giá trị đi vào**. Đó là điểm
  khác biệt về bản chất so với một đợt phân phối không nhận gì, và tài liệu này nêu ra thay vì
  gộp chung. Việc phân loại hành vi đó thuộc thẩm quyền của cơ quan nhà nước và của tư vấn pháp
  lý, không thuộc tài liệu này.

  Hai điều khoản sau đây thì **không** phụ thuộc vào việc có ở trong thí điểm hay không, nên nêu
  riêng: Điều 4 khoản 9 (thuế áp như với chứng khoán cho tới khi có chính sách riêng — tức việc
  một tài sản **không phải** chứng khoán không kéo theo việc nó được đối xử khác chứng khoán về
  thuế), và Điều 7 khoản 2 (nhà đầu tư trong nước giao dịch ngoài tổ chức được cấp phép, sau 06
  tháng kể từ khi tổ chức đầu tiên được cấp phép, bị xử lý hành chính hoặc truy cứu hình sự —
  điều này chạm **người dùng**, không chạm bên phân phối).

- **Cho tới khi có kết luận tư vấn pháp lý bằng văn bản cho một khu vực cụ thể, khu vực đó đóng.**
  Nguyên tắc đóng-mặc-định ở dưới có hiệu lực kỹ thuật tại khâu claim, không phải một lời hứa.
- **Không bên sáng lập nào là bên thụ hưởng.** ADA phần-thưởng chuyển hướng đi vào kho cộng đồng
  (đợt 1) hoặc pot RedBack (đợt 2), không đi vào doanh thu của GreenSun Tech hay Aladin Contract.
  Hai công ty này đóng góp công nghệ và nhận LAMP theo phần phân bổ đã công bố, **không nhận dòng
  ADA nào từ SRCL**. Điều này cắt đứt hình dạng "người tham gia góp giá trị → bên sáng lập thu về",
  vốn là hình dạng mà mọi khung chứng khoán soi vào đầu tiên.
- **Không có đường rút đơn phương — nhưng CÓ quyền vận hành còn lại, ở HAI hợp đồng khác nhau.**
  Kho nhận ADA chỉ chi được qua nhánh dẫn chiếu đề xuất quản trị
  (`Treasury/onchain/validators/custody.ak`, nhánh `Release` đòi `proposal_ref`). Ngoài cổng đó
  còn hai chỗ giữ quyền, và chúng thuộc hai hợp đồng riêng biệt — bản trước của mục này gộp làm
  một và mô tả sai phía người tham gia:
  - **Phía người tham gia** — `SRCL/onchain/validators/srcl_stake.ak`. Đích rút thưởng khoá cứng
    về pot của đợt (tham số `pot_cred`), không ai đổi được, và nhánh `publish` cấm tuyệt đối
    huỷ đăng ký. Nhưng nhánh `publish` **không đòi chữ ký nào** cho chứng nhận uỷ thác: mọi
    certificate ngoài `UnregisterCredential` đều được chấp nhận. Hệ quả phải nói thẳng: một bên
    thứ ba chuyển được phần uỷ thác của người tham gia sang stake pool khác — kể cả pool không
    sản xuất khối — với chi phí một phí giao dịch. **Vốn gốc không suy suyển** (nó nằm ở khoá
    chi tiêu của chính người tham gia), song dòng thưởng, và do đó phần LAMP được ghi nhận, có
    thể bị đưa về gần không. Khi nào nhánh này còn để mở, tài liệu **không được** mô tả đóng góp
    của người tham gia là "được bảo đảm" hay "không ai can thiệp được".
  - **Phía kho** — `Treasury/onchain/validators/treasury_stake.ak`, tham số `delegation_admin`:
    một khoá duy nhất chọn stake pool cho kho. Khoá đó không rút được đồng nào, song trỏ kho vào
    một pool chết thì dòng thưởng của kho cạn với cùng chi phí. Ai giữ khoá đó, và chuyển giao
    theo lộ trình nào, phải công bố trong quy chế từng đợt — **chưa công bố thì cấm mô tả cơ chế
    này là "bất biến" hay "không có admin"**.
- **Nghĩa vụ thuế vẫn phát sinh ở chỗ nào có thu nhập thật.** Người tham gia đóng góp phần thưởng
  staking của chính mình; số LAMP họ nhận là tài sản, và việc kê khai thuộc về họ theo pháp luật
  nơi cư trú. Bên vận hành kê khai phần của bên vận hành.
  > Văn bản dẫn chiếu: **Thông tư 32/2026/TT-BTC** (ký 27/3/2026) hướng dẫn thuế GTGT, TNDN, TNCN
  > với giao dịch tài sản mã hoá, và **Thông tư 15/2026/TT-BTC** (ký 04/3/2026) hướng dẫn kế toán.
  > Hai văn bản này đã xác minh là có thật. **Mức thuế cụ thể áp cho trường hợp này thì chưa** —
  > đừng lấy con số nào ở đây đi lập kế hoạch tài chính khi chưa hỏi kế toán/luật sư.
- Phần thưởng staking sinh từ hành vi vận hành mạng; LAMP chia ra là **ghi nhận đóng góp theo việc đã xảy ra**, không phải bán token đổi vốn.
- Phần phân phối LAMP áp **giới hạn theo vùng pháp lý** theo nguyên tắc **đóng mặc định**: một
  khu vực chỉ được mở khi đã có kết luận tư vấn pháp lý cho khu vực đó. Danh sách khu vực được
  mở công bố trong quy chế từng đợt và có hiệu lực kỹ thuật tại khâu claim. (Bản trước ghi
  "tuỳ quy chế từng đợt" — chữ "tuỳ" là mở-mặc-định, tức một hành vi, không phải một tuỳ chọn.)
- **Dự án không tự kết luận phân loại pháp lý cho chính mình.** Việc một chương trình thuộc
  phạm vi điều chỉnh nào do pháp luật từng khu vực xác định, không do bên phát hành tự xác
  định. Mọi câu dạng *"vì X nên nghĩa vụ Y không phát sinh"* đều bị loại khỏi tài liệu này.

---

## 9. Tài nguyên hệ sinh thái dùng

| Chức năng | Dùng |
|---|---|
| Trang đợt + thông báo | AffiSo (`affiso.net/launch/<đợt>`) |
| Định danh + ký uỷ quyền + ký claim | PhoenixKey |
| Đo lường + xác định phần thưởng | AffiSo + Launch engine |
| Phân bổ + nhả LAMP | Launch engine (kho + claim đã kiểm) |
| Hiển thị số dư / địa chỉ | ProofChat trong Chat của SuperApp |
| Chi tiết token + diễn đàn | magiclamp.network + magiclamp.network/forum |
| Cộng đồng đợt | nhóm Launch trên Chat của SuperApp |

Không dùng Telegram, X, hay nền tảng ngoài.
