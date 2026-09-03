# Runbook — diễn tập policy LAMP canonical (v2) trên Preprod

> Đây là **diễn tập**, không phải phát hành. Mọi script trong runbook này chặn thẳng khi
> `NETWORK=Mainnet`. Phát hành mainnet đi theo `mainnet-deploy-plan.md` mục D, và chỉ sau
> khi toàn bộ cổng ở cuối tệp này xanh.

## Vì sao cần một policy mới, chứ không dùng tiếp bản 18/06

Policy LAMP đang chạy trên mainnet — `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0`,
đúc **2026-06-18**, `lifecycle: "bootstrap"`, **8 tham số** — có một ngõ cụt không sửa được:

| | bản mồi mainnet (8 tham số) | bản canonical (12 tham số) |
|---|---|---|
| `meter_nft_policy` | **28 byte 0** (`offchain/src/deployed.ts:92`) | policy one-shot có thật |
| nhánh `ReserveDraw` | không bao giờ thoả ⇒ **9,63 tỷ LAMP kẹt** (`deployed.ts:118-119`) | mở được — chứng minh ở bước 3 |
| trần phát hành THỰC TẾ | **26,37 tỷ**, không phải 36 tỷ | 36 tỷ |
| WHO-gate | danh sách pkh nướng sẵn, 1-of-1 (`deployed.ts:71-76`) | đọc bảng registry theo `token_tag` |
| xoay khoá vận hành | không được — phải đúc lại policy | sửa entry registry, không redeploy |
| A-DEST | không ép on-chain ở bản đang chạy | ép: hash kho đọc động từ TRSY NFT |

Tham số bị nướng vào policy-id, nên **không có đường nâng cấp tại chỗ**
(`onchain/validators/lamp_mint.ak:34`). Trên Cardano, đổi tham số là đổi policy-id — tức
một token khác. Câu hỏi chưa bao giờ là *có* đổi hay không, chỉ là *khi nào*.

## Chuẩn bị

- `$AGENT_SECRETS` trỏ tới tệp biến môi trường có khoá Blockfrost Preprod và seed ví
  (tên biến tra trong `scripts/config.ts`, mục `BF_KEY_BY_NETWORK` / `SEED_VAR_BY_NETWORK`).
- Ví Preprod ≥ **15 tADA** (5 output NFT + phí).
- Blueprint đã dựng: `aiken build` trong `Genesis/onchain/` **và** `Distribution/onchain/`.
  Wiring đọc cả hai; thiếu một cái thì cổng APPLY-002 dừng ngay chứ không đoán.

```bash
cd Genesis/scripts && npm install
```

## Bước 0 — soi wiring khô (không chạm mạng, không cần ví)

```bash
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod npm run v2:dry
```

Tính trọn bộ policy-id / script-hash / địa chỉ từ một hạt giống mẫu. Chạy được trên máy
không có khoá, không có tADA. **Chạy lại sau mỗi lần `aiken build`**: cổng APPLY-001/002
tra blueprint và ném nếu số tham số truyền vào không khớp bản khai — mà truyền thiếu tham
số thì `applyParamsToScript` KHÔNG báo lỗi, nó ra một policy-id khác, im lặng.

## Bước 1 — Tx A: đúc trọn bộ marker one-shot

```bash
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod npm run v2:genesis                 # dựng + eval, KHÔNG gửi
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod SUBMIT=true npm run v2:genesis     # gửi thật
```

**Bước này không làm lại được.** Cả năm marker nướng cùng một `genesis_ref`, và một UTxO
chỉ tiêu được một lần trong lịch sử chuỗi. Marker nào không đúc ở đây thì không bao giờ
đúc được nữa dưới policy-id đã tính — mà `lamp_mint` đã nướng sẵn những policy-id ấy.

| marker | policy | hạ cánh ở | dùng làm gì |
|---|---|---|---|
| SUPPLY | `oneshot_nft` | `supply_state` | neo định danh bộ đếm cap |
| REG | `oneshot_nft` | ví (xem hạn chế bên dưới) | bảng `token_tag` → authority |
| MET | `oneshot_nft` | ví (Lớp 1) | cửa DUY NHẤT của nhánh `ReserveDraw` |
| TRSY | `treasury_nft` | `treasury.ak` (KHO) | đích A-DEST, đọc hash kho động |
| DROP | `beacon_nft` | `beacon.ak` | beacon Distribution, cần cho claim/redeem |

DROP có mặt vì đúng cái lý do đã giết nhánh Reserve của mainnet: `beaconPid` đã nướng vào
`claim_account` ⇒ vào `treHash` ⇒ vào **địa chỉ kho**. Không đúc nó bây giờ thì địa chỉ kho
vẫn đúng, nhưng đường claim/redeem chết câm — và lúc phát hiện thì hạt giống đã tiêu.

## Bước 2 — Tx B: `DistributionVest` → KHO

```bash
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod DELTA_LAMP=10000 npm run v2:vest
```

Kiểm ba luật cùng lúc: **WHO** (authority đọc từ bảng registry, không phải pkh nướng sẵn),
**WHERE** (A-DEST đo *độ tăng ròng* của LAMP tại kho ≥ Δ — đo ròng nên mẹo "tiêu UTxO kho
rồi trả lại đúng số cũ" không lọt), **HOW MUCH** (`dist_minted += Δ`, ≤ cap, đơn điệu).

## Bước 3 — Tx C: `ReserveDraw` — nhánh đã CHẾT trên mainnet

```bash
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod RESERVE_LAMP=1000 npm run v2:reserve
```

Đây là phép thử quan trọng nhất của cả màn diễn tập. Xanh = policy mới không mang khuyết
tật của bản mồi. **Đỏ = đừng phát hành.**

## Bước 4 — bằng chứng one-shot (phủ định)

```bash
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod npm run v2:oneshot
```

`mainnet-deploy-plan.md` mục C nói rõ: một lượt Preprod xanh chứng minh *đường ống thông*,
không chứng minh *chỉ có một SupplyState*. Bước này chứng minh phần còn lại, hai chiều:

1. **cấu trúc** — UTxO hạt giống đã biến mất khỏi tập UTxO sống, nên điều kiện one-shot
   (`oneshot_nft.ak:34`) không giao dịch nào về sau thoả được, kể cả của người giữ khoá ví.
   Đây là phủ định cho **mọi** lượt thử, không riêng lượt dưới.
2. **vận hành** — dựng thật một giao dịch đúc SUPPLY NFT thứ hai và xác nhận nó bị chặn.
   Giao dịch thử KHÔNG bao giờ được ký và KHÔNG bao giờ được gửi.

Bản diễn tập cũ (`canonical_mint.ts`) không thể có bước này: nó đúc marker bằng
`scriptFromNative({type:"sig"})`, mà native-sig đúc lại được tuỳ ý — phép thử sẽ **thành
công**, tức là hỏng.

## Đối chiếu bất cứ lúc nào (đọc-không-ghi)

```bash
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod npm run v2:verify
```

Mọi số đọc từ chuỗi. `canonical-v2-state.json` chỉ dùng để biết `genesis_ref`; từ đó toàn
bộ policy-id được **dựng lại và so** với state — lệch một chữ là dừng (`rehydrate()`).

## Cái này CHƯA chứng minh — đừng nhầm là đã xong

| chưa có | vì sao | ai làm |
|---|---|---|
| **Trần nhịp Reserve δ ≤ E/1000** | Lớp 1 để MET ở ví, nên khi MET bị tiêu **không validator nào chạy**. Nhánh mở được ≠ nhánh có phanh. Để MET ở ví lúc lên mainnet thì ai giữ khoá rút trọn 9,63 tỷ trong một giao dịch, chi phí bằng phí mạng. | Lớp 2 — đặt MET dưới `reserve_draw.ak` (module Reserve, 9 tham số) |
| **Xoay khoá authority** | REG nằm dưới `oneshot_nft`, mà `oneshot_nft` có `else(_) { fail }` ⇒ UTxO đó **không tiêu được** ⇒ bảng registry BẤT BIẾN. Đúng ý cho diễn tập, nhưng nghĩa là chưa chạy thử được đường sửa bảng. Mainnet dùng `registry_write` — tiêu được, gác bằng TAAD/OrgDID | `mainnet-deploy-plan.md` mục D12 |
| **Authority M-of-N** | committee của màn diễn tập là 1-of-1 (chính ví deploy) | mục A4, đang MỞ |
| **Đường claim → redeem** | DROP NFT đã đúc và đặt đúng chỗ, nhưng chuỗi claim/beacon/redeem chưa chạy trong runbook này | Distribution |

## Cổng phải xanh trước khi bàn tới mainnet

1. Bước 1-4 xanh trên Preprod, có tx hash ghi trong `canonical-v2-state.json`.
2. `v2:verify` xanh toàn bộ mục.
3. Lớp 2 xanh: MET dưới `reserve_draw`, và một lượt `ReserveDraw` vượt trần nhịp **bị chặn**.
4. Quyết định A1/A4 của `mainnet-deploy-plan.md` được chốt, cùng với việc phát biểu lại cổng
   A' theo `hash + commit nguồn` — hai việc đó ràng nhau, không làm lẻ (lý do ghi ở mục A').
5. Công bố rõ: 1.000.000 LAMP đã đúc dưới policy mồi **không đốt được**
   (`lamp_mint.ak:157` ép `delta > 0`; `Treasury/CONTRACT.md §5`). Chúng ở lại như tài sản
   của một policy đã khai tử, nên phải nói thẳng policy-id nào là LAMP thật.

## Trạng thái đo được — lượt chạy 2026-09-03 trên Preprod, XANH TOÀN BỘ

`genesis_ref` = `525b80f4…e301#1` · `lamp_policy` = `d9c09230079b810ab5ed92e8db4c190d42efc42db6aac028656f7e07`

| bước | giao dịch | kết quả |
|---|---|---|
| 0 `v2:dry` | — | 5 marker ra 5 policy-id khác nhau, cổng APPLY-001/002 im |
| 1 Tx A | `5d615fa7…a05d` | 5 marker one-shot đúc trong MỘT giao dịch, hạ cánh đúng chỗ |
| 1b dời REG | `0cca4708…bdf8` | REG về `Script(regPid)` — xem "phát hiện" bên dưới |
| 2 Tx B | `44b73727…801a` | `dist_minted` 0 → 10.000 LAMP; KHO tăng đúng 10.000, **không đồng nào ra ví** |
| 3 Tx C | `11438d3a…fc91` | `reserve_minted` 0 → **1.000 LAMP** — nhánh chết ở mainnet **chạy được ở đây** |
| 4 one-shot | (không gửi) | đúc SUPPLY NFT lượt hai **bị chặn**; hạt giống đã tiêu ⇒ phủ định mọi lượt về sau |
| — `v2:verify` | — | **toàn bộ mục xanh** |

`SupplyState` trên chuỗi sau lượt chạy: `dist_minted` 10.000 · `reserve_minted` 1.000 ·
`dist_cap` 26.370.000.000 · `reserve_cap` 9.630.000.000 · **tổng cap 36 tỷ**.

### Phát hiện của chính màn diễn tập — REG ở ví thì cổng WHO KHÔNG mở

Bản đầu đặt REG NFT ở ví và runbook chỉ ghi giới hạn là *"chưa chứng minh được việc xoay khoá
authority"*. Chạy thật thì Tx B **đỏ ngay**: `failed script execution Mint[0]`.

Nguyên nhân: `registry.ak::find_registry_datum` lọc reference input theo NFT **và** theo địa chỉ —
`payment_credential == Script(policy)`. REG ở ví ⇒ bộ lọc rỗng ⇒ `None` ⇒ cổng WHO đóng.

Ràng buộc đó **cố ý**, và chú thích tại chỗ nói vì sao không được gỡ: reference input không cần
chữ ký của ai, nên registry NFT nằm ở một ví thì người giữ nó tự viết `entries` — kể cả
`authority = SinglePkh(ví_mình)` — và tự cấp quyền đúc LAMP. Bản v1 thiếu đúng mệnh đề này và một
PoC đã đúc LAMP không giới hạn từ anchor đặt ở ví thường.

**Giới hạn ghi trong bản trước nhẹ hơn sự thật**: không phải "chưa chứng minh xoay khoá" mà là
"cổng WHO không mở được". Đây đúng là loại lỗi một màn diễn tập sinh ra để bắt — đọc mã không ra,
vì mã dựng tx trông hợp lệ và chỉ validator mới từ chối.

Bản vá: `20_canonical_genesis.ts` nay đặt REG thẳng vào `Script(regPid)`;
`20b_place_registry.ts` dời giúp một lượt đã lỡ đặt ở ví; `21_vest_to_kho.ts` gác trước khi dựng
tx nên hỏng sớm với thông điệp đọc được thay vì "Mint[0] crashed".

### Hai lỗi công cụ cũng chỉ lộ khi chạy thật

- `JSON.stringify` ném với BigInt **sau khi Tx A đã gửi** — giao dịch thành công nhưng state
  không ghi được, các bước sau mất `genesis_ref`. Vá hai lớp: đổi kiểu lúc ghi, và cho
  `20_canonical_genesis.ts` **chạy lại được** (`ADOPT_GENESIS_TX=…`) để nhặt lại state.
- `explorerTx` nướng cứng `preview.` cho mọi mạng ⇒ lượt Preprod in ra đường dẫn Preview, mở lên
  thành "không tìm thấy giao dịch" — nghe như tx hỏng chứ không nghe như link sai.
- Đọc trạng thái ngay sau `awaitTx` ra **bản cũ**: Tx C thành công trên chuỗi (`reserve_minted`
  = 1.000 LAMP) nhưng script đọc ra 0 rồi ném. Vá bằng `waitFor` — đọc lại theo nhịp, và khi hết
  hạn thì nói rõ "có thể tx ĐÃ thành công, kiểm bằng `v2:verify` trước khi kết luận là hỏng".

— LAMP agent
