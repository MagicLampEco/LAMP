# Treasury — CONTRACT (interface đa thuê bao)

**Trạng thái:** khung interface 2026-06-05 (chờ anh duyệt). Đây là **xương sống** mà 2 nhóm build
song song phải bám: **(A) `collectToTreasury`** (lớp thu) và **(B) Treasury core** (custody + bucket
+ release). KHÔNG nhóm nào tự đổi schema/bất biến ở đây.

Gốc: state §6 (Treasury design) + §7 (fee model) + rà soát 2026-06-05 (generators đã trả Treasury;
OriLife `animal_fee` cắt 7%; MAGIC AppEconomics). Reconcile `Foundation-Bootstrap.md §7` (3 quỹ cứng
→ nay là **buckets cấu hình**).

## 1. Mô hình đa thuê bao

- Treasury = **instance** param hóa. MagicLamp = một instance; team eco khác = instance khác (open SDK).
- Tham số instance: `(governance_ref, accepted_assets[], buckets[], protocol_cut_bps)`.
- **Custody tách accounting:** value nằm ở 1 (hoặc shard) UTxO custody; **bucket = sổ kế toán trong
  datum**, KHÔNG phải mỗi bucket một UTxO (chống bloat + min-ADA). DAO chỉnh % từng bucket.
- **Emergency bucket tách physical** (isolation) — không gộp custody với bucket thường.

## 2. Ba cửa tiền (KHÔNG gộp polymorphic theo addr)

| Hàm | Ý nghĩa |
|---|---|
| `transfer(asset, amount, addr)` | gửi ví thường — KHÔNG vào treasury, KHÔNG ghi sổ |
| `collectToTreasury(asset, amount, app_id, category)` | **THU về treasury** + ghi sổ + receipt (hàm chung, §3) |
| `donateToCardanoTreasury(ada)` | Conway `treasury_donation` — ADA-only, KHÔNG có addr (kho bạc Cardano riêng biệt) |

## 3. `collectToTreasury` — hàm thu dùng chung (nhóm A)

Chữ ký: `collectToTreasury(asset ∈ accepted_assets, amount, app_id, category)`.

1. **Split:** `cut = amount × protocol_cut_bps / 10000` → bucket(`category`); phần còn lại định tuyến
   theo app (provider/node — do app/caller chỉ định, không phải việc của Treasury).
2. **Bảo toàn value on-chain (bất biến lõi):** với mọi asset,
   `Σ treasury_out.value(asset) ≥ Σ treasury_in.value(asset) + cut(asset)`.
   Đây là **tổng quát hóa** bất biến `treasury_receives_lamp >= lamp_paid` đã có ở generators.
3. **Gộp theo lô:** nhiều `collect` gộp trong một settlement tx (chống bloat — KHÔNG thu từng
   micro-fee on-chain, bất khả thi vì min-ADA + phí mạng).
4. **Receipt:** ghi `(app_id, asset, amount, cut, epoch)` vào datum/UTxO → audit + tín dụng VP/uy tín.
5. **ĐỊNH GIÁ KHÔNG ở đây.** Bao nhiêu phí (bò ≠ gà) là việc của app (OriLife `animal_fee`); hàm này
   chỉ nhận `amount` đã tính. Quy đổi LAMP↔USD/ADA (oracle) cũng ở phía app/caller.

## 4. Bucket release — chi ra (nhóm B)

- Release **chỉ khi** một proposal Governance đã pass (đọc kết quả qua reference input / beacon).
- Ngưỡng theo loại bucket, viết dạng **"≥"** (tham số DAO): vd community ≥2/3, ops ≥1/2, emergency ≥2/3.
- Multi-sig council + **time-lock** giải ngân.
- **Chống double-satisfaction:** đếm theo **payment script hash** (bài học audit C1/C2/M1 Distribution),
  bảo toàn value, không drain.

## 5. Giảm lưu hành — KHÔNG BAO GIỜ BURN (chỉ chuyển trạng thái)

- **LAMP fixed-supply 36 tỷ là tuyệt đối — KHÔNG có nhánh burn, không có `deflation_bps`.** Đã gọi
  fixed-supply thì không được phá tổng cung.
- "Thu về Treasury" = **chuyển trạng thái** một lượng LAMP từ **UTxO lưu hành (circulating)** sang
  **Accounting trong Treasury** — token vẫn tồn tại trong tổng cung, chỉ **rời lưu hành**; governance
  chi lại sau. Đây đúng mô hình **Cardano treasury** (ADA vào treasury không bị đốt, chỉ rời
  circulating).
- Hệ quả cho bất biến §3.2: value LUÔN bảo toàn tuyệt đối (`Σ out = Σ in`, không có nhánh giảm tổng).
  "Giảm lưu hành" là thuộc tính **kế toán** (circulating = tổng − Σ balance các Treasury instance),
  KHÔNG phải thao tác đốt on-chain.

## 6. Asset & ràng buộc

- `accepted_assets`: LAMP, ADA, token doanh nghiệp (đa thuê bao). ADA reserve cho free-ops (PersonDID).
- ⚠️ **Địa chỉ Treasury PHẢI tách khỏi mọi ví tạo output cùng tx** — nếu `treasury == wallet`, bất biến
  `treasury_receives ≥ X` bị thỏa mãn rỗng (bài học Preview generators).
- ADA vào "Treasury" = vào **script Treasury riêng của MagicLamp** (giữ đa-asset), KHÔNG phải kho bạc
  Cardano (Conway donate, ADA-only, không addr).

## 7. Phụ thuộc

- **Governance** (cổng release) — đọc kết quả vote (Voting Power model đã chốt).
- **Oracle** LAMP↔USD/ADA (Score DEX TWAP / Charli3) — cho app định giá, **NGOÀI** Treasury.
- **Caller** của `collectToTreasury`: generators (MAGIC), OriLife, app SDK khác. (LAMP ← MAGIC 1 chiều.)

## 8. Phân rã build

Treasury là **một hệ thống** → build **4 spec FEAT/MATH/TECH/EXEC** cho toàn hệ, chạy song song +
Agent audit đối kháng (như Voting Power). Hai mảng nội dung A và B cùng nằm trong 4 spec đó, KHÔNG
tách 2 nhóm (tránh trùng datum/bất biến):

- **A — Collect** (`collectToTreasury`): split / bảo-toàn-value / batch / receipt + tích hợp caller
  (§2, §3, §6). Là module xuyên suốt: FEAT mô tả hành vi thu, MATH chứng minh bảo-toàn + split,
  TECH validator thu, EXEC tích hợp generators/OriLife.
- **B — Core**: custody + buckets + release + governance-gate + giảm-lưu-hành + đa thuê bao
  (§1, §4, §5, §6).
