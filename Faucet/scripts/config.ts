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
// Cổng đếm khe apply-param (dùng chung toàn kho) — xem `blueprintSource.ts`.
import { blueprintGate } from "../../Genesis/offchain/src/blueprintSource.js";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env của MAGIC (theo yêu cầu task). Override bằng ENV_PATH nếu cần.
// Secret: MỘT nguồn duy nhất — $AGENT_SECRETS. KHÔNG có đường dự phòng nướng cứng.
// Đường dự phòng cũ trỏ vào bộ nhà agent ở chỗ cũ — chỗ đó đã dời, nên hằng số ấy là
// một con trỏ chết. Con trỏ chết im lặng theo HAI chiều: dotenv KHÔNG báo khi tệp
// không tồn tại (script chỉ gãy muộn hơn, ở một chỗ không liên quan), và nếu về sau có
// tệp thật mọc đúng đường đó thì nó được đọc mà không ai chọn.
if (!process.env.AGENT_SECRETS) {
  throw new Error(
    "SECRETS-001: thiếu $AGENT_SECRETS. Secret CHỈ đọc từ biến này, không có đường dự phòng.",
  );
}
dotenv.config({ path: process.env.AGENT_SECRETS });

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

/**
 * Cổng đếm khe của blueprint Faucet. Số khe ĐỌC từ blueprint, không nhận số gõ tay — lý do
 * đầy đủ ở `Genesis/offchain/src/blueprintSource.ts`. Đọc tệp LAZY (lần apply đầu tiên).
 */
export const FAUCET_GATE = blueprintGate(PLUTUS_JSON_PATH, "Faucet");

/** Apply params → PlutusV3 spend validator, QUA cổng đếm khe. */
export function applyValidator(compiledCode: string, params: unknown[]): Validator {
  FAUCET_GATE.assertParamCountOfCode(compiledCode, params.length);
  return { type: "PlutusV3", script: applyParamsToScript(compiledCode, params as never) };
}

/** Apply params → PlutusV3 minting policy, QUA cổng đếm khe. */
export function applyPolicy(compiledCode: string, params: unknown[]): MintingPolicy {
  FAUCET_GATE.assertParamCountOfCode(compiledCode, params.length);
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

/**
 * Con trỏ về NGUỒN DUY NHẤT của policy id tLAMP, đóng dấu vào mọi lượt ghi state.
 *
 * VÌ SAO SINH CHỨ KHÔNG CHÉP TAY: `saveDeployed` ghi đè TRỌN tệp. Một dòng cảnh báo gõ tay vào
 * `deployed-faucet.json` sẽ biến mất ở lần `01_mint_pool.ts` kế tiếp — im lặng, không lỗi, và
 * người đọc sau lại thấy một tệp trông sạch sẽ khai mình là nguồn. Đóng dấu ở tầng ghi thì bản
 * sao không tự chết được.
 */
export const TLAMP_POLICY_ID_SOURCE =
  "Genesis/offchain/src/lampPolicies.ts — NGUỒN DUY NHẤT cho policy id + TRẠNG THÁI " +
  "(ACTIVE / SUPERSEDED / PENDING-MINT). Đọc bằng activeLampPolicyId(network); hàm đó NÉM khi " +
  "mạng chưa có bản ACTIVE, thay vì trả một giá trị trông hợp lệ. Giá trị trong tệp này là ẢNH " +
  "CHỤP của một lượt deploy, KHÔNG phải nguồn — đừng chép nó sang repo khác.";

export interface FaucetDeployed {
  network: Network;
  tlamp: {
    policyId: string;
    assetName: string;
    totalSupplyOildrop: string;
    genesisRef: { txHash: string; outputIndex: number };
  };
  faucet: { hash: string; address: string };
  poolUtxo?: { txHash: string; outputIndex: number };
  claimAmountOildrop: string;
  /** Đóng dấu tự động bởi `saveDeployed` — đừng đặt tay, đừng xoá. */
  _policyIdSource?: string;
}

export async function loadDeployed(): Promise<FaucetDeployed> {
  try {
    return JSON.parse(await readFile(DEPLOYED_PATH, "utf8")) as FaucetDeployed;
  } catch {
    throw new Error(`chưa có deployed-faucet.json (${DEPLOYED_PATH}) — chạy 01_mint_pool.ts trước.`);
  }
}

export async function saveDeployed(state: FaucetDeployed): Promise<void> {
  // Đóng dấu con trỏ nguồn ở tầng GHI, không ở tầng gọi: chỗ gọi quên một lần là bản sao mất
  // đường về nguồn, và không gì kêu lên.
  const stamped: FaucetDeployed = { ...state, _policyIdSource: TLAMP_POLICY_ID_SOURCE };
  await writeFile(DEPLOYED_PATH, JSON.stringify(stamped, null, 2) + "\n", "utf8");
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}
