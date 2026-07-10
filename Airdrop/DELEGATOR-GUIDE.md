# TIGER Airdrop — Hướng dẫn Delegator

Bạn delegate ADA vào pool TIGER trong các epoch snapshot? Bạn được nhận **LAMP token miễn phí** theo tỉ lệ stake.

---

## 1. Tôi có đủ điều kiện không?

Bạn đủ điều kiện khi:
- Bạn đã **delegate vào pool TIGER** trong ít nhất 1 epoch snapshot (danh sách epoch sẽ được công bố)
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

Phần LAMP của bạn tỉ lệ với **tổng ADA stake × số epoch** trong danh sách epoch snapshot:

```
Phần bạn nhận = (ADA của bạn × số epoch có mặt) / (tổng ADA × epoch toàn pool) × 100,000,000 LAMP
```

Ví dụ:
- Bạn stake 10,000 ADA trong 3 epoch
- Tổng pool: 5,000,000 ADA × 3 epoch = 15,000,000 ADA-epoch
- Bạn nhận: (10,000 × 3) / 15,000,000 × 100M = **20,000 LAMP**

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
| Phần delegator | 100,000,000 LAMP |
| Phần SPO | 20,000,000 LAMP |
| Thời hạn claim | 360 epoch sau SETUP |
| Điều kiện | Delegate TIGER pool trong epoch snapshot |
| Phí claim | ~0.2 ADA |
| Double-claim | Không thể (onchain) |
