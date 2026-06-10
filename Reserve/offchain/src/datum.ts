// Reserve datum/redeemer codec — Plutus Data (Lucid Evolution).
// PHẢI khớp byte-perfect với onchain types.ak. Constr index = thứ tự khai báo Aiken.
//
//   SupplyState{dist_minted,reserve_minted,dist_cap,reserve_cap} = Constr(0,[int×4])
//   ReservePolicy{...8 field} = Constr(0,[int,int,int,int,int,int,bytes,bytes])
//   TreasuryFlowBeacon{window_start_epoch,sma_ratio_bps} = Constr(0,[int,int])
//   ReserveMeter{epoch,drawn_in_epoch} = Constr(0,[int,int])
//   ReserveMeterRedeemer: Draw=Constr(0,[]) | Reset=Constr(1,[])

import { Constr, Data } from "@lucid-evolution/lucid";
import type {
  ReserveMeter,
  ReserveMeterRoute,
  ReservePolicy,
  SupplyState,
  TreasuryFlowBeacon,
} from "./types.js";

export const RESERVE_METER_REDEEMER = { Draw: 0, Reset: 1 } as const;

function normHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.toLowerCase();
}

// ── SupplyState ────────────────────────────────────────────────────────
export function supplyStateToData(s: SupplyState): string {
  return Data.to(
    new Constr(0, [s.dist_minted, s.reserve_minted, s.dist_cap, s.reserve_cap]),
  );
}

export function supplyStateFromData(cbor: string): SupplyState {
  const d = Data.from(cbor) as Constr<Data>;
  const f = d.fields as bigint[];
  return {
    dist_minted:    f[0]!,
    reserve_minted: f[1]!,
    dist_cap:       f[2]!,
    reserve_cap:    f[3]!,
  };
}

// ── ReservePolicy ──────────────────────────────────────────────────────
export function reservePolicyToData(p: ReservePolicy): string {
  return Data.to(
    new Constr(0, [
      p.genesis_release_epoch,
      p.reserve_release_base,
      p.annual_growth_bps,
      p.epochs_per_year,
      p.demand_floor_bps,
      p.velocity_window,
      normHex(p.velocity_source_policy),
      normHex(p.governance_ref),
    ]),
  );
}

export function reservePolicyFromData(cbor: string): ReservePolicy {
  const d = Data.from(cbor) as Constr<Data>;
  const f = d.fields as Array<bigint | string>;
  return {
    genesis_release_epoch:  f[0] as bigint,
    reserve_release_base:   f[1] as bigint,
    annual_growth_bps:      f[2] as bigint,
    epochs_per_year:        f[3] as bigint,
    demand_floor_bps:       f[4] as bigint,
    velocity_window:        f[5] as bigint,
    velocity_source_policy: f[6] as string,
    governance_ref:         f[7] as string,
  };
}

// ── TreasuryFlowBeacon ─────────────────────────────────────────────────
export function flowBeaconToData(b: TreasuryFlowBeacon): string {
  return Data.to(new Constr(0, [b.window_start_epoch, b.sma_ratio_bps]));
}

export function flowBeaconFromData(cbor: string): TreasuryFlowBeacon {
  const d = Data.from(cbor) as Constr<Data>;
  const f = d.fields as bigint[];
  return { window_start_epoch: f[0]!, sma_ratio_bps: f[1]! };
}

// ── ReserveMeter ───────────────────────────────────────────────────────
export function reserveMeterToData(m: ReserveMeter): string {
  return Data.to(new Constr(0, [m.epoch, m.drawn_in_epoch]));
}

export function reserveMeterFromData(cbor: string): ReserveMeter {
  const d = Data.from(cbor) as Constr<Data>;
  const f = d.fields as bigint[];
  return { epoch: f[0]!, drawn_in_epoch: f[1]! };
}

// ── Redeemer ───────────────────────────────────────────────────────────
export function reserveMeterRedeemerToData(route: ReserveMeterRoute): string {
  return Data.to(new Constr(RESERVE_METER_REDEEMER[route], []));
}
