# LAMP — Thứ tự thực thi (overlay lên DEV-DEPLOYMENT-PLAN)

> File này KHÔNG thay `DEV-DEPLOYMENT-PLAN.md`. Plan đó là **task card + DoD** (cái gì + xong khi nào).
> File này là **điều phối**: *thứ tự build*, *critical path*, *cái gì chặn cái gì*, *cái gì làm song song được ngay*.
> Lý do tách: plan liệt kê theo milestone `M0→M5`, nhưng đó **không** phải thứ tự thực thi tối ưu — vài deliverable trong plan **chưa có code** trên nhánh, vài cái **đã code-ready**.

---

## 1. Đối chiếu Plan ↔ Code thực tế (`feat/lamp-allocation`)

| Task | Trạng thái code trên nhánh | Sẵn sàng deploy? |
|---|---|---|
| **T0** Submit backend | ❌ `scripts/launch/submit.ts` **chưa tồn tại** (chỉ có nháp `launch_did_mint.ts` ở worktree cũ) | Phải viết mới |
| **T1** Migration GreenSun-DID | ✅ validators có (`did_token_mint.ak`, `lamp_mint.ak`, `mint_registry.ak`, `supply_state.ak`); ⚠️ `ALLOCATION-SPEC §8` policy-id = `<TBD>` | Chặn bởi external (HSM / root DID / `feat/registry-mint-builders`) |
| **T2** ETD | ✅ **Đã implement** (`Distribution/ETD/` — `dripB`, `entitlement`, tests) | **Sẵn sàng — chỉ thiếu deploy + redeem Preview** |
| **T3** Airdrop 20:100 | ❌ validator `airdrop_registry` + keeper **chưa có** | Phải build mới |
| **T4** ISPO Franken | ❌ `ispo_stake_script` / `ispo_pot` / `spo_registry` + keeper **chưa có** | Phải build mới |
| **T5** Reserve gate-Treasury | ⚠️ Treasury có `custody`/`collect`/`release`/`registry`, **nhưng validator Reserve gate-mức (auto-mint permissionless) chưa có**; đụng MAGIC `SnapshotGen` | Phải build mới + cross-repo |

**Kết luận:** chỉ **T2 (ETD)** đã code-ready. **T0/T3/T4/T5** là code mới. **T1** đã có on-chain nhưng bị chặn ngoài.

---

## 2. Critical path & phụ thuộc (DAG)

```
                    ┌─ [CHẶN: anh chốt §5 của DEV-DEPLOYMENT-PLAN] ─┐
                    │                                               │
T0 (submit backend) ┴─► T1 (genesis mainnet) ─► điền policy-id thật vào ALLOCATION-SPEC §8
   │  (dry-run preprod)      │ cần: HSM PhoenixKey + root OrgDID mainnet + feat/registry-mint-builders
   │                         └────────► (mọi pot muốn lên mainnet mới có policy-id thật để tham chiếu)
   │
   ├─► T2 (ETD)        ── độc lập, chạy NGAY trên Preview ──┐
   ├─► T3 (Airdrop)    ── build mới, độc lập T1 ────────────┤  TẤT CẢ test trên Preview
   ├─► T4 (ISPO)       ── build mới, độc lập T1 ────────────┤  bằng tLAMP (02_mint_test_lamp.ts),
   └─► T5 (Reserve)    ── build mới + cross-repo MAGIC ──────┘  KHÔNG cần policy-id mainnet
```

- **Nút cổ chai mainnet duy nhất = T1.** Nó sinh ra LAMP policy-id thật mà `§8` đang để `<TBD>`. Nhưng T1 **bị chặn bởi external** (HSM PhoenixKey, root OrgDID mainnet, builder ở nhánh `feat/registry-mint-builders` chưa merge).
- **T2–T5 KHÔNG cần chờ T1** — test/redeem chạy trên **Preview với tLAMP**. Đây là phần song song được ngay.
- **T0 là tiền đề của T1** (cùng submit-engine) → vừa là việc đầu tiên, vừa unblock M1.

---

## 3. Blocker cần CHỐT trước (từ §5 của DEV-DEPLOYMENT-PLAN)

| # | Blocker | Chặn | Ưu tiên |
|---|---|---|---|
| 1 | Blockfrost **preprod key** + ai chạy verify testnet | T0 dry-run | **Tuần này** |
| 2 | LAMP nhận DID `Service` hay giữ `Org` (Platform-DID) | T1 datum gate (byte-perfect) | **Tuần này** |
| 3 | Hàm `f(parked, C)` (trần 2% ↔ sàn 1%) + mức `keeper_fee` | T5 (là test-vector normative — không có thì T5 vô DoD) | Trước Sprint D |
| 4 | Chấp nhận đụng `SnapshotGen` (T16, repo MAGIC) đọc beacon-cap | T5 cross-repo | Trước Sprint D |

---

## 4. Trình tự thực thi đề xuất (theo nhịp dev, KHÔNG theo số M)

### Sprint A — "Mở khoá song song" (bắt đầu ngay, không chờ mainnet)
- **A1 · T2 ETD** — deploy `claim_account` (vesting B, D=1) lên Preview, redeem thật, verify `on-chain redeemed == off-chain vested`, bất biến `Σ Eᵢ + leftover == 12.000 nghìn`. *Quick-win: code đã có, test xanh — chỉ thiếu evidence tx.*
- **A2 · T0 submit backend** — viết `scripts/launch/submit.ts` (fetch Blockfrost → evaluate-patch ExUnits `POST /utils/txs/evaluate` → submit → poll) + unit test patch-ExUnits từ 1 CBOR mẫu. *Chặn bởi blocker #1.*

### Sprint B — "Mainnet genesis" (sau A2 xanh + chốt #2 + external sẵn sàng)
- **B · T1** — chuỗi `B1→B2→B3→B4→C` trên mainnet, ký bằng controller GreenSun (sinh trắc), **retire seed bootstrap**, điền policy-id thật vào `ALLOCATION-SPEC §8`. *Điểm không thể đảo ngược — dry-run preprod canonical (M0) phải pass 100% trước.*

### Sprint C — "Pot phân phối cộng đồng" (build mới, song song B nếu đủ người)
- **C1 · T3 Airdrop** — validator `airdrop_registry` + keeper snapshot→Merkle→beacon, tái dùng `claim_account` Merkle/marker. Vá Sybil (sàn stake + block/epoch) + test negative.
- **C2 · T4 ISPO** — `ispo_stake_script` (Franken reward-only) + `ispo_pot` + `spo_registry` + keeper ADA→Merkle. Vá front-run + bait-switch (cooldown).

### Sprint D — "Reserve tự động" (sau khi chốt #3/#4)
- **D · T5** — Reserve gate-mức-Treasury (trần 2% / sàn 1% circulating) + thưởng-keeper + keeper-beacon-C + `SnapshotGen` đọc beacon-cap. *Đụng MAGIC repo → đồng bộ lịch với dev MAGIC.*

---

## 5. Bàn giao — vẫn theo §3 của DEV-DEPLOYMENT-PLAN

Mỗi task = **1 nhánh + 1 PR**; DoD đo được; **evidence tx Preview/preprod link cexplorer trong PR body**; đồng bộ interface 2 phía (`aiken ↔ ts`); README vận hành.
