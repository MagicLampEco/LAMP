# ISPO — pot "ISPO redirect" (360.000 nghìn LAMP = 360M LAMP = 1% của 36 tỷ)

Phát **36 epoch × 10.000 nghìn LAMP**. Delegator tự nguyện **redirect %reward-ADA**
(Franken stake-script, tự chọn 0–100%) đổi LAMP; **chủ repo thu ADA**. **DECOUPLED**:
tỉ lệ chỉ phụ thuộc **tổng ADA mỗi pool đã góp** — SPO là *người nhận*, không *gác cổng*.

> LAMP = **oil** (1 LAMP = 10⁶ oil); ADA = lovelace. BigInt tuyệt đối.
> Đây là **tầng off-chain** (engine + Merkle + keeper). On-chain Franken `ispo_stake_script`
> (Rewarding purpose ép tách reward) + `ispo_pot` + `spo_registry` là PR kế.

## Công thức mỗi epoch e (off-chain, tất định, bảo toàn oil)

`Σ_p` = Σ ADA pool p góp; `Σ_all` = Σ Σ_p.

```
LAMP_pool(p)  = floor(LAMP_e · Σ_p / Σ_all)            (góp gấp đôi → gấp đôi LAMP)
spo_bonus(p)  = floor(LAMP_pool · rate_bp(p) / 10000)  (SPO tự đặt, trần MAX_RATE_BP=10%)
LAMP_deleg(p) = LAMP_pool − spo_bonus
entitlement(d)= floor(LAMP_deleg · c_d / Σ_p)          (c_d = ADA delegator d góp)
```

**Vá game-theory (đều có test):**
- **Front-run snapshot:** chỉ đếm contribution `epoch < e` (góp ở e → tính cho e+1).
- **Bait-and-switch:** `rate_bp` chỉ hiệu lực từ `rateEffectiveFromEpoch` (qua cooldown); trước đó 0.
- **SPO không cấu hình/rate:** delegator pool đó **nhận đủ** LAMP_pool (rate 0, không ai ăn bonus).
- **Sybil delegator:** vô hại (chia theo ADA). **Whale:** cap `maxContribLovelace` (tuỳ chọn).
- **Dư floor → contributor ADA lớn nhất** (tie owner hex nhỏ nhất).

**Bất biến/epoch:** `Σ wonThisEpoch + leftover == LAMP_e` (leftover>0 chỉ khi Σ_all=0).
`won_cumulative` cộng dồn ⇒ claim trễ vẫn đủ; leaf Merkle dùng cumulative.

## Cấu trúc

```
Distribution/ISPO/offchain/src/
├── constants.ts    # 360M LAMP, 36 epoch, MAX_RATE_BP, cooldown, merkle prefixes
├── types.ts        # PoolConfig, Contribution, IspoEntitlement
├── distribute.ts   # distributeEpoch + runIspo (∝ ADA, bonus, anti front-run/bait-switch)
├── merkle.ts       # canonical Merkle (byte-perfect onchain merkle.ak)
└── keeper.ts       # snapshot → root postable + claimed_cumulative + gói redeem
Distribution/ISPO/tests/   # merkle + distribute + keeper  (22 test)
```

## Test

```bash
cd Distribution/ISPO/offchain && npm install && npm test   # 22/22 vitest pass
```

## Còn lại (PR kế)

- On-chain Franken: `ispo_stake_script` (stake validator, ScriptPurpose `Rewarding` ép tách
  `redirect_bp%` reward → `ispo_pot`, còn lại về ví) · `ispo_pot` (spend, Collect ADA về
  treasury) · `spo_registry` (NFT POOL-CONFIG, `SetRate` cooldown + cap MAX_RATE).
- Claim permissionless: tái dùng `claim_account` Merkle + `beacon` MerkleRoot (như Airdrop).
- Keeper đọc ADA-góp THẬT trên on-chain + builder Lucid + e2e Preview (cần `.env`).
