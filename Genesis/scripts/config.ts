// Genesis scripts config — Preview deploy lazy-mint (self-contained).
//
// Đọc .env (BLOCKFROST_KEY, PRIVATE_KEY/WALLET_SEED, NETWORK=Preview). KHÔNG hard-code
// secret. SUBMIT=false (mặc định) → build tx + in CBOR, KHÔNG gửi lên chain (an toàn,
// kiểm tra logic trước khi tốn tADA). SUBMIT=true để gửi thật.

import dotenv from "dotenv";
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

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? process.env.BLOCKFROST_TOKEN_GREENSUN ?? "";
export const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

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
  if (override) return override;
  return network === "Mainnet" ? LAMP_NAME : TLAMP_NAME;
}

/** asset name LAMP áp dụng cho deploy hiện tại (theo NETWORK). */
export const TOKEN_NAME = tokenNameFor(NETWORK);

export function assertEnv(): void {
  if (!BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_KEY trong .env — lấy từ https://blockfrost.io (Preview).");
  }
  if (!PRIVATE_KEY && !WALLET_SEED) {
    throw new Error("thiếu PRIVATE_KEY hoặc WALLET_SEED trong .env — ví deploy testnet.");
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

/** Số tham số blueprint khai, tra theo compiledCode. Nạp một lần, giữ trong bộ nhớ. */
const paramCountByCode = new Map<string, { title: string; n: number }>();

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  const vs = json.validators as RawValidator[];
  for (const v of vs) {
    // `.mint`/`.spend` và `.else` dùng CHUNG compiledCode; giữ tên của bản chính để
    // thông điệp lỗi đọc ra đúng validator, không phải nhánh `.else`.
    if (v.title.endsWith(".else") && paramCountByCode.has(v.compiledCode)) continue;
    paramCountByCode.set(v.compiledCode, { title: v.title, n: (v.parameters ?? []).length });
  }
  return vs;
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
  if (!meta) return; // code không từ blueprint này (vd module khác) — không đoán.
  assertParamCountGate(meta.title, meta.n, params.length);
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

export function explorerTx(hash: string): string {
  return `https://preview.cexplorer.io/tx/${hash}`;
}
