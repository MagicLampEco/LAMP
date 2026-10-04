# Pot vault (két pot 8) — hợp đồng on-chain

**Phiên bản:** v1.0 — 2026-10-04, lần đầu khai phiên bản. Vì sao: §Tham số biên dịch thêm `window_origin_ms`
(7 tham số, khớp chữ ký `validator pot_vault(`); bản trước còn 6.

Két trung gian giữa nguồn LAMP của kênh pot 8 và két swap của Feecover. Một
validator đa mục đích duy nhất, permissionless: không nhánh nào đòi chữ ký, toàn bộ
an toàn nằm ở ràng buộc giá trị và datum.

Mã nguồn: `onchain/validators/pot_vault.ak` (validator + bộ ca kiểm),
`onchain/lib/magiclamp/potvault/handlers.ak` (thân hai handler + danh sách bất
biến), `.../types.ak` (datum, redeemer, hằng), `.../util.ak` (helper).

## Tham số biên dịch

Thứ tự cố định, áp một lần lúc deploy:

```
pot_vault(
  genesis_ref: OutputReference,
  lamp_policy: PolicyId,
  lamp_name:   AssetName,
  ms_per_epoch: Int,
  window_cap:  Int,
  total_cap:   Int,
  window_origin_ms: Int,
)
```

| tham số | nghĩa | giá trị Preprod |
|---|---|---|
| `genesis_ref` | UTxO bị tiêu trong lượt đúc ⇒ policy chạy tối đa một lần | chọn lúc deploy |
| `lamp_policy` · `lamp_name` | định danh token LAMP | theo mạng |
| `ms_per_epoch` | độ rộng một cửa sổ, ms | `432_000_000` (5 ngày) |
| `window_cap` | trần LAMP của két swap NGAY SAU một lượt rót | `1_000_000 × 10^6` |
| `total_cap` | trần tích luỹ của kênh (F8 = 1) | `7_000_000 × 10^6` |
| `window_origin_ms` | gốc lưới cửa sổ: cửa sổ = `(t − window_origin_ms) / ms_per_epoch` (`Specs/Window/CONTRACT.md` v1.0 §1, WIN-ORIGIN-3) | `1_654_041_600_000` (nguồn: `Specs/Window/CONTRACT.md` v1.0 §2) |

`window_cap` và `total_cap` tính bằng oildrop (LAMP decimals 6).

**`reserve_hash` KHÔNG là tham số.** Két swap nhận `pot_return = địa chỉ script
pot` làm tham số của nó, nên nếu pot cũng ôm hash két thì hai hash phụ thuộc lẫn
nhau ⇒ điểm bất động blake2b ⇒ không dựng được cặp nào. Pot phát hiện két lúc chạy,
qua NFT két ghi trong datum của chính nó. Chi tiết ở đầu `types.ak`.

Hash validator CHƯA áp tham số (`aiken build` v1.1.21, stdlib
`7d5cee54b2bb4eea211ae3bd806c7c39e5fd899d`):
`1a05301954b74f50dd58e856baa7a4b1a87c357e4f122280a35814dd`.
Hash sau khi áp tham số khác giá trị này và phải đọc lại từ `plutus.json` của lượt
dựng thật — đừng chép con số trên vào bên off-chain.

## Định danh trên chuỗi

- NFT pot: policy = hash của CHÍNH script pot, asset name = `""` (rỗng). One-shot,
  không có đường đốt.
- Địa chỉ pot = `Script(own_hash)`, **không** stake credential (enterprise). Mọi
  nhánh so ĐỊA CHỈ ĐẦY ĐỦ, không chỉ payment credential.
- NFT két swap: policy = `reserve_hash`, asset name = `""`. Địa chỉ két đích =
  `Script(reserve_hash)`, cũng enterprise.

## Datum · redeemer (chỉ số CBOR)

```
PotDatum = Constr(0, [ reserve_hash: bytes(28), drawn_total: int, last_window: int ])
```

| trường | nghĩa |
|---|---|
| `reserve_hash` | script hash két swap. Ghi MỘT lần lúc đúc, bất biến |
| `drawn_total` | tổng LAMP đã rót sang két, tính gộp, CHỈ TĂNG |
| `last_window` | cửa sổ của lượt rót gần nhất. Khởi tạo `-1`, tăng NGẶT |

Redeemer spend `PotRedeemer`: `0 = Feed`, `1 = Absorb`.
Redeemer mint `PotMintRedeemer`: `0 = MintPot`.

Handler spend nhận datum kiểu `Option<Data>`, KHÔNG `Option<PotDatum>`: Plutus V3
cho tiêu một input script không datum, và các UTxO lạc gửi tới địa chỉ pot mang
datum bất kỳ (hoặc không có). Chỉ UTxO pot mới được parse thành `PotDatum`.

## Danh sách chốt

Mỗi mã dưới đây là một `expect` có thật trong `handlers.ak`, kèm tên ca kiểm ghim nó.

### Chung cho mọi lượt spend

| mã | nội dung |
|---|---|
| — | đúng 1 input mang NFT pot trong cả tx (`count_inputs_with_nft`) — chống thoả mãn kép |
| — | input mang NFT pot phải đứng ở đúng địa chỉ enterprise của pot |

Phân loại UTxO bằng TOKEN, không bằng hình dạng datum: input mang NFT pot đi nhánh
pot, mọi input khác ở địa chỉ pot là "UTxO lạc".

### `Feed` — rót LAMP sang két swap (ai cũng gọi)

| mã | nội dung |
|---|---|
| F-0 | không UTxO lạc nào trong input (`Feed` và `Absorb` rời nhau) |
| F-1 | `now = get_epoch_pinned(tx)`: hai cận hữu hạn, xử đúng cận mở, cùng bucket, `hi − lo ≤ 1 giờ`, `lo ≥ 0`, `lo ≤ hi`; và `now > last_window` |
| F-2 | đúng 1 output ở địa chỉ pot, địa chỉ đầy đủ khớp, mang NFT pot, không reference script, datum inline giữ `reserve_hash`, `last_window' = now` |
| F-3 | value pot chỉ ADA + NFT + LAMP; ADA không giảm; `d` = hiệu LAMP thật của pot (KHÔNG do redeemer khai) |
| F-4 | `d > 0`; `drawn_total' = drawn_total + d`; `drawn_total' ≤ total_cap` |
| F-5 | đúng 1 input mang NFT két (két bị tiêu trong cùng tx; redeemer của két là việc của két) |
| F-6 | đúng 1 output mang NFT két, ở đúng `Script(reserve_hash)` không stake credential; `LAMP_két_out − LAMP_két_in = d`; `LAMP_két_out ≤ window_cap` |
| F-7 | không đúc/đốt gì dưới policy pot |

### `Absorb` — hút UTxO lạc vào pot (ai cũng gọi)

| mã | nội dung |
|---|---|
| A-1 | datum output tiếp nối == datum input, y nguyên kể cả `drawn_total` (LAMP trả về KHÔNG hoàn trần) |
| A-2 | đúng 1 output ở địa chỉ pot, địa chỉ đầy đủ khớp, mang NFT pot, không reference script |
| A-3 | ≥1 UTxO lạc trong input; value pot chỉ ADA + NFT + LAMP; ADA pot không giảm; `LAMP_pot_out = LAMP_pot_in + Σ LAMP của mọi UTxO lạc` |
| A-4 | không đúc/đốt gì dưới policy pot |

ADA và token lạ trên UTxO lạc đi theo người dọn (công dọn). Token lạ KHÔNG được
vào pot — A-3 chặn.

### Nhánh UTxO lạc

| mã | nội dung |
|---|---|
| A-STRAY-1 | UTxO pot phải bị tiêu trong cùng tx (ép ở phần chung) ⇒ nhánh pot chạy và ép A-1..A-4 |
| A-STRAY-2 | redeemer của input pot là `Absorb` |
| A-STRAY-3 | redeemer của chính UTxO lạc là `Absorb` |

Nhánh này cố ý KHÔNG lặp lại luật của `Absorb` — luật thật do nhánh của UTxO pot ép.

### `MintPot` — one-shot, cổng duy nhất ép trạng thái khởi tạo

| mã | nội dung |
|---|---|
| M-7 | tham số biên dịch dùng được: `ms_per_epoch > 0`, `window_cap > 0`, `total_cap > 0`, `(lamp_policy, lamp_name) ≠ (own_policy, "")` |
| M-1 | tx tiêu `genesis_ref` |
| M-2 | đúc đúng `{ (own_policy, "") : 1 }` và không gì khác dưới policy này (⇒ mọi số lượng âm bị từ chối ⇒ không có đường đốt) |
| M-3 | đúng 1 output mang NFT, ở đúng `Script(own_policy)` không stake credential, không reference script |
| M-4 | datum inline `PotDatum`: `reserve_hash` dài 28 byte, `drawn_total == 0`, `last_window == -1` |
| M-5 | value output đó chỉ ADA + NFT + (tuỳ) LAMP |
| M-6 | `reserve_hash ≠ own_policy` |

M-7 đặt TRƯỚC M-1..M-5 có lý do đo được: M-5 dựng lại value từ ba thành phần, nên
khi LAMP trùng NFT pot nó tự từ chối trước. Để M-7 ở cuối hàm thì vế "LAMP ≠ NFT
pot" thành một chốt không bao giờ chạy tới.

`last_window` khởi tạo là `-1`, KHÔNG phải `0`: cửa sổ 0 là một cửa sổ THẬT, đặt 0
là tặng sẵn một lượt rót mà `now > last_window` vẫn thoả.

## Đường nạp LAMP vào pot

1. **Lượt đầu, kèm lúc đúc** — M-5 cho phép output đúc mang LAMP sẵn.
2. **Sau đó** — gửi LAMP tới địa chỉ pot với datum gì cũng được (hoặc không datum),
   rồi gọi `Absorb`. Chính đường này là đường két swap trả LAMP về: két đặt
   `pot_return` = địa chỉ pot và gửi kèm datum inline `OutputReference`.

Lượt `Absorb` permissionless: ai gọi cũng được, và người gọi giữ ADA + token lạ của
các UTxO lạc làm công dọn.

## Nghĩa vụ off-chain

- `Feed`: đặt `lo = now_ms`,
  `hi = min(now_ms + ttl, (lo / ms_per_epoch + 1) × ms_per_epoch − 1)` với
  `ttl ≤ 3_600_000`. Phần còn lại của cửa sổ ngắn hơn ttl tối thiểu thì CHỜ sang cửa
  sổ sau, KHÔNG nới `hi` — nới là hai cận rơi vào hai bucket và tx bị từ chối.
- Mọi output tới pot hoặc tới két phải dùng địa chỉ **enterprise** (không stake
  credential). Hàm dựng địa chỉ của thư viện off-chain thường nhận tham số stake
  thứ ba — bỏ trống nó.
- `d` không nằm trong redeemer. Người dựng tx điều khiển `d` bằng cách chọn LAMP của
  output pot; validator suy `d` từ hiệu value.

## Giới hạn đã biết

- **`reserve_hash` ghi một lần, không có đường đổi.** Két swap đổi hash (đổi tham
  số, sửa mã) ⇒ pot hiện tại rót vào hash cũ vĩnh viễn. Đổi két = đúc một pot mới
  (một `genesis_ref` mới) và chuyển LAMP sang bằng đường `Absorb` của pot mới.
- **KHÔNG đặt ô reference script tại địa chỉ pot.** Nhánh `Absorb` cho phép ai cũng
  tiêu một UTxO lạc ở địa chỉ đó và giữ ADA của nó — một ô reference script đặt ở
  đấy là của chùa (mất ADA, mất cả ô script). Chỗ đúng là một địa chỉ native script
  `all[sig <pkh>]` riêng.
- **`drawn_total` chỉ tăng và không có đường hoàn.** LAMP quay về pot qua `Absorb`
  không nới lại trần `total_cap`. Đây là quyết định của kênh, không phải lỗ: trần là
  trần TÍCH LUỸ ĐÃ RÓT, không phải trần số dư.
- **Một `Feed` mỗi cửa sổ.** Lượt bị thiếu không dồn: `last_window' = now`, nên một
  cửa sổ bỏ trống là một hạn mức mất, không phải một hạn mức để dành.
- **Chốt "LAMP ≠ NFT pot" (một vế của M-7) chưa có ca kiểm ghim được.** Nó bị M-5
  chặn hộ ở mọi đường, đo bằng kiểm đột biến: gỡ vế đó thì 0 ca đỏ. Giữ lại vì nó
  đổi một lỗi "value không khớp" khó truy thành một dòng nói đúng nguyên nhân.
- **Pot KHÔNG ép datum của output két.** F-6 chỉ ép NFT két, địa chỉ enterprise
  `Script(reserve_hash)` và lượng LAMP. Hình dạng datum của ô két do chính két ép:
  F-5 buộc tx tiêu input két, nên validator két chạy trong cùng tx và phải tự ghim
  output tiếp nối của nó (datum, địa chỉ). Két nào không ghim output tiếp nối của mình
  thì một lượt `Feed` có thể đặt LAMP vào sân két mà ngoài sổ két. Trước lượt rót
  đầu tiên trên một mạng, phải có một tx `Feed` thật được két tiêu lại thành công.
- **Không lượt spend nào đòi chữ ký.** Cố ý — mọi tài sản đều bị ràng bởi value và
  datum. Hệ quả: ai cũng dựng được `Feed`/`Absorb`, và ai cũng trả phí cho nó.

## Chạy kiểm

`aiken` chỉ in chẩn đoán khi stdout là một terminal thật, nên phải bọc pty:

```
cd onchain
python3 ../../run_with_tty.py aiken check
python3 ../../run_with_tty.py aiken build
```
