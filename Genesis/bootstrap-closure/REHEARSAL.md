# Diễn tập đóng policy LAMP bản mồi — Preprod, 2026-09-27

Mục đích: chạy đúng hai giao dịch sẽ đóng policy mainnet `55d3e01b…180f0`, trên Preprod, bằng
**cùng mã** (thư mục `onchain/` cạnh tệp này), trên một trạng thái dựng lại giống mainnet.
Công cụ: `Genesis/scripts/bootstrap_closure.ts`. Không có giao dịch mainnet nào được gửi.

## 1. Mã dùng trong lượt diễn tập là mã đang chạy mainnet

`aiken v1.1.21+42babe5`, `aiken build` trong `onchain/`, rồi `aiken blueprint apply` từng tham số
(8 tham số mint lấy nguyên `cborHex` trong `Genesis/offchain/src/deployed.ts`):

```
lamp_mint     -> 55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0
supply_state  -> 84f6d84f64468d0b201171ec10c22fd1124ec3fd803e853697b34084
dist_treasury -> d5e80c9a5a885f56b36d915b4353c2e9e6797b38455d11d0014edbb6
```

Cả ba khớp `LAMP_MAINNET.policyId` / `supplyStateHash` / `khoHash`. Đường Lucid (`applyParamsToScript`)
ra cùng ba hash — ghim trong `Genesis/tests/bootstrapClosure.test.ts`, và công cụ in lại ở đầu mọi lệnh:

```
▸ Tái dựng: blueprint đóng băng + 8 tham số deployed.ts ⇒ 55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0 (khớp mainnet)
```

`aiken check` trong `onchain/`: `total 62, passed 62, failed 0`.

## 2. Tham số Preprod

Khác mainnet đúng ở các tham số buộc phải khác; hình dạng giống hệt.

| Tham số | Preprod | Mainnet |
|---|---|---|
| `thread_nft_policy` | `a7baf5fb…` (thread_nft áp genesis_ref `a00ab3de…1fee#1`) | `97213f24…77f0` |
| `thread_nft_name` | `SUPPLY` | `SUPPLY` |
| `token_name` | `4c414d50` ("LAMP") | `4c414d50` |
| `dist_authority` / `auth_threshold` | `[603249ab…5ff5]` / 1 | `[180a5c17…0441]` / 1 |
| `dist_dest` | dist_treasury(authority Preprod) | `d5e80c9a…edbb6` |
| `meter_nft_policy` / `meter_nft_name` | 28 byte 0 / `MET` | 28 byte 0 / `MET` |

Kết quả: policy Preprod `b46d95aac29bb263206ce82344274d282fd56dc848bd586bf38038a1`,
supply_state `addr_test1wq9r4ghwgjxvwy3sxkxdkj0clxjentfc6gp8ruylmefr4pcaqereg`,
kho `addr_test1wzszhqua7ccjw4uawt4w3dkluylrfz9ew7lpl9essm7g0pga977kl`,
lock_vault `addr_test1wq5gl6nh5rm8f3sgp2ka3mfu5skdt2fqhu0spsxnucesdeqxrttf6` (không tham số — cùng hash `288fea77…` mọi nơi).

## 3. Giao dịch Preprod

| Bước | Tx hash | Phí (lovelace) | Kích thước |
|---|---|---|---|
| bootstrap A — thread NFT + SupplyState {0,0,cap,cap} | `8e339b04a33b300b59a389ced14e83ced143b774d9939dbf9397fa4a3f5b3392` | 206 192 | 957 B |
| bootstrap B — DistributionVest 1 000 000 LAMP → kho | `07e03995bf54061b9f3f56769391e26eef20ad3105b980d4b5ce462b64bba052` | 349 602 | 3 378 B |
| **tx1 close-mint** — Δ = 26 369 000 000 000 000 oildrop → kho | `0afeb880b74094c0cef659b0bd01f8992457eebe960c4fca1ee5e85d09e372ac` | **347 671** | 3 378 B |
| **tx2 close-lock** — 2 UTxO kho → 1 output lock_vault | `f2119209d0923088de55f9de9fc8eacb170bb04e412b12492bb24209223fce08` | **197 898** | 800 B |

Sau bootstrap, UTxO kho mang 1 051 640 lovelace + 1e12 LAMP, không datum — đúng từng số với UTxO kho
mainnet `db0610c2…dd35#1` (koios `address_utxos`, cùng ngày).

Đầu vào/đầu ra tx2 (koios `tx_utxos`): vào `07e03995…#1` (1e12) + `0afeb880…#1` (26 369e12) + một UTxO
ví; ra lock_vault `1 099 050` lovelace + `26370000000000000` LAMP, datum inline `d87980`.

## 4. `verify-closed` — output thô

Trước tx1 (đối chứng: cùng bộ dựng giao dịch phải được CHẤP NHẬN khi quota còn):

```
  SupplyState: dist_minted=1000000000000 dist_cap=26370000000000000 ⇒ dist_minted==dist_cap: false
  🔴 DistributionVest 1 oildrop · UPLC cục bộ: ĐƯỢC CHẤP NHẬN
  🔴 DistributionVest 1 oildrop · nút mạng (Ogmios qua Blockfrost): ĐƯỢC CHẤP NHẬN
  ✅ ReserveDraw 1 oildrop · UPLC cục bộ: BỊ SCRIPT TỪ CHỐI — nguyên văn:
     { Complete: "failed script execution Mint[0] the validator crashed / exited prematurely" }
  ⚪ spend lock_vault: KHÔNG ĐO ĐƯỢC — chưa có UTxO LAMP ở lock_vault.
  KẾT LUẬN: CHƯA ĐÓNG — xem các dòng 🔴/⚪/false ở trên.
```

Sau tx2 (mã thoát 0):

```
  SupplyState: dist_minted=26370000000000000 dist_cap=26370000000000000 ⇒ dist_minted==dist_cap: true
               reserve_minted=0 reserve_cap=9630000000000000
  tổng cung on-chain (b46d95aac29bb263206ce82344274d282fd56dc848bd586bf38038a14c414d50): 26370000000000000
  số asset name dưới policy: 1 (4c414d50)
  LAMP ở lock_vault addr_test1wq5gl6nh5rm8f3sgp2ka3mfu5skdt2fqhu0spsxnucesdeqxrttf6: 26370000000000000
  LAMP ở nơi khác: 0 (không địa chỉ nào)
  Phép thử âm (chỉ evaluate, không ký, không gửi):
  ✅ DistributionVest 1 oildrop · UPLC cục bộ: BỊ SCRIPT TỪ CHỐI — nguyên văn:
     { Complete: "failed script execution Mint[0] the validator crashed / exited prematurely" }
  ✅ DistributionVest 1 oildrop · nút mạng (Ogmios qua Blockfrost): BỊ SCRIPT TỪ CHỐI — nguyên văn:
     { Complete: Error: NODE-REJECT: [{"validator":{"index":0,"purpose":"mint"},"error":{"code":3012,"message":"Some of the scripts failed to evaluate to a positive outcome. …","data":{"validationError":"An error has occurred:\nThe machine terminated because of an error, either from a built-in function or from an explicit use of 'error'.\nCaused by: (error)","traces":[]}}}] }
  ✅ ReserveDraw 1 oildrop · UPLC cục bộ: BỊ SCRIPT TỪ CHỐI — nguyên văn:
     { Complete: "failed script execution Mint[0] the validator crashed / exited prematurely" }
  ✅ ReserveDraw 1 oildrop · nút mạng (Ogmios qua Blockfrost): BỊ SCRIPT TỪ CHỐI — nguyên văn:
     { Complete: Error: NODE-REJECT: [{"validator":{"index":0,"purpose":"mint"},"error":{"code":3012, … "Caused by: (error)","traces":[]}}}] }
  ✅ spend lock_vault · UPLC cục bộ: BỊ SCRIPT TỪ CHỐI — nguyên văn:
     { Complete: "failed script execution Spend[0] the validator crashed / exited prematurely" }
  ✅ spend lock_vault · nút mạng (Ogmios qua Blockfrost): BỊ SCRIPT TỪ CHỐI — nguyên văn:
     { Complete: Error: NODE-REJECT: [{"validator":{"index":0,"purpose":"spend"},"error":{"code":3012, … "Caused by: (error)","traces":[]}}}] }
  KẾT LUẬN: ĐÃ ĐÓNG — quota cạn, mọi LAMP ở lock_vault, ba phép thử âm đều bị từ chối.
```

(`…` = phần câu chuẩn của Ogmios lặp lại, đã rút gọn khi chép.) Mã mainnet build ở chế độ trace im
lặng nên lời từ chối không nêu `expect` nào hỏng; nó nói script nào hỏng (`mint`/`spend`, chỉ số 0)
và rằng máy UPLC dừng ở `error`. Lời từ chối DistributionVest chỉ có nghĩa nhờ đối chứng trước tx1:
cùng bộ dựng, cùng số lượng, trước đó được cả hai đường chấp nhận.

Hai điều đã đo được khi dựng phép thử, ghi lại vì cả hai làm phép thử âm xanh mà không đo gì:
- `evaluateTx` của Lucid 0.4.34 với Blockfrost trả `failed to decode payload from base64 or base16`
  cho MỌI giao dịch, kể cả giao dịch hợp lệ. Công cụ gửi CBOR thô tới `/utils/txs/evaluate?version=6`.
- Khuôn v5 mặc định của endpoint đó trả `{"ScriptFailures":{}}` rỗng khi script hỏng. Công cụ dùng
  khuôn v6 và chỉ tính là "bị từ chối" khi mã lỗi là 3010; mọi lỗi khác in ⚪ "không đo được".

## 5. Mainnet — các bước dự kiến (chưa chạy)

Tham số phí mainnet và Preprod giống nhau (koios `cli_protocol_params`, 2026-09-27: `txFeePerByte 44`,
`txFeeFixed 155381`, `priceMemory 0.0577`, `priceSteps 7.21e-05`), và tx mainnet cùng hình dạng, cùng
cỡ script. Ước lượng: **tx1 ≈ 0,348 ADA, tx2 ≈ 0,198 ADA**, cộng ≈ 1,1 ADA min-ADA nằm lại ở output
lock_vault (lấy từ 2 × 1,05 ADA của hai UTxO kho, phần dư về ví). Cần thêm 5 ADA làm collateral (không mất).

1. `aiken build` trong `onchain/`; chạy `bootstrapClosure.test.ts` — phải ra 55d3e01b….
2. Đọc chuỗi (không cần ví): SupplyState `db0610c2…dd35#0` còn `dist_minted = 1e12`; kho chỉ có
   `db0610c2…dd35#1` (1e12 LAMP); không địa chỉ nào khác giữ LAMP. Lệch bất kỳ điểm nào ⇒ dừng.
3. Người giữ khoá `dist_authority` (`180a5c17…0441`) chạy
   `EXPECTED_WALLET_ADDR=<địa chỉ ví đó> NETWORK=Mainnet … tsx bootstrap_closure.ts close-mint --network Mainnet --confirm-mainnet-closure`
   KHÔNG đặt SUBMIT ⇒ công cụ dựng tx1, in phí + CBOR, không gửi. Soát CBOR, rồi chạy lại với `SUBMIT=true`.
4. Cùng cách cho `close-lock`. Công cụ tự dừng nếu `dist_minted ≠ dist_cap` hoặc tổng LAMP trong kho
   khác tổng đã đúc (tức có LAMP nằm ngoài kho).
5. `verify-closed --network Mainnet --confirm-mainnet-closure` — phải in `KẾT LUẬN: ĐÃ ĐÓNG`, mã thoát 0.

Công cụ từ chối `--network Mainnet` khi thiếu `--confirm-mainnet-closure` (`CLOSE-NET-002`), cấm hẳn
`bootstrap` trên Mainnet (`CLOSE-NET-001`), và đòi `EXPECTED_WALLET_ADDR` trên Mainnet (`WALLET-001`, `config.ts`).
