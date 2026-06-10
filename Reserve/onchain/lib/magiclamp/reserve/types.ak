// Reserve types — Plutus Data encoding (Constr index = thứ tự khai báo field).
//
// P8 (bit-identical): TypeScript mirror trong offchain/src/types.ts PHẢI khai báo
// đúng thứ tự field dưới đây. THÊM field tương lai → CUỐI (giữ tương thích decode).

/// SupplyState — TÁI DÙNG NGUYÊN VẸN từ Genesis (KHÔNG sửa Genesis; mirror ở đây
/// để Reserve validator đọc/ép transition reserve_minted độc lập module).
/// = Constr(0, [dist_minted, reserve_minted, dist_cap, reserve_cap]).
pub type SupplyState {
  dist_minted: Int,
  reserve_minted: Int,
  dist_cap: Int,
  reserve_cap: Int,
}

/// ReservePolicy — beacon HẰNG-THUẬT-TOÁN (reference input, KHÔNG spend khi draw).
/// Thay "approved_cumulative DAO chỉnh tay" bằng THAM SỐ của HÀM. Validator tự tính
/// approved/max từ (policy, epoch, velocity) → KHÔNG ai chỉnh con số cuối, chỉ đổi
/// THAM SỐ qua governance_ref proposal Executed.
/// = Constr(0, [Int,Int,Int,Int,Int,Int,ByteArray,ByteArray]).
pub type ReservePolicy {
  genesis_release_epoch: Int,
  // field 0: t_g — epoch bắt đầu nhả
  reserve_release_base: Int,
  // field 1: R0 (oil, năm 0)
  annual_growth_bps: Int,
  // field 2: g_bps (clamp [300,500] on-chain)
  epochs_per_year: Int,
  // field 3: E_y
  demand_floor_bps: Int,
  // field 4: sàn allowance khi velocity=0 (vd 2000)
  velocity_window: Int,
  // field 5: K (SMA epochs) — metadata cho keeper, không ép trong gate
  velocity_source_policy: ByteArray,
  // field 6: policy id TreasuryFlowBeacon (#"" = bypass MVP)
  governance_ref: ByteArray,
  // field 7: proposal NFT cho phép ĐỔI THAM SỐ policy này
}

/// TreasuryFlowBeacon — velocity feed (reference input). Treasury collect cập nhật.
/// sma_ratio_bps ∈ [0, 10000]: velocity LAMP đo on-chain so mức tham chiếu (≤100%).
/// = Constr(0, [Int, Int]).
pub type TreasuryFlowBeacon {
  window_start_epoch: Int,
  // field 0
  sma_ratio_bps: Int,
  // field 1: tỷ lệ velocity (bps) — input duy nhất của demand_gate
}

/// ReserveMeter — thread state 1/epoch (reset sang epoch mới).
/// = Constr(0, [Int, Int]).
pub type ReserveMeter {
  epoch: Int,
  // field 0
  drawn_in_epoch: Int,
  // field 1
}

/// Redeemer reserve_meter spend.
/// Draw  = Constr(0, []) — rút trong epoch hiện tại.
/// Reset = Constr(1, []) — reset sang epoch mới (drawn_in_epoch về delta lần đầu).
pub type ReserveMeterRedeemer {
  Draw
  Reset
}
