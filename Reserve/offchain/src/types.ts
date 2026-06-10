// Reserve TS types — P8 mirror của onchain/lib/magiclamp/reserve/types.ak.
// Thứ tự field = thứ tự Constr index. THÊM field → CUỐI.

/** SupplyState = Constr(0, [dist_minted, reserve_minted, dist_cap, reserve_cap]). */
export interface SupplyState {
  dist_minted:    bigint;
  reserve_minted: bigint;
  dist_cap:       bigint;
  reserve_cap:    bigint;
}

/**
 * ReservePolicy = Constr(0, [Int,Int,Int,Int,Int,Int,ByteArray,ByteArray]).
 * velocity_source_policy = "" (empty hex) → bypass MVP demand_gate.
 */
export interface ReservePolicy {
  genesis_release_epoch:  bigint;
  reserve_release_base:   bigint;
  annual_growth_bps:      bigint;
  epochs_per_year:        bigint;
  demand_floor_bps:       bigint;
  velocity_window:        bigint;
  velocity_source_policy: string; // hex policy id ("" = bypass)
  governance_ref:         string; // hex
}

/** TreasuryFlowBeacon = Constr(0, [Int, Int]). */
export interface TreasuryFlowBeacon {
  window_start_epoch: bigint;
  sma_ratio_bps:      bigint;
}

/** ReserveMeter = Constr(0, [Int, Int]). */
export interface ReserveMeter {
  epoch:          bigint;
  drawn_in_epoch: bigint;
}

/** ReserveMeterRedeemer: Draw=Constr(0,[]) | Reset=Constr(1,[]). */
export type ReserveMeterRoute = "Draw" | "Reset";
