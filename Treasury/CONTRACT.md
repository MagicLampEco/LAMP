# Treasury — CONTRACT (interface đa thuê bao)

**Trạng thái:** khung interface 2026-06-05 (chờ anh duyệt). Đây là **xương sống** mà 2 nhóm build
song song phải bám: **(A) `collectToTreasury`** (lớp thu) và **(B) Treasury core** (custody + bucket
+ release). KHÔNG nhóm nào tự đổi schema/bất biến ở đây.

Gốc: state §6 (Treasury design) + §7 (fee model) + rà soát 2026-06-05 (generators đã trả Treasury;
OriLife `animal_fee` cắt 7%; MAGIC AppEconomics). Reconcile `Foundation-Bootstrap.md §7` (3 quỹ cứng
→ nay là **buckets cấu hình**).

## 1. Mô hình đa thuê bao

- Treasury = **instance** param hóa. MagicLamp = một instance; team eco khác = instance khác (open SDK).
- Tham số instance: `(governance_ref, accepted_assets[], buckets[], protocol_cut_bps)` — nằm ở **datum**
  (DAO chỉnh không đổi script hash). Param **validator** (bất biến đời instance, hardening v1 §10 H5):
  `(proposal_policy, seed_policy, ms_per_epoch)`. `governance_ref` là **ràng buộc cứng** ở release
  (§10 H1A), không còn field trang trí.
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
   ⛔ **F8 (vá lần 2 — CHƯA thực thi):** CODE `CustodyDatum` KHÔNG có `receipt_root`; `app_id` chỉ ở
   redeemer (vô danh, không neo on-chain). **VP/uy tín KHÔNG được tin `app_id` từ Collect** để cấp tín
   dụng C1 cho tới khi receipt được thực thi thật (chống bịa). receipt_root là **v1.x** hoặc bỏ lời hứa.
   (TECH §6.)
5. **ĐỊNH GIÁ KHÔNG ở đây.** Bao nhiêu phí (bò ≠ gà) là việc của app (OriLife `animal_fee`); hàm này
   chỉ nhận `amount` đã tính. Quy đổi LAMP↔USD/ADA (oracle) cũng ở phía app/caller.
6. **Collect là PERMISSIONLESS + có van no-op (vá lần 2 F3).** Bất kỳ ai cũng build được settlement tx
   Collect (không cần authority/proposal). Để chặn griefing no-op (respend custody rỗng mỗi block gây
   contention), Collect ép **`Σcut per-asset > 0`** (TECH C-COL-11): mỗi Collect phải sinh cut THẬT. Vá
   GIẢM griefing **zero-cost** (kẻ tấn công nay tốn value), NHƯNG contention gốc 1-UTxO vẫn cần **shard
   custody (T4)** đóng hẳn — van rẻ trước, shard khi đo thấy nghẽn.

## 4. Bucket release — chi ra (nhóm B)

- Release **chỉ khi** một proposal Governance đã pass (đọc kết quả qua reference input / beacon),
  và proposal UTxO PHẢI ở đúng `Script(governance_ref)` (§10 H1A — binding cứng).
- Ngưỡng theo loại bucket, viết dạng **"≥"** (tham số DAO): vd community ≥2/3, ops ≥1/2, emergency ≥2/3.
- Multi-sig council + **time-lock** giải ngân.
- **Chống double-satisfaction:** đếm theo **payment script hash** (bài học audit C1/C2/M1 Distribution),
  bảo toàn value, không drain. Thêm (§10 H5): custody spend ép **seed NFT authenticity hiện diện**
  (in+out) — chỉ custody "thật" mới chi được.

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

## 9. Quyết định reconcile 2026-06-05 (interface KHÓA — mọi spec phải khớp)

Sau rà soát đối kháng, ghim cứng. Đồng bộ với Governance CONTRACT §5 (D1–D9).

- **T1 — Release-gate = Model A** (= Gov D3). Treasury KHÔNG tự tính ngưỡng; chỉ kiểm
  `status==Executed` + Proposal NFT + `spend_spec_hash` + `execute_after_epoch`. Toàn bộ ngưỡng
  (gồm clamp BFT) do Governance ép trước. → bỏ mọi bất đẳng thức tự-kiểm ngưỡng ở Treasury.
- **T2 — Collect ĐƠN-BUCKET mặc định.** `cut → đúng item.category` (một bucket). `split_table`
  (đa-bucket) CHỈ là tùy chọn instance, KHÔNG phải đường mặc định. MATH sửa: hạ PARTITION-MULTI
  xuống "tùy chọn", dạng chính là `Δ_bucket(category) == cut`. Hết cite chéo ngược TECH↔MATH.
- **T3 — Bất biến sổ↔value là INCREMENTAL.** Mỗi tx chỉ kiểm asset CÓ Δ: `Σ_b Δledger[(b,a)] ==
  Δvalue(a)`; asset không đụng thì value bảo toàn → sổ giữ nguyên (không fold lại toàn sổ mỗi tx).
  Thêm phân tích ExUnit theo K·M (số bucket × số asset) + đặt trần đo-thực trước M2.
- **T4 — Custody: đo throughput trước khi chốt 1 UTxO.** Một UTxO custody là điểm contention tuần
  tự. EXEC phải đo (batch N/tx × tx/block) so tải nhiều thuê bao; nếu nghẽn → **shard-by-asset**
  (mỗi shard 1 UTxO độc lập, bất biến áp per-shard, off-chain cộng tổng cho circulating). Nâng câu
  hỏi treo #3 thành quyết-định-có-số-đo.
- **T5 — MATH §6.1 bỏ tự-kiểm ngưỡng.** Chỉ giữ vị từ boolean `pass(P)` đọc từ Governance (đã clamp,
  khớp §0.2 + T1). Nếu mô tả ngữ nghĩa thì ghi rõ `approval = Σ VP_eff(thuận)` (đã clamp),
  `total = ΣVP-tham-gia GỐC` — cross-ref VotingPower MATH §8B + D1, để không implement nhầm power thô.

## 10. Hardening v1 (2026-06-13 — interface KHÓA, mọi spec phải khớp)

Đợt vá an toàn sau audit. Đụng interface ⇒ ghim ở đây để TECH/EXEC/MATH/FEAT khớp. Chưa deploy gì lên
testnet → đổi param/script hash KHÔNG cần migrate (lý do làm ngay bây giờ).

- **H1A — `governance_ref` là ràng buộc cứng (binding proposal↔governance).** Release ÉP proposal UTxO
  nằm ở **đúng** `Script(governance_ref)` (`payment_credential == Script(governance_ref)`). `governance_ref`
  từ field trang trí → ràng buộc cứng. Chặn (a) NFT proposal bị dời sang UTxO datum giả ở script lạ,
  (b) replay chéo instance khác `governance_ref`. (TECH C-REL-1.)
- **H1A-interface — Proposal NFT = MỘT policy chung per-governance** (asset name = `proposal_id`),
  **KHÔNG one-shot-by-seed per-proposal**. Custody param `proposal_policy` là policy id đơn → chỉ đúng
  khi policy ổn định per-DAO. **Mâu thuẫn phải chốt với Governance** trước khi code Release thật.
- **H1B — ĐÓNG (vá lần 2 F10).** `spend_spec_hash` NAY gồm `instance_id`
  (`= blake2b(0x02 ‖ blake2b(instance_id) ‖ blake2b(cbor(draws)))`) → hai instance Treasury CÙNG
  `governance_ref` KHÔNG còn replay chéo (hash khác instance ⇒ release reject). Known-gap #1B chuyển
  **MỞ → ĐÓNG**. ⛔ **YÊU CẦU INTERFACE thay thế (Governance build-side):** khi tạo proposal, Governance
  PHẢI tính `spend_spec_hash` với ĐÚNG `instance_id` đích (commit target instance). Tính sai ⇒ proposal
  không chi được ở instance nào. Đây là ràng buộc đúng-đắn của Governance, KHÔNG còn lỗ hổng on-chain.
- **H5 — custody ĐÒI NFT authenticity khi spend.** Param custody → `(proposal_policy, seed_policy,
  ms_per_epoch)` (bỏ `lamp_policy/lamp_name`). Mọi spend (Collect/Release) ép
  `quantity_of(value, seed_policy, instance_id) == 1` cho custody_in **và** custody_out. `custody_seed`
  param → chỉ `genesis_ref` (bỏ `custody_script_hash`), chọn output custody bằng **self-reference NFT**
  → phá vòng phụ thuộc seed↔custody. NFT mint sẵn ở genesis mà không dùng khi spend là sai gốc; mất
  NFT-gate biến lỗ cut_bps từ mis-seed BỊ ĐỘNG thành tấn công CHỦ ĐỘNG. (TECH §2/§10 C-NFT-1, EXEC §16.)
- **H2 — seed guards (ép tại `custody_seed`).** `S-CUT-0` `0 ≤ cut_bps ≤ 10000`; `S-LEDGER-1` mọi dòng
  sổ `amount > 0` (chặn âm + zero); `S-ID-0` `instance_id ≠ #""`; `S-ACC-1` `accepted_assets ≠ []`.
  `cut_bps` bất biến đời instance → ép một lần tại seed; v1.x thêm nhánh đổi cut_bps PHẢI lặp kiểm range
  (cut_bps<0 hở drain). (TECH §11, EXEC §16.)
- **H3 — canonical sổ.** Mọi dòng `amount > 0` (C-POS) + strict-sorted theo `(bucket_id, policy, name)`
  (C-SORT, thay `no_dup_lines` O(n²)→O(n)) + cho prune dòng khi số dư mới == 0 (C-PRUNE). T3 (sổ↔value)
  giữ nguyên (dòng 0 đóng góp 0). Vá gốc (v1.x): đưa `consumed_proposals` ra khỏi custody datum (cần
  Governance trạng thái `Spent`); van tạm = trần `N_max` đo-thực trước Mainnet. (TECH §3.)
- **H4 — epoch neo chain.** `epoch_out == get_epoch(tx) ∧ get_epoch(tx) >= epoch_in` (thay chỉ `>=`).
  Field `epoch` thành audit thật. **Vá lần 2 (F4): dùng `get_epoch_bounded`** — validity_range hữu hạn
  CẢ HAI biên + gọn 1 epoch (chống đóng băng: kẻ đặt lower epoch cũ submit muộn). (TECH C-EPOCH.)
- **H6 — Rebalance/MigrateIn hoãn v1.x** (`_ -> fail`). Giữ Constr trong types (index ổn định). Nạp
  generators v1 dùng adapter off-chain b-ii qua `Collect` (không cần MigrateIn). (TECH §8/§9, EXEC §4.)

## 11. Vá audit lần 2 (2026-06-15 — interface KHÓA, mọi spec phải khớp)

Đợt vá thứ hai: 6 lỗ on-chain + reconcile + known-gap. Chỉ phần đụng interface ghim ở đây.

- **F1 — replay-marker khóa vào DANH TÍNH NFT.** `read_proposal` ép `nft_name == proposal_id`. Marker
  single-use (C-REL-9) neo vào asset name của Proposal NFT, KHÔNG field datum tự-khai. (TECH C-REL-1.)
- **F10 + H1B-ĐÓNG — `spend_spec_hash` gồm `instance_id`** (xem §10 H1B). Đóng replay chéo cùng
  `governance_ref`. ⛔ Governance build-side PHẢI commit đúng `instance_id` đích khi tạo proposal.
- **F2 — Release ép `draws != []`** (TECH C-REL-13). **F3 — Collect ép `Σcut > 0`** (§3.6, TECH C-COL-11).
  **F4 — epoch neo gọn 1 epoch** `get_epoch_bounded` (chống đóng băng, TECH C-COL-7/C-REL-11). **F5 —
  `custody_seed` ép mint đúng 1 policy** (least-authority, TECH S-MINT-2).
- **F9 — đồng bộ MATH:** MATH chiều collect đổi `≥` → `==` (code dùng đẳng thức, an toàn hơn — loại tip
  làm vỡ sổ). (MATH §2.3/§3.3.)
- **Known-gap còn lại:** **F11** `proposal_id` đơn-nhất-vĩnh-viễn do Governance đảm bảo (policy chung
  per-governance KHÔNG ép unique asset-name); **F12** authority/committee 1-of-1 → multisig M-of-N TRƯỚC
  mainnet (lộ key = drain mọi custody của gov đó); **F13** (PlatformKit) `verifyEntryAgainstCustody`+dedup
  chỉ là van SDK — người tích hợp PHẢI gọi trước khi route phí.
