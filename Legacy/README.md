# Legacy — bản đã bị thay thế, giữ để truy vết

Mọi thứ trong thư mục này **KHÔNG còn hiệu lực**. Giữ lại để hiểu vì sao thiết kế hiện tại thành
ra như vậy, và để không ai vô tình làm lại một hướng đã bị bỏ. **Đừng lấy code hay số liệu ở đây
đem dùng.**

| Mục | Bị thay bởi | Vì sao bỏ |
|---|---|---|
| `Tokenomics-v1-anchor/` | mô hình lazy-mint cap-36B hiện tại | bản neo v1 (CountMint, SupplyState 3 field) lỗi thời |
| `TOKENOMICS-v3-DEPRECATED.md` | `Specs/LAMP-POT-CATALOG.md` | số liệu phân bổ đã đổi nhiều vòng |
| `lamp-mint-core-adapter-v1-anchor.md` | `Specs/lamp-mint-core-adapter.md` | bản v1 8 tham số |
| `SPO-MCS-SPEC-Vi.md.superseded-by-SPO-CS-stakeweighted` | `Airdrop/SPO-CS-SPEC-Vi.md` | đổi cách đo đóng góp |
| `design-notes/` | — | ghi chép thiết kế theo ngày, giữ làm bằng chứng quá trình |
| `internal-2026H1/` | — | tài liệu NỘI BỘ giai đoạn đầu 2026: bàn giao, thư nội bộ, bản nháp tokenomics, danh sách việc treo. **Không phải tài liệu công bố.** Ngôn ngữ trong đó là ngôn ngữ làm việc nội bộ, không phải cách MagicLamp mô tả mình ra bên ngoài — mô tả chính thức xem `Specs/`. |

## Ghi chú về `internal-2026H1/`

Nhóm này từng nằm ở thư mục `SPEC/` và `Specs/` cùng chỗ với đặc tả công khai. Đã tách ra vì lẫn
lộn hai loại tài liệu là nguồn gây hiểu nhầm: bản nháp nội bộ dùng cách nói tắt, giả định chưa
chốt, và số liệu đã đổi. Khi có mâu thuẫn giữa `Legacy/` và `Specs/`, **`Specs/` đúng**.
