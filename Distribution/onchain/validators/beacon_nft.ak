// Beacon authenticity NFT — minting policy ONE-SHOT (CONTRACT v2).
//
// Beacon UTxO DropParam cần đúng 1 authenticity NFT để chống datum hijacking:
// kẻ tấn công có thể tạo UTxO giả tại cùng beacon address với datum bịa, nhưng
// KHÔNG thể mint NFT này → claim_account (đọc D qua reference input) + beacon
// validator chỉ tin UTxO mang NFT.
//
// FIRST-PRINCIPLES — one-shot:
//   Policy parameterized bởi 1 genesis OutputReference. Mint chỉ hợp lệ khi tx
//   CONSUME đúng UTxO genesis đó. Vì 1 UTxO chỉ spend được 1 lần trong lịch sử
//   chain → policy chạy được đúng 1 lần → supply 1 NFT cố định, KHÔNG re-mint.
//   Đây là bất biến mạnh nhất có thể đạt được mà không cần state on-chain.
//
// MINT shape (đúng 1, không hơn không kém):
//   (DROP, +1) — authenticity token cho beacon DropParam.
//
// BURN — chọn an toàn = CẤM hoàn toàn (xem QĐ ghi dưới).

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, OutputReference, Transaction, placeholder}
use magiclamp/lampdist/types.{DropParam}
use magiclamp/lampdist/util

/// Redeemer của minting policy.
///
/// Chỉ một action `MintGenesis`. KHÔNG có biến thể Burn:
///
/// QĐ (trục an toàn vốn + bền vững hệ thống): CẤM burn.
///  - Beacon NFT là authenticity token sống suốt vòng đời module. Burn được =
///    cho phép phá tính xác thực beacon → datum hijacking lại có cửa. Không có
///    use-case hợp lệ nào cần đốt NFT này.
///  - One-shot đã chặn re-mint, nên cấm burn khiến supply BẤT BIẾN tuyệt đối
///    (đúng 1, mãi mãi). Đơn giản hoá lý luận an toàn cho mọi validator phụ thuộc.
///  - `else(_) { fail }` chặn mọi purpose khác (spend/withdraw/...) lẫn mọi
///    redeemer ngoài MintGenesis → mint âm (burn) tự động bị từ chối.
pub type BeaconNftRedeemer {
  MintGenesis
}

validator beacon_nft(genesis_ref: OutputReference) {
  mint(_redeemer: BeaconNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── ONE-SHOT: phải consume đúng UTxO genesis ───────────────────────────
    // 1 UTxO spend được tối đa 1 lần → policy chạy được tối đa 1 lần.
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Mint chứa ĐÚNG 1 token của policy này, qty +1 ───────────────────────
    // tokens(mint, policy_id) = Dict<AssetName, Int> chỉ gồm asset của policy
    // này. size == 1 đảm bảo KHÔNG mint thừa asset name lạ; quantity_of == 1
    // đảm bảo đúng (DROP,1) — không hơn không kém, không qty 2, không qty âm (burn).
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1

    let drop_name = util.beacon_name(DropParam)
    expect assets.quantity_of(tx.mint, policy_id, drop_name) == 1

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const nt_policy: PolicyId = #"beac"

/// genesis UTxO mà policy bắt buộc consume (output_index 7 để phân biệt).
fn nt_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 7 }
}

/// Mint value tham số hoá theo qty (để dựng cả happy + sai lệch).
fn nt_mint(drop_qty: Int) -> Value {
  assets.zero
    |> assets.add(nt_policy, util.beacon_name(DropParam), drop_qty)
}

/// Input consume genesis ref (dummy output ví thường).
fn nt_genesis_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(nt_genesis_ref(), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

/// Input bất kỳ KHÔNG phải genesis (output_index khác).
fn nt_other_input() -> Input {
  let addr = util.vk_address(#"a0")
  util.mk_input(util.mk_ref(0), util.mk_output_no_datum(addr, assets.from_lovelace(2_000_000)))
}

test mint_happy() {
  // consume genesis + mint đúng 1 NFT qty 1 → pass.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_other_input(), nt_genesis_input()],
      mint: nt_mint(1),
    }
  beacon_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test mint_without_genesis() fail {
  // KHÔNG consume genesis ref → one-shot reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_other_input()],
      mint: nt_mint(1),
    }
  beacon_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}

test mint_wrong_quantity() fail {
  // mint 2 DROP (≠ 1) → reject (supply phải đúng 1).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [nt_genesis_input()],
      mint: nt_mint(2),
    }
  beacon_nft.mint(nt_genesis_ref(), MintGenesis, nt_policy, tx)
}
