// Genesis/scripts/config.ts — cấu hình deploy Preview cho mô hình 4-POT.
//
// Đọc .env của MAGIC (/Users/ductiger/Projects/MAGIC/.env): BLOCKFROST_TOKEN_GREENSUN,
// VEDATA_WALLET_MNEMONIC. KHÔNG hard-code secret. SUBMIT=false mặc định — CHỈ build tx,
// anh chạy live sau khi audit.

import dotenv from "dotenv";
import {
  Lucid, Blockfrost, applyParamsToScript, validatorToScriptHash,
  getAddressDetails, type Data, type LucidEvolution, type Validator, type Network,
} from "@lucid-evolution/lucid";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env của MAGIC (theo yêu cầu: đọc /Users/ductiger/Projects/MAGIC/.env).
dotenv.config({ path: "/Users/ductiger/Projects/MAGIC/.env" });

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY =
  process.env.BLOCKFROST_KEY ?? process.env.BLOCKFROST_TOKEN_GREENSUN ?? "";
export const WALLET_SEED =
  (process.env.WALLET_SEED ?? process.env.VEDATA_WALLET_MNEMONIC ?? "").trim().replace(/\s+/g, " ");

/** SUBMIT=false mặc định — chỉ build (anh chạy live sau audit). */
export const SUBMIT = (process.env.SUBMIT ?? "false").toLowerCase() === "true";

export function assertEnv(): void {
  if (!BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_KEY/BLOCKFROST_TOKEN_GREENSUN trong MAGIC/.env (Preview).");
  }
  if (!WALLET_SEED) {
    throw new Error("thiếu WALLET_SEED/VEDATA_WALLET_MNEMONIC trong MAGIC/.env (ví testnet).");
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

// ── Blueprint loader (plutus.json từ aiken build) ──────────────
interface Blueprint {
  validators: { title: string; compiledCode: string; hash: string }[];
}

export async function loadBlueprint(): Promise<Blueprint> {
  const p = resolve(__dirname, "../onchain/plutus.json");
  return JSON.parse(await readFile(p, "utf8")) as Blueprint;
}

export function findValidator(bp: Blueprint, title: string): { compiledCode: string } {
  const v = bp.validators.find((x) => x.title === title);
  if (!v) throw new Error(`không tìm thấy validator '${title}' trong plutus.json`);
  return v;
}

/** Áp params vào compiledCode → Validator PlutusV3. */
export function applied(compiledCode: string, params: Data[]): Validator {
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params) };
}

export function scriptHash(v: Validator): string {
  return validatorToScriptHash(v);
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}
