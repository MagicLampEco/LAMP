# TIGER Airdrop — Hướng dẫn đăng ký SPO

Phần phân bổ SPO: **20,000,000 LAMP** (từ tổng 120M Airdrop pot #14).

> Phần delegator (100M) được phân bổ tự động dựa trên snapshot Blockfrost — delegator KHÔNG cần đăng ký.
> Phần SPO (20M) dành riêng cho operator(s) đã vận hành pool TIGER trong các epoch snapshot. Đăng ký để nhận.

---

## 1. Điều kiện nhận

Bạn nhận phần SPO khi TẤT CẢ 3 điều kiện dưới đây đều đúng:

| # | Điều kiện |
|---|---|
| 1 | Pool của bạn là **pool TIGER** (pool ID sẽ được công bố bởi MagicLamp Foundation) trong ít nhất 1 epoch snapshot |
| 2 | Bạn là **cold key owner** (có khả năng ký bằng pool cold key hoặc reward stake key của pool) |
| 3 | Đăng ký trước **deadline đăng ký SPO** (xem website MagicLamp) |

---

## 2. Thông tin cần cung cấp

Tạo file `spo_registration.json` theo mẫu dưới:

```json
{
  "pool_id": "pool1xs2yx...",
  "reward_stake_address": "stake1...",
  "payment_address": "addr1...",
  "operator_name": "Tên pool / tên tổ chức (tùy chọn)",
  "contact": "email hoặc Telegram (tùy chọn)",
  "signed_message": "<xem bước 3>",
  "signature_pubkey": "<xem bước 3>"
}
```

| Trường | Mô tả |
|---|---|
| `pool_id` | Pool ID (bech32, bắt đầu bằng `pool1`) |
| `reward_stake_address` | Stake address nhận reward của pool (bech32) |
| `payment_address` | Địa chỉ Cardano để nhận 20M LAMP — đây là địa chỉ **thanh toán**, không nhất thiết trùng reward address |
| `signed_message` | Chữ ký xác thực quyền sở hữu pool (bước 3) |
| `signature_pubkey` | Public key tương ứng với chữ ký |

---

## 3. Ký xác thực quyền sở hữu pool

Mục đích: chứng minh bạn kiểm soát pool cold key (không ai giả mạo SPO để ăn cắp phần SPO).

### Nội dung cần ký (không thay đổi):

```
TIGER-AIRDROP-SPO-REGISTRATION:pool_id:<pool_id>:payment_address:<payment_address>
```

Ví dụ:
```
TIGER-AIRDROP-SPO-REGISTRATION:pool_id:pool1xs2yx67vxuygadnjflj5u5dv6cqf6t0u6jke9z9jzj2svfuxmqq:payment_address:addr1qx...
```

### Cách ký với cardano-cli:

```bash
# 1. Tạo message file
echo -n "TIGER-AIRDROP-SPO-REGISTRATION:pool_id:<POOL_ID>:payment_address:<PAYMENT_ADDR>" > message.txt

# 2. Ký bằng stake key của pool (reward address key)
cardano-cli stake-address key-gen \
  --verification-key-file stake.vkey \
  --signing-key-file stake.skey
# (bỏ qua bước trên nếu bạn đã có stake.skey)

cardano-cli stake-address build \
  --stake-verification-key-file stake.vkey \
  --testnet-magic 2 > stake_addr.txt

# Ký
cardano-cli key sign \
  --signing-key-file stake.skey \
  --tx-body-file message.txt \
  --out-file signature.json
```

### Hoặc ký bằng Eternl / Flint / cardano-signer:

```bash
# cardano-signer (https://github.com/gitmachtl/cardano-signer)
cardano-signer sign --data-file message.txt \
  --signing-key stake.skey \
  --out-json signature.json
```

Kết quả `signature.json` chứa `signature` và `publicKey` — điền vào `signed_message` và `signature_pubkey`.

---

## 4. Nộp đăng ký

Gửi file `spo_registration.json` đến MagicLamp Foundation qua một trong hai kênh:

- **Discord:** `#spo-registration` channel (link trên website)
- **Email:** spo@magiclamp.network

Nhân viên sẽ xác minh chữ ký và phản hồi trong vòng 48h. Sau khi xác minh, địa chỉ `payment_address` của bạn sẽ được thêm vào Merkle tree SPO share và nhận 20M LAMP khi SETUP Airdrop hoàn tất.

---

## 5. Cơ chế phân bổ SPO share

Nếu có nhiều SPO đã vận hành pool TIGER trong các epoch snapshot (pool đổi tay), phần 20M được chia theo **số epoch active** của từng operator.

Ví dụ:
- SPO A: active 3 epoch → 3/5 × 20M = 12M LAMP
- SPO B: active 2 epoch → 2/5 × 20M = 8M LAMP

MagicLamp Foundation xác minh bằng on-chain pool registration history.

---

## 6. Câu hỏi thường gặp

**Q: Tôi có thể dùng địa chỉ ví hardware (Ledger/Trezor) không?**
A: Có. Điền `payment_address` = địa chỉ ví hardware. LAMP sẽ gửi về đó.

**Q: Tôi không còn private key của pool cold key cũ?**
A: Chỉ cần stake key của reward address pool. Nếu không còn cả stake key, liên hệ MagicLamp Foundation với bằng chứng ownership khác.

**Q: Deadline đăng ký SPO là khi nào?**
A: Được thông báo chính thức trước ít nhất 2 tuần trên website và Discord.

**Q: Nếu không đăng ký trước deadline?**
A: Phần SPO chưa đăng ký được chuyển về Treasury — KHÔNG giữ lại vô thời hạn.
