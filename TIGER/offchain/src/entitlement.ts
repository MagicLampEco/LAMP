// TIGER entitlement — tích lũy stake qua mọi snapshot trước cutoff → E_i (oil).
//
// ─────────────────────────────────────────────────────────────────────────
// THUẬT TOÁN (tất định, bảo toàn oil)
//
//   1. Tích lũy:  accStake[o] = Σ_snapshot stake(o)   (cộng mọi epoch < cutoff).
//      → Ví stake X qua 10 epoch nhận 10X "stake·epoch": THƯỞNG LÒNG TRUNG THÀNH
//        theo thời gian (KHÔNG token-weighted governance — đây là phân bổ pot).
//      → Loại ví self-dealing (sáng lập/đối tác) TRƯỚC khi chia (chống tư lợi).
//
//   2. Tỷ lệ:     E_i = floor(budget × accStake_i / Σ accStake).
//
//   3. Cap/ví (water-filling, tùy chọn): ví chạm trần cap → ghim = cap, phần dôi
//      chia lại theo tỷ lệ cho ví CHƯA chạm trần; lặp tới ổn định. Chống cá voi.
//
//   4. Dư floor: gom phần lẻ (budget − Σ E_i) bù vào ví CHƯA-cap có stake lớn nhất
//      (tie → owner hex nhỏ nhất) tới khi đầy cap; còn dư → leftover (về treasury).
//
//   Bất biến: 0 ≤ E_i ≤ cap; Σ E_i + leftover = budget (cap=null ⇒ leftover=0).

import { TIGER_TOTAL_OIL } from "./constants.js";
import type {
  EntitlementParams,
  SnapshotSet,
  StakeEntry,
  TigerEntitlement,
} from "./types.js";

/** Tham số mặc định: full budget, không cap, không loại ai. */
export function defaultParams(): EntitlementParams {
  return { budgetOil: TIGER_TOTAL_OIL, capOil: null, excluded: new Set() };
}

/** B1 — tích lũy stake qua mọi snapshot. Loại excluded + stake 0.
 *  Trả Map owner→accStake (chỉ ví > 0).
 *
 *  TOÀN VẸN DỮ LIỆU (chống thao túng ở khâu build snapshot — audit MED):
 *  mỗi snapshot = 1 epoch ⇒ 1 owner CHỈ được xuất hiện 1 dòng/snapshot. Owner
 *  trùng trong CÙNG 1 snapshot là lỗi nguồn (resolve stake→pkh sai) HOẶC cố ý thổi
 *  phồng accStake để chiếm phần lớn pot → THROW, không âm thầm cộng dồn. */
export function accumulate(
  snapshots: SnapshotSet,
  excluded: Set<string> = new Set(),
): Map<string, bigint> {
  const acc = new Map<string, bigint>();
  for (let i = 0; i < snapshots.length; i++) {
    const seen = new Set<string>();
    for (const { owner, stake } of snapshots[i]!) {
      if (seen.has(owner))
        throw new Error(
          `TIGER-002: owner ${owner} trùng trong snapshot #${i} — lỗi toàn vẹn dữ liệu (mỗi epoch 1 owner 1 dòng)`,
        );
      seen.add(owner);
      if (excluded.has(owner)) continue;
      if (stake <= 0n) continue; // bỏ dòng stake ≤ 0 (lovelace không âm)
      acc.set(owner, (acc.get(owner) ?? 0n) + stake);
    }
  }
  return acc;
}

/** So sánh tất định: stake giảm dần, tie → owner hex tăng dần. */
function byStakeDescOwnerAsc(
  a: [string, bigint],
  b: [string, bigint],
): number {
  if (a[1] !== b[1]) return a[1] > b[1] ? -1 : 1;
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** Kết quả entitlement đầy đủ + leftover (oil chưa phân bổ do cap). */
export interface EntitlementResult {
  entitlements: TigerEntitlement[];
  /** oil còn lại do cap chặn không chia hết (về treasury pot). cap=null ⇒ 0. */
  leftover: bigint;
  /** tổng đã phân bổ = Σ amount. */
  distributed: bigint;
}

/** B2–B4 — tính entitlement từ snapshot. */
export function computeEntitlements(
  snapshots: SnapshotSet,
  params: Partial<EntitlementParams> = {},
): EntitlementResult {
  const p: EntitlementParams = { ...defaultParams(), ...params };
  if (p.budgetOil < 0n) throw new Error("TIGER-000: budget phải ≥ 0");
  if (p.capOil !== null && p.capOil <= 0n)
    throw new Error("TIGER-001: cap phải > 0 (hoặc null)");

  const acc = accumulate(snapshots, p.excluded);
  const owners = [...acc.entries()].sort(byStakeDescOwnerAsc);
  if (owners.length === 0)
    return { entitlements: [], leftover: p.budgetOil, distributed: 0n };

  const cap = p.capOil;
  const amount = new Map<string, bigint>(); // kết quả ghim cho ví đã cap
  const capped = new Set<string>();
  let free = new Set(owners.map(([o]) => o));

  // ── B3: water-filling ──
  while (true) {
    let freeTotal = 0n;
    for (const o of free) freeTotal += acc.get(o)!;
    const reserved = [...capped].reduce((s, o) => s + amount.get(o)!, 0n);
    const budgetForFree = p.budgetOil - reserved;
    if (free.size === 0 || freeTotal === 0n || budgetForFree <= 0n) break;

    // tỷ lệ tạm cho ví free
    const tentative = new Map<string, bigint>();
    for (const o of free)
      tentative.set(o, (budgetForFree * acc.get(o)!) / freeTotal);

    if (cap === null) {
      for (const [o, v] of tentative) amount.set(o, v);
      break;
    }
    // ví vượt cap → ghim cap, loại khỏi free, lặp lại
    const over = [...free].filter((o) => tentative.get(o)! > cap);
    if (over.length === 0) {
      for (const [o, v] of tentative) amount.set(o, v);
      break;
    }
    for (const o of over) {
      amount.set(o, cap);
      capped.add(o);
    }
    free = new Set([...free].filter((o) => !capped.has(o)));
  }
  // ví không nằm trong amount (free=0 từ đầu do budget cạn) → 0
  for (const [o] of owners) if (!amount.has(o)) amount.set(o, 0n);

  // ── B4: dư floor → ví CHƯA-cap stake lớn nhất, tôn trọng cap ──
  let distributed = 0n;
  for (const v of amount.values()) distributed += v;
  let dust = p.budgetOil - distributed;
  if (dust > 0n) {
    for (const [o] of owners) {
      if (capped.has(o)) continue;
      const room = cap === null ? dust : cap - amount.get(o)!;
      if (room <= 0n) continue;
      const add = dust < room ? dust : room;
      amount.set(o, amount.get(o)! + add);
      dust -= add;
      if (dust === 0n) break;
    }
  }

  const entitlements: TigerEntitlement[] = owners
    .map(([o, s]) => ({
      owner: o,
      accStake: s,
      amount: amount.get(o)!,
      capped: capped.has(o),
    }))
    .filter((e) => e.amount > 0n);

  distributed = entitlements.reduce((s, e) => s + e.amount, 0n);
  return { entitlements, leftover: p.budgetOil - distributed, distributed };
}
