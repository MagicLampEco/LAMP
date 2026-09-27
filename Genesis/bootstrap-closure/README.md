# bootstrap-closure — mã đóng băng của policy LAMP bản mồi

Thư mục này giữ **bản sao nguyên văn** mã on-chain đang chạy trên mainnet cho policy LAMP bản mồi
`55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0`, để dựng lại đúng byte và diễn tập việc
đóng policy đó. **Không sửa logic ở đây** — sửa một ký tự là ra một policy khác.

| Tệp trong `onchain/` | Lấy từ commit | Ghi chú |
|---|---|---|
| `aiken.toml`, `aiken.lock`, `lib/magiclamp/genesis/*.ak` | `457f312` | stdlib `v3.1.0` |
| `validators/lamp_mint.ak`, `supply_state.ak`, `thread_nft.ak` | `457f312` | 8 tham số mint |
| `validators/dist_treasury.ak` | `60f7e3a` | kho `dist_dest`, tham số authority |
| `validators/lock_vault.ak` | `098de98` (không đổi tới `1db6b58`) | spend luôn `False`, không tham số |

Cả thư mục trùng từng byte với cây `60f7e3a:Genesis/onchain` (đối chiếu bằng `cmp` lúc chép).

## Tái dựng và đối chiếu hash

```
cd Genesis/bootstrap-closure/onchain && aiken build        # aiken v1.1.21; cần TTY, xem Distribution/run_with_tty.py
cd Genesis/offchain && npx vitest run ../tests/bootstrapClosure.test.ts
```

Bộ kiểm áp 8 tham số trong `Genesis/offchain/src/deployed.ts` (`LAMP_MAINNET.mintParams`) vào
blueprint ở đây và đòi ra đúng `LAMP_MAINNET.policyId`, `supplyStateHash`, `khoHash`. Công cụ
`Genesis/scripts/bootstrap_closure.ts` chạy lại đúng phép kiểm đó ở đầu MỌI lệnh, mọi mạng.
Đường thứ hai, không qua Lucid: `aiken blueprint apply` từng tham số lên `onchain/plutus.json`
(lệnh + kết quả thô ở `REHEARSAL.md`). Đối chiếu với bytecode THẬT trên chain thì dùng
`bash Genesis/scripts/verify_deployed_bytes.sh` — tệp đó dựng từ chính commit gốc, không từ thư mục này.

## Đóng policy

Hai giao dịch, do khoá `dist_authority` ký:

1. `close-mint` — DistributionVest đúc nốt `dist_cap − dist_minted` vào kho ⇒ `dist_minted == dist_cap`,
   chốt `s2.dist_minted <= s2.dist_cap` của `lamp_mint` chặn mọi lần đúc sau.
2. `close-lock` — tiêu mọi UTxO kho mang LAMP, gom vào MỘT output ở `lock_vault`.

ReserveDraw đã chết từ lúc deploy (`meter_nft_policy` = 28 byte 0). Lượt diễn tập và các bước mainnet:
`REHEARSAL.md`.

**Đã đóng trên mainnet 2026-09-27** — hai tx và output `verify-closed`: `REHEARSAL.md` §5.
