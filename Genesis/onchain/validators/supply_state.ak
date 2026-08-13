// supply_state — spend validator giữ SupplyState UTxO (CONTRACT §3 tầng 3, §5b).
//
// FIRST-PRINCIPLES — tách luật khỏi state holder:
//   SupplyState UTxO ngồi tại validator này. Spend hợp lệ ⟺ tx CÓ mint LAMP (Δ>0).
//   TOÀN BỘ transition (cap/quota/monotonic/no-burn) do lamp_mint (tầng 2) ép — một
//   nguồn sự thật, không trùng lặp luật (tối ưu ExUnit + giảm bề mặt lỗi).
//
//   Param = lamp_policy (tầng 2) + thread_nft_policy (tầng 1) + token_name (asset name
//   LAMP, khớp param token_name của lamp_mint: "tLAMP" testnet / "LAMP" mainnet). Tuyến
//   tính, KHÔNG vòng lặp: (3) chỉ biết policy của (2); (2) chỉ biết policy/name của (1);
//   (1) chỉ biết genesis_ref. token_name PHẢI khớp giá trị truyền cho lamp_mint khi deploy.
//
// A12 (spend SupplyState mà KHÔNG mint → phá thread vô cớ): chặn bằng đòi Δ>0.
//   Mọi lần SupplyState bị tiêu PHẢI kèm mint LAMP → lamp_mint luôn được kích hoạt
//   → transition luôn được kiểm. Không có đường "rút NFT/đổi datum" lách lamp_mint.

use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/genesis/constants
use magiclamp/genesis/types.{Advance, SupplyState, SupplyStateRedeemer}
use magiclamp/genesis/util

validator supply_state(
  lamp_policy       : PolicyId,
  thread_nft_policy : PolicyId,
  token_name        : ByteArray,
) {
  spend(
    _datum: Option<SupplyState>,
    _r: SupplyStateRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    // D8-#3: UTxO BỊ SPEND phải mang ĐÚNG thread NFT thật (qty==1 đúng policy đó).
    // Không tin "đây là SupplyState" chỉ vì ngồi ở script này — kẻ tấn công có thể
    // tạo UTxO rác KHÔNG có NFT tại cùng địa chỉ rồi spend để tiêu min-ADA / gây nhiễu.
    // Ghim NFT thật → chỉ UTxO SupplyState chính danh mới được đường spend này.
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })
    expect
      assets.quantity_of(own_input.output.value, thread_nft_policy, constants.supply_name) == 1

    // Spend ⟺ có mint LAMP (Δ>0). Ủy quyền transition cho lamp_mint (tầng 2).
    // Đo theo token_name (param): tLAMP testnet / LAMP mainnet — khớp lamp_mint.
    let delta = util.minted_qty(tx.mint, lamp_policy, token_name)
    delta > 0
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const lamp_pol: PolicyId = #"7717"

/// token_name dùng cho test = default_token_name ("tLAMP"). Validator nhận qua param.
const tk_name: ByteArray = constants.default_token_name

const thr_pol: PolicyId = #"5544"

const sscript: ByteArray = #"5151"

fn some_state() -> Option<SupplyState> {
  Some(SupplyState {
    dist_minted: 0,
    reserve_minted: 0,
    dist_cap: constants.dist_cap_oildrop,
    reserve_cap: constants.reserve_cap_oildrop,
  })
}

fn mint_lamp(qty: Int) {
  assets.zero |> assets.add(lamp_pol, constants.default_token_name, qty)
}

/// own_ref được spend; input tương ứng MANG thread NFT thật (qty==1).
fn own_ref() -> OutputReference {
  util.mk_ref(0)
}

fn ss_input_with_nft() -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(thr_pol, constants.supply_name, 1)
  expect Some(s) = some_state()
  util.mk_input(own_ref(), util.mk_output(util.script_address(sscript), v, s))
}

/// input bị spend KHÔNG mang thread NFT (UTxO rác tại cùng địa chỉ).
fn ss_input_no_nft() -> Input {
  expect Some(s) = some_state()
  util.mk_input(
    own_ref(),
    util.mk_output(util.script_address(sscript), assets.from_lovelace(2_000_000), s),
  )
}

test spend_with_mint() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input_with_nft()],
      mint: mint_lamp(1_000_000),
    }
  supply_state.spend(lamp_pol, thr_pol, tk_name, some_state(), Advance, own_ref(), tx)
}

test spend_without_mint() fail {
  // A12: spend SupplyState mà không mint tLAMP (Δ=0) → reject (phá thread vô cớ).
  let tx = Transaction { ..placeholder, inputs: [ss_input_with_nft()], mint: assets.zero }
  supply_state.spend(lamp_pol, thr_pol, tk_name, some_state(), Advance, own_ref(), tx)
}

test spend_with_burn_attempt() fail {
  // mint âm (Δ<0) → reject (không cho spend kèm burn).
  let tx =
    Transaction { ..placeholder, inputs: [ss_input_with_nft()], mint: mint_lamp(-1) }
  supply_state.spend(lamp_pol, thr_pol, tk_name, some_state(), Advance, own_ref(), tx)
}

test spend_without_real_nft() fail {
  // D8-#3: UTxO bị spend KHÔNG mang thread NFT thật → reject (dù có mint tLAMP).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [ss_input_no_nft()],
      mint: mint_lamp(1_000_000),
    }
  supply_state.spend(lamp_pol, thr_pol, tk_name, some_state(), Advance, own_ref(), tx)
}
