# Treasury — Kho bạc Foundation (spec outline)

**Trạng thái:** 🔜 chưa implement. Outline phạm vi để truy vết.

Nguồn chuẩn: `MagicLamp-Docs/docs/Foundation-Bootstrap.md` §7.

## Phạm vi

3 kho bạc on-chain, giải ngân tự động qua smart contract theo kết quả governance:

| Kho bạc | Ngưỡng phê duyệt | Mục đích |
|---|---|---|
| Community Treasury | > 66% vote | grants, ecosystem, thưởng cộng đồng |
| Operational Treasury | > 51% vote | vận hành, lương, hạ tầng |
| Emergency Treasury | > 67% vote | sự cố khẩn cấp, security incident |

## Cần spec onchain (chưa có)

- `Treasury` validator: giữ LAMP pool mỗi loại; release chỉ khi có proposal đã pass + đủ ngưỡng.
- Liên kết với `Governance` (đọc kết quả vote qua reference input / beacon).
- Multi-sig council + time-lock giải ngân.
- Bảo toàn value (chống drain — bài học audit C-TRE/M1 từ Distribution).
- Chống double-satisfaction (đếm theo payment script hash).

## Tái dùng từ Distribution

- Mẫu `DistributionTreasury` validator (release LAMP có kiểm soát) đã build + audit ở
  `Distribution/onchain/validators/treasury.ak` — Treasury Foundation mở rộng từ đây.
