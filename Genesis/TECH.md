# Genesis — TECH (Kiến trúc on-chain Aiken + codec)

**Trạng thái:** draft 2026-06-09. Bám [`CONTRACT.md`](./CONTRACT.md) (interface lazy-mint đã ghim).
KHÔNG định nghĩa lại bất biến (việc của [MATH](./MATH.md)) — TECH mô tả **datum/redeemer byte-perfect,
validator/policy Aiken, từng invariant on-chain map tới dòng code, chống double-satisfaction, và
codec offchain↔onchain**.

> Mọi tham chiếu dòng code: `tlamp_mint.ak`, `thread_nft.ak`, `supply_state.ak` (validators);
> `lib/magiclamp/genesis/{types,constants,util}.ak`; offchain `src/{types,datum,supplyState,
> mintBuilder,circulating,constants}.ts`.

---

## 1. Kiến trúc ba tầng (CONTRACT §3)

```
  Tầng 1: thread_nft(genesis_ref)              policy  — mint one-shot SUPPLY NFT
  Tầng 2: tlamp_mint(thread_policy, SUPPLY,    policy  — mint tLAMP, gate bởi SupplyState
                     dist_auth, res_auth, thr)            TOÀN BỘ luật cap/quota/monotonic ở đây
  Tầng 3: supply_state(tlamp_policy)           spend   — giữ SupplyState UTxO; spend ⟺ Δ>0
```

Phụ thuộc **tuyến tính** (không vòng): (1) chỉ biết `genesis_ref`; (2) chỉ biết policy+name của (1);
(3) chỉ biết policy của (2). Apply params bằng `applyParamsToScript` (`config.ts:72–79`).

---

## 2. Datum schema (byte-perfect)

### 2.1 SupplyState (`types.ak:9–14`)

```
SupplyState {
  dist_minted    : Int,   // oil đã mint qua Distribution
  reserve_minted : Int,   // oil đã mint qua Reserve
  dist_cap       : Int,   // 34_200_000_000_000_000 (hằng qua transition)
  reserve_cap    : Int,   // 1_800_000_000_000_000  (hằng qua transition)
}
= Constr(0, [int, int, int, int])
```

**Constr index = thứ tự khai báo field, từ 0.** Mã hóa Plutus Data:
`121([dist_minted, reserve_minted, dist_cap, reserve_cap])` (tag 121 = Constr 0).

Codec offchain (`datum.ts:44–58`):
- encode: `new Constr(0, [s.dist_minted, s.reserve_minted, s.dist_cap, s.reserve_cap])`.
- decode: ép `c.index === 0` (`datum.ts:50`), `c.fields.length === 4` (`datum.ts:51`), mỗi field
  `typeof === "bigint"` (`asInt`, `datum.ts:36`). Sai → throw `GDATUM-010/011/002`.

Round-trip test: `datum.test.ts` "round-trip object → cbor → object"; reject sai index/field-count/non-int.

### 2.2 Inline datum bắt buộc

On-chain đọc datum qua `util.inline_datum` (`util.ak:67–70`): `expect InlineDatum(d) = o.datum`.
NoDatum / datum-hash → fail. SupplyState output PHẢI inline (`mintBuilder.ts:104` `kind: "inline"`).

Sai kiểu datum (datum rác) → `expect s2: SupplyState` fail: test `garbage_output_datum`
(`tlamp_mint.ak:405`) đặt datum = `42` (Int) → reject.

---

## 3. Redeemer schema (byte-perfect)

| Redeemer | Constr | Code | Offchain |
|---|---|---|---|
| `TLampMintRedeemer::DistributionVest` | `Constr(0, [])` | `types.ak:20` | `MINT_ROUTE.DistributionVest = 0` (`datum.ts:18`) |
| `TLampMintRedeemer::ReserveDraw` | `Constr(1, [])` | `types.ak:21` | `MINT_ROUTE.ReserveDraw = 1` (`datum.ts:19`) |
| `ThreadNftRedeemer::MintGenesis` | `Constr(0, [])` | `types.ak:26` | `threadNftRedeemerToCbor()` (`datum.ts:79`) |
| `SupplyStateRedeemer::Advance` | `Constr(0, [])` | `types.ak:33` | `supplyStateRedeemerToCbor()` (`datum.ts:84`) |

Test byte-perfect: `datum.test.ts` "DistributionVest = Constr(0,[])", "ReserveDraw = Constr(1,[])",
"ThreadNftRedeemer.MintGenesis = Constr(0,[])", "SupplyStateRedeemer.Advance = Constr(0,[])".

`genesis_ref` (param tầng 1) mã hóa offchain: `Constr(0, [txHash, BigInt(index)])` = `OutputReference`
(`01_deploy_lazymint.ts:37–40` `encodeOutputRef`). Khớp `OutputReference{transaction_id, output_index}`.

---

## 4. Tham số validator (apply-time)

### 4.1 thread_nft (`thread_nft.ak:19`)

```
validator thread_nft(genesis_ref: OutputReference)
```

Apply: `applyPolicy(threadRaw, [genesisRef])` (`01_deploy_lazymint.ts:64`).

### 4.2 tlamp_mint (`tlamp_mint.ak:27–33`)

```
validator tlamp_mint(
  thread_nft_policy : PolicyId,
  thread_nft_name   : ByteArray,
  dist_authority    : List<ByteArray>,   // keyhash committee (stub MVP) — đường DistributionVest
  auth_threshold    : Int,               // M-of-N (chỉ DistributionVest)
  meter_nft_policy  : PolicyId,          // ReserveMeter thread NFT — đường ReserveDraw
  meter_nft_name    : ByteArray,
)
```

Gate theo đường mint: DistributionVest = pubkey-sig M-of-N (dist_authority); ReserveDraw = KHÔNG
chữ ký, ÉP tx spend đúng 1 ReserveMeter NFT (permissionless, đi qua reserve_meter — release function).

Apply: `applyPolicy(tlampRaw, [threadPid, SUPPLY_NAME, [pkh], 1n, meterPid, meterNm])` (`01_deploy_lazymint.ts`).
Self-test deploy: cả 2 authority = ví deployer, threshold 1 (1-of-1).

### 4.3 supply_state (`supply_state.ak:21`)

```
validator supply_state(tlamp_policy: PolicyId)
```

Apply: `applyValidator(ssRaw, [tlampPid])` (`01_deploy_lazymint.ts:83`).

---

## 5. Invariant on-chain — map tới dòng code

### 5.1 thread_nft (mint, one-shot)

| Inv | Code | Chặn |
|---|---|---|
| consume genesis_ref | `thread_nft.ak:22` `expect list.any(tx.inputs, fn(i){ i.output_reference == genesis_ref })` | A3 |
| đúng 1 name | `thread_nft.ak:25` `expect util.policy_name_count(tx.mint, policy_id) == 1` | name lạ |
| qty == 1 | `thread_nft.ak:26` `expect assets.quantity_of(tx.mint, policy_id, supply_name) == 1` | qty≠1, burn |
| no else | `thread_nft.ak:30` `else(_) { fail }` | burn / spend nhánh khác |

### 5.2 tlamp_mint (mint, luật chính) — CONTRACT §5 luật 1–8

| Luật | Code | Vector |
|---|---|---|
| 1: đúng 1 input thread | `tlamp_mint.ak:39` `count_inputs_holding_nft(...) == 1` | A2, A7 |
| 1: đúng 1 output thread | `tlamp_mint.ak:40` `count_holding_nft(outputs,...) == 1` | A2 |
| 1: thread không mint/burn | `tlamp_mint.ak:41` `quantity_of(tx.mint, thread, SUPPLY) == 0` | phá thread (`thread_minted_in_tx`) |
| 1: output cùng địa chỉ | `tlamp_mint.ak:47` `s_out.address == s_in.address` | `supplystate_moved_address` |
| datum đúng kiểu | `tlamp_mint.ak:49–50` `expect s/s2: SupplyState` | `garbage_output_datum` |
| 2: Δ > 0 | `tlamp_mint.ak:55` `expect delta > 0` | A6 |
| 3: đúng 1 name tLAMP | `tlamp_mint.ak:56` `policy_name_count(tx.mint, policy_id) == 1` | A11 |
| 4: caps bất biến | `tlamp_mint.ak:59–60` `s2.dist_cap == s.dist_cap ∧ s2.reserve_cap == s.reserve_cap` | A9 |
| 5: cộng đúng quota | `tlamp_mint.ak:65–74` `when r is { DistributionVest -> ... ReserveDraw -> ... }` | A5, A8 |
| 6: monotonic | `tlamp_mint.ak:78–79` `s2.dist_minted >= s.dist_minted ∧ ...` | A4 |
| 7: cap enforce | `tlamp_mint.ak:82–83` `s2.dist_minted <= s2.dist_cap ∧ ...` | A1 |
| 8: authority | `tlamp_mint.ak:87–92` `count_sigs(authority, extra_signatories) >= auth_threshold` | A10 |
| no else | `tlamp_mint.ak:97–99` `else(_) { fail }` | nhánh khác mint |

**Δ là CÙNG biến cho mint + datum** (`tlamp_mint.ak:54` `let delta = util.minted_qty(...)`, dùng lại
ở `:68,71`) → đóng A8 cấu trúc (không thể lệch, MATH §6).

### 5.3 supply_state (spend, tối giản) — CONTRACT §5b

| Inv | Code | Vector |
|---|---|---|
| spend ⟺ Δ > 0 | `supply_state.ak:29–30` `let delta = util.minted_qty(tx.mint, tlamp_policy, tlamp_name); delta > 0` | A12 |
| no else | `supply_state.ak:33` `else(_) { fail }` | spend nhánh khác |

Spend KHÔNG lặp lại luật transition — ủy quyền cho tlamp_mint (một nguồn sự thật). Vì mọi lần
SupplyState bị tiêu PHẢI kèm mint tLAMP, tlamp_mint luôn được kích hoạt → transition luôn được kiểm.

---

## 6. Helper on-chain (`util.ak`)

| Helper | Dòng | Dùng cho |
|---|---|---|
| `minted_qty(mint, policy, name)` | `util.ak:12–14` | Δ (tlamp_mint, supply_state) |
| `count_holding_nft(outputs, p, n)` | `util.ak:17–23` | đếm output mang NFT (qty==1) |
| `count_inputs_holding_nft(inputs, p, n)` | `util.ak:26–32` | đếm input mang NFT |
| `output_holding_nft` / `input_holding_nft` | `util.ak:35–54` | lấy UTxO mang NFT (sau khi count==1) |
| `policy_name_count(v, policy)` | `util.ak:57–59` | `dict.size(assets.tokens(v, policy))` — đúng 1 name |
| `count_sigs(authority, signatories)` | `util.ak:62–64` | M-of-N stub |
| `inline_datum(o)` | `util.ak:67–70` | `expect InlineDatum(d)` |

`policy_name_count` test: `name_count_one`/`name_count_two` (`util.ak:115–126`). `count_sigs` test:
`sigs_count` (2 khớp), `sigs_none` (`util.ak:107–113`).

---

## 7. Chống double-satisfaction

Genesis dùng **đếm chính xác** thay vì "tồn tại ít nhất một":
- Input: `count_inputs_holding_nft == 1` (`tlamp_mint.ak:39`) — đúng MỘT input mang thread NFT. Hai
  SupplyState input → count==2 → fail (`two_supplystate_inputs`, A7).
- Output: `count_holding_nft(outputs) == 1` (`tlamp_mint.ak:40`) — đúng MỘT output recreate.

Vì thread NFT là **singleton on-chain** (one-shot, MATH §5.1), không thể có 2 UTxO mang nó cùng lúc
→ double-satisfaction bị chặn từ gốc (kẻ tấn công không thể "mượn" cùng một SupplyState cho 2 mint).

`policy_name_count == 1` (`tlamp_mint.ak:56`) chặn "nhét thêm asset name lạ cùng policy tlamp"
(A11, `mint_extra_name`) — không cho mượn một mint redeemer để đúc token ngoài tLAMP.

---

## 8. Constants (`constants.ak` ↔ `constants.ts`)

| Hằng | Aiken | TS | Giá trị |
|---|---|---|---|
| oil/LAMP | `oil_per_lamp` (`:7`) | `OIL_PER_LAMP` (`:3`) | `1_000_000` |
| tLAMP name | `tlamp_name` (`:10`) | `TLAMP_NAME` (`:6`) | `#"744c414d50"` ("tLAMP") |
| SUPPLY name | `supply_name` (`:13`) | `SUPPLY_NAME` (`:9`) | `#"535550504c59"` ("SUPPLY") |
| dist_cap | `dist_cap_oil` (`:16`) | `DIST_CAP_OIL` (`:12`) | `34_200_000_000_000_000` |
| reserve_cap | `reserve_cap_oil` (`:19`) | `RESERVE_CAP_OIL` (`:15`) | `1_800_000_000_000_000` |
| total_cap | `total_cap_oil` (`:22`) | `TOTAL_CAP_OIL` (`:18`) | `36_000_000_000_000_000` |

Bất biến hằng kiểm tại compile-time Aiken: `caps_sum_to_total` (`constants.ak:24`),
`total_is_36b_lamp` (`constants.ak:28`). Offchain mirror test: `supplyState.test.ts` "dist_cap +
reserve_cap == 36 tỷ × 10^6".

**Aiken Int = bigint vô hạn** → KHÔNG tràn (`constants.ak:4`). `36e15` oil nằm thừa trong dải an
toàn (`< 2^55`), không lo overflow ngay cả nếu chuyển sang u64.

---

## 9. Tx builder offchain (`mintBuilder.ts`)

`buildMintTx` (`mintBuilder.ts:80–115`) dựng tx lazy-mint khớp luật on-chain:

```
collectFrom([supplyUtxo], Advance)              // spend SupplyState (tầng 3)
.attach.SpendingValidator(supplyStateScript)
.mintAssets({ [tlampUnit]: amount }, route)      // mint Δ tLAMP (tầng 2)
.attach.MintingPolicy(tlampPolicy)
.pay.ToContract(supplyStateAddress, inline(sOut), threadNftValue)  // recreate SupplyState'
.pay.ToAddress(recipient, { [tlampUnit]: amount })                 // Δ → user
.addSignerKey(kh) for kh in authoritySigners                       // T8 gate
```

- `sOut = applyMint(sIn, route, amount)` (`mintBuilder.ts:88`) — **fail-fast offchain** trước
  `.complete()` (tránh tốn phí cho tx chắc reject on-chain).
- Builder KHÔNG mint thread NFT → `tx.mint(thread) == 0` tự nhiên đúng (luật 1, `tlamp_mint.ak:41`).
- Builder KHÔNG gắn chữ ký — chỉ `addSignerKey` để Lucid đòi ví ký (caller cấp khóa thật).
- Output SupplyState' giữ lại thread NFT (`threadNftAssets`, `mintBuilder.ts:68–73`) tại CÙNG địa
  chỉ script (luật 1, `tlamp_mint.ak:47`).

**Duck-type Constr** (`datum.ts:24–34`): tránh lỗi `instanceof` khi 2 bản `@lucid-evolution/lucid`
khác class identity (offchain vs scripts) — kiểm `index: number` + `Array.isArray(fields)`.

---

## 10. Circulating (`circulating.ts`)

`circulating(s, pots)` (`circulating.ts:25–39`): `M(s) − Σ pot.held`. Ép `held ≥ 0`
(`:28`, throw `GCIRC-001`) + `Σ held ≤ M(s)` (`:33`, throw `GCIRC-002` — bất khả thi custody giữ hơn
đã mint). Reserve KHÔNG là pot (quota ẢO chưa mint, không trong `M(s)`).

---

## 11. Bảng mã lỗi offchain (truy vết)

| Mã | Nơi | Nghĩa |
|---|---|---|
| `GDATUM-000/002/010/011` | `datum.ts` | decode SupplyState sai (Constr/int/index/field-count) |
| `GMINT-001` | `supplyState.ts:43` | Δ ≤ 0 (no burn/no-op) |
| `GMINT-010/011` | `supplyState.ts:48,58` | vượt dist_cap / reserve_cap |
| `GMINT-020/021/022` | `supplyState.ts:69,72,75` | audit: minted âm / dist>cap / reserve>cap |
| `GMB-001` | `mintBuilder.ts:63` | SupplyState UTxO thiếu inline datum |
| `GCIRC-001/002` | `circulating.ts:30,34` | pot held âm / Σ held > minted |
