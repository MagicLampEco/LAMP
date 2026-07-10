// Faucet/scripts/config.ts — cấu hình deploy tLAMP + Faucet trên Preview/Preprod.
//
// Đọc .env từ /Users/ductiger/Projects/MAGIC/.env (theo yêu cầu): BLOCKFROST_TOKEN_GREENSUN
// + VEDATA_WALLET_MNEMONIC (seed ví test). KHÔNG hard-code secret. KHÔNG submit tx
// live trong các script này (chỉ build + log) — caller tự bật SUBMIT khi sẵn sàng.

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  getAddressDetails, validatorToScriptHash, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, applyParamsToScript,
  type LucidEvolution, type Validator, type MintingPolicy,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env của MAGIC (theo yêu cầu task). Override bằng ENV_PATH nếu cần.
dotenv.config({ path: process.env.ENV_PATH ?? "/Users/ductiger/Projects/MAGIC/.env" });

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY =
  process.env.BLOCKFROST_KEY ?? process.env.BLOCKFROST_TOKEN_GREENSUN ?? "";
export const WALLET_SEED =
  (process.env.WALLET_SEED ?? process.env.VEDATA_WALLET_MNEMONIC ?? "").trim().replace(/\s+/g, " ");

/** Có thật sự submit tx live? Mặc định FALSE (chỉ build + log, theo yêu cầu). */
export const SUBMIT = (process.env.SUBMIT ?? "false").toLowerCase() === "true";

export function assertEnv(): void {
  if (!BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_TOKEN_GREENSUN trong MAGIC/.env (project Preview/Preprod).");
  }
  if (!WALLET_SEED) {
    throw new Error("thiếu VEDATA_WALLET_MNEMONIC trong MAGIC/.env (ví test, KHÔNG dùng ví mainnet).");
  }
}

export async function makeLucid(): Promise<LucidEvolution> {
  assertEnv();
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

export async function walletPkh(lucid: LucidEvolution): Promise<string> {
  const addr = await lucid.wallet().address();
  const { paymentCredential } = getAddressDetails(addr);
  if (!paymentCredential) throw new Error("không lấy được payment credential từ ví");
  return paymentCredential.hash;
}

// ── plutus.json loader + apply params ──────────────────────────

const PLUTUS_JSON_PATH = resolve(__dirname, "../onchain/plutus.json");

interface RawValidator { title: string; compiledCode: string; hash: string; }

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  return json.validators as RawValidator[];
}

export async function rawValidator(title: string): Promise<RawValidator> {
  const vs = await loadBlueprint();
  const v = vs.find((x) => x.title === title);
  if (!v) {
    throw new Error(`validator '${title}' không có trong onchain/plutus.json — chạy 'aiken build' trước.`);
  }
  return v;
}

/** Apply params → PlutusV3 spend validator. */
export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

/** Apply params → PlutusV3 minting policy. */
export function applyPolicy(compiledCode: string, params: unknown[]): MintingPolicy {
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

export function policyId(policy: MintingPolicy): string {
  return mintingPolicyToId(policy);
}

export function scriptAddress(script: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(script)));
}

export function scriptHash(script: Validator): string {
  return validatorToScriptHash(script);
}

// ── deployed-faucet.json state ─────────────────────────────────

export const DEPLOYED_PATH = resolve(__dirname, "deployed-faucet.json");

export interface FaucetDeployed {
  network: Network;
  tlamp: {
    policyId: string;
    assetName: string;
    totalSupplyOil: string;
    genesisRef: { txHash: string; outputIndex: number };
  };
  faucet: { hash: string; address: string };
  poolUtxo?: { txHash: string; outputIndex: number };
  claimAmountOil: string;
}

export async function loadDeployed(): Promise<FaucetDeployed> {
  try {
    return JSON.parse(await readFile(DEPLOYED_PATH, "utf8")) as FaucetDeployed;
  } catch {
    throw new Error(`chưa có deployed-faucet.json (${DEPLOYED_PATH}) — chạy 01_mint_pool.ts trước.`);
  }
}

export async function saveDeployed(state: FaucetDeployed): Promise<void> {
  await writeFile(DEPLOYED_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}
