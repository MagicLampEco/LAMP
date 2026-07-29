// Airdrop/scripts/config.ts — Cấu hình cho Airdrop scripts.
// Đọc .env, cung cấp Lucid + Blockfrost helpers. KHÔNG hard-code secret.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Lucid, Blockfrost,
  getAddressDetails,
  type LucidEvolution,
} from "@lucid-evolution/lucid";

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env từ thư mục gốc Airdrop/scripts hoặc repo root
function loadEnv(): void {
  const candidates = [
    resolve(__dir, ".env"),
    resolve(__dir, "../../.env"),
    resolve(__dir, "../../../.env"),
  ];
  for (const p of candidates) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]!] === undefined) {
          process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
        }
      }
      break;
    } catch { /* thử file tiếp */ }
  }
}
loadEnv();

export type Network = "Preview" | "Preprod" | "Mainnet";
export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
export const WALLET_SEED = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;

export function assertEnv(): void {
  if (!BLOCKFROST_KEY)
    throw new Error("thiếu BLOCKFROST_KEY trong .env");
  if (!WALLET_SEED)
    throw new Error("thiếu WALLET_SEED trong .env");
  if (NETWORK !== "Preview" && NETWORK !== "Preprod" && NETWORK !== "Mainnet")
    throw new Error(`NETWORK không hợp lệ: ${NETWORK}`);
}

export async function makeLucid(): Promise<LucidEvolution> {
  assertEnv();
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

export async function walletAddress(lucid: LucidEvolution): Promise<string> {
  return lucid.wallet().address();
}

export function walletPkh(lucid: LucidEvolution, addr: string): string {
  const det = getAddressDetails(addr);
  if (!det.paymentCredential) throw new Error("không lấy được payment credential");
  return det.paymentCredential.hash;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Blockfrost GET với retry 429. */
export async function bf<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BLOCKFROST_URL}${path}`, {
      headers: { project_id: BLOCKFROST_KEY },
    });
    if (res.status === 429 && attempt < 6) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return [] as unknown as T;
    if (!res.ok) throw new Error(`Blockfrost ${res.status} ${path}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
}

/** Phân trang tự động (count=100). */
export async function bfAll<T>(base: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const sep = base.includes("?") ? "&" : "?";
    const chunk = await bf<T[]>(`${base}${sep}count=100&page=${page}`);
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

/** Epoch hiện tại từ Blockfrost tip. */
export async function currentEpoch(): Promise<bigint> {
  const tip = await bf<{ epoch: number }>("/blocks/latest");
  return BigInt(tip.epoch);
}

export function explorerTx(hash: string): string {
  const net = NETWORK === "Mainnet" ? "" : `${NETWORK.toLowerCase()}.`;
  return `https://${net}cardanoscan.io/transaction/${hash}`;
}
