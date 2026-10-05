// @magiclamp/utils — Shared primitives (GenMAGIC v3.3)
// Single source of truth for all modules.
// ALL arithmetic BigInt. No Number for oildrop/nanogic/Q values.

// ══════════════════════════════════════════════════════════════
// §19 Protocol constants (Immutable unless noted)
// ══════════════════════════════════════════════════════════════
export const Q                   = 1_000_000_000n;   // [Immutable]
export const OILDROP_PER_LAMP        = 1_000_000n;
export const NANOGIC_PER_MAGIC   = 1_000_000_000n;
export const S_LAMP_TOTAL        = 36_000_000_000_000_000n;  // 36×10^15 oildrop

// `slots_per_epoch` is network-specific (used for slot-based epoch math and SDK display).
// Source: ShelleyGenesis `epochLength` of each network (book.world.dev.cardano.org +
// input-output-hk/cardano-configurations — two independent sources, in agreement).
// PREPROD MIRRORS MAINNET (5-day epochs). PREVIEW is the short-epoch network (1 day).
// Do NOT group Preview and Preprod together — that grouping was the bug fixed here.
export const SLOTS_PER_EPOCH_BY_NETWORK = {
  Preview:  86_400n,
  Preprod:  432_000n,
  Mainnet:  432_000n,
} as const;

/** Slots-per-epoch for a given Cardano network. */
export function slotsPerEpoch(network: Network): bigint {
  return SLOTS_PER_EPOCH_BY_NETWORK[network];
}

// `ms_per_epoch` is what the Aiken validator's epoch-from-validity-range math uses,
// because PlutusV3 validity_range carries POSIX milliseconds (not slots).
// All current Cardano networks use slot_length = 1000 ms, so ms_per_epoch = slots_per_epoch × 1000.
// ms_per_epoch MUST stay = slots_per_epoch × 1000 for every network — `epochTablesAgree()`
// below is the machine check, and the test suite asserts it for the whole table.
export const MS_PER_EPOCH_BY_NETWORK = {
  Preview:  86_400_000n,
  Preprod:  432_000_000n,
  Mainnet:  432_000_000n,
} as const;

/** slot_length is 1000 ms on every current Cardano network. */
export const MS_PER_SLOT = 1_000n;

/**
 * True iff both epoch tables agree on every network (ms = slots × MS_PER_SLOT).
 * The two tables are separate literals, so one can be edited without the other;
 * this is what makes that silent divergence loud.
 */
export function epochTablesAgree(): boolean {
  return (Object.keys(SLOTS_PER_EPOCH_BY_NETWORK) as Network[]).every(
    (n) => MS_PER_EPOCH_BY_NETWORK[n] === SLOTS_PER_EPOCH_BY_NETWORK[n] * MS_PER_SLOT,
  );
}

/** Milliseconds-per-epoch for a given Cardano network (used by validator + SDK). */
export function msPerEpoch(network: Network): bigint {
  return MS_PER_EPOCH_BY_NETWORK[network];
}

// (`posixMsToEpoch` — `posixMs / ms_per_epoch` from the 1970 origin — was REMOVED with
//  Specs/Window/CONTRACT.md v1.0. Its replacement is `windowOf` below: it subtracts
//  `window_origin_ms` first, exactly as every validator now does.)

// OAC [GenMAGIC §6.4, Constitutional]
export const DRM_LOOKBACK        = 12n;   // epochs
export const MIN_BURN_FOR_OAC    = 1_000_000_000n;  // 1 MAGIC

// ══════════════════════════════════════════════════════════════
// §2.4 Epoch utilities
// ══════════════════════════════════════════════════════════════

export type Network = "Preview" | "Preprod" | "Mainnet";

// ── One epoch system since Specs/Window/CONTRACT.md v1.0 ─────────────────────
//   WINDOW index = (posixMs − window_origin_ms) / ms_per_epoch   (`windowOf`, `slotToProtocolEpoch`)
//                  what every LAMP validator computes from validity_range and what every
//                  `*_epoch` datum field carries.
//   CHAIN epoch  = the Cardano epoch explorers show               (`slotToEpoch`, `getCurrentEpoch`)
// On Preprod and Mainnet the two are the SAME number and the window edges are the epoch edges
// (= the stake-snapshot instants): `window_origin_ms` is the Shelley start pulled back to epoch 0.
// The retired system (`posixMs / ms_per_epoch`, origin 1970, Preprod ≈ 4_144) is rejected by every
// validator built with a `window_origin_ms` parameter, with no explanation — never produce it.

/** First Shelley-era slot of each network: its slot number, chain epoch and POSIX time.
 *  From this slot on every network has slot_length = 1 s (`MS_PER_SLOT`), so slot ↔ time is
 *  linear; BEFORE it (Byron, 20 s slots) the linear formula is wrong, hence the guards below.
 *
 *  Derivation (Byron genesis `startTime` + Shelley hard-fork epoch × Byron epoch duration,
 *  Byron epoch = 21_600 slots × 20 s = 432_000 s):
 *    Mainnet  1_506_203_091 + 208 × 432_000 = 1_596_059_091   (HF at epoch 208, slot 208×21_600 = 4_492_800)
 *    Preprod  1_654_041_600 +   4 × 432_000 = 1_655_769_600   (HF at epoch 4,   slot   4×21_600 =    86_400)
 *    Preview  no Byron era; Shelley `systemStart` 2022-10-25T00:00:00Z = 1_666_656_000
 *  Cross-checked against `@lucid-evolution/plutus` 0.1.x ▸ `SLOT_CONFIG_NETWORK`
 *  (zeroTime/zeroSlot, "Starting at Shelley era"), read 2026-09-27; the test suite re-derives
 *  the three rows from the Byron start times above. */
export const SHELLEY_START_BY_NETWORK: Record<Network, { slot: bigint; epoch: bigint; posixMs: bigint }> = {
  Preview: { slot: 0n,         epoch: 0n,   posixMs: 1_666_656_000_000n },
  Preprod: { slot: 86_400n,    epoch: 4n,   posixMs: 1_655_769_600_000n },
  Mainnet: { slot: 4_492_800n, epoch: 208n, posixMs: 1_596_059_091_000n },
};

/** POSIX seconds of the LINEARLY EXTRAPOLATED slot 0: `slot = unixSec − GENESIS_UNIX[n]`
 *  holds for every Shelley-era slot. It is NOT the time of the first block on Preprod or
 *  Mainnet (Byron slots were 20 s long), which is why the old literals were wrong:
 *  Preprod had the Byron start 1_654_041_600 (off by +1_641_600 s = 1_641_600 slots) and
 *  Mainnet had 1_596_491_091 (off by +4_924_800 s). Derived from
 *  `SHELLEY_START_BY_NETWORK` so the two cannot drift:
 *    Preview 1_666_656_000 · Preprod 1_655_683_200 · Mainnet 1_591_566_291. */
export const GENESIS_UNIX: Record<Network, number> = Object.fromEntries(
  (Object.keys(SHELLEY_START_BY_NETWORK) as Network[]).map((n) => {
    const s = SHELLEY_START_BY_NETWORK[n];
    return [n, Number(s.posixMs / MS_PER_SLOT - s.slot)];
  }),
) as Record<Network, number>;

export const CHAIN_TIME_ERRORS = {
  PROVIDER_NO_GETBLOCK: "UTILS-TIME-001-PROVIDER-NO-GETBLOCK",
  PROVIDER_FAILED:      "UTILS-TIME-002-PROVIDER-FAILED",
  TIP_SLOT_INVALID:     "UTILS-TIME-003-TIP-SLOT-INVALID",
  PRE_SHELLEY:          "UTILS-TIME-004-PRE-SHELLEY",
  WINDOW_ORIGIN_UNDEFINED: "UTILS-TIME-005-WINDOW-ORIGIN-UNDEFINED",
  WINDOW_BEFORE_ORIGIN:    "UTILS-TIME-006-WINDOW-BEFORE-ORIGIN",
  WINDOW_PARAMS_INVALID:   "UTILS-TIME-007-WINDOW-PARAMS-INVALID",
} as const;

/** Chain-time error with a stable code, so callers can tell the causes apart. */
export class ChainTimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.name = "ChainTimeError";
    this.code = code;
  }
}

function assertShelleySlot(slot: bigint, network: Network): void {
  const start = SHELLEY_START_BY_NETWORK[network].slot;
  if (slot < start) {
    throw new ChainTimeError(
      CHAIN_TIME_ERRORS.PRE_SHELLEY,
      `slot ${slot} is before the first Shelley slot ${start} of ${network}; ` +
        `the 1-slot-per-second conversion does not apply to Byron slots`,
    );
  }
}

// ══════════════════════════════════════════════════════════════
// Window arithmetic — Specs/Window/CONTRACT.md v1.2 (WIN-ORIGIN-1..4)
//   window(t)       = (t − window_origin_ms) / ms_per_epoch      (floor)
//   window_start(e) = window_origin_ms + e × ms_per_epoch
//   window_end(e)   = window_origin_ms + (e + 1) × ms_per_epoch − 1
// The ONLY place in the off-chain tree where this arithmetic is written. Every other
// `epochWindow` / `windowAt` / `epochOf` is a thin layer over `windowBounds` / `windowIndex`.
// ══════════════════════════════════════════════════════════════

/** Networks that have a defined `window_origin_ms` — every `Network` (Preview since spec v1.2). */
const WINDOW_ORIGIN_NETWORKS = ["Preview", "Preprod", "Mainnet"] as const;

/** `window_origin_ms` of a network: the Shelley start pulled back to epoch 0,
 *  `shelley.posixMs − shelley.epoch × ms_per_epoch` (Byron epochs are also 432_000 s long on
 *  Preprod and Mainnet; Preview has no Byron era, so its Shelley start IS epoch 0).
 *  DERIVED from `SHELLEY_START_BY_NETWORK` — never typed by hand (WIN-ORIGIN-4).
 *    Mainnet 1_506_203_091_000 · Preprod 1_654_041_600_000 · Preview 1_666_656_000_000
 *  The Preview origin IS a multiple of its 1-day `ms_per_epoch`: a Preview vector tells an
 *  origin-subtracting build from one that forgot (the index differs by 19_290) but not the edge
 *  phase — validator tests still need a Mainnet or Preprod case (spec §3).
 *  An unknown network (a cast `Network`) has no entry: `windowOriginMs` throws
 *  `WINDOW_ORIGIN_UNDEFINED` (fail-closed). Apply validator parameters through
 *  `windowOriginMs(network)`, not through a bare index. */
export const WINDOW_ORIGIN_MS_BY_NETWORK: Readonly<Partial<Record<Network, bigint>>> = Object.freeze(
  Object.fromEntries(
    WINDOW_ORIGIN_NETWORKS.map((n) => {
      const s = SHELLEY_START_BY_NETWORK[n];
      return [n, s.posixMs - s.epoch * MS_PER_EPOCH_BY_NETWORK[n]];
    }),
  ),
) as Readonly<Partial<Record<Network, bigint>>>;

/** `window_origin_ms` for `network`. Throws `WINDOW_ORIGIN_UNDEFINED` for a network without an entry. */
export function windowOriginMs(network: Network): bigint {
  const o = WINDOW_ORIGIN_MS_BY_NETWORK[network];
  if (o === undefined) {
    throw new ChainTimeError(
      CHAIN_TIME_ERRORS.WINDOW_ORIGIN_UNDEFINED,
      `no window_origin_ms for ${network} (Specs/Window/CONTRACT.md §2): ` +
        `that network has no settled origin — refusing to guess`,
    );
  }
  return o;
}

function assertWindowParams(originMs: bigint, epochMs: bigint): void {
  if (!(epochMs > 0n)) {
    throw new ChainTimeError(CHAIN_TIME_ERRORS.WINDOW_PARAMS_INVALID, `ms_per_epoch must be > 0, got ${epochMs}`);
  }
  if (originMs < 0n) {
    throw new ChainTimeError(CHAIN_TIME_ERRORS.WINDOW_PARAMS_INVALID, `window_origin_ms must be >= 0, got ${originMs}`);
  }
}

/** Window index of a POSIX-ms instant for explicit parameters: `(t − origin) / ms_per_epoch` (floor).
 *  `t` before the origin throws (`WINDOW_BEFORE_ORIGIN`) — Aiken's `/` floors, so on-chain it
 *  would return a negative index (−1 just before the origin) that no window can match. `origin = 0` is a legal input but cannot tell
 *  a build that subtracts the origin from one that forgot to: tests need a real origin too (spec §3). */
export function windowIndex(t: bigint, originMs: bigint, epochMs: bigint): bigint {
  assertWindowParams(originMs, epochMs);
  if (t < originMs) {
    throw new ChainTimeError(CHAIN_TIME_ERRORS.WINDOW_BEFORE_ORIGIN, `time ${t} ms is before window_origin_ms ${originMs}`);
  }
  return (t - originMs) / epochMs;
}

/** First ms of window `e`: `origin + e × ms_per_epoch`. */
export function windowStartMs(e: bigint, originMs: bigint, epochMs: bigint): bigint {
  assertWindowParams(originMs, epochMs);
  return originMs + e * epochMs;
}

/** Last ms of window `e`: `origin + (e + 1) × ms_per_epoch − 1` (the largest `hi` that still divides to `e`). */
export function windowEndMs(e: bigint, originMs: bigint, epochMs: bigint): bigint {
  assertWindowParams(originMs, epochMs);
  return originMs + (e + 1n) * epochMs - 1n;
}

/** The window containing `t`: its index and both edges (inclusive). */
export function windowBounds(
  t: bigint, originMs: bigint, epochMs: bigint,
): { epoch: bigint; startMs: bigint; endMs: bigint } {
  const epoch = windowIndex(t, originMs, epochMs);
  return { epoch, startMs: windowStartMs(epoch, originMs, epochMs), endMs: windowEndMs(epoch, originMs, epochMs) };
}

/** POSIX ms → window index of `network` (= the Cardano epoch number on Preprod/Mainnet). Throws for Preview. */
export function windowOf(t: bigint, network: Network): bigint {
  return windowIndex(t, windowOriginMs(network), msPerEpoch(network));
}

/** First ms of window `e` of `network`. Throws for Preview. */
export function windowStart(e: bigint, network: Network): bigint {
  return windowStartMs(e, windowOriginMs(network), msPerEpoch(network));
}

/** Last ms of window `e` of `network`. Throws for Preview. */
export function windowEnd(e: bigint, network: Network): bigint {
  return windowEndMs(e, windowOriginMs(network), msPerEpoch(network));
}

/** slot → POSIX ms (Shelley era onward). Throws `PRE_SHELLEY` for Byron slots. */
export function slotToPosixMs(slot: bigint, network: Network): bigint {
  assertShelleySlot(slot, network);
  const s = SHELLEY_START_BY_NETWORK[network];
  return s.posixMs + (slot - s.slot) * MS_PER_SLOT;
}

/** slot → window index (the validator's system): `windowOf(slotToPosixMs(slot))`.
 *  On every network this equals `slotToEpoch` (window = Cardano epoch, Specs/Window v1.2 §1). */
export function slotToProtocolEpoch(slot: bigint, network: Network): bigint {
  return windowOf(slotToPosixMs(slot, network), network);
}

/** slot → CHAIN epoch (the Cardano epoch explorers show), Shelley era onward.
 *
 *  Equals `slotToProtocolEpoch` on every network (window origin = epoch 0, Specs/Window v1.2 §1).
 *
 *  The old body was `slot / slots_per_epoch`, which ignores the Byron era: it was right on
 *  Preview only, 4 epochs low on Preprod and ~198 epochs low on Mainnet.
 *  Throws `PRE_SHELLEY` for Byron slots. */
export function slotToEpoch(slot: bigint, network: Network): bigint {
  assertShelleySlot(slot, network);
  const s = SHELLEY_START_BY_NETWORK[network];
  return s.epoch + (slot - s.slot) / slotsPerEpoch(network);
}

/** ESTIMATE of the tip slot from a wall clock (`nowMs`, POSIX ms) — never read from the chain.
 *  This is the old silent fallback of `getTipSlot`, now a separate, explicitly named call:
 *  it is only as right as the caller's clock and says nothing about whether the node is
 *  synced. Throws `PRE_SHELLEY` if `nowMs` is before the network's first Shelley slot. */
export function estimateSlotFromClock(nowMs: bigint, network: Network): bigint {
  const s = SHELLEY_START_BY_NETWORK[network];
  if (nowMs < s.posixMs) {
    throw new ChainTimeError(
      CHAIN_TIME_ERRORS.PRE_SHELLEY,
      `time ${nowMs} ms is before the first Shelley slot of ${network} (${s.posixMs} ms)`,
    );
  }
  return s.slot + (nowMs - s.posixMs) / MS_PER_SLOT;
}

/** Tip slot read from the provider's `getBlock("latest")`. Throws — never falls back:
 *    `PROVIDER_NO_GETBLOCK` the provider has no `getBlock` (NOTE: `@lucid-evolution` 0.x
 *                           providers do not implement it; the old code therefore ALWAYS
 *                           ended in its clock fallback with such a provider)
 *    `PROVIDER_FAILED`      `getBlock` threw / rejected (original error kept as `cause`)
 *    `TIP_SLOT_INVALID`     the block has no slot, or it is not a non-negative safe integer
 *                           (the old `tip.slot ?? 0` turned this into slot 0 = epoch 0)
 *  Want a clock estimate instead? Call `estimateSlotFromClock` explicitly. */
export async function getTipSlot(lucid: { provider: unknown }): Promise<number> {
  const provider = lucid.provider as { getBlock?: unknown } | null | undefined;
  if (!provider || typeof provider.getBlock !== "function") {
    throw new ChainTimeError(
      CHAIN_TIME_ERRORS.PROVIDER_NO_GETBLOCK,
      `provider has no getBlock(); cannot read the tip slot from the chain`,
    );
  }
  let tip: unknown;
  try {
    tip = await (provider.getBlock as (s: string) => Promise<unknown>).call(provider, "latest");
  } catch (e) {
    throw new ChainTimeError(
      CHAIN_TIME_ERRORS.PROVIDER_FAILED,
      `provider.getBlock("latest") failed: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  const slot = (tip as { slot?: unknown } | null | undefined)?.slot;
  if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0) {
    throw new ChainTimeError(
      CHAIN_TIME_ERRORS.TIP_SLOT_INVALID,
      // String(), not JSON.stringify: the latter throws on bigint and would mask this error.
      `latest block has no valid slot (got ${typeof slot} ${String(slot)})`,
    );
  }
  return slot;
}

/** Current CHAIN epoch (the Cardano epoch explorers show), read from the provider tip.
 *
 *  On every network this IS the LAMP window index (Specs/Window/CONTRACT.md v1.2 §1), so it may
 *  go into a `*_epoch` datum field; for a window from a wall clock use `windowOf(nowMs, network)`.
 *  `network` is required: a default network would silently mis-convert on the other two. */
export async function getCurrentEpoch(
  lucid   : { provider: unknown },
  network : Network,
): Promise<bigint> {
  return slotToEpoch(BigInt(await getTipSlot(lucid)), network);
}

// ══════════════════════════════════════════════════════════════
// Unit conversions
// ══════════════════════════════════════════════════════════════
export function lampToOildrop(lamp: bigint): bigint   { return lamp * OILDROP_PER_LAMP; }
export function oildropToLamp(oildrop: bigint):  bigint   { return oildrop  / OILDROP_PER_LAMP; }
export function lAvail(balance: bigint, locked: bigint): bigint { return balance - locked; }

// ══════════════════════════════════════════════════════════════
// Display
// ══════════════════════════════════════════════════════════════
export function nanogicToMagicStr(ng: bigint, dec = 4): string {
  if (ng === 0n) return "0." + "0".repeat(dec);
  if (ng < 0n)   return "-" + nanogicToMagicStr(-ng, dec);
  const whole = ng / NANOGIC_PER_MAGIC;
  const frac  = (ng % NANOGIC_PER_MAGIC).toString().padStart(9, "0").slice(0, dec);
  return `${whole}.${frac}`;
}

export function qToStr(qv: bigint, dec = 3): string {
  const sign = qv < 0n ? "-" : "";
  const abs  = qv < 0n ? -qv : qv;
  return sign + (Number(abs) / 1e9).toFixed(dec);
}

// ══════════════════════════════════════════════════════════════
// BigInt sort comparators (avoids Number() precision concern)
// Safe for all realistic values; pure BigInt comparison.
// ══════════════════════════════════════════════════════════════
export function cmpBigIntAsc(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function cmpBigIntDesc(a: bigint, b: bigint): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

// ══════════════════════════════════════════════════════════════
// LoyaltyHolding types & lock algorithm (§6.8, §A.9, T5)
// Canonical implementation — P8: all modules must use this exact code.
// ══════════════════════════════════════════════════════════════
export interface LoyaltyHolding {
  amount         : bigint;
  acquired_epoch : bigint;
  is_locked      : boolean;
}

/** §6.8 Youngest-first lock (T5) — maximises LF of free holdings.
 *  Lock youngest holdings first → free = oldest → LF(free) highest.
 *  Pure function: returns new array, does not mutate input.
 */
export function selectLampForLock(
  holdings : LoyaltyHolding[],
  amount   : bigint,
): LoyaltyHolding[] {
  // Sort youngest-first (desc acquired_epoch) — BigInt-safe comparator
  const sorted = [...holdings].sort((a, b) => cmpBigIntDesc(a.acquired_epoch, b.acquired_epoch));
  let remaining = amount;
  const result: LoyaltyHolding[] = [];

  for (const h of sorted) {
    if (remaining <= 0n) { result.push(h); continue; }
    if (remaining >= h.amount) {
      result.push({ ...h, is_locked: true });
      remaining -= h.amount;
    } else {
      result.push({ amount: remaining,           acquired_epoch: h.acquired_epoch, is_locked: true  });
      result.push({ amount: h.amount - remaining, acquired_epoch: h.acquired_epoch, is_locked: false });
      remaining = 0n;
    }
  }
  if (remaining > 0n) throw new Error(`GEN-LOCK-001: insufficient holdings (${remaining} oildrop short)`);
  return result;
}

/** §A.9 Oldest-locked-first removal — called at fire/burn time.
 *  Pure function: returns new array, does not mutate input.
 */
export function removeLockedAmount(
  holdings : LoyaltyHolding[],
  amount   : bigint,
): LoyaltyHolding[] {
  const unlocked = holdings.filter(h => !h.is_locked);
  const locked   = holdings.filter(h =>  h.is_locked)
    .sort((a, b) => cmpBigIntAsc(a.acquired_epoch, b.acquired_epoch));  // oldest first

  let remaining = amount;
  const result: LoyaltyHolding[] = [];

  for (const h of locked) {
    if (remaining <= 0n) { result.push(h); continue; }
    if (remaining >= h.amount) { remaining -= h.amount; }
    else { result.push({ ...h, amount: h.amount - remaining }); remaining = 0n; }
  }
  if (remaining > 0n) throw new Error(`GEN-LOCK-002: insufficient locked holdings (${remaining} oildrop short)`);
  return [...unlocked, ...result];
}

export function sumHoldings(holdings: LoyaltyHolding[]): bigint {
  return holdings.reduce((s, h) => s + h.amount, 0n);
}

export function sumLocked(holdings: LoyaltyHolding[]): bigint {
  return holdings.filter(h => h.is_locked).reduce((s, h) => s + h.amount, 0n);
}

// ══════════════════════════════════════════════════════════════
// OAC (§6.4) — single canonical implementation
//
// IMPORTANT: Two different window semantics exist by design:
//
//   PRUNE (ConsumeMAGIC §10.2 STEP 0e): keeps ep ≥ e − DRM_LOOKBACK
//     → keeps entries that may be counted in the NEXT SnapshotGen
//
//   COUNT (SnapshotGen §6.4, AppEconomics §8.5): counts ep ∈ [e−12, e)
//     → [current-12, current) — exclusive upper bound
//     → burns in CURRENT epoch apply to NEXT epoch's OAC (by design)
//
// These are intentionally different. Do NOT unify them.
// ══════════════════════════════════════════════════════════════

/** Prune stale entries from recent_burn_epochs (ConsumeMAGIC STEP 0e).
 *  Keeps entries with ep ≥ current − DRM_LOOKBACK.
 */
export function pruneActivityWindow(
  entries      : [string, bigint][],
  currentEpoch : bigint,
): [string, bigint][] {
  return entries.filter(([, ep]) => ep >= currentEpoch - DRM_LOOKBACK);
}

/** Count distinct active apps in OAC window (SnapshotGen §6.4).
 *  Window: [current − DRM_LOOKBACK, current) — EXCLUSIVE upper bound.
 *  Burns from current epoch NOT counted (they affect next epoch's OAC).
 */
export function countActiveAppsInOacWindow(
  entries      : [string, bigint][],
  currentEpoch : bigint,
): number {
  const lo = currentEpoch - DRM_LOOKBACK;
  const hi = currentEpoch;  // exclusive
  const active = entries.filter(([, ep]) => ep >= lo && ep < hi);
  return new Set(active.map(([id]) => id)).size;
}

/** Add or update (app_id, epoch) in recent_burn_epochs with deduplication.
 *  C-ACTIVITY-DEDUP: skip if (app_id, epoch) already present.
 *  INV-CM-ACT-ORDER: maintains epoch-descending order for efficient dedup.
 */
export function addBurnToActivity(
  entries  : [string, bigint][],
  appId    : string,
  epoch    : bigint,
): [string, bigint][] {
  // C-ACTIVITY-DEDUP: no duplicate (app_id, epoch)
  if (entries.some(([id, ep]) => id === appId && ep === epoch)) return entries;
  return [[appId, epoch], ...entries];  // prepend = epoch-descending order
}

// ══════════════════════════════════════════════════════════════
// isqrt — ⌊√n⌋ Newton's method (AppEconomics §3.3, Lemma 3.5)
// Pure BigInt — no float.
// ══════════════════════════════════════════════════════════════
export function isqrt(n: bigint): bigint {
  if (n <= 0n) return 0n;
  // Initial guess: use bit length to estimate magnitude (BigInt-safe)
  const bits = n.toString(2).length;
  let x = 1n << BigInt(Math.ceil(bits / 2));
  let y = (x + n / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/** isqrt_10th — ⌊n^(1/10)⌋ for AppEconomics V_dampened.
 *  BigInt Newton's method. No float for initial guess.
 *  Safe for V^7 where V ≤ S_LAMP_TOTAL = 36×10^15 (V^7 ≤ ~10^110).
 */
export function isqrt10th(n: bigint): bigint {
  if (n <= 0n) return 0n;
  if (n < 10n) return 1n;

  // Initial guess via bit-length (pure BigInt, no float)
  const bits = n.toString(2).length;
  // k^10 ≈ 2^(bits-1) → k ≈ 2^((bits-1)/10)
  let x = 1n << BigInt(Math.ceil((bits - 1) / 10) + 1);

  // Newton's method: x_{n+1} = (9x + n/x^9) / 10
  for (let iter = 0; iter < 200; iter++) {
    const x9   = x ** 9n;
    const xNew = (9n * x + n / x9) / 10n;
    if (xNew >= x) break;
    x = xNew;
  }

  // Correct boundary (one-time adjustment)
  while ((x + 1n) ** 10n <= n) x++;
  while (x > 0n && x ** 10n > n) x--;

  return x;
}

/** On-chain verification of V_dampened (§9.1 Lemma 9.2).
 *  Vd^10 ≤ V^7 < (Vd+1)^10 — cheaper than computing isqrt_10th on-chain.
 */
export function verifyVd(V: bigint, Vd: bigint): boolean {
  return Vd ** 10n <= V ** 7n && V ** 7n < (Vd + 1n) ** 10n;
}

export function vDampened(V: bigint): bigint {
  return isqrt10th(V ** 7n);
}

// ══════════════════════════════════════════════════════════════
// Q-format arithmetic (§3.2)
// ══════════════════════════════════════════════════════════════
export function mulQ(a: bigint, b: bigint): bigint { return a * b / Q; }
export function clamp(x: bigint, lo: bigint, hi: bigint): bigint {
  return x < lo ? lo : x > hi ? hi : x;
}
