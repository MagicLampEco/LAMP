# Faucet v1 server (tLAMP, Preprod)

Stateless HTTP server that builds an **unsigned** Claim transaction for the faucet v1 validator
(`Faucet/onchain/validators/faucet_v1.ak`). Each Claim releases 100 tLAMP from one pool UTxO to the
caller. The client wallet adds its vkey witness (keeping the body bytes unchanged) and submits.
The server never holds keys, never signs, never submits.

Chain data comes from the public Koios Preprod API (`https://preprod.koios.rest/api/v1`, no API key).
The only outbound traffic is HTTPS to that host. The process writes nothing to disk.

## Run

From a checkout of the repository at the pinned commit (Node >= 22):

```sh
cd Faucet/server
npm ci
npm run build
NETWORK=Preprod \
POOL_ADDRESS=addr_test1wp67savr7r5wmccslrfrpaknyr0dt2fqwc06nexzx6yn26sypk9ka \
FAUCET_COMMIT=<commit sha> \
FAUCET_BASE_PATH=/lampfaucet/preprod \
node dist/server/faucetBuild.js
```

The build compiles `server/*.ts` and `../offchain/src/faucetV1.ts` into `dist/`. Running the
TypeScript sources directly (tsx) is not supported: the off-chain module would not resolve
`@lucid-evolution/lucid` from this package.

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `NETWORK` | yes | — | Must be `Preprod`; anything else refuses to start. |
| `POOL_ADDRESS` | yes | — | Faucet pool script address. Its payment credential must equal the hash of the committed script. |
| `FAUCET_COMMIT` | yes | — | Commit being run (1–64 chars `[0-9A-Za-z._-]`); reported by `/health`. |
| `FAUCET_BASE_PATH` | no | `""` | Path prefix the reverse proxy forwards unchanged, e.g. `/lampfaucet/preprod`. Requests without the exact prefix get 404. |
| `FAUCET_REF_UTXO` | no | unset | `<txhash>#<index>` of a UTxO carrying the faucet script as reference script. Unset ⇒ the committed script is attached inline to every transaction. |
| `PORT` | no | `8187` | Listen port. |
| `HOST` | no | `127.0.0.1` | Listen address. |

### Script source

`faucet_v1.preprod.json` is the faucet v1 script with its parameters (tLAMP Preprod policy
`493002cc…`, name `tLAMP`) already applied. It is generated from the Aiken blueprint by
`Genesis/scripts/34_faucet_v1.ts` (`STEP=export-script`) and must not be edited by hand.
At startup the server recomputes the script hash from `compiled_code` and refuses to start unless it
equals both the `script_hash` field and the payment credential of `POOL_ADDRESS`. When
`FAUCET_REF_UTXO` is set, the reference script hash must match as well. The test suite
(`Faucet/tests/faucetServer.test.ts`) fails if the file drifts from the blueprint.

### Startup errors (process exits with code 1)

| Code | Cause |
|---|---|
| `FAUCET-SERVER-001` | `NETWORK` is not `Preprod`. |
| `FAUCET-SERVER-002` | `POOL_ADDRESS` unreadable, not a testnet script address. |
| `FAUCET-SERVER-003` | `FAUCET_REF_UTXO` malformed. |
| `FAUCET-SERVER-004` | `PORT` or `HOST` invalid. |
| `FAUCET-SERVER-005` | `FAUCET_REF_UTXO` not found on chain or carries no reference script. |
| `FAUCET-SERVER-006` | Script hash mismatch (committed file, `POOL_ADDRESS`, or reference script). |
| `FAUCET-SERVER-007` | `FAUCET_BASE_PATH` not empty and not of the form `/a/b`. |
| `FAUCET-SERVER-008` | `FAUCET_COMMIT` missing or invalid. |
| `FAUCET-SERVER-009` | `faucet_v1.preprod.json` not found next to the package (run from `dist/server/`). |

## Endpoints

`GET <base>/health` → `200`

```json
{"commit":"…","network":"Preprod","script_address":"addr_test1wp67…","script_hash":"75e87583…","ref_utxo":null}
```

`POST <base>/faucet/build` with body `{"address":"addr_test1…"}` → `200 {"tx_cbor_hex":"84…"}`

The address must be a Preprod address with a key payment credential, and must hold at least
5 ADA in pure-ADA UTxOs (fee + collateral + min-ADA of the tLAMP output).

### Smoke test

```sh
curl -s http://127.0.0.1:8187/lampfaucet/preprod/health
curl -s -X POST http://127.0.0.1:8187/lampfaucet/preprod/faucet/build \
  -H 'content-type: application/json' -d '{"address":"addr_test1q…"}'
```

Expected: `/health` returns the five keys above; `/faucet/build` returns `tx_cbor_hex` for a funded
key address, or `422 FAUCET-NO-ADA` for an address with no ADA.

### Error responses

All errors are `{"code": "…", "message": "…"}`.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `FAUCET-BAD-REQUEST` | Body is not a JSON object `{"address": …}`. |
| 400 | `FAUCET-ADDR` | Not a Preprod key (payment key) address. |
| 404 | `FAUCET-NOT-FOUND` | Unknown path (check `FAUCET_BASE_PATH`). |
| 405 | `FAUCET-METHOD` | Wrong method (`POST` for build, `GET` for health). |
| 422 | `FAUCET-NO-ADA` | Address lacks pure ADA for fee + collateral. |
| 503 | `FAUCET-EMPTY` | No pool UTxO holds 100 tLAMP; the pool needs a refill. |
| 500 | `FAUCET-INTERNAL` | Server-side failure; the message carries a reference id that appears in the server log. |

## Rate limiting

There is no per-address or per-IP rate limit. tLAMP is a testnet token with no value, the v1
validator has no cooldown by design, and the pool is refilled from the Preprod development pot.
Put a rate-limiting reverse proxy in front if abuse becomes a problem.
