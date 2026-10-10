// faucetBuild.ts — máy chủ HTTP không trạng thái: dựng giao dịch Claim CHƯA KÝ của vòi v1.
//
//   POST <base>/faucet/build   {"address": "addr_test1…"}
//     200 {"tx_cbor_hex": "…"}          ứng dụng thêm chữ ký vkey (giữ nguyên byte thân) rồi tự gửi
//     4xx/5xx {"code": "…", "message": "…"}
//   GET  <base>/health
//     200 {"commit", "network": "Preprod", "script_address", "script_hash", "ref_utxo": "<tx>#<ix>" | null}
//
// Mã lỗi: FAUCET-ADDR (400) · FAUCET-NO-ADA (422) · FAUCET-EMPTY (503) · FAUCET-BAD-REQUEST (400)
// · FAUCET-NOT-FOUND (404) · FAUCET-METHOD (405) · FAUCET-INTERNAL (500, kèm mã tham chiếu tra
// được ở log máy chủ; chi tiết nội bộ không ra ngoài).
//
// `<base>` = FAUCET_BASE_PATH: Cloudflare chuyển NGUYÊN đường (`/lampfaucet/preprod/faucet/build`),
// không cắt tiền tố ⇒ máy chủ phải biết tiền tố. Không gõ cứng: gốc công khai có thể đổi sang
// host riêng theo mạng, khi đó đặt FAUCET_BASE_PATH="" là xong.
//
// Script: FAUCET_REF_UTXO có ⇒ đọc script từ reference UTxO trên chuỗi; không có ⇒ đính trực
// tiếp script commit sẵn `Faucet/server/faucet_v1.preprod.json` (sinh từ blueprint bởi
// `Genesis/scripts/34_faucet_v1.ts` STEP=export-script). Lúc khởi động máy chủ TÍNH LẠI hash của
// script đó và từ chối chạy khi hash ≠ payment credential của POOL_ADDRESS.
//
// Biến môi trường, chạy, mã lỗi khởi động: `Faucet/server/README.md`.
//
// Không có giới hạn tần suất theo địa chỉ/IP: token thử vô giá trị, validator v1 cố ý không có
// cooldown, pool được nạp lại từ pot development.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Koios, Lucid, getAddressDetails, validatorToScriptHash, type ProtocolParameters, type UTxO,
} from "@lucid-evolution/lucid";
import {
  FAUCET_V1_CLAIM_OILDROP, FAUCET_V1_PREPROD_TLAMP, FaucetV1Error, assertClaimerAddress,
  buildFaucetV1ClaimTx, faucetV1ValidatorFromCommitted, scanFaucetV1Pool, type FaucetV1Code,
} from "../offchain/src/faucetV1.js";

export const KOIOS_PREPROD_URL = "https://preprod.koios.rest/api/v1";
export const FAUCET_BUILD_PATH = "/faucet/build";
export const FAUCET_HEALTH_PATH = "/health";
export const DEFAULT_PORT = 8187;
export const DEFAULT_HOST = "127.0.0.1";
/**
 * Script commit sẵn, tính từ vị trí tệp CHẠY: `Faucet/server/dist/server/faucetBuild.js`
 * ⇒ `Faucet/server/faucet_v1.preprod.json`. Chạy từ chỗ khác (vd. dist của Faucet/offchain) thì
 * không thấy tệp ⇒ FAUCET-SERVER-009, không chạy.
 */
export const COMMITTED_SCRIPT_URL = new URL("../../faucet_v1.preprod.json", import.meta.url);
const MAX_BODY_BYTES = 4096;

export interface HandlerResult { status: number; body: Record<string, string | null> }
/** Dựng tx cho một địa chỉ đã qua kiểm dạng; trả CBOR hex chưa ký. */
export type BuildFn = (address: string) => Promise<string>;
type Log = (msg: string, err?: unknown) => void;

export interface Health {
  commit: string;
  network: "Preprod";
  script_address: string;
  script_hash: string;
  ref_utxo: string | null;
}

/** Mã lỗi phía NGƯỜI DÙNG → HTTP. FAUCET-CONFIG là lỗi phía vận hành, đi đường 500. */
const USER_STATUS: Partial<Record<FaucetV1Code, number>> = {
  "FAUCET-ADDR": 400,
  "FAUCET-NO-ADA": 422,
  "FAUCET-EMPTY": 503,
};

const defaultLog: Log = (m, e) => console.error(m, e);

/**
 * Phần THUẦN của endpoint build: nhận body đã parse, trả status + JSON. Không mạng, không biến
 * môi trường — bài kiểm gọi thẳng hàm này với một `build` giả.
 */
export async function handleFaucetBuild(body: unknown, build: BuildFn, log: Log = defaultLog): Promise<HandlerResult> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, body: { code: "FAUCET-BAD-REQUEST", message: `body phải là JSON object {"address": "addr_test1…"}.` } };
  }
  const raw = (body as Record<string, unknown>)["address"];
  try {
    const address = assertClaimerAddress(raw);
    return { status: 200, body: { tx_cbor_hex: await build(address) } };
  } catch (e) {
    if (e instanceof FaucetV1Error && USER_STATUS[e.code] !== undefined) {
      return { status: USER_STATUS[e.code]!, body: { code: e.code, message: e.message } };
    }
    return internal(log, "lỗi nội bộ khi dựng tx", e);
  }
}

function internal(log: Log, what: string, e: unknown): HandlerResult {
  const ref = randomUUID().slice(0, 8);
  log(`[faucet] ref=${ref} ${what}`, e);
  return { status: 500, body: { code: "FAUCET-INTERNAL", message: `Lỗi máy chủ vòi. Mã tham chiếu: ${ref}.` } };
}

export interface App {
  /** Đã chuẩn hoá bởi `parseServerEnv`: "" hoặc "/a/b" (không có "/" cuối). */
  basePath: string;
  build: BuildFn;
  health: Health;
  log?: Log;
}

/**
 * Định tuyến THUẦN: (method, url, đọc-body) → kết quả. Không socket — bài kiểm gọi thẳng.
 * Khớp CHÍNH XÁC `<base>/faucet/build` và `<base>/health`; đường không mang đúng tiền tố là 404
 * (đặt sai FAUCET_BASE_PATH lộ ra ngay ở /health, không âm thầm chạy ở đường khác).
 * Body chỉ được đọc khi đường + phương thức đã đúng.
 */
export async function handleRequest(
  method: string, url: string, readBody: () => Promise<unknown>, app: App,
): Promise<HandlerResult> {
  const path = url.split("?")[0] ?? "";
  if (path === app.basePath + FAUCET_BUILD_PATH) {
    if (method !== "POST") return { status: 405, body: { code: "FAUCET-METHOD", message: `dùng POST.` } };
    let body: unknown;
    try { body = await readBody(); } catch (e) {
      return { status: 400, body: { code: "FAUCET-BAD-REQUEST", message: `body không phải JSON hợp lệ (${(e as Error).message}).` } };
    }
    return handleFaucetBuild(body, app.build, app.log);
  }
  if (path === app.basePath + FAUCET_HEALTH_PATH) {
    if (method !== "GET") return { status: 405, body: { code: "FAUCET-METHOD", message: `dùng GET.` } };
    return { status: 200, body: { ...app.health } };
  }
  return { status: 404, body: { code: "FAUCET-NOT-FOUND", message: `không có đường này.` } };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new SyntaxError(`body vượt ${MAX_BODY_BYTES} byte`);
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, r: HandlerResult): void {
  res.writeHead(r.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(r.body));
}

// ── Khởi động ────────────────────────────────────────────────────────────────

export interface ServerEnv {
  network: "Preprod";
  poolAddress: string;
  refOutRef: { txHash: string; outputIndex: number } | null;
  port: number;
  host: string;
  basePath: string;
  commit: string;
}

/** Đọc + soát biến môi trường. Sai ⇒ NÉM, máy chủ không khởi động. */
export function parseServerEnv(env: Record<string, string | undefined>): ServerEnv {
  if (env["NETWORK"] !== "Preprod") {
    throw new Error(`FAUCET-SERVER-001: NETWORK phải là 'Preprod' (đang '${env["NETWORK"] ?? ""}'). Vòi v1 chỉ nhả tLAMP Preprod.`);
  }
  const poolAddress = (env["POOL_ADDRESS"] ?? "").trim();
  let cred;
  try { cred = getAddressDetails(poolAddress); } catch {
    throw new Error(`FAUCET-SERVER-002: POOL_ADDRESS '${poolAddress}' không đọc được.`);
  }
  if (cred.networkId !== 0 || cred.paymentCredential?.type !== "Script") {
    throw new Error(`FAUCET-SERVER-002: POOL_ADDRESS phải là địa chỉ script mạng thử.`);
  }
  const refRaw = (env["FAUCET_REF_UTXO"] ?? "").trim().toLowerCase();
  let refOutRef: ServerEnv["refOutRef"] = null;
  if (refRaw !== "") {
    const m = /^([0-9a-f]{64})#(\d{1,5})$/.exec(refRaw);
    if (!m) throw new Error(`FAUCET-SERVER-003: FAUCET_REF_UTXO phải để trống hoặc có dạng <txhash 64 hex>#<chỉ số>.`);
    refOutRef = { txHash: m[1]!, outputIndex: Number(m[2]) };
  }
  const port = Number(env["PORT"] ?? String(DEFAULT_PORT));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`FAUCET-SERVER-004: PORT '${env["PORT"]}' không hợp lệ.`);
  const host = (env["HOST"] ?? DEFAULT_HOST).trim();
  if (host === "") throw new Error(`FAUCET-SERVER-004: HOST rỗng.`);
  let basePath = (env["FAUCET_BASE_PATH"] ?? "").trim().replace(/\/+$/, "");
  if (basePath !== "" && !/^(\/[A-Za-z0-9._~-]+)+$/.test(basePath)) {
    throw new Error(`FAUCET-SERVER-007: FAUCET_BASE_PATH '${env["FAUCET_BASE_PATH"]}' phải rỗng hoặc dạng /a/b (bắt đầu bằng '/').`);
  }
  basePath = basePath === "/" ? "" : basePath;
  const commit = (env["FAUCET_COMMIT"] ?? "").trim();
  if (!/^[0-9A-Za-z._-]{1,64}$/.test(commit)) {
    throw new Error(`FAUCET-SERVER-008: FAUCET_COMMIT bắt buộc (commit đang chạy, 1–64 ký tự [0-9A-Za-z._-]) — /health báo nó.`);
  }
  return { network: "Preprod", poolAddress, refOutRef, port, host, basePath, commit };
}

async function main(): Promise<void> {
  const cfg = parseServerEnv(process.env);

  // Script commit sẵn: luôn đọc + kiểm (kể cả khi có ref UTxO — để đối chiếu hash của ref).
  let committed: unknown;
  try { committed = JSON.parse(readFileSync(fileURLToPath(COMMITTED_SCRIPT_URL), "utf8")); } catch (e) {
    throw new Error(`FAUCET-SERVER-009: không đọc được ${fileURLToPath(COMMITTED_SCRIPT_URL)} (${(e as Error).message}).`);
  }
  let script;
  try { script = faucetV1ValidatorFromCommitted(committed, cfg.poolAddress); } catch (e) {
    throw new Error(`FAUCET-SERVER-006: script commit sẵn không khớp POOL_ADDRESS — ${(e as Error).message}`);
  }

  const provider = new Koios(KOIOS_PREPROD_URL);
  let pp: ProtocolParameters = await provider.getProtocolParameters();
  setInterval(() => { provider.getProtocolParameters().then((p) => { pp = p; }, (e) => console.error("[faucet] làm mới tham số giao thức hỏng", e)); },
    3_600_000).unref();

  let refUtxo: UTxO | undefined;
  if (cfg.refOutRef) {
    [refUtxo] = await provider.getUtxosByOutRef([cfg.refOutRef]);
    if (!refUtxo?.scriptRef) throw new Error(`FAUCET-SERVER-005: FAUCET_REF_UTXO không tồn tại hoặc không mang reference script.`);
    const refHash = validatorToScriptHash(refUtxo.scriptRef);
    if (refHash !== script.scriptHash) {
      throw new Error(`FAUCET-SERVER-006: reference script có hash ${refHash}, POOL_ADDRESS mang ${script.scriptHash}.`);
    }
  }

  const tlampUnit = FAUCET_V1_PREPROD_TLAMP.policyId + FAUCET_V1_PREPROD_TLAMP.assetName;
  const scan = scanFaucetV1Pool(await provider.getUtxos(cfg.poolAddress), tlampUnit, FAUCET_V1_CLAIM_OILDROP);
  const held = scan.usable.reduce((s, u) => s + (u.assets[tlampUnit] ?? 0n), 0n);
  console.log(`[faucet] Preprod · commit ${cfg.commit} · pool ${cfg.poolAddress} · ${scan.usable.length} UTxO dùng được, ` +
    `${held} oildrop tLAMP, ${scan.skipped.length} UTxO bỏ qua · script ${script.scriptHash} ` +
    (refUtxo ? `qua reference ${refUtxo.txHash}#${refUtxo.outputIndex}` : `đính trực tiếp (không reference UTxO)`));

  const source = refUtxo ? { refScriptUtxo: refUtxo } : { validator: script.validator };
  // Mỗi yêu cầu một instance Lucid: builder chọn ví người claim trên instance, nên dùng chung
  // giữa hai yêu cầu đồng thời là trộn ví. Tham số giao thức đặt sẵn ⇒ không gọi mạng thêm.
  const build: BuildFn = async (address) => {
    const lucid = await Lucid(provider, "Preprod", { presetProtocolParameters: pp });
    const r = await buildFaucetV1ClaimTx(lucid, {
      poolAddress: cfg.poolAddress, claimer: address, tlampUnit, claimAmount: FAUCET_V1_CLAIM_OILDROP, ...source,
    });
    console.log(`[faucet] dựng ${r.txHash} cho ${address} từ ${r.poolUtxo.txHash}#${r.poolUtxo.outputIndex}`);
    return r.txCbor;
  };

  const app: App = {
    basePath: cfg.basePath,
    build,
    health: {
      commit: cfg.commit, network: "Preprod", script_address: cfg.poolAddress, script_hash: script.scriptHash,
      ref_utxo: refUtxo ? `${refUtxo.txHash}#${refUtxo.outputIndex}` : null,
    },
  };

  createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req.method ?? "", req.url ?? "", () => readJson(req), app)
      .then((r) => send(res, r))
      .catch((e) => { if (!res.headersSent) send(res, internal(defaultLog, "lỗi định tuyến", e)); });
  }).listen(cfg.port, cfg.host, () =>
    console.log(`[faucet] nghe ${cfg.host}:${cfg.port} · POST ${cfg.basePath}${FAUCET_BUILD_PATH} · GET ${cfg.basePath}${FAUCET_HEALTH_PATH}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
