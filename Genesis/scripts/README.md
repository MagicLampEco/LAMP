# Genesis lazy-mint — deploy Preview

Deploy + mint thử lazy-mint tLAMP trên Cardano Preview. Mặc định **SUBMIT=false**
(build tx + eval script + in CBOR, KHÔNG gửi chain — an toàn, kiểm logic trước khi
tốn tADA).

## Chuẩn bị

`.env` ở repo root (`../../.env`):

```
NETWORK=Preview
BLOCKFROST_KEY=preview...        # https://blockfrost.io
WALLET_SEED="word1 word2 ..."    # HOẶC PRIVATE_KEY=ed25519_sk... (ví testnet)
```

Ví cần ≥ 10 tADA (faucet: https://docs.cardano.org/cardano-testnet/tools/faucet).

## Chạy

```bash
npm install
npm run deploy                  # SUBMIT=false — build + eval, KHÔNG gửi
SUBMIT=true npm run deploy       # gửi thật lên Preview
```

## Luồng (3 tầng tuyến tính — CONTRACT §3)

1. `thread_nft` policy = apply(genesis_ref) — one-shot SUPPLY NFT (đảm bảo SupplyState DUY NHẤT).
2. `lamp_mint` policy = apply(thread_pid, SUPPLY, [auth], [auth], 1) — gate cap/quota.
3. `supply_state` spend = apply(tlamp_pid) — giữ SupplyState UTxO.

- **Tx A**: consume genesis seed → mint 1 SUPPLY NFT → tạo SupplyState UTxO (dist_minted=0).
- **Tx B**: spend SupplyState (Advance) + mint Δ tLAMP (DistributionVest) → recreate
  SupplyState' (dist_minted += Δ) + trả Δ cho ví. Authority stub = ví deploy (1-of-1).

`TEST_MINT_OIL` (env, mặc định 100_000_000 = 100 tLAMP) — lượng mint thử ở Tx B.
