// TIGER/scripts/build_tiger_koios.ts — dựng bảng entitlement THẬT từ koios (mainnet, KHÔNG cần key).
// READ-ONLY: chỉ đọc chain + tính toán. KHÔNG tạo tx, KHÔNG đụng LAMP đã mint.
// Output JSON để nhúng vào giao diện Launch checker (self-contained).
//
// v2 (2026-07-11): quét pool_delegators_history TỪNG EPOCH < cutoff → gồm CẢ delegator
// đã rời pool (retroactive đúng nghĩa: ai TỪNG stake TIGER đều được tính). Thêm LAMP per-epoch.
//
// Chạy: npx tsx build_tiger_koios.ts [--cutoff 637] [--out tiger_entitlements.json]

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSnapshotSet, summarize, type EpochRows } from "../offchain/src/snapshot.js";
import { computeEntitlements } from "../offchain/src/entitlement.js";
import { TIGER_TOTAL_OIL, OIL_PER_LAMP, TIGER_POOL_ID_DEFAULT } from "../offchain/src/constants.js";

const KOIOS = "https://api.koios.rest/api/v1";
const POOL = process.env.TIGER_POOL_ID ?? TIGER_POOL_ID_DEFAULT;
const cutoffArg = process.argv.indexOf("--cutoff");
const CUTOFF = BigInt(cutoffArg >= 0 && process.argv[cutoffArg + 1] ? process.argv[cutoffArg + 1]! : "637");
const outArg = process.argv.indexOf("--out");
const OUT = outArg >= 0 && process.argv[outArg + 1] ? process.argv[outArg + 1]! : "tiger_entitlements.json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function kget<T>(path: string): Promise<T> {
  for (let a = 0; ; a++) {
    const res = await fetch(`${KOIOS}${path}`, { headers: { accept: "application/json" } });
    if (res.status === 429 && a < 8) { await sleep(1500 * (a + 1)); continue; }
    if (!res.ok) throw new Error(`koios ${res.status} ${path}`);
    return res.json() as Promise<T>;
  }
}
async function kpost<T>(path: string, body: unknown): Promise<T> {
  for (let a = 0; ; a++) {
    const res = await fetch(`${KOIOS}${path}`, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && a < 8) { await sleep(1500 * (a + 1)); continue; }
    if (!res.ok) throw new Error(`koios ${res.status} ${path}`);
    return res.json() as Promise<T>;
  }
}

interface PoolHistRow { epoch_no: number; active_stake: string | null; }
interface DelegRow { stake_address: string; amount: string; }
interface AcctAddr { stake_address: string; addresses: string[] }

/** Phân bổ tổng LAMP nguyên của 1 owner ra các epoch ∝ stake (largest-remainder, bảo toàn). */
function attributePerEpoch(totalLamp: bigint, epochStakes: bigint[]): bigint[] {
  const denom = epochStakes.reduce((s, x) => s + x, 0n);
  if (denom === 0n || totalLamp === 0n) return epochStakes.map(() => 0n);
  const floors: bigint[] = [], rema: { i: number; r: bigint }[] = [];
  let used = 0n;
  epochStakes.forEach((st, i) => {
    const num = totalLamp * st;
    const f = num / denom; floors[i] = f; used += f;
    rema.push({ i, r: num % denom });
  });
  let left = totalLamp - used;
  rema.sort((a, b) => (b.r < a.r ? -1 : b.r > a.r ? 1 : a.i - b.i));
  for (let k = 0; k < rema.length && left > 0n; k++) { floors[rema[k]!.i] += 1n; left -= 1n; }
  return floors;
}

async function main() {
  console.log(`Pool:   ${POOL}\nCutoff: <${CUTOFF} (mainnet epoch 637 = 18/6 UTC)\nKoios:  mainnet (no key)\n`);

  // 1) khoảng epoch pool hoạt động (pool_history) → các epoch < cutoff
  const hist = await kget<PoolHistRow[]>(`/pool_history?_pool_bech32=${POOL}&select=epoch_no,active_stake`);
  const epochs = hist.map((h) => h.epoch_no).filter((e) => BigInt(e) < CUTOFF).sort((a, b) => a - b);
  console.log(`Pool hoạt động ${hist.length} epoch; ${epochs.length} epoch < cutoff (${epochs[0]}…${epochs[epochs.length - 1]})`);

  // 2) quét delegator TỪNG epoch (gồm cả người đã rời) → per-epoch rows
  const perEpoch: EpochRows[] = [];
  let seen = 0;
  for (const ep of epochs) {
    const rows: DelegRow[] = [];
    for (let page = 1; ; page++) {
      const chunk = await kget<DelegRow[]>(
        `/pool_delegators_history?_pool_bech32=${POOL}&_epoch_no=${ep}&select=stake_address,amount&offset=${(page - 1) * 1000}&limit=1000`,
      );
      rows.push(...chunk);
      if (chunk.length < 1000) break;
    }
    const good = rows.filter((r) => BigInt(r.amount) > 0n)
      .map((r) => ({ stake_address: r.stake_address, amount: r.amount }));
    if (good.length) perEpoch.push({ epoch: BigInt(ep), rows: good });
    seen += good.length;
    if (ep % 20 === 0 || ep === epochs[epochs.length - 1]) console.log(`  epoch ${ep}: ${good.length} delegator (Σ rows ${seen})`);
    await sleep(120);
  }

  const snap = buildSnapshotSet(perEpoch);          // owner = stake_address
  const { accStake, totalStake, owners } = summarize(snap);
  const { entitlements, distributed, leftover } = computeEntitlements(snap, { budgetOil: TIGER_TOTAL_OIL });
  console.log(`\nOwner duy nhất: ${owners} · Σ accStake=${totalStake} · phân bổ ${distributed / OIL_PER_LAMP} LAMP · leftover ${leftover / OIL_PER_LAMP}`);

  // 3) per-owner epochs {epoch, stake} (để hiển thị + attribute LAMP)
  const perOwnerEpochs = new Map<string, { epoch: bigint; stake: bigint }[]>();
  for (const er of perEpoch) for (const r of er.rows) {
    if (!perOwnerEpochs.has(r.stake_address)) perOwnerEpochs.set(r.stake_address, []);
    perOwnerEpochs.get(r.stake_address)!.push({ epoch: er.epoch, stake: BigInt(r.amount) });
  }

  const entMap = new Map(entitlements.map((e) => [e.owner, e]));
  const stakes = [...perOwnerEpochs.keys()];

  // 4) payment addresses — CHỈ cho owner có entitlement > 0 (rẻ hơn)
  const entitledStakes = stakes.filter((s) => (entMap.get(s)?.amount ?? 0n) > 0n);
  const addrMap = new Map<string, string[]>();
  const BATCH = 40;
  for (let i = 0; i < entitledStakes.length; i += BATCH) {
    const chunk = entitledStakes.slice(i, i + BATCH);
    try {
      const aas = await kpost<AcctAddr[]>(`/account_addresses`, { _stake_addresses: chunk });
      for (const aa of aas) addrMap.set(aa.stake_address, aa.addresses ?? []);
    } catch { /* vẫn tra bằng stake addr */ }
    await sleep(250);
  }

  const entries = [];
  for (const sa of entitledStakes) {
    const e = entMap.get(sa)!;
    const eps = (perOwnerEpochs.get(sa) ?? []).sort((a, b) => (a.epoch < b.epoch ? -1 : 1));
    const lampTotal = e.amount / OIL_PER_LAMP;               // LAMP nguyên owner
    const perEpLamp = attributePerEpoch(lampTotal, eps.map((x) => x.stake));
    entries.push({
      stake_address: sa,
      addresses: addrMap.get(sa) ?? [],
      acc_stake_lovelace: (accStake.get(sa) ?? 0n).toString(),
      claimable_lamp: lampTotal.toString(),
      claimable_lamp_frac: Number(e.amount % OIL_PER_LAMP) / 1e6,
      capped: e.capped,
      epochs: eps.map((x, i) => ({ epoch: String(x.epoch), stake: x.stake.toString(), lamp: perEpLamp[i]!.toString() })),
    });
  }

  const out = {
    meta: {
      pool_id: POOL, cutoff_epoch: String(CUTOFF), network: "mainnet",
      budget_lamp: (TIGER_TOTAL_OIL / OIL_PER_LAMP).toString(),
      total_owners: entries.length, total_acc_stake_lovelace: totalStake.toString(),
      provisional: true,
      note: "PROVISIONAL — gồm MỌI ai từng stake TIGER (< epoch 637), kể cả đã rời pool; owner=stake_address; số LAMP có thể đổi khi chốt registration payment address.",
    },
    entries: entries.sort((a, b) => Number(BigInt(b.claimable_lamp) - BigInt(a.claimable_lamp))),
  };
  const outPath = resolve(process.cwd(), OUT);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✓ ${entries.length} owner → ${outPath}`);
  const tot = entries.reduce((s, e) => s + Number(e.claimable_lamp), 0);
  console.log(`Top owner share: ${(Number(entries[0]?.claimable_lamp ?? 0) / tot * 100).toFixed(1)}%  ·  owner > 1000 LAMP: ${entries.filter((e) => Number(e.claimable_lamp) > 1000).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
