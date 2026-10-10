# deployments — định danh deploy LAMP theo mạng, máy đọc được

`mainnet.json`, `preprod.json`, `preview.json` là tệp **SINH RA**, không sửa tay. Hình dạng:
`schema.json` (JSON Schema 2020-12).

## Sinh và kiểm

```sh
cd Genesis/scripts
npm run deployments          # sinh lại cả ba tệp từ nguồn
npm run deployments:check    # so từng byte với tệp đã commit; lệch ⇒ mã thoát 1, in tệp lệch
```

Nguồn (đọc bằng mã, không chép tay):

- `Genesis/offchain/src/lampPolicies.ts` — sổ policy LAMP/tLAMP kèm trạng thái.
- `Genesis/offchain/src/deployed.ts` — bản ghi mainnet đầy đủ, kể cả `closure`.
- `Utils/src/index.ts` — `MS_PER_EPOCH_BY_NETWORK`, `WINDOW_ORIGIN_MS_BY_NETWORK`.
- `Genesis/deployed/*.wiring.json` — phần bất biến của cụm hợp đồng đang chạy trên mạng thử.

Bộ sinh: `buildDeployments(network)` trong `Genesis/offchain/src/deploymentsManifest.ts`; bộ kiểm
`validateDeployments(obj)` cùng tệp áp mọi luật bên dưới (cả những luật JSON Schema không diễn được).
Bài kiểm: `Genesis/tests/deploymentsManifest.test.ts`.

## Dùng thế nào

- **Ghim theo commit.** Tải tệp ở một commit cụ thể của kho, không ở nhánh. Đầu ra tất định: cùng
  nguồn ⇒ cùng byte, không có trường thời gian.
- **Luật trạng thái:**
  - Chỉ dựng giao dịch **MỚI** với bản ghi `ACTIVE`.
  - Đọc số dư / rút phần cũ với `ACTIVE ∪ SUPERSEDED`.
  - Gặp `PENDING` ⇒ **NÉM**. Bản ghi đó chưa có định danh trên chuỗi.
- `supersededBy` trỏ `id` của bản thay thế (cùng `role`, cùng tệp). Mỗi `(role, cluster)` có nhiều
  nhất một bản `ACTIVE`.
- Số lượng (ms, trần cung) là **chuỗi thập phân** để không mất chính xác; `schemaVersion` và
  `networkMagic` là số nguyên JSON.
- `params` chỉ chứa tham số đã nướng vào script hoặc cần để dựng lại định danh, không chứa trạng thái
  sống (số đã đúc, UTxO hiện tại). Trạng thái sống phải đọc từ chuỗi.
- `evidence`: `tx:<hash>` là giao dịch trên chính mạng của tệp; `file:<đường>` là tệp trong kho này.
- Mainnet: policy `lamp-token` hiện có mang `mintClosed: true` — đã đóng đúc vĩnh viễn, không phải
  token LAMP chính thức sẽ lưu hành.
