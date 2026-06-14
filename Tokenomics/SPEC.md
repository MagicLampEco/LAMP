# LAMP Tokenomics — SPEC canonical (v3)

> Nguồn sự thật cho phân bổ + kiến trúc tiền tệ LAMP. Đông kết từ phiên thiết kế
> 2026-06-14 (allocation v3 + tái thiết Reserve). Mọi con số đơn vị "oil": **1 LAMP = 10⁶ oil**.
> Tổng cung **CỐ ĐỊNH 36 tỷ LAMP = 36×10¹⁵ oil**, **KHÔNG burn**.

---

## 1. Nguyên tắc bất biến

1. **Cố định 36 tỷ, không đốt.** Giảm lưu hành = chuyển vào Treasury (kế toán), không hủy token.
   36 = 1³+2³+3³ — Schelling-point của niềm tin. Validator ép tổng phát hành lịch sử ≤ 36 tỷ vĩnh viễn.
2. **Mô hình 3 trạng thái U/C/T** — `U + C + T = 36 tỷ` luôn đúng:
   - **U** = quota CHƯA mint (token chưa tồn tại on-chain). Reserve nằm ở đây.
   - **C** = đang lưu hành (circulating).
   - **T** = đỗ ở Treasury (parked).
   - `U → C` MỘT CHIỀU đơn điệu (mint). Điều tiết 2 chiều CHỈ ở `C ↔ T` (Treasury). Reserve KHÔNG 2 chiều (no-burn cấm quay lại U).
3. **Governance phi-token-weighted** — cử tri = cá nhân (PhoenixKey DID sinh trắc), không theo lượng token nắm giữ.
4. **Phát hành bởi doanh nghiệp VN** (GreenSun + Aladin), không offshore — tối đa minh bạch, đúng NQ 05/2025.

---

## 2. Allocation v3 (tổng = 36 tỷ)

| Khoản | LAMP | % | Cơ chế | Bật 18/6? |
|---|---:|---:|---|---|
| Team | 12 tỷ | 33,33% | Capped Drop, D nhỏ + `start_epoch` lùi (cliff) | ✓ |
| Reserve | 7,899 tỷ | 21,94% | Linear 1001 epoch, thuần thuật toán | engine code (nhánh b) |
| Platform | 5 tỷ | 13,89% | Capped Drop theo MAGIC tiêu thụ/epoch | ✗ → 27/9 |
| NewUser | 4,001 tỷ | 11,11% | 1,001 tỷ (1tr DID×1001, Capped Drop) + 3 tỷ (user sau, thuật toán √×MAGIC) | một phần |
| Development | 3 tỷ | 8,33% | Quỹ vận hành 2 cty, Capped Drop. Nguồn = trích từ Reserve | ✓ |
| Affiliate | 1 tỷ | 2,78% | Capped Drop, committee/DID | ✗ → 27/9 |
| Scavenger | 1 tỷ | 2,78% | Thưởng node lưu/phát tán dữ liệu | ✗ → 27/9 |
| ISPO | 1 tỷ | 2,78% | reward-redirect 1 tỷ/36 epoch, 2 cty toàn quyền ADA thu | một phần |
| Thanh khoản | 1 tỷ | 2,78% | LP incentive theo TVL LAMP/ADA | ✗ |
| TIGER Airdrop | 0,1 tỷ | 0,28% | retro snapshot delegator TIGER pool, claim 360 epoch sau 29/7, dư hoàn Treasury | ✓ |

Tổng: 12 + 7,899 + 5 + 4,001 + 3 + 1 + 1 + 1 + 1 + 0,1 = **36 tỷ** ✓.

**Rổ Genesis (2 nhánh mint):** dist_cap = 28,101 tỷ (tất cả trừ Reserve) + reserve_cap = 7,899 tỷ = 36 tỷ.

---

## 3. Kiến trúc tầng (layered)

```
┌─ Genesis (mint layer) ───────────────────────────────────────┐
│  thread_nft (one-shot) → tlamp_mint (cap/quota/no-burn) →     │
│  supply_state (holder). SupplyState{dist_minted, reserve_     │
│  minted, dist_cap=28,101T, reserve_cap=7,899T}. 2 route:      │
│  DistributionVest (→dist) | ReserveDraw (→reserve, gate meter)│
└──────────────────────────────────────────────────────────────┘
      │ dist bucket                         │ reserve bucket
      ▼                                      ▼
┌─ Tokenomics (channel layer) ──┐   ┌─ Reserve engine ──────────┐
│ HARD-CAP per-channel 2 lớp:   │   │ reserve_draw / meter:     │
│  A. ChannelBudget beacon NFT  │   │ linear 1001 epoch,        │
│     (remaining_oil)           │   │ permissionless, gate=hàm  │
│  B. treasury con per-channel  │   │ (không chữ ký).           │
│     (value = budget).         │   │ vested(t)=min(E, E·max(0, │
│ claim_account: Capped Drop    │   │  t−start)/1001)           │
│  vested(t)=min(E, D·dpe·max(  │   └───────────────────────────┘
│   0,t−start)). Claim/Redeem.  │
└───────────────────────────────┘
      │ C ↔ T (điều tiết 2 chiều)
      ▼
┌─ Treasury (collect/release) ──┐
│ collect C→T, release T→C.     │
└───────────────────────────────┘
```

- **Distribution/onchain** = engine Capped Drop tái dùng (đã live Preview, 33 test xanh).
- **Tokenomics/onchain** = tầng phân bổ per-channel (HARD-CAP, 61 test xanh). Offchain: nhánh (a).
- **Reserve/onchain** = engine linear 1001 epoch: nhánh (b).

---

## 4. Quyết định kiến trúc (ghi lý do — 4 trục)

### QĐ-1: Mint = LAZY-MINT (Genesis), KHÔNG native one-time mint
*Ghi đè dòng "native one-time mint, đóng policy" ở state file cũ — chờ anh duyệt/phủ quyết.*
- **Dài hạn:** lazy-mint hiện thực trung thực mô hình U-space (token chưa mint = chưa tồn tại). One-time mint buộc 36 tỷ "nằm chờ" ở vault, mâu thuẫn mô hình 3 trạng thái + tốn min-ADA khóa.
- **First-principles:** "fixed-supply" KHÔNG đòi 36 tỷ nằm sẵn on-chain — chỉ đòi *tổng phát hành lịch sử ≤ cap*. Bộ đếm đơn điệu (SupplyState) chặn tại cap = bảo chứng mạnh hơn.
- **Tối ưu:** Genesis đã code + test (thread NFT one-shot chống SupplyState giả/đôi; D7-#1 neo cap vào hằng số; no-burn). Tái dùng thay viết lại.
- **User + bền vững:** không có "kho 36 tỷ" tập trung làm mồi tấn công/nghi ngờ; mint theo nhu cầu kênh.

### QĐ-2: Reserve = thuần linear 1001 epoch, BỎ demand_gate
- Reserve KHÔNG 2 chiều (no-burn) → điều tiết cung-cầu thuộc Treasury (C↔T). Reserve chỉ giảm sốc + tái phân phối tác động cá mập, KHÔNG neo giá.
- Nhả ReserveDraw đi qua `reserve_meter` NFT (gate = HÀM, permissionless, không chữ ký) → không ai rút tay được. (1001 = Aladin 1001 đêm = 7×11×13.)

### QĐ-3: Development 3 tỷ trích từ Reserve (Team giữ nguyên 12 tỷ)
- Team = đóng góp TRƯỚC mainnet, sở hữu cá nhân, thuế cá nhân. Development = quỹ vận hành tương lai, 2 cty quản (không sở hữu cá nhân), thuế doanh nghiệp.

---

## 5. Doanh thu công ty (KHÔNG bán token gây quỹ)
- ADA reward từ ISPO pool (margin) + TIGER pool (fee 1%) — vận hành SPO hợp pháp.
- Bán gói MAGIC dạng dịch vụ = doanh thu B2B sạch nhất.
- KHÔNG bán LAMP trên DEX (nếu cần → ISPO đợt 2).

---

## 6. Pháp lý VN (luật mới nhất 2025)
- **Luật CN công nghệ số 2025** (hiệu lực 1/1/2026, Điều 46): công nhận tài sản số/mã hóa/ảo.
- **Nghị quyết 05/2025/NQ-CP** (9/9/2025, thí điểm 5 năm): CHỈ doanh nghiệp VN được phát hành; tài sản ảo phải bảo chứng tài sản thực; giao dịch qua sàn cấp phép VN, thanh toán VND → niêm yết DEX nước ngoài = **vùng xám**. Vốn ~10 nghìn tỷ chỉ áp nhà vận hành SÀN, không áp nhà phát hành token.
- **TIÊN QUYẾT:** định loại LAMP (utility/governance vs tài sản ảo) — cần luật sư VN. Xem PENDING.md §1.

---

## 7. Interface contract (byte-perfect onchain ↔ offchain)
Constr index = thứ tự khai báo, từ 0. Mọi giá trị oil.

| Type | Encoding |
|---|---|
| `SupplyState` | Constr(0, [dist_minted:int, reserve_minted:int, dist_cap:int, reserve_cap:int]) |
| `TLampMintRedeemer` | DistributionVest=Constr(0,[]); ReserveDraw=Constr(1,[]) |
| `ClaimAccountDatum` | Constr(0, [owner:bytes, entitlement:int, redeemed:int, start_epoch:int, drops_per_epoch:int, channel_id:bytes]) |
| `ClaimAccountRedeemer` | Claim{amount}=Constr(0,[int]); Redeem=Constr(1,[]) |
| `ChannelBudgetDatum` | Constr(0, [channel_id:bytes, remaining_oil:int]) |
| `ChannelBudgetRedeemer` | Decrement{amount}=Constr(0,[int]) |
| `TreasuryDatum` | Constr(0, [committee_hash:bytes, channel_id:bytes]) |
| `TreasuryRedeemer` | ReleaseForRedeem=Constr(0,[]) |

Công thức vested:
- Channel (Capped Drop): `vested(t) = min(entitlement, drops_per_epoch · max(0, t − start_epoch))`; `redeemable = vested − redeemed`.
- Reserve (linear): `vested(t) = min(total_oil, total_oil · max(0, t − start_epoch) / 1001)`; `draw = vested(t) − drawn_oil`.

---

## 8. Launch timeline
- **18/6:** Genesis lazy-mint deploy + vault multisig/timelock + thanh khoản DEX (Minswap/Sundae/WingRiders/VyFinance) + OriLife MVP. Kênh thưởng (Platform/Affiliate/Scavenger) bật SAU.
- **27/9:** Production + phát hành ORIL + DAO/DID đầy đủ + MAGIC accumulator (mở khóa Platform + NewUser-sau √×MAGIC).

---

## 9. Trạng thái module (2026-06-14)
| Module | onchain | offchain | tests | Ghi chú |
|---|---|---|---|---|
| Genesis | ✓ (worktree feat/genesis-lazymint) | ✓ | ✓ | lazy-mint; cap CẦN sửa 34,2/1,8 → 28,101/7,899 |
| Tokenomics | ✓ 61 test | nhánh (a) đang build | nhánh (a) | HARD-CAP per-channel |
| Reserve | nhánh (b) đang build | nhánh (b) | nhánh (b) | linear 1001 epoch |
| Distribution | ✓ live Preview | ✓ | ✓ 33 test | engine Capped Drop tái dùng |
| Treasury | ✓ | ✓ | ✓ | collect/release C↔T |

Xem `PENDING.md` cho danh sách quyết định chờ chốt.
