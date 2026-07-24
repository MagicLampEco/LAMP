# Treasury — deploy scripts (Cardano Preview)

Apply-params + seed (bootstrap) MỘT custody instance của Treasury. Mẫu theo
`Distribution/scripts`. KHÔNG đụng `onchain/` hay `offchain/src` (đã chốt).

## Điều kiện

- `onchain/plutus.json` phải có 4 validator (`custody`, `custody_seed`, `registry`,
  `registry_beacon`). Nếu thiếu → chạy `aiken build` trong `Treasury/onchain/` trước.
- `node_modules` đã link `@magiclamp/treasury-sdk` (→ `../offchain`) +
  `@magiclamp/protocol-utils`. Nếu trống → `npm install`.

## Chạy

```bash
cd Treasury/scripts
npm install            # nếu node_modules trống
npm run seed           # = npx tsx 01_seed_custody.ts
```

### Hai chế độ (tự nhận theo .env)

- **DRY** (thiếu `BLOCKFROST_KEY` / `PRIVATE_KEY`): apply-params + dựng `planSeed`
  (tự kiểm `seedDatumOk`) + in `seed_policy` / `custody hash` / `custody address` /
  datum CBOR. KHÔNG cần mạng. Đủ để kiểm hash/address/datum.
- **LIVE** (đủ credential): thêm bước `buildSeedTx` dry-run — `.complete()` build tx
  thật NHƯNG **KHÔNG submit** (ký + submit thủ công sau khi duyệt).

## Env

Xem `.env.example`. Tối thiểu để LIVE: `BLOCKFROST_KEY` + (`PRIVATE_KEY` hoặc
`WALLET_SEED`) + `NETWORK=Preview`. DRY mode không cần gì (dùng default dev +
placeholder).

## Output

`seeded.json` — `{ instanceId, custodyHash, custodyAddress, seedPolicy,
proposalPolicy, genesisRef, datumCbor, dryRun }`. PlatformKit `03_onboard_platform.ts`
đọc `seedPolicy` + `custodyHash` từ đây (hoặc tự apply lại).

## Thứ tự dependency (apply-params)

1. `custody_seed(genesis_ref)` → `seed_policy = mintingPolicyToId(custody_seed)`.
2. `custody(proposal_policy, seed_policy, ms_per_epoch)` → custody hash/address.

`custody` cần `seed_policy` ⇒ apply `custody_seed` TRƯỚC.
