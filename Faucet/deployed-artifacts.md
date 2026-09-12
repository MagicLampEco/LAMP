# Faucet tLAMP — DEPLOYED ARTIFACTS (Preview + Preprod)

> ⚠️ **Tệp này là ẢNH CHỤP tại thời điểm ghi, KHÔNG phải trạng thái đang sống.** Số dư pool ở
> dưới đúng cho lượt claim được ghi, không đúng cho hôm nay: faucet nhả theo lượt, nên **mỗi
> lượt claim đổi cả số dư lẫn UTxO của pool**. Muốn biết trạng thái thật thì **tra theo địa chỉ
> pool**, đừng đọc số ở đây. Vế UTxO cũng vậy — xem cảnh báo trong `scripts/deployed-faucet.*.json`.

> ⚠️ **Policy id trong tệp này KHÔNG phải nguồn.** Nguồn duy nhất cho "mạng nào đang dùng policy
> nào, và bản nào đã bị thay": `Genesis/offchain/src/lampPolicies.ts`. Đọc bằng hàm
> `activeLampPolicyId(network)` — nó NÉM khi mạng chưa có bản `ACTIVE`, thay vì trả một giá trị
> trông hợp lệ. Đừng chép policy id sang repo khác.

> Cập nhật 2026-07-14, soát lại 2026-09-11. **Faucet nhả tLAMP đúc bởi `lamp_mint`**
> (registry-gate + A-DEST), KHÔNG còn dùng token one-shot *fixed-supply* của bản đầu. Lý do:
> token one-shot đó khác policy → validator hệ (Distribution / Treasury custody / Governance)
> từ chối, và KHÔNG test được Reserve-Treasury. Faucet param `(policy, name)` rồi khoá cứng
> 100/claim ⇒ token tới từ đâu không quan trọng; nạp pool bằng tLAMP đúc từ `lamp_mint`
> (redeem từ kho `treasury.ak`) là đủ.
>
> Chữ **"CANONICAL"** ở bản trước đã gỡ: policy đang nhả là `7a1a7aed…`, nay mang trạng thái
> **SUPERSEDED** trong sổ `Genesis/offchain/src/lampPolicies.ts`.

## tLAMP `7a1a7aed…` — bản ĐÃ BỊ THAY, đang còn chạy

> ⚠️ **Con số dưới đây KHÔNG phải nguồn.** Nguồn duy nhất: `Genesis/offchain/src/lampPolicies.ts`.
> Trạng thái bản này: **SUPERSEDED** — bị thay bởi bản ghi `preprod-oneshot-12param`
> (`d9c09230…`), và cả hai đang chờ bản `preprod-oneshot-14param` / `preview-oneshot-14param`
> đúc lại theo đường registry-gate 14 tham số. Đo lại:
> `cd Genesis/offchain && npx vitest run ../tests/lampPolicies.test.ts` — đọc ở **dòng tổng kết
> `Tests N passed`**, không đọc ở mã thoát của một đường ống. Bài
> `"mạng chưa có bản ACTIVE nào"` khẳng định `activeLampPolicyId("preprod")` **NÉM**, không rơi
> ngược về giá trị dưới đây.

- **Policy id:** `7a1a7aed5ec47acc37b6fa82695c1219bf76895b505b01161367adf9`
- **Unit:** `7a1a7aed5ec47acc37b6fa82695c1219bf76895b505b01161367adf9744c414d50`
- Asset name: `744c414d50` ("tLAMP"), decimals 6 (1 tLAMP = 10^6 oildrop).
- Policy GIỐNG NHAU xuyên mạng vì cả bốn khe marker của `lamp_mint` đều neo bởi native-sig ví
  deploy (`Genesis/scripts/canonical_mint.ts:109-123`), không phải one-shot genesis-ref.
  ⇒ Preprod và Preview cùng 1 policy + cùng faucet address.
- **Cái "chung cả 2 mạng" đó là TRIỆU CHỨNG, không phải tiện lợi.** Native-sig không one-shot:
  người giữ khoá ví deploy đúc lại SUPPLY NFT lượt hai ⇒ SupplyState thứ hai với `dist_minted`
  = 0 ⇒ đúc lại trọn cap; và đúc MET giữ ở ví ⇒ nhánh `ReserveDraw` thoả mà không validator nào
  chạy. Nguyên văn hệ quả: `Genesis/scripts/_guards.ts:52-56`. Validator thì đúng là
  registry-gate + A-DEST — nhưng câu "registry-gate" một mình che mất đúng vế này.
- Bản thay thế (`d9c09230…`) đúc marker bằng `oneshot_nft.ak` neo `genesis_ref` `525b80f4…e301#1`;
  lượt đúc SUPPLY NFT thứ hai **bị chặn** (`Genesis/scripts/canonical-v2-state.json`,
  khối `oneshotProof`).
- **Faucet pool address (cả 2 mạng):** `addr_test1wq5kway3ng4amxt47l2ugk7h0cvr7zyfp706uacqqmqcg7sg80hqc`
- Faucet hash: `296774919a2bdd9975f7d5c45bd77e183f08890f9fae770006c1847a`
- claim_amount: **100 tLAMP/claim**, permissionless on-chain — pool đang sống là **bản v1**
  (`faucet.ak`, datum chỉ có `claim_amount`, không POOL NFT). Đường dựng tx đúng cho nó là
  **`offchain/src/claimBuilder.ts`**.
  > ⚠️ **KHÔNG phải `claimDidBuilder.ts`.** Tệp đó là **Faucet v2**: drip **1001** tLAMP và bắt
  > buộc claimer mang một UTxO chứa **DID NFT** (`claimDidBuilder.ts:1,7`). Pool v1 đang sống
  > không có POOL NFT và datum chỉ có một trường ⇒ `buildClaimDidTx` **chết ngay ở offchain,
  > trước khi dựng nổi tx**: `decodeFaucetConfig` ném `FAUCET-DATUM-031: FaucetConfig expects
  > 3 fields, got 1` (`offchain/src/datum.ts:64`, gọi từ `claimDidBuilder.ts:103`). Lỗi này
  > may là lỗi kêu thành tiếng — nhưng nó không nói "bạn đang dùng nhầm bản", nên vẫn tốn một
  > vòng dò. Dòng này trước đây gộp hai thiết kế vào một câu, nên người đọc đi thẳng vào v2 và tắc.

## Preprod
- Seed pool tx: `51f8944d795f874791fd11375fe8441f5e12894f75053fae7718af36d153a4c7` (9.000 tLAMP)
- Claim thử (verify): `d6570a366fa0d4e182bea46147ca56d73cd554bc6ef0b0a5dace76e6179b8277` (pool 9000→8900)
- State file: `scripts/deployed-faucet.preprod.json`
- Canonical genesis+mint: xem `Genesis/scripts/canonical_mint.ts` + `canonical-state.json`

## Preview
- Seed pool tx: `6a375e47d0c3cbcff696f3d71be7915bba42bd44a713c48df17f82a6456d144f` (9.000 tLAMP)
- Claim thử (verify): `4697f89978952fd5fc0afa9558b664e249a3249b2b042f6f9dd44c7ab1f1eea0` (pool 9000→8900)
- State file: `scripts/deployed-faucet.preview.json`
- Canonical mint→kho: `9da1f1248cb718531c23818ff56da5b8aad69abaf19bddbf69418c2bad6e667c`
- LƯU Ý pollution: mạng Preview có nhiều thread/beacon từ các run genesis cũ (native-sig re-mintable).
  Release phải chọn beacon `drop_value` LỚN NHẤT (xem `Distribution/scripts/fix_beacon_redeem.ts`).

## Nạp lại pool (refill) khi cạn
Pool nhả 100/claim, cạn dần. Refill = mint canonical thêm vào kho → release qua claim_account
→ FOUNDATION → `seed_canonical_pool.ts` nạp tiếp. KHÔNG có đường "rút bụng" (faucet.ak anti-drain).
Đường trích tLAMP khỏi kho BẮT BUỘC qua claim_account redeem (đúng thiết kế treasury.ak).

## Faucet v2 (faucet_pool / faucet_account) — CHƯA deploy canonical

Bản đang sống ở trên là **v1 `faucet.ak`**, param `(tlamp_policy, tlamp_name)` — **KHÔNG có
`ms_per_epoch`**. Pool/account của v2 chỉ tồn tại trong các run demo (`scripts/demo_faucet_v2.ts`
đúc POOL NFT one-shot từ 1 UTxO ví chọn lúc chạy, ghi ra `demo-faucet-v2-out.json` — gitignored),
KHÔNG có state file canonical.

⇒ Sửa `ms_per_epoch` về đúng per-network (Preview 86_400_000, không phải 432_000_000) **không
mồ côi deployment nào đang sống**. Trước đây off-chain nạp 432_000_000 cho Preview (số của
Preprod/Mainnet): lệch 5× nhưng tx vẫn pass vì validator nhận cùng số ⇒ `COOLDOWN = 36 epoch`
chạy thành 180 ngày, `RECLAIM = 1001 epoch` thành ~13,7 năm. Cổng gác
`assertMsPerEpochMatchesNetwork` (`FAUCET-EPOCH-001`) chặn lần nạp sai kế tiếp.

## Reserve-Treasury (ngoài phạm vi faucet)
- Faucet cho dev token canonical để test **downstream**: transfer, claim Distribution, **nạp Treasury custody**, vote.
- **ReserveDraw** (mint E/1000 từ reserve) là hành vi NHÀ PHÁT HÀNH (cần reserve meter/thread NFT +
  `reserve_gate`), KHÔNG phải hành vi người cầm token → test qua `Faucet/scripts/demo_reserve_e2e.ts`,
  không qua faucet. Cùng token `7a1a7aed` — **bản SUPERSEDED**, xem sổ
  `Genesis/offchain/src/lampPolicies.ts`.

## DEPRECATED (one-shot fixed-supply — KHÔNG dùng)
- Preprod one-shot `59113c3e32d4dd3dc9b6c4fbed134fabbd37353f839df80c357f72dd` — bỏ.
- Preview one-shot `770a518de374f4db9c854af3fc93f125c30afd8d658ab586a2eb655e` — bỏ.
- Token sig cũ (prodLAMP `28e916b0…`, test-LAMP native) — bỏ.

— LAMP agent
