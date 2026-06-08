// Deposits/scripts/config.ts — cấu hình live runner cho module Deposits (Preview).
//
// Đọc .env từ repo root LAMP (../../.env). KHÔNG hard-code secret. .env có thể CHƯA
// tồn tại — script chỉ cần IMPORT được + tsc pass; chạy live (submit tx) sau khi anh
// cấp .env. SUBMIT=false (mặc định build-mode): plan + dựng tx, KHÔNG submit.
//
// Validator (Deposits/onchain/plutus.json):
//   deposits.deposits.spend : [] (KHÔNG param — instance config nằm trong datum)

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  getAddressDetails, validatorToScriptHash,
  credentialToAddress, scriptHashToCredential,
  type LucidEvolution, type Validator,
} from "@lucid-evolution/lucid";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../../.env") });

export type Network = "Mainnet" | "Preview" | "Preprod";

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? process.env.BLOCKFROST_TOKEN_GREENSUN ?? "";
export const PRIVATE_KEY    = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED    = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

// SUBMIT=false ở build-mode (chỉ plan + dựng tx). Live: SUBMIT=true + .env đủ.
export const SUBMIT = (process.env.SUBMIT ?? "false").trim().toLowerCase() === "true";

// LAMP asset (self-test override qua .env; production = policy/name thật).
// 6 decimals → 1 LAMP = 10^6 oil. name "LAMP" = 744c414d50.
export const LAMP_ASSET_NAME = (process.env.LAMP_ASSET_NAME ?? "744c414d50").trim();
export const LAMP_POLICY_ID  = (process.env.LAMP_POLICY_ID ?? "").trim();

export function assertEnv(): void {
  if (!BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_KEY trong .env — lấy từ https://blockfrost.io (project Preview).");
  }
  if (!PRIVATE_KEY && !WALLET_SEED) {
    throw new Error("thiếu PRIVATE_KEY hoặc WALLET_SEED trong .env — ví deploy testnet (KHÔNG ví mainnet).");
  }
}

export async function makeLucid(): Promise<LucidEvolution> {
  assertEnv();
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  if (PRIVATE_KEY)      lucid.selectWallet.fromPrivateKey(PRIVATE_KEY);
  else if (WALLET_SEED) lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

export async function walletPkh(lucid: LucidEvolution): Promise<string> {
  const addr = await lucid.wallet().address();
  const { paymentCredential } = getAddressDetails(addr);
  if (!paymentCredential) throw new Error("không lấy được payment credential từ ví");
  return paymentCredential.hash;
}

// ── plutus.json loader ──

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
    const have = vs.map((x) => x.title).join(", ");
    throw new Error(`validator '${title}' không có trong onchain/plutus.json — chạy 'aiken build' trước.\n  Có: ${have}`);
  }
  return v;
}

/** deposits.spend KHÔNG param → dùng compiledCode trực tiếp. */
export function depositsValidator(compiledCode: string): Validator {
  return { type: "PlutusV3", script: compiledCode };
}

export function scriptAddress(script: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(script)));
}

export function scriptHash(script: Validator): string {
  return validatorToScriptHash(script);
}

// ── deployed.json ──

export const DEPLOYED_PATH = resolve(__dirname, "deployed.json");

export interface OutRef { txHash: string; outputIndex: number; }

export interface DepositsDeployedState {
  network: Network;
  pot: { hash: string; address: string };
  instanceId: string;
  lifecycleAuthority: { kind: "VerificationKey" | "Script"; hash: string };
  reservedMinAda: string;
  genesis?: { potUtxo: OutRef };
  lamp?: { policyId: string; assetName: string };
  wallet?: { pkh: string };
}

export async function loadDeployed(): Promise<DepositsDeployedState> {
  try {
    return JSON.parse(await readFile(DEPLOYED_PATH, "utf8")) as DepositsDeployedState;
  } catch {
    throw new Error(`chưa có deployed.json (${DEPLOYED_PATH}) — chạy '01_deploy_pot.ts' trước.`);
  }
}

export async function saveDeployed(state: DepositsDeployedState): Promise<void> {
  await writeFile(DEPLOYED_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function toUnit(policyId: string, assetName: string): string {
  return policyId + assetName;
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}

export async function awaitTx(lucid: LucidEvolution, txHash: string, label = ""): Promise<void> {
  process.stdout.write(`   ⏳ đợi confirm ${label} ${txHash.slice(0, 12)}… `);
  const ok = await lucid.awaitTx(txHash);
  if (!ok) throw new Error(`tx ${txHash} không confirm sau timeout`);
  console.log("✓");
}
