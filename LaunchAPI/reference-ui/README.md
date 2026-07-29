# Launch Checker — giao diện tham chiếu (bàn giao AffiSo)

Giao diện tra cứu số LAMP nhận được (ETD/Airdrop/SRCL/Joinnet). **Read-only, song ngữ VI/EN.**
Đây là bản THAM CHIẾU cho team AffiSo dựng trang `affiso.net/launch`.

## Hai cách chạy

**1. Bản demo tĩnh (nhúng dữ liệu — dùng để test nhanh, không cần server):**
```bash
# a) dựng dữ liệu ETD thật từ mainnet (read-only, không key)
cd TIGER/offchain && npx tsx ../scripts/build_tiger_koios.ts --cutoff 637 --out entitlements.json
# b) làm slim + nhồi vào template (thay __DATA__)
node -e 'const fs=require("fs");const d=require("./entitlements.json");const L=1000000n;
  const slim={meta:d.meta,entries:d.entries.map(e=>({s:e.stake_address,a:e.addresses,
    acc:(BigInt(e.acc_stake_lovelace)/L).toString(),lamp:e.claimable_lamp,cap:e.capped,
    ep:e.epochs.map(x=>[Number(x.epoch),Math.round(Number(x.stake)/1e6),Number(x.lamp)])}))};
  const tpl=fs.readFileSync("LaunchAPI/reference-ui/launch-checker.template.html","utf8");
  fs.writeFileSync("launch-checker.html",tpl.replace("__DATA__",JSON.stringify(slim)));'
# → mở launch-checker.html
```

**2. Bản production (gọi API trực tiếp — KHUYẾN NGHỊ cho affiso.net):**
Thay `const DATA = __DATA__;` bằng lời gọi endpoint LaunchAPI (`LaunchAPI/src/etd.ts`):
```
GET /v1/launch/etd/check?address=<addr|stake_addr>
→ { history, tiger, tiger_acc_stake, lamp:{amount_lamp, capped, provisional} }
```
AffiSo render JSON — **KHÔNG tự tính LAMP** (math canonical ở LAMP-side, P8).

## Dữ liệu (v2, 2026-07-11)
- Nguồn: `pool_delegators_history` từng epoch < cutoff 637 → **MỌI ai từng stake TIGER** (kể cả đã rời pool).
- `provisional=true`: owner = stake_address, chưa qua registration; số LAMP có thể đổi khi chốt đăng ký payment.
- LAMP per-epoch = phân bổ tổng owner ∝ stake mỗi epoch (largest-remainder, Σ per-epoch = tổng owner).

## Tab
| Tab | Trạng thái | Nội dung |
|---|---|---|
| ETD | có dữ liệu | dán địa chỉ → LAMP + bảng epoch (stake + LAMP) + sparkline |
| Airdrop | mô tả | 3 pot: SPO 5M · SC 15M · Delegator 100M |
| SRCL | mô tả | ký-1-lần 3 đường (Lace/CLI/CIP-30), nút copy |
| Joinnet | mô tả | sắp công bố |

## Bảo mật hiển thị
- Chỉ đọc chain, KHÔNG đụng LAMP đã mint, KHÔNG tạo tx.
- Luôn hiển thị Policy ID `55d3e01b…180f0` để user tự xác minh.
