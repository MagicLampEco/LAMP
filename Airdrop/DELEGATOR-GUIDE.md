# Airdrop — Hướng dẫn Delegator (pot Delegator 100M)

> **Model v2 (chốt 2026-07-11).** Đây là **pot Delegator = 100.000.000 LAMP** trong tổng Airdrop
> 120M (2 pot còn lại: SPO (Staking Pool Operator) 5M + CS (Community Supporter) 15M — xem `SPO-REGISTRATION.md`). Đặc tả:
> `AIRDROP-V2-SPEC-Vi.md` §1. Khác v1: **mọi pool Cardano** (không chỉ TIGER) và **phải đăng ký**.

Bạn delegate ADA vào **bất kỳ pool Cardano** và đăng ký? Bạn được nhận **LAMP token miễn phí** từ
pot Delegator theo tỉ lệ stake.

---

## 1. Tôi có đủ điều kiện không?

Bạn đủ điều kiện khi:
- Bạn đã **delegate vào bất kỳ pool Cardano** (gợi ý thân thiện: pool TIGER, nhưng KHÔNG bắt buộc)
  và **giữ delegation ≥ N epoch liên tục** trong cửa sổ snapshot `[E_open, E_cut)` (N = 2, chốt mỗi đợt)
- Bạn đã **đăng ký** bằng cách ký reward stake key (opt-in — khác v1 auto-snapshot)
- Phần LAMP của bạn ≥ **1 LAMP** (người stake rất nhỏ có thể dưới ngưỡng tối thiểu)

### Kiểm tra ngay:

```bash
# Kiểm tra bằng snapshot (khi snapshot đã được công bố):
npx tsx check_airdrop.ts --snapshot snapshot.json --addr stake1...

# Hoặc kiểm tra trực tiếp từ Blockfrost:
npx tsx check_airdrop.ts --live --epoch 580 --addr stake1...
```

Bạn cũng có thể kiểm tra trên trang web MagicLamp (không cần CLI).

---

## 2. Tính toán phần LAMP

Phần LAMP của bạn tỉ lệ với **tổng ADA stake tích lũy qua các epoch giữ ≥ N liên tục** (mọi pool,
trong cửa sổ `[E_open, E_cut)`) so với tổng của tất cả delegator đã đăng ký:

```
Phần bạn nhận = (Σ ADA của bạn qua các epoch đủ điều kiện) / (Σ toàn bộ delegator đăng ký) × 100,000,000 LAMP
```

Ví dụ:
- Bạn stake 10,000 ADA, giữ liên tục 3 epoch (≥ N = 2) → accStake = 30,000 ADA-epoch
- Tổng tất cả delegator đăng ký: 15,000,000 ADA-epoch
- Bạn nhận: 30,000 / 15,000,000 × 100M = **200,000 LAMP**

> Giữ delegation càng nhiều epoch → accStake càng lớn → phần càng nhiều (thưởng lòng trung thành).
> Ví stake đúng 1 epoch rồi rút (không đủ chuỗi ≥ N) → accStake = 0 → loại.

---

## 3. Cách claim LAMP

### 3.1 Thông qua giao diện web (khuyến nghị)

1. Truy cập **magiclamp.network/airdrop**
2. Kết nối ví Cardano (Lace, Eternl, ...)
3. Hệ thống tự nhận diện stake address và hiển thị phần LAMP của bạn
4. Nhấn **"Claim LAMP"** → ký giao dịch
5. LAMP sẽ về ví của bạn trong vài giây (1 block confirmation)

### 3.2 Thông qua CLI (nâng cao)

Cần cài đặt Node.js ≥ 20 và có `.env` với Blockfrost key:

```bash
cd Airdrop/scripts
npm install

# Xác nhận bạn có trong snapshot
npx tsx check_airdrop.ts --snapshot snapshot.json --addr stake1...

# Chạy demo claim (xem OPERATOR-RUNBOOK.md để claim thật)
npx tsx demo_airdrop.ts
```

---

## 4. Thời hạn claim

- Airdrop mở **360 epoch** (khoảng 5 năm trên Mainnet, 360 ngày trên Preview testnet) từ ngày SETUP
- Sau thời hạn: LAMP chưa claim được thu hồi về **Treasury** (không mất LAMP của bạn trước deadline)
- Không có "late penalty" — bạn nhận đủ phần của mình bất kỳ lúc nào trong 360 epoch

---

## 5. Câu hỏi thường gặp

**Q: LAMP về ví nào?**
A: LAMP về địa chỉ ví bạn dùng để claim (ký giao dịch). Không nhất thiết phải là cùng ví bạn delegate.

**Q: Tôi có thể claim sau khi rời pool?**
A: Có. Snapshot đã chốt — rời pool sau epoch snapshot không ảnh hưởng.

**Q: Phí giao dịch claim là bao nhiêu?**
A: ~0.17–0.2 ADA (phí Cardano thông thường). Bạn cần ít nhất 2 ADA trong ví để ký tx.

**Q: Tôi có thể claim nhiều lần cho cùng 1 địa chỉ?**
A: Không. Mỗi địa chỉ trong snapshot chỉ claim được 1 lần. Cơ chế onchain (spend-once slot NFT) chặn double-claim tuyệt đối.

**Q: Snapshot có khớp với dữ liệu thực không?**
A: Snapshot lấy từ Blockfrost API (on-chain data). Bạn có thể tự verify bằng `/epochs/{E}/stakes?pool_id={pool}`.

**Q: Nếu ví của tôi thay đổi stake key sau epoch snapshot?**
A: Stake address gắn với delegation key — nếu bạn redelegate ra pool khác nhưng không đổi stake key, bạn vẫn nhận LAMP về cùng stake address. Nếu bạn dùng ví hoàn toàn mới (stake key mới), liên hệ MagicLamp Foundation.

---

## 6. Tóm tắt nhanh

| | |
|---|---|
| Tổng Airdrop | 120,000,000 LAMP |
| Phần delegator (pot này) | 100,000,000 LAMP (∝stake, mọi pool) |
| Phần SPO | 5,000,000 LAMP (tư cách hợp lệ, chia đều) |
| Phần CS (Community Supporter) | 15,000,000 LAMP (đóng góp cộng đồng, cần DID) |
| Thời hạn claim | 360 epoch sau SETUP |
| Điều kiện (delegator) | Delegate mọi pool + đăng ký + giữ ≥ N epoch |
| Phí claim | ~0.2 ADA |
| Double-claim | Không thể (onchain) |
