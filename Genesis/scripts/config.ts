// Genesis scripts config — Preview deploy lazy-mint (self-contained).
//
// Nhận BLOCKFROST_KEY, PRIVATE_KEY/WALLET_SEED, NETWORK qua BIẾN MÔI TRƯỜNG (xem khối
// BÍ MẬT bên dưới — tệp này KHÔNG mở tệp nào để lấy chúng). KHÔNG hard-code secret.
// SUBMIT=false (mặc định) → build tx + in CBOR, KHÔNG gửi lên chain (an toàn, kiểm tra
// logic trước khi tốn tADA). SUBMIT=true để gửi thật.

import {
  Lucid, Blockfrost, getAddressDetails,
  validatorToScriptHash, credentialToAddress, scriptHashToCredential,
  applyParamsToScript, mintingPolicyToId, scriptFromNative,
  type LucidEvolution, type Validator, type MintingPolicy, type Network,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertParamCount as assertParamCountGate } from "../offchain/src/applyGate.js";
import { requiredHexParam } from "./_guards.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// BÍ MẬT: tệp này nhận GIÁ TRỊ qua biến môi trường, KHÔNG mở kho khoá và KHÔNG biết
// kho ở đâu. Đường cũ tự đọc biến trỏ tới kho rồi `dotenv.config()` lên tệp đó — thứ
// đắt nhất bị lộ không phải giá trị mà là SƠ ĐỒ KHO, và mọi phép quét bí mật đều im
// lặng đúng ở ca đó. Đặt biến ngay trước lệnh, để bí mật sống trong đúng một tiến trình:
//   NETWORK=… BLOCKFROST_KEY=… WALLET_SEED="…" tsx <tệp>.ts

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;

// Bảng tra TÊN KHOÁ theo mạng đã bỏ hẳn, KHÔNG thay bằng bảng khác — nó là một mẩu sơ
// đồ kho nằm trong kho mã. Hệ quả phải biết: script không còn TỰ TÌM được khoá cho một
// mạng; đó là chủ ý, vì "tự tìm được" chính là năng lực bị cấm. Thiếu biến thì
// `assertEnv()` nói THIẾU BIẾN NÀO, không nói tìm nó ở đâu.

export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
export const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

/**
 * Địa chỉ ví đối chiếu — DỮ LIỆU CÔNG KHAI, không phải bí mật.
 *
 * Tách khỏi mọi đường kho khoá có chủ ý: địa chỉ in ra được, dán vào dòng lệnh được, ghi
 * vào nhật ký được. Bản cũ tra nó bằng một bảng tên-khoá-theo-mạng — dùng sơ đồ kho để
 * lấy về một thứ vốn chẳng cần giấu — và bảng đó trỏ ví CŨ sau khi ví xoay, nên chốt
 * kiểm chặn đúng ví đúng mà không ai hiểu vì sao.
 */
export const EXPECTED_WALLET_ADDR = (process.env.EXPECTED_WALLET_ADDR ?? "").trim();

/** SUBMIT=false (mặc định) → chỉ build tx + in CBOR, KHÔNG gửi chain. */
export const SUBMIT = (process.env.SUBMIT ?? "false").toLowerCase() === "true";

// ── Asset name LAMP theo network (param token_name của lamp_mint) ──────────
// Mainnet → "LAMP" (#"4c414d50"); mọi testnet (Preview/Preprod) → "tLAMP"
// (#"744c414d50"). Token = PolicyID + AssetName → token_name là param ⇒ policyId KHÁC
// nhau giữa tLAMP và LAMP (đúng: 2 token độc lập); tính DUY NHẤT nằm ở PolicyID (neo bởi
// genesis_ref one-shot). Cho phép override qua env TOKEN_NAME (hex) khi cần đặc biệt.

/** asset name LAMP testnet — "tLAMP" (hex). */
export const TLAMP_NAME = "744c414d50";

/** asset name LAMP mainnet — "LAMP" (hex). */
export const LAMP_NAME = "4c414d50";

/** Chọn token_name theo network: Mainnet → LAMP, còn lại (testnet) → tLAMP. */
export function tokenNameFor(network: Network): string {
  const override = (process.env.TOKEN_NAME ?? "").trim();
  if (!override) return network === "Mainnet" ? LAMP_NAME : TLAMP_NAME;
  // Override PHẢI qua cổng gác: `token_name` là apply-param của CẢ `lamp_mint` LẪN
  // `supply_state` ⇒ nó nằm trong policy-id + script-hash của cả hai. Trước bản vá này
  // override chỉ `.trim()`, nên `TOKEN_NAME=LAMP` (ASCII, không phải hex) đi thẳng vào
  // `applyParamsToScript` và sinh ra một policy-id khác, im lặng — cùng đúng một lớp lỗi
  // với `meter_nft_policy` = 28 byte 0 ở bản mồi mainnet. Đây là chỗ DUY NHẤT mọi script
  // Genesis lấy token_name, nên gác ở đây là gác hết.
  return requiredHexParam("TOKEN_NAME", {
    env: process.env,
    warn: (m: string) => console.warn(m),
    submit: true,              // có override = có chủ ý dùng nhãn này để đúc thật
    placeholder: "",           // không dùng: nhánh thiếu-biến đã return ở trên
    consequence:
      "token_name sai dạng ⇒ lamp_mint + supply_state nướng một nhãn token KHÁC ⇒ mint ra " +
      "một token không ai nhận là LAMP, và LAMP KHÔNG burn nên số đó kẹt vĩnh viễn.",
  }).value;
}

/** asset name LAMP áp dụng cho deploy hiện tại (theo NETWORK). */
export const TOKEN_NAME = tokenNameFor(NETWORK);

/**
 * Giá trị mang hình dạng CHỖ GIỮ CHỖ — tức người chạy đã dán nguyên dòng lệnh mẫu trong
 * runbook mà chưa thay giá trị thật.
 *
 * Vì sao phải có: `SECRETS-001`/`002` bản trước chỉ kiểm "rỗng hay không". Dòng lệnh mẫu
 * viết `BLOCKFROST_KEY=… WALLET_SEED="…"`, và chuỗi `…` thì KHÔNG rỗng — cổng đi qua, rồi
 * hỏng ở tận lần gọi mạng với một câu 403 đọc như "khoá sai" chứ không như "bạn chưa thay
 * chỗ giữ chỗ". Cổng đo đúng đại lượng ("biến có được đặt không") nhưng đại lượng cần đo là
 * "biến có mang một giá trị THẬT không", và khoảng cách giữa hai câu đó là cả một buổi dò.
 */
export function isPlaceholder(v: string): boolean {
  const s = v.trim();
  if (s === "") return true;
  // `…` (U+2026), `...`, và các biến thể chỉ gồm dấu chấm / dấu chấm lửng / `<...>` / `xxx`.
  return /^(…+|\.{2,}|<[^>]*>|x{3,}|X{3,}|TODO|FIXME)$/.test(s);
}

export function assertEnv(): void {
  // Thông điệp nói THIẾU BIẾN NÀO và cách đặt nó, KHÔNG nói đi lấy giá trị ở đâu —
  // chỉ đường tới kho khoá cũng là một mẩu sơ đồ kho.
  if (isPlaceholder(BLOCKFROST_KEY)) {
    throw new Error(
      `SECRETS-001: BLOCKFROST_KEY cho ${NETWORK} chưa có giá trị thật (thiếu, rỗng, hoặc ` +
        `còn nguyên chỗ giữ chỗ của dòng lệnh mẫu). Đặt nó ngay trước lệnh, đừng ghi vào ` +
        `tệp nào trong kho.`,
    );
  }
  if (isPlaceholder(PRIVATE_KEY) && isPlaceholder(WALLET_SEED)) {
    throw new Error(
      `SECRETS-002: WALLET_SEED (hoặc PRIVATE_KEY) cho ${NETWORK} chưa có giá trị thật ` +
        `(thiếu, rỗng, hoặc còn nguyên chỗ giữ chỗ của dòng lệnh mẫu). Đặt nó ngay trước ` +
        `lệnh, đừng ghi vào tệp nào trong kho.`,
    );
  }
}

/**
 * Chốt kiểm ví: địa chỉ SUY RA từ seed phải khớp địa chỉ công khai đã biết của mạng.
 *
 * Vì sao cần: seed sai vẫn dựng được ví hợp lệ — chỉ là ví KHÁC. Trên Preprod thì mất
 * thời gian; trên mainnet thì đúc token vào ví không ai giữ khoá. Chốt ở đây để hỏng
 * SỚM, trước khi có tx nào được dựng. Địa chỉ là dữ liệu công khai, in ra được.
 */
export function assertWalletMatches(derived: string): void {
  // FAIL-CLOSED trên mạng thật. Bản trước `return` khi mạng chưa khai địa chỉ đối chiếu — và
  // Mainnet chính là mạng chưa khai, nên chốt kiểm ví KHÔNG chạy đúng ở mạng duy nhất mà
  // chú thích trên vừa nói hậu quả là "đúc token vào ví không ai giữ khoá". Cổng hỏng-mà-
  // cho-qua thì không ai biết; ở đây phải hỏng-mà-chặn.
  if (NETWORK === "Mainnet" && !EXPECTED_WALLET_ADDR) {
    throw new Error(
      `WALLET-001: chạy trên Mainnet mà chưa đặt EXPECTED_WALLET_ADDR. Chốt kiểm ví không có ` +
        `gì để so, nên nó KHÔNG đo được — và trên mainnet thì seed sai nghĩa là đúc token vào ví ` +
        `không ai giữ khoá, không quay lui được. Đặt địa chỉ ví công khai vào biến đó ngay trước ` +
        `lệnh, hoặc đừng chạy mạng này.`,
    );
  }
  // Testnet chưa khai địa chỉ đối chiếu → không đoán, và KHÔNG tự đi tìm ở đâu khác.
  if (!EXPECTED_WALLET_ADDR) return;
  if (derived !== EXPECTED_WALLET_ADDR) {
    throw new Error(
      `WALLET-002 SAI VÍ: seed suy ra ${derived} nhưng EXPECTED_WALLET_ADDR là ` +
        `${EXPECTED_WALLET_ADDR}. Dừng trước khi dựng tx — kiểm lại biến seed đang đặt.`,
    );
  }
}

export async function makeLucid(): Promise<LucidEvolution> {
  assertEnv();
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  if (PRIVATE_KEY) lucid.selectWallet.fromPrivateKey(PRIVATE_KEY);
  else if (WALLET_SEED) lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

export async function walletPkh(lucid: LucidEvolution): Promise<string> {
  const addr = await lucid.wallet().address();
  assertWalletMatches(addr);
  const { paymentCredential } = getAddressDetails(addr);
  if (!paymentCredential) throw new Error("không lấy được payment credential từ ví");
  return paymentCredential.hash;
}

// ── plutus.json blueprint loader + apply params ────────────────

const PLUTUS_JSON_PATH = resolve(__dirname, "../onchain/plutus.json");

interface RawValidator {
  title: string;
  compiledCode: string;
  hash: string;
  parameters?: unknown[];
}

/**
 * Blueprint mà cổng APPLY-001 phải tra được. KHÔNG chỉ Genesis: script trong thư mục này
 * áp param cho CẢ validator của Distribution (`claim_account` / `treasury`, lấy qua
 * `applyDist()` ở `_canonical_v2.ts` / `_reserve_layer2.ts` — đường cũ `distCode()` ở
 * `canonical_mint.ts` / `canonical_mint_resume.ts` / `oneshot_cap_mint.ts` đã xoá khỏi kho,
 * tra `git show 930480e:Genesis/scripts/canonical_mint.ts`).
 * Chỉ nạp blueprint Genesis thì mọi compiledCode Distribution KHÔNG có `meta` — cổng mù
 * đúng con đường cần canh nhất.
 */
const BLUEPRINT_SOURCES: ReadonlyArray<{ label: string; path: string }> = [
  { label: "Genesis",      path: PLUTUS_JSON_PATH },
  { label: "Distribution", path: resolve(__dirname, "../../Distribution/onchain/plutus.json") },
];

/** Số tham số blueprint khai, tra theo compiledCode. Nạp một lần, giữ trong bộ nhớ. */
const paramCountByCode = new Map<string, { title: string; n: number; source: string }>();
/** Blueprint nạp hụt (thường vì chưa `aiken build`) — nêu trong lỗi để chẩn đúng chỗ. */
const blueprintLoadErrors: string[] = [];

async function readBlueprint(path: string): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(path, "utf8"));
  return json.validators as RawValidator[];
}

function indexBlueprint(vs: RawValidator[], source: string): void {
  for (const v of vs) {
    // `.mint`/`.spend` và `.else` dùng CHUNG compiledCode; giữ tên của bản chính để
    // thông điệp lỗi đọc ra đúng validator, không phải nhánh `.else`.
    if (v.title.endsWith(".else") && paramCountByCode.has(v.compiledCode)) continue;
    paramCountByCode.set(v.compiledCode, {
      title: v.title, n: (v.parameters ?? []).length, source,
    });
  }
}

let blueprintsIndexed = false;
async function indexAllBlueprints(): Promise<void> {
  if (blueprintsIndexed) return;
  blueprintsIndexed = true;
  for (const src of BLUEPRINT_SOURCES) {
    try {
      indexBlueprint(await readBlueprint(src.path), src.label);
    } catch (e) {
      // Không ném ở đây: blueprint thiếu chỉ thành lỗi KHI có script thật cần tra mà
      // không tra được (assertParamCount ném, kèm đúng danh sách này).
      blueprintLoadErrors.push(`${src.label} (${src.path}): ${(e as Error).message}`);
    }
  }
}

// Nạp NGAY lúc module load. `applyValidator`/`applyPolicy` là hàm ĐỒNG BỘ — không có chỗ
// await bên trong — nên bảng tra phải đầy TRƯỚC lần apply đầu tiên, kể cả khi chỗ gọi
// không đi qua `rawValidator()`.
await indexAllBlueprints();

async function loadBlueprint(): Promise<RawValidator[]> {
  await indexAllBlueprints();
  return readBlueprint(PLUTUS_JSON_PATH);
}

export async function rawValidator(title: string): Promise<RawValidator> {
  const vs = await loadBlueprint();
  const v = vs.find((x) => x.title === title);
  if (!v) throw new Error(`validator '${title}' không có trong plutus.json — chạy 'aiken build' trong onchain/.`);
  return v;
}

/**
 * ÉP đủ số tham số blueprint khai, trước khi apply. Chốt ở tầng helper để MỌI script
 * Genesis hưởng, không phải nhớ từng chỗ gọi.
 *
 * Phần ĐỌC blueprint ở đây; phần ÉP + thông điệp lỗi nằm ở `offchain/src/applyGate.ts`
 * (thuần, không .env, không plutus.json) để test chạm được — xem lý do đầy đủ ở đó.
 */
function assertParamCount(compiledCode: string, params: unknown[]): void {
  const meta = paramCountByCode.get(compiledCode);
  if (!meta) {
    // FAIL-CLOSED. Bản cũ `return` ở đây — tức cổng LẶNG LẼ cho qua mọi compiledCode
    // không tra được, mà đó CHÍNH LÀ trường hợp nguy hiểm nhất: không tra được thì
    // không biết blueprint khai bao nhiêu tham số, apply thiếu vẫn chạy trơn và sinh
    // script hash / policy id KHÁC, im lặng. Không tra được ⇒ DỪNG, không đoán.
    const known = BLUEPRINT_SOURCES.map((b) => b.label).join(", ");
    throw new Error(
      `APPLY-002: compiledCode (${params.length} tham số truyền vào) không có trong ` +
      `blueprint nào đã nạp (${known}) — cổng APPLY-001 KHÔNG kiểm được số tham số nên ` +
      `DỪNG (fail-closed). Apply thiếu tham số KHÔNG báo lỗi: nó sinh script hash/policy ` +
      `id khác, im lặng, và tiền vào địa chỉ đó thì không ai mở được.` +
      (blueprintLoadErrors.length
        ? ` Blueprint nạp hụt: ${blueprintLoadErrors.join("; ")} — chạy 'aiken build' rồi thử lại.`
        : ` Thêm blueprint chứa script này vào BLUEPRINT_SOURCES, hoặc lấy compiledCode qua rawValidator().`),
    );
  }
  assertParamCountGate(`${meta.source}:${meta.title}`, meta.n, params.length);
}

export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  assertParamCount(compiledCode, params);
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

/** Minting policy đã apply params (cùng cơ chế applyParamsToScript). */
export function applyPolicy(compiledCode: string, params: unknown[]): MintingPolicy {
  assertParamCount(compiledCode, params);
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

export function scriptAddress(script: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(script)));
}

export function policyId(policy: MintingPolicy): string {
  return mintingPolicyToId(policy);
}

export function scriptHashOf(script: Validator): string {
  return validatorToScriptHash(script);
}

/**
 * Đường tra giao dịch trên explorer, THEO MẠNG đang chạy.
 *
 * Bản cũ nướng cứng `preview.` cho mọi mạng, nên một lượt chạy Preprod in ra đường dẫn Preview —
 * mở lên thì "không tìm thấy giao dịch", nghe như tx hỏng chứ không nghe như link sai. Đây là
 * loại lỗi tự nó không kêu: nó chỉ làm người đọc kết luận sai về một việc đã thành công.
 */
export function explorerTx(hash: string): string {
  const host =
    NETWORK === "Mainnet" ? "cexplorer.io"
    : NETWORK === "Preprod" ? "preprod.cexplorer.io"
    : "preview.cexplorer.io";
  return `https://${host}/tx/${hash}`;
}
