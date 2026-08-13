// LampDistribution constants — Preview MVP (SPEC §7)
// Đơn vị: oildrop (1 LAMP = 10^6 oildrop). Q-format: Q = 10^9.

pub const q : Int = 1_000_000_000

// P parameter (oildrop/drop)
pub const p_genesis : Int = 100_000_000      // 100 LAMP
pub const p_min     : Int = 10_000_000       // 10 LAMP  [hard floor]
pub const p_max     : Int = 10_000_000_000   // 10_000 LAMP [hard ceiling]

// P adjustment
pub const max_p_delta_q : Int = 100_000_000  // ±10% = 0.10 × Q
pub const p_ema_window  : Int = 3            // α = 0.5
