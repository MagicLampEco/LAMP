// genesis_mint — minting policy ONE-SHOT phát tổng cung tLAMP tại genesis.
//
// FIRST-PRINCIPLES — fixed-supply qua one-shot:
//   Param (genesis_ref, lamp_name, total_oil). Mint hợp lệ chỉ khi consume genesis_ref.
//   1 UTxO spend ≤ 1 lần → policy chạy ≤ 1 lần → ĐÚNG total_oil tLAMP, KHÔNG re-mint →
//   tổng cung BẤT BIẾN. KHÔNG nhánh burn (else fail) → supply không giảm.
//
// ÉP (G-MINT-1 phần tLAMP):
//   M-MINT-1  mint chứa ĐÚNG 1 asset name của policy này (lamp_name), qty == total_oil.
//   (Phần authenticity NFT pot do genesis_pot.ak ép — tách policy để tách hash mỗi pot.)
//
// LƯU Ý mô hình: production tLAMP đã tồn tại (Faucet). Validator này MÔ HÌNH hóa genesis
// supply mint trung thực cho 4-pot (deploy SUBMIT=false). Khi seed từ tLAMP Faucet có sẵn,
// deploy fund từ Faucet thay mint mới — bất biến phân-pot (split/seed) không đổi.

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction,
  placeholder}
use magiclamp/genesis/split

pub type GenesisMintRedeemer {
  MintSupply
}

validator genesis_mint(
  genesis_ref : OutputReference,
  lamp_name   : ByteArray,
  total_oil   : Int,
) {
  mint(_redeemer: GenesisMintRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ONE-SHOT: consume genesis_ref.
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // M-MINT-1: đúng 1 asset name (lamp_name), qty == total_oil (không hơn không kém).
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect assets.quantity_of(tx.mint, policy_id, lamp_name) == total_oil

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const pol: PolicyId = #"d00d"

const lamp_name: ByteArray = #"744c414d50"

fn g_ref() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 5 }
}

fn g_input() -> Input {
  Input {
    output_reference: g_ref(),
    output: Output {
      address: Address { payment_credential: Script(#"a0"), stake_credential: None },
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn mint_lamp(qty: Int) -> Value {
  assets.zero |> assets.add(pol, lamp_name, qty)
}

test t_mint_supply_happy() {
  // mint đúng total_supply_oil (36e15) với consume genesis.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_lamp(split.total_supply_oil),
    }
  genesis_mint.mint(g_ref(), lamp_name, split.total_supply_oil, MintSupply, pol, tx)
}

test t_mint_without_genesis() fail {
  let tx =
    Transaction { ..placeholder, inputs: [], mint: mint_lamp(split.total_supply_oil) }
  genesis_mint.mint(g_ref(), lamp_name, split.total_supply_oil, MintSupply, pol, tx)
}

test t_mint_wrong_qty() fail {
  // mint thiếu 1 → reject (supply phải đúng total_oil).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_lamp(split.total_supply_oil - 1),
    }
  genesis_mint.mint(g_ref(), lamp_name, split.total_supply_oil, MintSupply, pol, tx)
}

test t_mint_extra_name() fail {
  // mint thêm asset name lạ cùng policy → dict.size != 1 → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_lamp(split.total_supply_oil) |> assets.add(pol, #"9999", 1),
    }
  genesis_mint.mint(g_ref(), lamp_name, split.total_supply_oil, MintSupply, pol, tx)
}
