// TIGER/scripts/config.ts — cấu hình Blockfrost cho snapshot builder TIGER.
// Chỉ cần đọc chain (KHÔNG ký tx) → không nạp Lucid, giữ nhẹ dependency.
// Đọc .env; KHÔNG hard-code secret. Mẫu tái dùng từ Airdrop/scripts/config.ts.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

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
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;

/** Pool TIGER (bech32 pool1... hoặc hex). Mặc định = pool TIGER chính thức; override qua env. */
export const TIGER_POOL_ID =
  process.env.TIGER_POOL_ID ??
  "pool1q9kwa675j2z53jecrs6pn3fqsc9ypxrsypu5dgu6hammqkagy22";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Blockfrost GET với retry 429; 404 → mảng rỗng (epoch chưa có stake). */
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
