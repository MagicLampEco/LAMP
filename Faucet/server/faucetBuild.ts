// faucetBuild.ts — máy chủ HTTP không trạng thái: dựng giao dịch Claim CHƯA KÝ của vòi v1.
//
//   POST /faucet/build   {"address": "addr_test1…"}
//     200 {"tx_cbor_hex": "…"}          ứng dụng thêm chữ ký vkey (giữ nguyên byte thân) rồi tự gửi
//     4xx/5xx {"code": "…", "message": "…"}
//
// Mã lỗi: FAUCET-ADDR (400) · FAUCET-NO-ADA (422) · FAUCET-EMPTY (503) · FAUCET-BAD-REQUEST (400)
// · FAUCET-NOT-FOUND (404) · FAUCET-METHOD (405) · FAUCET-INTERNAL (500, kèm mã tham chiếu tra
// được ở log máy chủ; chi tiết nội bộ không ra ngoài).
//
// Không phụ thuộc mới: chỉ `node:http` + lucid-evolution (đã có trong Faucet/offchain).
// Nhà cung cấp: Koios Preprod công khai (không cần khoá). Script đọc từ reference UTxO trên
// chuỗi, nên máy chủ KHÔNG cần blueprint — chỉ cần ba biến:
//   NETWORK=Preprod                      bắt buộc, khác giá trị này thì KHÔNG khởi động
//   POOL_ADDRESS=addr_test1w…            địa chỉ pool vòi v1 (`Genesis/scripts/34_faucet_v1.ts` STEP=address in ra)
//   FAUCET_REF_UTXO=<txhash>#<ix>        UTxO mang reference script (34 STEP=ref dựng)
//   PORT=8787                            tuỳ chọn
//
// Chạy (từ Faucet/offchain, sau `npm run build` — tsconfig đã gồm ../server):
//   NETWORK=Preprod POOL_ADDRESS=… FAUCET_REF_UTXO=…#0 node dist/server/faucetBuild.js
//
// Không có giới hạn tần suất theo IP: token thử vô giá trị, và validator v1 cố ý không có cooldown.
// Đặt sau một reverse proxy có rate-limit nếu cần.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  Koios, Lucid, getAddressDetails, validatorToScriptHash, type ProtocolParameters, type UTxO,
} from "@lucid-evolution/lucid";
import {
  FAUCET_V1_CLAIM_OILDROP, FAUCET_V1_PREPROD_TLAMP, FaucetV1Error, assertClaimerAddress,
  buildFaucetV1ClaimTx, scanFaucetV1Pool, type FaucetV1Code,
} from "../offchain/src/faucetV1.js";

export const KOIOS_PREPROD_URL = "https://preprod.koios.rest/api/v1";
export const FAUCET_BUILD_PATH = "/faucet/build";
const MAX_BODY_BYTES = 4096;

export interface HandlerResult { status: number; body: Record<string, string> }
/** Dựng tx cho một địa chỉ đã qua kiểm dạng; trả CBOR hex chưa ký. */
export type BuildFn = (address: string) => Promise<string>;

/** Mã lỗi phía NGƯỜI DÙNG → HTTP. FAUCET-CONFIG là lỗi phía vận hành, đi đường 500. */
const USER_STATUS: Partial<Record<FaucetV1Code, number>> = {
  "FAUCET-ADDR": 400,
  "FAUCET-NO-ADA": 422,
  "FAUCET-EMPTY": 503,
};

/**
 * Phần THUẦN của endpoint: nhận body đã parse, trả status + JSON. Không mạng, không biến môi
 * trường — bài kiểm gọi thẳng hàm này với một `build` giả.
 */
export async function handleFaucetBuild(
  body: unknown,
  build: BuildFn,
  log: (msg: string, err?: unknown) => void = (m, e) => console.error(m, e),
): Promise<HandlerResult> {
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
    const ref = randomUUID().slice(0, 8);
    log(`[faucet] ref=${ref} lỗi nội bộ khi dựng tx`, e);
    return { status: 500, body: { code: "FAUCET-INTERNAL", message: `Lỗi máy chủ vòi. Mã tham chiếu: ${ref}.` } };
  }
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

/** Định tuyến: chỉ POST /faucet/build. Tách khỏi `main` để kiểm được không cần mạng. */
export async function route(req: IncomingMessage, res: ServerResponse, build: BuildFn): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  if (path !== FAUCET_BUILD_PATH) return send(res, { status: 404, body: { code: "FAUCET-NOT-FOUND", message: `chỉ có POST ${FAUCET_BUILD_PATH}.` } });
  if (req.method !== "POST") return send(res, { status: 405, body: { code: "FAUCET-METHOD", message: `dùng POST.` } });
  let body: unknown;
  try { body = await readJson(req); } catch (e) {
    return send(res, { status: 400, body: { code: "FAUCET-BAD-REQUEST", message: `body không phải JSON hợp lệ (${(e as Error).message}).` } });
  }
  send(res, await handleFaucetBuild(body, build));
}

// ── Khởi động ────────────────────────────────────────────────────────────────

export interface ServerEnv { network: "Preprod"; poolAddress: string; refOutRef: { txHash: string; outputIndex: number }; port: number }

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
  const m = /^([0-9a-f]{64})#(\d{1,5})$/.exec((env["FAUCET_REF_UTXO"] ?? "").trim().toLowerCase());
  if (!m) throw new Error(`FAUCET-SERVER-003: FAUCET_REF_UTXO phải có dạng <txhash 64 hex>#<chỉ số>.`);
  const port = Number(env["PORT"] ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`FAUCET-SERVER-004: PORT '${env["PORT"]}' không hợp lệ.`);
  return { network: "Preprod", poolAddress, refOutRef: { txHash: m[1]!, outputIndex: Number(m[2]) }, port };
}

async function main(): Promise<void> {
  const cfg = parseServerEnv(process.env);
  const provider = new Koios(KOIOS_PREPROD_URL);
  let pp: ProtocolParameters = await provider.getProtocolParameters();
  setInterval(() => { provider.getProtocolParameters().then((p) => { pp = p; }, (e) => console.error("[faucet] làm mới tham số giao thức hỏng", e)); },
    3_600_000).unref();

  const [refUtxo]: UTxO[] = await provider.getUtxosByOutRef([cfg.refOutRef]);
  if (!refUtxo?.scriptRef) throw new Error(`FAUCET-SERVER-005: FAUCET_REF_UTXO không tồn tại hoặc không mang reference script.`);
  const refHash = validatorToScriptHash(refUtxo.scriptRef);
  const poolHash = getAddressDetails(cfg.poolAddress).paymentCredential!.hash;
  if (refHash !== poolHash) {
    throw new Error(`FAUCET-SERVER-006: reference script có hash ${refHash}, POOL_ADDRESS mang ${poolHash}.`);
  }

  const tlampUnit = FAUCET_V1_PREPROD_TLAMP.policyId + FAUCET_V1_PREPROD_TLAMP.assetName;
  const scan = scanFaucetV1Pool(await provider.getUtxos(cfg.poolAddress), tlampUnit, FAUCET_V1_CLAIM_OILDROP);
  const held = scan.usable.reduce((s, u) => s + (u.assets[tlampUnit] ?? 0n), 0n);
  console.log(`[faucet] Preprod · pool ${cfg.poolAddress} · ${scan.usable.length} UTxO dùng được, ${held} oildrop tLAMP, ` +
    `${scan.skipped.length} UTxO bỏ qua · script ${poolHash}`);

  // Mỗi yêu cầu một instance Lucid: builder chọn ví người claim trên instance, nên dùng chung
  // giữa hai yêu cầu đồng thời là trộn ví. Tham số giao thức đặt sẵn ⇒ không gọi mạng thêm.
  const build: BuildFn = async (address) => {
    const lucid = await Lucid(provider, "Preprod", { presetProtocolParameters: pp });
    const r = await buildFaucetV1ClaimTx(lucid, {
      poolAddress: cfg.poolAddress, claimer: address, tlampUnit, claimAmount: FAUCET_V1_CLAIM_OILDROP, refScriptUtxo: refUtxo,
    });
    console.log(`[faucet] dựng ${r.txHash} cho ${address} từ ${r.poolUtxo.txHash}#${r.poolUtxo.outputIndex}`);
    return r.txCbor;
  };

  createServer((req, res) => {
    route(req, res, build).catch((e) => {
      const ref = randomUUID().slice(0, 8);
      console.error(`[faucet] ref=${ref} lỗi định tuyến`, e);
      if (!res.headersSent) send(res, { status: 500, body: { code: "FAUCET-INTERNAL", message: `Lỗi máy chủ vòi. Mã tham chiếu: ${ref}.` } });
    });
  }).listen(cfg.port, () => console.log(`[faucet] nghe cổng ${cfg.port}, POST ${FAUCET_BUILD_PATH}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
