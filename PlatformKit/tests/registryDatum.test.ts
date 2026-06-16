// PlatformKit · round-trip codec PlatformEntry/PlatformStatus + redeemer Constr index.
// Đảm bảo byte-perfect: encode → CBOR → decode == gốc; Constr index khớp platform.ak.

import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  platformEntryToCbor, platformEntryFromCbor,
  encodePlatformEntry, encodePlatformStatus, decodePlatformStatus,
  encodeRegisterPlatformRedeemer, encodeUpdateEntryRedeemer,
  PLATFORM_STATUS,
} from "../offchain/src/registryDatum.js";
import type { PlatformEntry } from "../offchain/src/types.js";
import { asciiToHex } from "../offchain/src/encoding.js";

const sampleEntry = (): PlatformEntry => ({
  platform_id:    asciiToHex("PhoenixKey"),
  instance_id:    asciiToHex("phoenixkey-custody-v1"),
  custody_hash:   "aa".repeat(28),
  seed_policy:    "bb".repeat(28),
  governance_ref: "cc".repeat(28),
  accepted_assets: [
    { policy: "", name: "" },
    { policy: "dd".repeat(28), name: asciiToHex("LAMP") },
  ],
  cut_bps:       500n,
  created_epoch: 42n,
  status:        "Active",
});

describe("PlatformEntry codec round-trip", () => {
  it("encode→decode bảo toàn mọi field", () => {
    const e = sampleEntry();
    const back = platformEntryFromCbor(platformEntryToCbor(e));
    expect(back).toEqual(e);
  });

  it("PlatformEntry là Constr(0) đúng 9 field, đúng thứ tự", () => {
    const c = encodePlatformEntry(sampleEntry());
    expect(c.index).toBe(0);
    expect(c.fields.length).toBe(9);
    // field[0..4] bytes, [5] list, [6..7] int, [8] status Constr.
    expect(typeof c.fields[0]).toBe("string");
    expect(Array.isArray(c.fields[5])).toBe(true);
    expect(typeof c.fields[6]).toBe("bigint");
    expect(c.fields[6]).toBe(500n);
    expect(c.fields[7]).toBe(42n);
    expect(c.fields[8]).toBeInstanceOf(Constr);
  });

  it("round-trip cho cả 3 status", () => {
    for (const s of ["Active", "Paused", "Retired"] as const) {
      const e = { ...sampleEntry(), status: s };
      // Paused/Retired không well-formed nhưng codec phải round-trip nguyên.
      expect(platformEntryFromCbor(platformEntryToCbor(e)).status).toBe(s);
    }
  });
});

describe("PlatformStatus Constr index khớp platform.ak", () => {
  it("Active=0, Paused=1, Retired=2", () => {
    expect(encodePlatformStatus("Active").index).toBe(0);
    expect(encodePlatformStatus("Paused").index).toBe(1);
    expect(encodePlatformStatus("Retired").index).toBe(2);
    expect(PLATFORM_STATUS).toEqual({ Active: 0, Paused: 1, Retired: 2 });
  });
  it("decode lại đúng nhãn", () => {
    expect(decodePlatformStatus(new Constr(0, []))).toBe("Active");
    expect(decodePlatformStatus(new Constr(1, []))).toBe("Paused");
    expect(decodePlatformStatus(new Constr(2, []))).toBe("Retired");
  });
  it("decode Constr lạ → ném lỗi", () => {
    expect(() => decodePlatformStatus(new Constr(3, []))).toThrow(/unknown/);
    expect(() => decodePlatformStatus(new Constr(0, ["x"]))).toThrow(/0 fields/);
  });
});

describe("Redeemers RegisterPlatform / UpdateEntry", () => {
  it("đều là Constr(0,[]) (mirror platform.ak)", () => {
    expect(encodeRegisterPlatformRedeemer().index).toBe(0);
    expect(encodeRegisterPlatformRedeemer().fields.length).toBe(0);
    expect(encodeUpdateEntryRedeemer().index).toBe(0);
    expect(encodeUpdateEntryRedeemer().fields.length).toBe(0);
    // CBOR của Constr(0,[]) = "d87980".
    expect(Data.to(encodeRegisterPlatformRedeemer())).toBe("d87980");
  });
});
