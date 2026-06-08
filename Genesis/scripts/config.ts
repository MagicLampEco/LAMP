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

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? process.env.BLOCKFROST_TOKEN_GREENSUN ?? "";
export const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

/** SUBMIT=false (mặc định) → chỉ build tx + in CBOR, KHÔNG gửi chain. */
export const SUBMIT = (process.env.SUBMIT ?? "false").toLowerCase() === "true";

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

interface RawValidator { title: string; compiledCode: string; hash: string; }

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  return json.validators as RawValidator[];
}

export async function rawValidator(title: string): Promise<RawValidator> {
  const vs = await loadBlueprint();
  const v = vs.find((x) => x.title === title);
  if (!v) throw new Error(`validator '${title}' không có trong plutus.json — chạy 'aiken build' trong onchain/.`);
  return v;
}

export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

/** Minting policy đã apply params (cùng cơ chế applyParamsToScript). */
export function applyPolicy(compiledCode: string, params: unknown[]): MintingPolicy {
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
