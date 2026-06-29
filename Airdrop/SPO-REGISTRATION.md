# TIGER Airdrop — Hướng dẫn đăng ký SPO

Phần phân bổ SPO: **20,000,000 LAMP** (từ tổng 120M Airdrop pot #14).

> Phần delegator (100M) được phân bổ tự động theo snapshot Blockfrost — delegator KHÔNG cần đăng ký.
> Phần SPO (20M) dành riêng cho operator(s) đã vận hành pool TIGER. Phải đăng ký và ký xác nhận đồng ý luật chơi.

---

## Không cần lấy key từ AirGap

Cardano SPO có 4 loại key. Quy trình này **chỉ dùng reward stake key** — loại mà SPO dùng hàng epoch để rút thưởng:

| Key | Dùng để | Nằm ở đâu | Cần cho đăng ký? |
|---|---|---|---|
| `pool.cold.skey` | Đăng ký/thoát pool | **AirGap** | **KHÔNG** |
| `kes.skey` | Ký block | Server nóng (rotate 90 ngày) | **KHÔNG** |
| `vrf.skey` | Tính slot leader | Server nóng | **KHÔNG** |
| **`stake.skey`** | **Rút thưởng pool** | **Ví thường, hỗ trợ Ledger** | **CHỈ KEY NÀY** |

**Tại sao reward stake key đủ để chứng minh quyền sở hữu pool?**
Pool của bạn có trường `reward_account` được ghi trên chain khi đăng ký pool (dùng cold key). Trường này là địa chỉ stake do `stake.skey` kiểm soát. Nếu bạn ký được bằng `stake.skey` → chứng minh bạn là operator mà không cần cold key.

---

## Quy trình đăng ký (3 bước, 5 phút)

### Bước 1: Xem thống kê pool của bạn

```bash
cd Airdrop/scripts
npm install

# Xem stake 6 epoch gần nhất + tham gia từ đợt nào
npx tsx spo_stats.ts --pool pool1xs2yx...
```

Output mẫu:
```
═══════════════════════════════════════════════════════════════════════
TIGER AIRDROP — Thống kê Pool
Pool ID:     pool1xs2yx67vxuygadnjflj5u5dv6cqf6t0u6jke9z9jzj2svfuxmqq
Tên pool:    TIGER Pool [TIGER]
Reward acct: stake1uxyz...
Tham gia từ: Epoch 578
Network:     Preview

Epoch  Active Stake           Delegators  Blocks  Pool %
───────────────────────────────────────────────────────────────
  578  5,234,001 ADA               127       3   0.52%  ← lần đầu
  579  5,891,230 ADA               134       5   0.59%
  580  6,102,441 ADA               139       4   0.61%
  581  6,045,112 ADA               137       6   0.60%
  582  5,998,334 ADA               135       3   0.60%
  583  6,234,001 ADA               142       7   0.62%
───────────────────────────────────────────────────────────────
Tổng stake × 6 epoch: 35,504,119 ADA·epoch
```

### Bước 2: Chạy đăng ký interactive

```bash
npx tsx spo_register.ts \
  --pool pool1xs2yx... \
  --payment addr1qx...   # địa chỉ ví nhận LAMP (payment addr, không phải stake)
```

Script sẽ:
1. Hiển thị stats và luật chơi
2. Hỏi xác nhận đồng ý
3. Tạo message cần ký
4. Hướng dẫn ký với reward stake key
5. Nhận chữ ký → xuất `spo_registration.json`

### Bước 3: Ký với reward stake key

Script sẽ in ra message hex cần ký. Chọn một trong hai phương thức:

#### Phương thức A: cardano-signer (khuyến nghị)

```bash
# Chỉ cần stake.skey (reward stake key) — KHÔNG phải cold.skey
cardano-signer sign \
  --data-hex "<message_hex_từ_script>" \
  --signing-key /path/to/stake.skey \
  --out-file sig.json

cat sig.json
# → { "signature": "4a3b...", "publicKey": "8f4e..." }
```

Sau đó dán `signature` và `publicKey` vào prompt của `spo_register.ts`.

#### Phương thức B: Eternl/Vespr wallet + Ledger

1. Mở Eternl → wallet có reward address = `stake1uxyz...` (pool reward account)
2. Settings → Sign Data
3. Address: `stake1uxyz...` (reward stake address của pool)
4. Payload: dán message hex
5. Ký (Ledger confirm) → copy JSON output
6. Trích xuất `signature` (64 bytes) và `pubkey` (32 bytes) từ JSON

---

## Sau khi đăng ký

File `spo_registration.json` chứa:
- Pool ID + reward address
- Payment address nhận LAMP
- Epochs active + tổng stake
- Message đã ký + chữ ký + public key

**Nộp file này qua:**
- Discord: `#spo-registration` (link trên magiclamp.network)
- Email: spo@magiclamp.network

MagicLamp Foundation sẽ **verify tự động** bằng:
```bash
npx tsx verify_registration.ts --file spo_registration.json
```

Kết quả VALID → payment address được thêm vào Merkle tree SPO share.

---

## Phân bổ SPO share (20M LAMP)

Nếu nhiều operator đã vận hành pool TIGER trong các epoch snapshot:

```
Phần SPO của bạn = (stake × epoch của bạn) / (tổng stake × epoch tất cả SPO) × 20M LAMP
```

Ví dụ:
- SPO A (3 epoch × 6M ADA = 18M ADA·epoch): 18/30 × 20M = 12M LAMP
- SPO B (2 epoch × 6M ADA = 12M ADA·epoch): 12/30 × 20M = 8M LAMP

---

## Câu hỏi thường gặp

**Q: Tôi không có cardano-signer và không dùng Eternl, có cách nào khác?**
A: Liên hệ MagicLamp Foundation — sẽ hỗ trợ cách ký riêng (Daedalus, Nami, v.v.)

**Q: Payment address có thể là địa chỉ hardware wallet (Ledger) không?**
A: Có. Điền địa chỉ bất kỳ bạn kiểm soát — LAMP sẽ gửi về đó.

**Q: Tôi đã bàn giao pool cho người khác, ai đăng ký?**
A: Operator TẠI THỜI ĐIỂM epoch snapshot là người có quyền đăng ký. Nếu có tranh chấp, liên hệ Foundation với bằng chứng lịch sử on-chain.

**Q: Deadline đăng ký SPO là khi nào?**
A: Thông báo trước ít nhất 2 tuần trên website và Discord. Phần không đăng ký đúng hạn → Treasury.

**Q: Phần thưởng SPO được claim thế nào?**
A: Operator KHÔNG cần làm thêm gì sau khi đăng ký được duyệt — MagicLamp Foundation bao gồm payment address của bạn vào Merkle tree SPO và gửi LAMP trực tiếp.
