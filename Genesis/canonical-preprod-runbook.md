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
| MET | `oneshot_nft` | ví ở Lớp 1 → **`reserve_draw` ở Lớp 2** | cửa DUY NHẤT của nhánh `ReserveDraw`; ở ví là cửa KHÔNG KHOÁ |
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
| ~~**Trần nhịp Reserve δ ≤ E/1000**~~ | **ĐÃ XONG 2026-09-03** — Lớp 2 chạy xanh trên Preprod, xem mục Lớp 2 bên dưới. | — |
| **Cổng cầu `parked < sàn` đóng lại được** | Lớp 2 chứng minh cổng MỞ khi két dưới sàn, và chứng minh không rút được nếu bỏ qua cổng. Nhưng **chưa chứng minh cổng ĐÓNG**, và lý do là cấu trúc chứ không phải thiếu công sức — xem "cổng cầu không tự đóng lại" bên dưới. | Treasury — `Collect` (chưa dựng) |
| **Xoay khoá authority** | REG nằm dưới `oneshot_nft`, mà `oneshot_nft` có `else(_) { fail }` ⇒ UTxO đó **không tiêu được** ⇒ bảng registry BẤT BIẾN. Đúng ý cho diễn tập, nhưng nghĩa là chưa chạy thử được đường sửa bảng. Mainnet dùng `registry_write` — tiêu được, gác bằng TAAD/OrgDID | `mainnet-deploy-plan.md` mục D12 |
| **Authority M-of-N** | committee của màn diễn tập là 1-of-1 (chính ví deploy) | mục A4, đang MỞ |
| **Đường claim → redeem** | DROP NFT đã đúc và đặt đúng chỗ, nhưng chuỗi claim/beacon/redeem chưa chạy trong runbook này | Distribution |

## Cổng phải xanh trước khi bàn tới mainnet

1. Bước 1-4 xanh trên Preprod, có tx hash ghi trong `canonical-v2-state.json`.
2. `v2:verify` xanh toàn bộ mục.
3. ~~Lớp 2 xanh: MET dưới `reserve_draw`, và một lượt `ReserveDraw` vượt trần nhịp **bị chặn**.~~
   **XONG 2026-09-03** — `npm run v2:l2` → `v2:l2draw` → `v2:l2brake`, cả ba xanh (bảng dưới).
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

## Lớp 2 — đặt phanh lên nhánh Reserve (chạy 2026-09-03, XANH)

Lớp 1 chứng minh nhánh `ReserveDraw` **mở được**. Nó không chứng minh nhánh đó **có phanh**:
MET nằm ở ví, nên tiêu nó không kích validator nào. Lớp 2 đưa MET xuống `reserve_draw.ak`.
Từ đó một lượt rút phải làm hài lòng **bốn validator trong một giao dịch**:

| validator | ép cái gì |
|---|---|
| `reserve_draw.spend` | ≤1 lượt/epoch · δ ≤ tổng/1000 · δ ≤ pot còn lại · δ về đúng đích · ReserveState tái tạo đúng · phải có auth NFT tiêu TỪ gate |
| `reserve_gate.spend` | `parked` của két < sàn (cổng CẦU) · auth NFT quay về gate · auth không mint/burn |
| `lamp_mint.mint` | nhánh `ReserveDraw`: đúng 1 input mang MET · MET không mint/burn |
| `supply_state.spend` | `reserve_minted += δ` ≤ cap, đơn điệu |

```bash
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod npm run v2:l2       # lắp phanh (3 tx)
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod npm run v2:l2draw   # rút thật QUA cổng
AGENT_SECRETS=<đường dẫn> NETWORK=Preprod npm run v2:l2brake  # 3 phép PHỦ ĐỊNH + 1 đối chứng
```

| bước | giao dịch | kết quả |
|---|---|---|
| L2a custody seed | `fdc93cb2…a84b` | custody NFT → két, `parked` = 0 (dưới sàn ⇒ cổng cầu mở) |
| L2b auth mint | `3b61c2a4…b3d7` | auth NFT → `reserve_gate`, **bị khoá ở đó** |
| L2c meter park | `28c494a4…b6c0` | MET ví → `reserve_draw` + `ReserveState(start=4139, total=9,63e15, drawn=0, last=0)` |
| DRAW qua cổng | `a1d64ec2…026e` | 1.000 LAMP · `drawn` 0 → 1e9 · `last_epoch` 0 → 4139 · `start`/`total` giữ nguyên |

Ba phép **phủ định** dựng-nhưng-không-gửi, kèm một **đối chứng dương** P0 dựng được ở cùng
epoch. Đối chứng là thứ làm ba phép kia nói được điều gì: cả bốn dùng CÙNG khuôn giao dịch,
nên mỗi phép phủ định chỉ khác đối chứng **đúng một chiều**, và chiều đó là nguyên nhân.

| phép | khác đối chứng ở | kết quả |
|---|---|---|
| P0 đối chứng | — | **dựng được** |
| P1 | δ = trần + 1 (`9.630.000.000.001`) | **bị chặn** — Luật 4 |
| P2 | epoch = `last_epoch` | **bị chặn** — Luật 3 |
| P3 | không tiêu auth NFT từ gate | **bị chặn** — Luật 5 |

Không có đối chứng thì ba dòng này vô nghĩa: cả ba trả về **cùng một chuỗi lỗi**
(`failed script execution Spend[0] the validator crashed`), nên chuỗi đó không nói được luật
nào đã chặn. Lượt chạy đầu mắc đúng bẫy đó — P1 dựng ở epoch đã rút, nên nó thật ra đang đo
lại Luật 3 chứ không đo Luật 4. Đã sửa: P1 và P3 dựng ở `last_epoch + 1`.

### Phát hiện — cổng cầu KHÔNG TỰ ĐÓNG LẠI ĐƯỢC

Số đo sau lượt rút:

```
parked (UTxO mang custody NFT) = 0 LAMP      · sàn = 1.000 LAMP
LAMP tại ĐỊA CHỈ két           = 1.000 LAMP
```

Hai số này lệch nhau, và đó là **hình dạng của thiết kế**, không phải lỗi lượt chạy:

- `reserve_draw` Luật 9 đếm LAMP tới **payment credential** của đích ⇒ Δ vào đúng địa chỉ két, xanh.
- `reserve_gate` G-CUST-1 + G-FLOOR-1 đọc `parked` từ **UTxO mang custody NFT** ⇒ Δ nằm ở một
  UTxO RIÊNG bên cạnh, không tính vào `parked`.
- Không sửa được bằng cách rót thẳng vào UTxO custody: cùng một UTxO **không thể vừa là
  reference input** (gate đòi) **vừa bị tiêu** (rót vào thì phải tiêu) trong một giao dịch.

⇒ Theo **cấu trúc**, một lượt rút Reserve không bao giờ tự nâng `parked` qua sàn. Cổng cầu chỉ
đóng khi một tiến trình KHÁC nạp LAMP vào chính UTxO custody — tức một `Collect` của Treasury,
**chưa dựng**. Chừng đó, thứ đang chặn là **trần nhịp** (≥1000 epoch để cạn pot ≈ 13,7 năm),
không phải cổng cầu. Đừng ghi cổng cầu vào cột "đã có".

### Ba thứ chỉ lộ khi chạy thật, lần này

1. **`custody_seed.ak` luật S-MINT-2 cấm gộp.** `list.length(assets.policies(tx.mint)) == 1` —
   giao dịch đúc custody không được mang thêm policy mint nào khác. Nên "một hạt giống, mọi
   marker" của Lớp 1 **không nối dài sang Lớp 2 được**: custody phải có hạt giống riêng.
2. **Hạt giống thứ hai phải chọn SAU khi giao dịch thứ nhất lên chuỗi.** Chọn cả hai trước thì
   coin-selection của giao dịch đầu có quyền tiêu chính cái đang để dành. Lượt chạy đầu dính
   đúng vậy — chỉ mục ví còn trả về UTxO vừa tiêu, và hạt giống auth trùng hạt giống custody.
3. **Đọc sớm cắn thêm một lần nữa, ở một chỉ mục khác.** Địa chỉ két và địa chỉ `reserve_draw`
   là hai chỉ mục riêng, nhà cung cấp cập nhật không đồng thời. Hậu-kiểm báo `LUẬT 9 HỎNG: két
   chỉ tăng 0` trong khi trên chuỗi Δ nằm đúng chỗ. Hai lớp vá: bọc `waitFor`, và **ghi state
   NGAY sau khi giao dịch xác nhận, trước mọi phép đo** — giao dịch không quay lui được, nên
   một lỗi đo không được phép làm mất bản ghi của một lượt chạy thành công.

Ngoài ra, bản demo cũ `Faucet/scripts/demo_reserve_e2e.ts` **không còn chạy được** với mã hiện
hành và nên đọc như tài liệu lịch sử: nó truyền 2 tham số cho `custody.custody.spend` (blueprint
khai 3), 2 cho `custody_seed.custody_seed.mint` (khai 1), và ghi custody NFT thành một dòng sổ —
mà `collect.seed_value_ok` cộng NFT **ngoài** sổ, nên ghi thế là đếm hai lần.

— LAMP agent
