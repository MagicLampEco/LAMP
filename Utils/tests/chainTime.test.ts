// tests/chainTime.test.ts — tip slot, genesis constants, chain vs protocol epoch
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getTipSlot, getCurrentEpoch, ChainTimeError, CHAIN_TIME_ERRORS,
  GENESIS_UNIX, SHELLEY_START_BY_NETWORK,
  slotToEpoch, slotToPosixMs, slotToProtocolEpoch, estimateSlotFromClock,
  windowOf, MS_PER_SLOT,
} from "../src/index.js";
import type { Network } from "../src/index.js";

const NETWORKS: Network[] = ["Preview", "Preprod", "Mainnet"];

/** Assert that `fn` throws a ChainTimeError carrying `code`. */
function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(ChainTimeError);
  expect((caught as ChainTimeError).code).toBe(code);
}

async function expectCodeAsync(p: Promise<unknown>, code: string): Promise<ChainTimeError> {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(ChainTimeError);
  expect((caught as ChainTimeError).code).toBe(code);
  return caught as ChainTimeError;
}

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════════════════════════
// Genesis constants
// ══════════════════════════════════════════════════════════════
describe("GENESIS_UNIX / SHELLEY_START_BY_NETWORK", () => {
  it("GENESIS_UNIX = POSIX s of the linearly extrapolated slot 0, per network", () => {
    expect(GENESIS_UNIX.Preview).toBe(1_666_656_000);
    // old literal was the Byron start 1_654_041_600 — off by +1_641_600 s
    expect(GENESIS_UNIX.Preprod).toBe(1_655_683_200);
    expect(GENESIS_UNIX.Preprod - 1_654_041_600).toBe(1_641_600);
    // old literal was 1_596_491_091 — off by +4_924_800 s
    expect(GENESIS_UNIX.Mainnet).toBe(1_591_566_291);
  });

  // Independent derivation: Byron genesis startTime + HF epoch × (21_600 slots × 20 s),
  // first Shelley slot = HF epoch × 21_600.
  it("Shelley start re-derives from the Byron genesis start times", () => {
    const byron: Record<Exclude<Network, "Preview">, { startSec: bigint; hfEpoch: bigint }> = {
      Mainnet: { startSec: 1_506_203_091n, hfEpoch: 208n },
      Preprod: { startSec: 1_654_041_600n, hfEpoch: 4n },
    };
    for (const n of ["Mainnet", "Preprod"] as const) {
      const s = SHELLEY_START_BY_NETWORK[n];
      expect(s.epoch).toBe(byron[n].hfEpoch);
      expect(s.slot).toBe(byron[n].hfEpoch * 21_600n);
      expect(s.posixMs).toBe((byron[n].startSec + byron[n].hfEpoch * 21_600n * 20n) * 1000n);
    }
    expect(SHELLEY_START_BY_NETWORK.Preview).toEqual({ slot: 0n, epoch: 0n, posixMs: 1_666_656_000_000n });
  });

  it("slot = unixSec − GENESIS_UNIX holds for every Shelley slot (agrees with slotToPosixMs)", () => {
    for (const n of NETWORKS) {
      const first = SHELLEY_START_BY_NETWORK[n].slot;
      for (const slot of [first, first + 1n, first + 10_000_000n]) {
        expect(slotToPosixMs(slot, n) / 1000n - BigInt(GENESIS_UNIX[n])).toBe(slot);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Slot ↔ time, chain vs protocol epoch
// ══════════════════════════════════════════════════════════════
describe("slot conversions", () => {
  it("slotToPosixMs / estimateSlotFromClock round-trip, 1 s per slot", () => {
    for (const n of NETWORKS) {
      const s = SHELLEY_START_BY_NETWORK[n];
      expect(slotToPosixMs(s.slot, n)).toBe(s.posixMs);
      expect(slotToPosixMs(s.slot + 5n, n)).toBe(s.posixMs + 5n * MS_PER_SLOT);
      expect(estimateSlotFromClock(s.posixMs + 5_999n, n)).toBe(s.slot + 5n);
      const slot = s.slot + 123_456_789n;
      expect(estimateSlotFromClock(slotToPosixMs(slot, n), n)).toBe(slot);
    }
  });

  it("Byron slots / pre-Shelley times throw PRE_SHELLEY (no linear extrapolation)", () => {
    for (const n of ["Preprod", "Mainnet"] as const) {
      const s = SHELLEY_START_BY_NETWORK[n];
      expectCode(() => slotToEpoch(s.slot - 1n, n), CHAIN_TIME_ERRORS.PRE_SHELLEY);
      expectCode(() => slotToPosixMs(s.slot - 1n, n), CHAIN_TIME_ERRORS.PRE_SHELLEY);
      expectCode(() => slotToProtocolEpoch(s.slot - 1n, n), CHAIN_TIME_ERRORS.PRE_SHELLEY);
    }
    for (const n of NETWORKS) {
      const s = SHELLEY_START_BY_NETWORK[n];
      expectCode(() => estimateSlotFromClock(s.posixMs - 1n, n), CHAIN_TIME_ERRORS.PRE_SHELLEY);
    }
    expectCode(() => slotToEpoch(-1n, "Preview"), CHAIN_TIME_ERRORS.PRE_SHELLEY);
  });

  it("slotToProtocolEpoch = windowOf(time) = the CHAIN epoch on Preprod/Mainnet (Specs/Window v1.0)", () => {
    // A Preprod slot in late 2026-09: the old 1970-origin system said 4_144; the window index
    // is now the epoch number the explorers show.
    const nowMs = 1_790_467_200_000n;
    const slot = estimateSlotFromClock(nowMs, "Preprod");
    expect(slotToProtocolEpoch(slot, "Preprod")).toBe(windowOf(nowMs, "Preprod"));
    expect(slotToProtocolEpoch(slot, "Preprod")).toBe(315n);
    expect(slotToEpoch(slot, "Preprod")).toBe(315n);
    // Mainnet at the same instant: chain epoch 658 (explorer) = window index.
    const mSlot = estimateSlotFromClock(nowMs, "Mainnet");
    expect(slotToEpoch(mSlot, "Mainnet")).toBe(658n);
    expect(slotToProtocolEpoch(mSlot, "Mainnet")).toBe(658n);
  });

  it("slotToProtocolEpoch === slotToEpoch for every Shelley slot sampled (both networks)", () => {
    for (const n of ["Preprod", "Mainnet"] as const) {
      const s = SHELLEY_START_BY_NETWORK[n];
      for (const k of [0n, 1n, 431_999n, 432_000n, 432_001n, 123_456_789n]) {
        expect(slotToProtocolEpoch(s.slot + k, n)).toBe(slotToEpoch(s.slot + k, n));
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════
// getTipSlot / getCurrentEpoch — no silent fallback
// ══════════════════════════════════════════════════════════════
describe("getTipSlot", () => {
  it("returns the provider's latest-block slot (getBlock called with \"latest\", `this` bound)", async () => {
    class Provider {
      tipSlot = 107_000_000;
      calls: string[] = [];
      async getBlock(which: string) { this.calls.push(which); return { slot: this.tipSlot }; }
    }
    const p = new Provider();
    expect(await getTipSlot({ provider: p })).toBe(107_000_000);
    expect(p.calls).toEqual(["latest"]);
  });

  it("provider throws ⇒ PROVIDER_FAILED with the original error as cause; clock is never read", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    const boom = new Error("blockfrost 503");
    const err = await expectCodeAsync(
      getTipSlot({ provider: { getBlock: async () => { throw boom; } } }),
      CHAIN_TIME_ERRORS.PROVIDER_FAILED,
    );
    expect(err.cause).toBe(boom);
    expect(err.message).toContain("blockfrost 503");
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it("provider has no getBlock (e.g. @lucid-evolution 0.x) ⇒ PROVIDER_NO_GETBLOCK", async () => {
    await expectCodeAsync(getTipSlot({ provider: { getUtxos: async () => [] } }), CHAIN_TIME_ERRORS.PROVIDER_NO_GETBLOCK);
    await expectCodeAsync(getTipSlot({ provider: undefined }), CHAIN_TIME_ERRORS.PROVIDER_NO_GETBLOCK);
    await expectCodeAsync(getTipSlot({ provider: null }), CHAIN_TIME_ERRORS.PROVIDER_NO_GETBLOCK);
  });

  it("tip without a valid slot ⇒ TIP_SLOT_INVALID (the old code returned slot 0)", async () => {
    const tips: unknown[] = [
      {}, null, undefined, { slot: null }, { slot: "107000000" }, { slot: -1 },
      { slot: 1.5 }, { slot: Number.NaN }, { slot: 2 ** 53 }, { slot: 107_000_000n },
    ];
    for (const tip of tips) {
      await expectCodeAsync(
        getTipSlot({ provider: { getBlock: async () => tip } }),
        CHAIN_TIME_ERRORS.TIP_SLOT_INVALID,
      );
    }
  });

  it("slot 0 from the provider is valid (Preview genesis), not treated as missing", async () => {
    expect(await getTipSlot({ provider: { getBlock: async () => ({ slot: 0 }) } })).toBe(0);
  });
});

describe("getCurrentEpoch", () => {
  it("propagates provider failure — no clock fallback", async () => {
    await expectCodeAsync(
      getCurrentEpoch({ provider: { getBlock: async () => { throw new Error("down"); } } }, "Preprod"),
      CHAIN_TIME_ERRORS.PROVIDER_FAILED,
    );
    await expectCodeAsync(
      getCurrentEpoch({ provider: { getBlock: async () => ({}) } }, "Mainnet"),
      CHAIN_TIME_ERRORS.TIP_SLOT_INVALID,
    );
  });

  // `network` must be required: a default ("Preview") silently mis-converts Preprod/Mainnet.
  // vitest does not type-check, so pin it at runtime: Function.length stops counting at the
  // first parameter that has a default value.
  it("network parameter has no default (Function.length = 2)", () => {
    expect(getCurrentEpoch.length).toBe(2);
  });

  it("returns the CHAIN epoch of the tip slot", async () => {
    const slot = 86_400 + 432_000 * 10;
    expect(await getCurrentEpoch({ provider: { getBlock: async () => ({ slot }) } }, "Preprod")).toBe(14n);
  });
});
