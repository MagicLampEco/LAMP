// content.ts — In-memory store với persistence qua JSON file.
// Production: thay bằng Postgres/SQLite; interface không đổi.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LaunchCampaign, LaunchStats } from "./types.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dir, "../data/campaigns.json");

let cache: LaunchCampaign[] | null = null;

async function load(): Promise<LaunchCampaign[]> {
  if (cache) return cache;
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    cache = JSON.parse(raw) as LaunchCampaign[];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(): Promise<void> {
  if (!cache) return;
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

export async function listCampaigns(filter?: {
  status?: string;
  mechanism?: string;
}): Promise<LaunchCampaign[]> {
  const all = await load();
  return all.filter((c) => {
    if (filter?.status && c.status !== filter.status) return false;
    if (filter?.mechanism && c.mechanism !== filter.mechanism) return false;
    return true;
  });
}

export async function getCampaign(id: string): Promise<LaunchCampaign | null> {
  const all = await load();
  return all.find((c) => c.id === id || c.slug === id) ?? null;
}

export async function upsertCampaign(campaign: LaunchCampaign): Promise<LaunchCampaign> {
  const all = await load();
  const idx = all.findIndex((c) => c.id === campaign.id);
  const updated = { ...campaign, updated_at: new Date().toISOString() };
  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.push({ ...updated, created_at: new Date().toISOString() });
  }
  cache = all;
  await save();
  return updated;
}

export async function patchCampaign(
  id: string,
  patch: Partial<LaunchCampaign>,
): Promise<LaunchCampaign | null> {
  const all = await load();
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const updated = { ...all[idx]!, ...patch, id, updated_at: new Date().toISOString() };
  all[idx] = updated;
  cache = all;
  await save();
  return updated;
}

export async function updateStats(id: string, stats: LaunchStats): Promise<LaunchCampaign | null> {
  return patchCampaign(id, { stats });
}

export function invalidateCache(): void {
  cache = null;
}
