// _guards.ts — CỔNG GÁC tham số apply-param đọc từ biến môi trường.
//
// VÌ SAO CÓ TỆP NÀY (nguyên nhân gốc, tra được bằng git):
//   `ddfa2c6` (2026-06-18, "guard chống kẹt LAMP — audit TRUNG-1/2") thêm cổng gác cho
//   ĐÚNG MỘT biến `DIST_DEST` ở cả ba script 01/02/03, và bỏ trống `METER_NFT_POLICY`
//   nằm ngay bên cạnh. Từ đó hai tham số CÙNG LOẠI trong CÙNG MỘT hàm có hai mức bảo vệ
//   khác nhau: thiếu `DIST_DEST` thì dừng, thiếu `METER_NFT_POLICY` thì đi tiếp lặng lẽ
//   với placeholder `00`×28.
//
//   Bản mồi mainnet dựng từ `457f312` mang đúng vết đó: `Genesis/offchain/src/deployed.ts:92`
//   ghi `meter_nft_policy` = `581c` + 28 byte 0 — "KHÔNG có tiền ảnh ⇒ nhánh ReserveDraw
//   chết vĩnh viễn" (deployed.ts:118-119: 9,63 tỷ Reserve không rút được qua policy này).
//
// VÌ SAO KHÔNG SỬA ĐƯỢC SAU KHI ĐÃ GỬI:
//   Mọi tham số dưới đây là **apply-param** — nó bị nướng vào bytecode, nên nó nằm TRONG
//   policy-id / script-hash. Sửa một byte ⇒ ra policy-id khác ⇒ là một token khác, một kho
//   khác. Cộng với luật "LAMP KHÔNG burn" (Treasury/CONTRACT.md §5), một lượt gửi nhầm là
//   một nhánh chết vĩnh viễn, không có đường quay lui.
//
// NGUYÊN TẮC: fail-closed và ĐỐI XỨNG. Mọi tham số dạng hash/policy-id đọc từ env đều đi
// qua đây, không có ngoại lệ "tham số này chắc không sao". Placeholder chỉ được phép tồn
// tại ở chế độ KHÔNG gửi (dựng tx để typecheck/xem CBOR).
//
// KHÔNG phụ thuộc lucid/dotenv, và KHÔNG chạm `process`/`console` — env + kênh cảnh báo
// được TRUYỀN VÀO. Hai lý do: (a) hàm thuần thì test được mọi nhánh không cần dựng global;
// (b) tệp này lọt vào chương trình tsc của `offchain/` (qua test) nơi không có @types/node,
// nên chạm global ở đây là thêm lỗi typecheck cho module khác. Mỗi script gọi tự khai
// `const GUARD_IO = { env: process.env, warn: (m: string) => console.warn(m) };` rồi trải vào.

/** Cách một tham số được quyết định, để in ra log kiểm chứng. */
export type ParamSource = "env" | "placeholder";

export interface HashParamOptions {
  /** true = tx sẽ được GỬI LÊN CHAIN ⇒ cấm placeholder. */
  submit: boolean;
  /** Hậu quả cụ thể nếu để placeholder đi tiếp. Bắt buộc — thông điệp chung vô dụng. */
  consequence: string;
  /** Độ dài byte bắt buộc khi có giá trị. Mặc định 28 (blake2b-224: policy-id / script-hash). */
  bytes?: number;
  /** Bảng biến môi trường. Script truyền `process.env`; test truyền object dựng sẵn. */
  env: Record<string, string | undefined>;
  /** Kênh in cảnh báo ở chế độ không gửi. Script truyền `console.warn`; test truyền spy. */
  warn: (msg: string) => void;
}

export interface HexParamOptions extends Omit<HashParamOptions, "bytes"> {
  /** Giá trị dùng khi KHÔNG gửi và env trống (vd asset-name mẫu). */
  placeholder: string;
}

export interface GuardedParam {
  name: string;
  value: string;
  source: ParamSource;
}

const HEX = /^[0-9a-f]+$/;

function readEnv(name: string, env: Record<string, string | undefined>): string {
  return (env[name] ?? "").trim().toLowerCase();
}

function missing(name: string, consequence: string): Error {
  return new Error(
    `${name} chưa set. Tham số này là APPLY-PARAM: nó nằm TRONG policy-id/script-hash, ` +
      `nên sửa nó sau khi gửi = đổi policy-id = một token/kho KHÁC. LAMP KHÔNG burn ` +
      `(Treasury/CONTRACT.md §5) ⇒ gửi nhầm là KẸT VĨNH VIỄN, không quay lui được. ` +
      `Hậu quả cụ thể: ${consequence} ` +
      `Set ${name}=… trước khi gửi, hoặc chạy ở chế độ không gửi để chỉ dựng tx.`,
  );
}

function poisoned(name: string, value: string, consequence: string) {
  return new Error(
    `${name} = ${value.slice(0, 8)}…(${value.length / 2} byte) — GIÁ TRỊ CHẾT, không phải giá trị thật. ` +
      `Toàn 0 / toàn f không có tiền ảnh blake2b-224, nên không UTxO nào mang được policy hay ` +
      `credential đó. Cổng gác cũ chỉ chặn THIẾU biến; giá trị này thì "đúng dạng" nên đi lọt — ` +
      `và đó chính xác là cách bản mồi mainnet ra đời (deployed.ts:92 ghi meter_nft_policy = 28 ` +
      `byte 0). Hậu quả cụ thể: ${consequence}`,
  );
}

/** Giá trị đúng dạng nhưng không thể có tiền ảnh: toàn 0 hoặc toàn f. */
function isPoison(value: string): boolean {
  return /^0+$/.test(value) || /^f+$/.test(value);
}

function malformed(name: string, value: string, want: string): Error {
  return new Error(
    `${name} sai dạng: cần ${want}, nhận ${value.length} ký tự ("${value.slice(0, 16)}…"). ` +
      `Apply-param sai dạng KHÔNG bị chặn ở tầng dưới — nó chỉ sinh ra một policy-id khác, ` +
      `im lặng. Kiểm lại giá trị trước khi chạy tiếp.`,
  );
}

/**
 * Tham số dạng HASH / POLICY-ID (mặc định 28 byte = 56 hex).
 *
 * - `submit=true` + env trống ⇒ NÉM LỖI kèm hậu quả.
 * - `submit=false` + env trống ⇒ trả placeholder `00`×bytes + cảnh báo to.
 * - Có giá trị ⇒ luôn kiểm hex + đúng độ dài, sai thì ném (kể cả khi không gửi).
 */
export function requiredHashParam(name: string, opts: HashParamOptions): GuardedParam {
  const bytes = opts.bytes ?? 28;
  const value = readEnv(name, opts.env);

  if (!value) {
    if (opts.submit) throw missing(name, opts.consequence);
    const placeholder = "00".repeat(bytes);
    opts.warn(
      `⚠ ${name} chưa set → dùng placeholder ${placeholder.slice(0, 8)}…(${bytes} byte 0). ` +
        `CHỈ hợp lệ ở chế độ KHÔNG gửi. Hậu quả nếu gửi: ${opts.consequence}`,
    );
    return { name, value: placeholder, source: "placeholder" };
  }

  if (!HEX.test(value) || value.length !== bytes * 2) {
    throw malformed(name, value, `${bytes * 2} ký tự hex (${bytes} byte)`);
  }
  // Đúng dạng vẫn có thể là giá trị CHẾT. Chỉ chặn khi GỬI — chế độ dựng-thử vẫn cần
  // đặt được 00×28 để xem CBOR.
  if (opts.submit && isPoison(value)) throw poisoned(name, value, opts.consequence);
  return { name, value, source: "env" };
}

/**
 * Tham số dạng HEX độ dài tự do (asset-name…). Cùng cổng gác, chỉ khác phép kiểm độ dài.
 *
 * Vì sao asset-name cũng phải qua cổng: nó cũng là apply-param. `meter_nft_name` sai thì
 * `count_inputs_holding_nft(tx.inputs, meter_nft_policy, meter_nft_name)` không bao giờ
 * thoả — chết đúng cái nhánh mà `meter_nft_policy` sai cũng giết. Gác một nửa cặp là tái
 * lập đúng thế bất đối xứng đã gây ra bản mồi mainnet.
 */
export function requiredHexParam(name: string, opts: HexParamOptions): GuardedParam {
  const value = readEnv(name, opts.env);

  if (!value) {
    if (opts.submit) throw missing(name, opts.consequence);
    opts.warn(
      `⚠ ${name} chưa set → dùng placeholder ${opts.placeholder}. ` +
        `CHỈ hợp lệ ở chế độ KHÔNG gửi. Hậu quả nếu gửi: ${opts.consequence}`,
    );
    return { name, value: opts.placeholder, source: "placeholder" };
  }

  if (!HEX.test(value) || value.length % 2 !== 0) {
    throw malformed(name, value, "chuỗi hex độ dài chẵn");
  }
  if (opts.submit && isPoison(value)) throw poisoned(name, value, opts.consequence);
  return { name, value, source: "env" };
}

// ── Hậu quả dùng lại — viết một lần, dẫn được về nguồn ────────────────────────

/** Hậu quả khi `meter_nft_policy`/`meter_nft_name` là placeholder. */
export const CONSEQUENCE_METER =
  "meter NFT không có tiền ảnh ⇒ điều kiện count_inputs_holding_nft(...) == 1 của nhánh " +
  "ReserveDraw KHÔNG BAO GIỜ thoả ⇒ toàn bộ pot Reserve (9,63 tỷ LAMP) không rút được qua " +
  "policy này, mãi mãi. Đây đúng là thứ đã xảy ra với bản mồi mainnet " +
  "(Genesis/offchain/src/deployed.ts:92, :118-119).";

/**
 * Hậu quả khi `genesis_ref` (neo one-shot của `thread_nft`) sai.
 *
 * Đây là apply-param GỐC RỄ, không phải một tham số ngang hàng với `meter_*`/`dist_dest`:
 * `genesis_ref` → `thread_nft` policy → `threadPid`, mà `threadPid` lại là apply-param của
 * CẢ `lamp_mint` LẪN `supply_state`. Sai một byte ở đây ⇒ sai TOÀN BỘ ba script cùng lúc.
 * Nó cũng là thứ DUY NHẤT bảo đảm tính một-lần: một OutputReference chỉ tồn tại một lần
 * trong lịch sử chain (`mainnet-deploy-plan.md §C`).
 */
export const CONSEQUENCE_GENESIS_REF =
  "genesis_ref sai ⇒ thread_nft ra policy khác ⇒ lamp_mint + supply_state cùng ra policy-id/" +
  "script-hash khác ⇒ mint dưới SAI policy (LAMP không burn = kẹt vĩnh viễn), và SupplyState " +
  "vừa dựng không phải cái UTxO nào trên chain đang mang thread NFT. Giá trị Preview cũ nướng " +
  "cứng trong mã sẽ IM LẶNG sai trên Preprod/Mainnet — phải truyền UTxO one-shot thật.";

/** Hậu quả khi `dist_dest` (A-DEST) là placeholder. */
export const CONSEQUENCE_DIST_DEST =
  "A-DEST sẽ ép toàn bộ LAMP mint ra rót vào Script(00×28) — địa chỉ không có tiền ảnh script " +
  "nên KHÔNG AI spend được. LAMP không burn ⇒ số đó mất khỏi lưu hành vĩnh viễn.";
