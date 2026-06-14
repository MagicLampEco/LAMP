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
| Reserve | 7,899 tỷ | 21,94% | Trần E/1000 mỗi epoch, Treasury-pull gated, rollover (~1001 epoch) | engine ✓ |
| Platform | 5 tỷ | 13,89% | Capped Drop theo MAGIC tiêu thụ/epoch | ✗ → 27/9 |
| NewUser | 4,001 tỷ | 11,11% | 1,001 tỷ (1tr DID×1001, Capped Drop) + 3 tỷ (user sau, thuật toán √×MAGIC) | một phần |
| Development | 2 tỷ | 5,56% | Quỹ vận hành 2 cty (R&D, M&A, BD, pháp lý, marketing), Capped Drop. Nguồn = trích từ Reserve | ✓ |
| Treasury (seed) | 1 tỷ | 2,78% | Vốn mồi điều tiết C↔T + khuyến khích bầu hội đồng/MagicLamp Foundation. Nguồn = trích từ Reserve | ✓ |
| Affiliate | 1 tỷ | 2,78% | Capped Drop, committee/DID | ✗ → 27/9 |
| Scavenger | 1 tỷ | 2,78% | Thưởng node lưu/phát tán dữ liệu | ✗ → 27/9 |
| ISPO | 1 tỷ | 2,78% | reward-redirect 1 tỷ/36 epoch, 2 cty toàn quyền ADA thu | một phần |
| Thanh khoản | 1 tỷ | 2,78% | LP incentive theo TVL LAMP/ADA | ✗ |
| TIGER Airdrop | 0,1 tỷ | 0,28% | retro snapshot delegator TIGER pool, claim 360 epoch sau 29/7, dư hoàn Treasury | ✓ |

Tổng: 12 + 7,899 + 5 + 4,001 + 2 + 1 (Treasury) + 1 + 1 + 1 + 1 + 0,1 = **36 tỷ** ✓.

**Rổ Genesis (2 nhánh mint):** dist_cap = 28,101 tỷ (mọi khoản trừ Reserve, gồm cả Development 2 + Treasury 1) + reserve_cap = 7,899 tỷ = 36 tỷ.

---

## 3. Kiến trúc tầng (layered)

```
┌─ Genesis (mint layer) ───────────────────────────────────────┐
│  thread_nft (one-shot) → lamp_mint (cap/quota/no-burn) →      │
│  supply_state (holder). SupplyState{dist_minted, reserve_     │
│  minted, dist_cap=28,101T, reserve_cap=7,899T}. 2 route:      │
│  DistributionVest (→dist) | ReserveDraw (→reserve, gate meter)│
└──────────────────────────────────────────────────────────────┘
      │ dist bucket                         │ reserve bucket
      ▼                                      ▼
┌─ Allocation (channel layer) ──┐   ┌─ Reserve engine ──────────┐
│ HARD-CAP per-channel 2 lớp:   │   │ reserve_draw + thread:    │
│  A. ChannelBudget beacon NFT  │   │ trần E/1000 mỗi epoch,    │
│     (remaining_oil)           │   │ Treasury-pull (gate sàn   │
│  B. treasury con per-channel  │   │ ở Treasury). rollover.    │
│     (value = budget).         │   │ delta≤min(E/1000,E−drawn) │
│ claim_account: Capped Drop    │   │ dest=Treasury. ~1001 ep.  │
│  vested(t)=min(E, D·dpe·max(  │   └───────────────────────────┘
│   0,t−start)). Claim/Redeem.  │
└───────────────────────────────┘
      │ C ↔ T (điều tiết 2 chiều)
      ▼
┌─ Treasury (collect/release) ──┐
│ collect C→T, release T→C.     │
└───────────────────────────────┘
```

- **Distribution/onchain** = engine Capped Drop gốc (đã live Preview, 33 test xanh).
- **Allocation/onchain** = tầng phân bổ per-channel (HARD-CAP, 61 test). Offchain 63 test. (đổi tên từ Tokenomics — module này chỉ làm phân bổ, không phải toàn bộ tokenomics). Engine vested của Allocation là **FORK** engine Distribution (math.ak đồng nhất, claim_account ~85% chung; KHÔNG `use magiclamp/lampdist`) — đồng bộ THỦ CÔNG; kế hoạch hợp nhất `magiclamp/common` sau 18/6.
- **Reserve/onchain** = engine trần E/1000/epoch, Treasury-pull gated (reserve_draw + reserve_thread one-shot).

---

## 4. Quyết định kiến trúc (ghi lý do — 4 trục)

### QĐ-1: Mint = LAZY-MINT (Genesis), KHÔNG native one-time mint
*Ghi đè dòng "native one-time mint, đóng policy" ở state file cũ — chờ anh duyệt/phủ quyết.*
- **Dài hạn:** lazy-mint hiện thực trung thực mô hình U-space (token chưa mint = chưa tồn tại). One-time mint buộc 36 tỷ "nằm chờ" ở vault, mâu thuẫn mô hình 3 trạng thái + tốn min-ADA khóa.
- **First-principles:** "fixed-supply" KHÔNG đòi 36 tỷ nằm sẵn on-chain — chỉ đòi *tổng phát hành lịch sử ≤ cap*. Bộ đếm đơn điệu (SupplyState) chặn tại cap = bảo chứng mạnh hơn.
- **Tối ưu:** Genesis đã code + test (thread NFT one-shot chống SupplyState giả/đôi; D7-#1 neo cap vào hằng số; no-burn). Tái dùng thay viết lại.
- **User + bền vững:** không có "kho 36 tỷ" tập trung làm mồi tấn công/nghi ngờ; mint theo nhu cầu kênh.

### QĐ-2: Reserve = lớp đệm gated, trần E/1000 mỗi epoch, Treasury-pull
- Reserve KHÔNG 2 chiều (no-burn) → điều tiết cung-cầu thuộc Treasury (C↔T). Reserve chỉ giảm sốc + tái phân phối tác động cá mập, KHÔNG neo giá.
- **Trần cứng mỗi epoch = E/1000** (7,899 tỷ oil, chia chẵn) — không cục catch-up. Dư (epoch bị gate) dồn về sau → tổng kéo dài ~1001 epoch; tối đa liên tục cạn trong 1000 epoch.
- **Treasury-pull (demand-gated):** mỗi draw đòi 1 input mang `treasury_auth` NFT — Treasury co-spend để "kéo" khi cần (parked < sàn). Logic sàn nằm ở Treasury; Reserve chỉ ép nhịp + trần + dest=Treasury. Gate dựa state on-chain tất định (KHÁC demand_gate velocity cũ đã bỏ vì lỗ H2).

### QĐ-3: 3 tỷ trích từ Reserve → Development 2 + Treasury 1 (Team giữ 12 tỷ)
- Team = đóng góp TRƯỚC mainnet, sở hữu cá nhân, thuế cá nhân. Development 2 tỷ = quỹ vận hành (R&D, M&A, BD, pháp lý, marketing), 2 cty quản, thuế doanh nghiệp. Treasury 1 tỷ = vốn mồi điều tiết C↔T + khuyến khích lập MagicLamp Foundation.

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
- Channel (Capped Drop): `vested(t) = min(entitlement, drop_value · drops_per_epoch · max(0, t − start_epoch))` (drop_value = D, param validator claim_account); `redeemable = vested − redeemed`.
- Reserve (gated, trần/epoch): `max_per_epoch = total_oil / 1000`; mỗi epoch (t > last_epoch) nhả `delta ≤ min(max_per_epoch, total_oil − drawn_oil)`, đòi Treasury-pull (treasury_auth NFT input). Dư dồn về sau → ~1001 epoch.

---

## 8. Launch timeline
- **18/6:** Genesis lazy-mint deploy + vault multisig/timelock + thanh khoản DEX (Minswap/Sundae/WingRiders/VyFinance) + OriLife MVP. Kênh thưởng (Platform/Affiliate/Scavenger) bật SAU.
- **27/9:** Production + phát hành ORIL + DAO/DID đầy đủ + MAGIC accumulator (mở khóa Platform + NewUser-sau √×MAGIC).

---

## 9. Trạng thái module (nhánh `integrate/launch-1806`)
| Module | onchain | offchain | Ghi chú |
|---|---|---|---|
| Genesis | ✓ 56 test | ✓ 34 test | lazy-mint; `lamp_mint` + `token_name` param (tLAMP/LAMP); cap 28,101/7,899 |
| Allocation | ✓ 61 test | ✓ 63 test | HARD-CAP per-channel (đổi tên từ Tokenomics) |
| Reserve | ✓ 38 test | ✓ 22 test | trần E/1000/epoch, Treasury-pull, rollover |
| Distribution | ✓ live Preview | ✓ 58 test | engine Capped Drop tái dùng |
| Faucet | ✓ | ✓ 17 test | vòi tLAMP cho dev test (testnet-only) |
| Utils | — | ✓ 26 test | thư viện helper chung (đổi tên từ protocol-utils) |
| Treasury | ✓ | ✓ | collect/release C↔T (đang phát triển: ledger.ak) |
| Governance | — | — | chỉ spec + VotingPower; code 27/9 (chưa có validator) |

Xem `PENDING.md` cho danh sách quyết định chờ chốt.
