// Treasury/scripts/config.ts — Cấu hình live test runner cho module Treasury (Preview).
//
// Đọc .env từ repo root LAMP (../../.env so với Treasury/scripts/). KHÔNG hard-code
// secret. LƯU Ý: .env có thể CHƯA tồn tại — các script này chỉ cần IMPORT được + tsc
// pass; chạy live (submit tx) để sau khi anh cấp .env.
//
// Cung cấp: Lucid provider, wallet select, plutus.json loader + apply params cho
// custody / custody_seed, helper epoch + deployed.json state.
//
// Validator (theo Treasury/onchain/plutus.json + .ak):
//   custody.custody.spend      : [proposal_policy:ByteArray, ms_per_epoch:Int]
//                                (custody.ak: validator custody(proposal_policy, ms_per_epoch))
//   custody_seed.custody_seed.mint : [genesis_ref:OutputReference, custody_script_hash:ByteArray]
//                                (custody_seed.ak — one-shot mint NFT authenticity custody)
//
// LƯU Ý desync blueprint: nếu `aiken build` chưa export đủ param/validator (vd
// custody_seed chưa có trong plutus.json), rawValidator ném lỗi rõ → chạy
// `aiken build` trong onchain/ trước.

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  getAddressDetails, validatorToScriptHash,
  credentialToAddress, scriptHashToCredential,
  applyParamsToScript, mintingPolicyToId,
  type LucidEvolution, type Validator, type MintingPolicy,
} from "@lucid-evolution/lucid";
import { msPerEpoch, S_LAMP_TOTAL, type Network } from "@magiclamp/protocol-utils";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env từ repo root LAMP (../../.env), không phụ thuộc cwd.
dotenv.config({ path: resolve(__dirname, "../../.env") });

// ── Network + provider ─────────────────────────────────────────
export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? process.env.BLOCKFROST_TOKEN_GREENSUN ?? "";
export const PRIVATE_KEY    = process.env.PRIVATE_KEY ?? "";
export const WALLET_SEED    = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");

export const MS_PER_EPOCH = msPerEpoch(NETWORK);

// Tổng cung LAMP cố định (oil) — fixed-supply 36 tỷ × 10^6. Dùng tính circulating.
export const LAMP_TOTAL_SUPPLY = S_LAMP_TOTAL;

// LAMP asset (self-test override qua .env; production = policy/name thật).
export const LAMP_ASSET_NAME = (process.env.LAMP_ASSET_NAME ?? "4c414d50").trim(); // "LAMP"
export const LAMP_POLICY_ID  = (process.env.LAMP_POLICY_ID ?? "").trim();

/** Bắt lỗi rõ khi thiếu credential — anh Aladin cấp .env sau. */
export function assertEnv(): void {
  if (!BLOCKFROST_KEY) {
    throw new Error("thiếu BLOCKFROST_KEY trong .env — lấy từ https://blockfrost.io (project Preview).");
  }
  if (!PRIVATE_KEY && !WALLET_SEED) {
    throw new Error("thiếu PRIVATE_KEY hoặc WALLET_SEED trong .env — ví deploy testnet (KHÔNG dùng ví mainnet).");
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

// ── plutus.json loader + apply params ──────────────────────────

const PLUTUS_JSON_PATH = resolve(__dirname, "../onchain/plutus.json");

interface RawValidator {
  title: string;
  compiledCode: string;
  hash: string;
  parameters?: { title?: string }[];
}

async function loadBlueprint(): Promise<RawValidator[]> {
  const json = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  return json.validators as RawValidator[];
}

/** Lấy validator chưa apply theo title. Ném lỗi rõ nếu thiếu (chưa aiken build). */
export async function rawValidator(title: string): Promise<RawValidator> {
  const vs = await loadBlueprint();
  const v = vs.find((x) => x.title === title);
  if (!v) {
    const have = vs.map((x) => x.title).join(", ");
    throw new Error(
      `validator '${title}' không có trong onchain/plutus.json — chạy 'aiken build' trong onchain/ trước.\n`
        + `  Có sẵn: ${have}`,
    );
  }
  return v;
}

/** Plutus Data hex của 1 param list → applied Validator (spend). */
export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

/** Apply params → MintingPolicy (cùng compiled code, chỉ khác kiểu nhãn). */
export function applyMintingPolicy(compiledCode: string, params: unknown[]): MintingPolicy {
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

export function scriptAddress(script: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(script)));
}

export function scriptHash(script: Validator): string {
  return validatorToScriptHash(script);
}

export function policyIdOf(policy: MintingPolicy): string {
  return mintingPolicyToId(policy);
}

// ── Epoch (POSIX-derived, khớp validator) ──────────────────────

export async function tipPosixMs(): Promise<bigint> {
  const res = await fetch(`${BLOCKFROST_URL}/blocks/latest`, {
    headers: { project_id: BLOCKFROST_KEY },
  });
  if (!res.ok) throw new Error(`Blockfrost /blocks/latest lỗi ${res.status}`);
  const tip = (await res.json()) as { time: number };
  return BigInt(tip.time) * 1000n;
}

export async function currentEpoch(): Promise<bigint> {
  return (await tipPosixMs()) / MS_PER_EPOCH;
}

// ── deployed.json (state giữa các bước) ────────────────────────

export const DEPLOYED_PATH = resolve(__dirname, "deployed.json");

export interface OutRef { txHash: string; outputIndex: number; }

export interface TreasuryDeployedState {
  network: Network;
  msPerEpoch: string;
  // proposal policy (Governance one-shot NFT) — self-test có thể là placeholder.
  proposalPolicy: string;
  // applied custody validator
  custody: { hash: string; address: string };
  // custody_seed minting policy (one-shot theo genesis_ref)
  custodySeed?: { policyId: string; genesisRef: OutRef; instanceId: string };
  // genesis custody UTxO (sau 01_deploy_custody)
  genesis?: { custodyUtxo: OutRef };
  // LAMP token dùng test
  lamp?: { policyId: string; assetName: string };
  // ví deploy
  wallet?: { pkh: string };
}

export async function loadDeployed(): Promise<TreasuryDeployedState> {
  try {
    return JSON.parse(await readFile(DEPLOYED_PATH, "utf8")) as TreasuryDeployedState;
  } catch {
    throw new Error(
      `chưa có deployed.json (${DEPLOYED_PATH}) — chạy '01_deploy_custody.ts' trước.`,
    );
  }
}

export async function saveDeployed(state: TreasuryDeployedState): Promise<void> {
  await writeFile(DEPLOYED_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ── misc ───────────────────────────────────────────────────────

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
