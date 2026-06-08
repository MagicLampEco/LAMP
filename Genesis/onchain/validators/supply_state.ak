// supply_state — spend validator giữ SupplyState UTxO (CONTRACT §3 tầng 3, §5b).
//
// FIRST-PRINCIPLES — tách luật khỏi state holder:
//   SupplyState UTxO ngồi tại validator này. Spend hợp lệ ⟺ tx CÓ mint tLAMP (Δ>0).
//   TOÀN BỘ transition (cap/quota/monotonic/no-burn) do tlamp_mint (tầng 2) ép — một
//   nguồn sự thật, không trùng lặp luật (tối ưu ExUnit + giảm bề mặt lỗi).
//
//   Param = tlamp_policy (tầng 2). Tuyến tính, KHÔNG vòng lặp: (3) chỉ biết policy
//   của (2); (2) chỉ biết policy/name của (1); (1) chỉ biết genesis_ref.
//
// A12 (spend SupplyState mà KHÔNG mint → phá thread vô cớ): chặn bằng đòi Δ>0.
//   Mọi lần SupplyState bị tiêu PHẢI kèm mint tLAMP → tlamp_mint luôn được kích hoạt
//   → transition luôn được kiểm. Không có đường "rút NFT/đổi datum" lách tlamp_mint.

use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction, placeholder}
use magiclamp/genesis/constants
use magiclamp/genesis/types.{Advance, SupplyState, SupplyStateRedeemer}
use magiclamp/genesis/util

validator supply_state(tlamp_policy: PolicyId) {
  spend(
    _datum: Option<SupplyState>,
    _r: SupplyStateRedeemer,
    _own_ref: OutputReference,
    tx: Transaction,
  ) {
    // Spend ⟺ có mint tLAMP (Δ>0). Ủy quyền transition cho tlamp_mint (tầng 2).
    let delta = util.minted_qty(tx.mint, tlamp_policy, constants.tlamp_name)
    delta > 0
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const tlamp_pol: PolicyId = #"7717"

fn some_state() -> Option<SupplyState> {
  Some(SupplyState {
    dist_minted: 0,
    reserve_minted: 0,
    dist_cap: constants.dist_cap_oil,
    reserve_cap: constants.reserve_cap_oil,
  })
}

fn mint_tlamp(qty: Int) {
  assets.zero |> assets.add(tlamp_pol, constants.tlamp_name, qty)
}

test spend_with_mint() {
  let tx = Transaction { ..placeholder, mint: mint_tlamp(1_000_000) }
  supply_state.spend(tlamp_pol, some_state(), Advance, util.mk_ref(0), tx)
}

test spend_without_mint() fail {
  // A12: spend SupplyState mà không mint tLAMP (Δ=0) → reject (phá thread vô cớ).
  let tx = Transaction { ..placeholder, mint: assets.zero }
  supply_state.spend(tlamp_pol, some_state(), Advance, util.mk_ref(0), tx)
}

test spend_with_burn_attempt() fail {
  // mint âm (Δ<0) → reject (không cho spend kèm burn).
  let tx = Transaction { ..placeholder, mint: mint_tlamp(-1) }
  supply_state.spend(tlamp_pol, some_state(), Advance, util.mk_ref(0), tx)
}
