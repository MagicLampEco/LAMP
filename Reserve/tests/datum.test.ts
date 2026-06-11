// Reserve datum codec — roundtrip + Constr index (P8 byte-perfect với types.ak).
import { describe, it, expect } from "vitest";
import {
  flowBeaconFromData,
  flowBeaconToData,
  reserveMeterFromData,
  reserveMeterRedeemerToData,
  reserveMeterToData,
  reservePolicyFromData,
  reservePolicyToData,
  supplyStateFromData,
  supplyStateToData,
} from "../offchain/src/datum.js";
import type {
  ReserveMeter,
  ReservePolicy,
  SupplyState,
  TreasuryFlowBeacon,
} from "../offchain/src/types.js";

describe("SupplyState codec", () => {
  it("roundtrip 4 field giữ thứ tự", () => {
    const s: SupplyState = {
      dist_minted: 1n,
      reserve_minted: 2n,
      dist_cap: 34_200_000_000_000_000n,
      reserve_cap: 1_800_000_000_000_000n,
    };
    expect(supplyStateFromData(supplyStateToData(s))).toEqual(s);
  });
});

describe("ReservePolicy codec (8 field)", () => {
  it("roundtrip giữ đúng thứ tự + bytes", () => {
    const p: ReservePolicy = {
      genesis_release_epoch: 1000n,
      reserve_release_base: 2_000_000_000_000n,
      annual_growth_bps: 300n,
      epochs_per_year: 73n,
      demand_floor_bps: 2000n,
      velocity_window: 12n,
      velocity_source_policy: "",
      governance_ref: "deadbeef",
    };
    const back = reservePolicyFromData(reservePolicyToData(p));
    expect(back).toEqual(p);
  });
  it("velocity_source_policy non-empty roundtrip", () => {
    const p: ReservePolicy = {
      genesis_release_epoch: 1000n,
      reserve_release_base: 2_000_000_000_000n,
      annual_growth_bps: 300n,
      epochs_per_year: 73n,
      demand_floor_bps: 2000n,
      velocity_window: 12n,
      velocity_source_policy: "a1a1a1a1",
      governance_ref: "beef",
    };
    expect(reservePolicyFromData(reservePolicyToData(p)).velocity_source_policy).toBe("a1a1a1a1");
  });
});

describe("TreasuryFlowBeacon codec", () => {
  it("roundtrip", () => {
    const b: TreasuryFlowBeacon = { window_start_epoch: 1024n, sma_ratio_bps: 3000n };
    expect(flowBeaconFromData(flowBeaconToData(b))).toEqual(b);
  });
});

describe("ReserveMeter codec", () => {
  it("roundtrip", () => {
    const m: ReserveMeter = { epoch: 1036n, drawn_in_epoch: 12345n };
    expect(reserveMeterFromData(reserveMeterToData(m))).toEqual(m);
  });
});

describe("ReserveMeterRedeemer", () => {
  it("Draw = Constr(0,[]), Reset = Constr(1,[]) — phân biệt", () => {
    const draw = reserveMeterRedeemerToData("Draw");
    const reset = reserveMeterRedeemerToData("Reset");
    expect(draw).not.toBe(reset);
    // Constr(0,[]) CBOR = d87980 ; Constr(1,[]) = d87a80.
    expect(draw).toBe("d87980");
    expect(reset).toBe("d87a80");
  });
});
