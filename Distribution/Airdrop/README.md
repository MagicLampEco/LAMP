# Airdrop — pot "Airdrop 20:100" (120.000 nghìn LAMP = 120M LAMP = 0,33% của 36 tỷ)

Phát **5 epoch × 24.000 nghìn LAMP**, mỗi epoch chia **20:100** → SPO 4.000 nghìn +
Delegator 20.000 nghìn. Phân phối **theo tỉ lệ stake** (chống Sybil tách pool), claim
**permissionless bằng Merkle proof** đối chiếu root committee post mỗi epoch (§6.2).

> Mọi tiền tính bằng **oil** (1 LAMP = 10⁶ oil). BigInt tuyệt đối (C-OVERFLOW).
> Đây là **tầng off-chain** (split + distribution engine + Merkle). On-chain `airdrop_registry`
> (đăng ký pool) + claim validator là PR kế (tái dùng claim_account marker + beacon root).

## Thuật toán mỗi epoch (off-chain, tất định, bảo toàn oil)

`S_p` = Σ stake delegator trong pool p (chỉ pool ĐÃ đăng ký); `S_tot` = Σ S_p.

```
Delegator d ở pool p:  floor(B_del · s_d / S_tot)     (pro-rata stake TOÀN CỤC)
SPO của pool p:        floor(B_spo · S_p / S_tot)      — CHỈ khi pool đủ tư cách:
                       (sản xuất block trong epoch) ∧ (S_p ≥ floor_stake)
```

- **Sybil tách pool vô hại:** SPO chia theo `S_p/S_tot` → tách đôi pool ⇒ mỗi nửa nhận nửa, tổng không đổi.
- **Pool không đủ tư cách:** phần SPO của nó **forfeit → leftover** (về treasury), KHÔNG chia lại
  (giữ trung lập + chống "mượn block" thông đồng).
- **Dư floor:** Delegator → ví stake lớn nhất; SPO (trong nhóm eligible) → pool eligible stake lớn nhất.
  Tie → owner hex nhỏ nhất (tất định).
- **`won_cumulative` cộng dồn** qua epoch → claim trễ vẫn đủ; leaf Merkle dùng cumulative.

**Bất biến/epoch:** `Σ wonThisEpoch + leftover == B_spo + B_del`. Toàn pot: `Σ_epoch == 120M LAMP`.

## Merkle (tái dùng canonical, byte-perfect onchain merkle.ak)

```
leaf = blake2b256( 0x00 ‖ owner_pkh ‖ won_cumulative[be8] )
node = blake2b256( 0x01 ‖ min(a,b) ‖ max(a,b) )          (sorted-pair, RFC-6962)
```

`@noble/hashes/blake2b`; sort leaf theo hash ⇒ cây tất định; tầng lẻ carry-up.

## Cấu trúc

```
Distribution/Airdrop/offchain/src/
├── constants.ts    # budget 120M LAMP, 5 epoch, split 20:100, merkle prefixes
├── types.ts        # PoolRegistration, DelegatorStake, EpochSnapshot, AirdropEntitlement
├── split.ts        # splitEpoch (20:100) + bất biến ngân sách
├── distribute.ts   # distributeEpoch + runAirdrop (fold cumulative + Merkle mỗi epoch)
├── merkle.ts       # canonical Merkle (root + proof + verify)
└── keeper.ts       # snapshot → root postable + claimed_cumulative + gói redeem
Distribution/Airdrop/tests/   # merkle + split + distribute + keeper  (29 test)

Distribution/Airdrop/onchain/                       # Aiken Plutus V3
├── lib/magiclamp/airdrop/merkle.ak   # Merkle verify canonical (xcheck off-chain)
├── lib/magiclamp/airdrop/types.ak    # Registration + Claim/Beacon/Treasury datum
├── lib/magiclamp/airdrop/util.ak     # helpers (epoch, script, sig, NFT, value)
├── validators/airdrop_registry.ak    # mint registration-NFT (deadline epoch, 1/pool)
├── validators/claim_account.ak       # Claim (committee) + Redeem (Merkle proof) — audited
├── validators/beacon.ak              # committee post MerkleRoot mỗi epoch — audited
└── validators/treasury.ak            # release LAMP đúng delta redeemed — audited
```

## Test

```bash
cd Distribution/Airdrop/offchain && npm install && npm test   # 29/29 vitest pass
cd Distribution/Airdrop/onchain && aiken check                # 34/34 aiken pass
```

`leaf_hash_xcheck_offchain` (aiken) pin giá trị từ `merkle.ts` ⇒ Merkle **byte-perfect**
giữa on-chain và off-chain.

## On-chain

**`airdrop_registry`** — SPO mint 1 NFT `name = pool_id` vào registry script +
`RegistrationDatum{pool_id, reward_owner, epoch_registered}`. Luật: đúng 1 token (chặn
token ẩn) · 1 output registry · cửa sổ `[open, deadline]` (mở 1/7, hạn epoch 4 — từ chối
sau hạn) · `epoch_registered == current` · SPO ký. NFT **bất biến** (`else fail`).

**Claim stack** (`claim_account` + `beacon` + `treasury`) — TÁI DÙNG nguyên cơ chế lottery
**đã audit** (single in/out theo script-hash chống double-satisfaction C1/C2; value bảo
toàn C-VAL-0; ADA-drain M1). Luồng: committee `Claim` đặt trần `claimed_cumulative` (=
entitlement snapshot) + post `MerkleRoot` lên `beacon` mỗi epoch → owner `Redeem`
**permissionless** (Merkle proof của `won_cumulative` đối chiếu root) → `treasury` release
đúng delta `redeemed_cumulative`. `redeemed_cumulative` cộng dồn chống double-redeem.

## Tham số đổi được (tầng vận hành, không strand LAMP)

`floorStake`, ngân sách epoch (qua `splitEpoch(budget)`), `epochRegistered`, hạn đăng ký —
tham số keeper/committee, đổi được; entitlement tính lại + post root mới, KHÔNG đụng policy LAMP.

## Còn lại (PR kế)

- Builder Lucid + script deploy/e2e Preview: apply params 4 validator → genesis (mint
  beacon NFT + treasury fund) → keeper post root → committee Claim → 1 SPO + 1 delegator
  Redeem thật → lấy evidence tx (cần `.env`: BLOCKFROST_KEY + ví Preview).
- Keeper đọc stake snapshot THẬT từ Blockfrost/Koios (hiện `EpochSnapshot` nhận từ caller).
- Datum/redeemer codec off-chain (mirror types.ak) cho builder.
