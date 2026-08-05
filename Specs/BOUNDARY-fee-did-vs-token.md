# RANH GIỚI PHÍ — DID (PhoenixKey) vs App/Token (LAMP)

**Trạng thái:** NORMATIVE (ranh giới liên hệ sinh thái). Bám doc canonical đã khóa:
`Treasury/CONTRACT.md` (§3 `collectToTreasury`, §5 no-burn, §6 `accepted_assets`).
**Ngày:** 2026-06-12 · **soát lại + sửa dẫn chiếu:** 2026-08-05.

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
chuyển trạng thái circulating→Treasury accounting, kế toán tập trung qua `SupplyState`
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
| Sổ kế toán | TAAD / Phoenix Vault | `CustodyDatum.ledger` + `SupplyState` |
| Receipt | PhoenixKey op-fee-receipt (DID-layer) | Ghi datum — **KHÔNG mint policy song song** (§5) |
| Authority chỉnh | PhoenixKey governance | DAO (`cut_bps` của instance, bucket %) |
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
- Phần split protocol/bucket do **`cut_bps` của chính instance Treasury mà PhoenixKey đã đăng ký**
  quyết, KHÔNG phải 30/70 hardcode của §36. PhoenixKey là một Platform trong registry PlatformKit,
  `cut_bps` là một trường của entry đó (`Treasury/onchain/lib/magiclamp/treasury/platform.ak`
  `PlatformEntry.cut_bps`), authority sửa được qua `UpdateEntry` — không phải hằng số trong mã.

---

## 4. Đối chiếu note cũ

Bản gốc file này (2026-06-12) đối chiếu với `docs/DESIGN-fee-paymaster-reserve.md` §A, đóng khung
PhoenixKey là "1 platform đăng ký" trong Multi-Tier Fee.

⚠ **Dẫn chiếu đó nay đã chết:** đợt tái sắp xếp cho public (`454a526`) gộp `docs/` vào `Specs/` và
**không giữ** `DESIGN-fee-paymaster-reserve.md`. `Specs/SPEC-Paymaster.md:158,559-560` vẫn còn trỏ
`DESIGN §A` — đó là một dẫn chiếu treo, cần dọn riêng, không thuộc phạm vi file này.

Điều đó **không làm suy yếu ranh giới ở đây**: Multi-Tier Fee vốn là **DESIGN, chưa code**, còn ranh
giới này neo vào cơ chế **đã canonical = `collectToTreasury`**, nên có hiệu lực bất kể Multi-Tier Fee
có được build hay không. Và khung "platform đăng ký" đã **thành thật** dưới dạng khác: PlatformKit
registry (`PlatformEntry{platform_id, custody_hash, governance_ref, cut_bps, …}`), nơi PhoenixKey và
OriLife là hai entry riêng, `governance_ref` tách quyền (`PlatformKit/EXEC.md:88-96`) — cùng một sink,
không mâu thuẫn.

---

## 5. Path canonical để PhoenixKey reference

| Mục đích | Path |
|---|---|
| Chữ ký + receipt + split | `Treasury/CONTRACT.md §3` |
| No-burn / kế toán circulating | `Treasury/CONTRACT.md §5` |
| `accepted_assets` + ràng buộc địa chỉ | `Treasury/CONTRACT.md §6` |
| Caller hợp lệ (gồm app SDK) | `Treasury/CONTRACT.md §7` |
| `SupplyState` (kế toán trần/quota mint) | `Genesis/onchain/lib/magiclamp/genesis/types.ak:9-14` |
| Đăng ký platform + `cut_bps` per-instance | `Treasury/onchain/lib/magiclamp/treasury/platform.ak` · `PlatformKit/CONTRACT.md` |

> Sửa 2026-08-05: bản gốc trỏ `SupplyState` vào `Reserve/onchain/lib/magiclamp/reserve/types.ak` —
> **sai, ở đó không có kiểu này**. `SupplyState` (4 trường `dist_minted`/`reserve_minted`/`dist_cap`/
> `reserve_cap`) nằm ở `Genesis`, do `lamp_mint` giữ.
