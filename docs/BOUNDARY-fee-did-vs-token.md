# RANH GIỚI PHÍ — DID (PhoenixKey) vs App/Token (LAMP)

**Trạng thái:** NORMATIVE (ranh giới liên hệ sinh thái). Bám doc canonical đã khóa:
`Treasury/CONTRACT.md` (§3 `collectToTreasury`, §5 no-burn, §6 `accepted_assets`).
**Ngày:** 2026-06-12.

> Mục đích: chấm dứt chồng lấn giữa PhoenixKey-Specs §36 (fee split 30/70 + fee-receipt
> minting policy) và cơ chế thu phí canonical của LAMP. Một loại phí — một sink.

---

## 1. Nguyên tắc nền (first-principles)

**Phí token hệ chỉ có MỘT sink: `collectToTreasury`.** Mọi phí định danh bằng token của hệ
(LAMP / ADA / token doanh nghiệp trong `accepted_assets`) PHẢI đi qua `collectToTreasury`
(`Treasury/CONTRACT.md §3`). Đây là cơ chế đã khóa: cut→bucket theo `protocol_cut_bps`,
receipt `(app_id, asset, amount, cut, epoch)` ghi vào datum, value bảo toàn tuyệt đối
(`Σ out ≥ Σ in + cut`), gộp lô chống bloat. Caller hợp lệ: generators (MAGIC), OriLife,
**và mọi app SDK khác — gồm PhoenixKey** (`§7`).

**Không dựng treasury token song song.** LAMP 36 tỷ fixed-supply, KHÔNG burn; giảm lưu hành =
chuyển trạng thái circulating→Treasury accounting, kế toán tập trung qua `SupplyState.circulating`
(`Treasury/CONTRACT.md §5`). Một fee-receipt minting policy riêng cho phần token, hoặc một split
30/70 riêng trên token hệ, sẽ tạo sink thứ hai → phá kế toán circulating tập trung và mâu thuẫn §5
(token-fee receipt = ghi datum, KHÔNG cần nhánh mint riêng).

**Phí DID là domain của PhoenixKey.** Phí cho thao tác danh tính / neo DID trên TAAD là nội tại
PhoenixKey: PhoenixKey tự quản split, tự quản receipt op trên TAAD, tự quản governance. LAMP KHÔNG
chạm phần này.

---

## 2. Bảng ranh giới

| Trục | **Phí DID** — PhoenixKey §36 GIỮ | **Phí app/token** — ủy thác LAMP |
|---|---|---|
| Thu cái gì | Thao tác DID / danh tính neo trên TAAD | Mọi phí định danh bằng LAMP / ADA / token doanh nghiệp |
| Cơ chế | PhoenixKey tự quản (split nội bộ + receipt op trên TAAD) | `collectToTreasury(asset, amount, app_id, category)` |
| Sổ kế toán | TAAD / Phoenix Vault | `CustodyDatum.ledger` + `SupplyState.circulating` |
| Receipt | PhoenixKey op-fee-receipt (DID-layer) | Ghi datum — **KHÔNG mint policy song song** (§5) |
| Authority chỉnh | PhoenixKey governance | DAO (`protocol_cut_bps`, bucket %) |
| Giảm tổng cung | (ngoài phạm vi LAMP) | KHÔNG bao giờ burn — chỉ rời circulating (§5) |

**Luật một dòng:** token hệ → `collectToTreasury` (sink duy nhất). PhoenixKey §36 chỉ giữ phí DID
nội tại trên TAAD, không dựng treasury token song song.

---

## 3. Cách PhoenixKey ủy thác phí token

Khi PhoenixKey cần thu phí bằng token hệ (vd phí dịch vụ tính bằng LAMP/ADA):

```
collectToTreasury(
  asset    ∈ accepted_assets,      // LAMP | ADA | token doanh nghiệp
  amount,                           // đã định giá ở phía PhoenixKey (Treasury KHÔNG định giá — §3.5)
  app_id   = "phoenixkey",          // để receipt tín dụng VP/uy tín đúng nguồn
  category                          // bucket đích
)
```

- PhoenixKey **định giá** (bao nhiêu phí) ở phía mình — Treasury chỉ nhận `amount` đã tính (`§3.5`).
- Receipt phát sinh **trong datum** của `collectToTreasury` — PhoenixKey KHÔNG mint receipt token cho
  phần này.
- Phần split protocol/bucket do `protocol_cut_bps` của instance Treasury quyết, KHÔNG phải 30/70
  hardcode của §36.

---

## 4. Đối chiếu note cũ

`docs/DESIGN-fee-paymaster-reserve.md` (dòng §A) từng khung PhoenixKey là "1 platform đăng ký" trong
Multi-Tier Fee. Lưu ý: Multi-Tier Fee là **DESIGN, chưa code**. Ranh giới trong file này neo vào cơ
chế **đã canonical = `collectToTreasury`**, nên có hiệu lực ngay cả trước khi Multi-Tier Fee được build.
Khi Multi-Tier Fee lên code, PhoenixKey có thể vào đúng tầng Platform — vẫn cùng sink, không mâu thuẫn.

---

## 5. Path canonical để PhoenixKey reference

| Mục đích | Path |
|---|---|
| Chữ ký + receipt + split | `Treasury/CONTRACT.md §3` |
| No-burn / kế toán circulating | `Treasury/CONTRACT.md §5` |
| `accepted_assets` + ràng buộc địa chỉ | `Treasury/CONTRACT.md §6` |
| Caller hợp lệ (gồm app SDK) | `Treasury/CONTRACT.md §7` |
| `SupplyState` (circulating accounting) | `Reserve/onchain/lib/magiclamp/reserve/types.ak` |
