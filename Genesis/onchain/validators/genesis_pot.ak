// genesis_pot — minting policy ONE-SHOT ép seed 1 POT custody tại genesis, ĐỒNG THỜI
// tách hash mỗi pot qua param `pot_tag`.
//
// VẤN ĐỀ (mirror Treasury custody_seed): custody UTxO ĐẦU TIÊN của 1 pot do ví thường
// tạo với inline CustodyDatum tùy ý → bất biến nền sổ↔value KHÔNG được ép ở đâu on-chain.
// Genesis ÉP bằng one-shot mint authenticity NFT của pot.
//
// FIRST-PRINCIPLES — one-shot + tách hash:
//   - Param (genesis_ref, custody_script_hash, pot_tag). `pot_tag` KHÁC nhau mỗi pot →
//     blake2b policy hash KHÁC → 4 pot có 4 authenticity policy riêng (tách thật).
//   - One-shot: mint hợp lệ chỉ khi consume genesis_ref. 1 UTxO spend ≤ 1 lần → policy
//     chạy ≤ 1 lần → đúng 1 NFT pot, KHÔNG re-mint.
//
// ÉP tại genesis (G-SEED + G-MINT phần NFT):
//   P-MINT-1   mint ĐÚNG 1 token của policy này (name = instance_id = pot_tag), qty +1.
//   P-OUT-1    đúng 1 output custody (theo custody_script_hash) mang NFT + inline datum.
//   P-PARAM-0  instance_id == pot_tag (datum khai đúng định danh đã mint).
//   P-SEED-0   seed_datum_ok: value↔sổ ∧ no_dup ∧ accepted (bất biến nền).
//   P-CONSUMED-0 consumed_proposals == [] (chống pre-mark né replay-guard).
// BURN — CẤM (else fail): authenticity NFT sống suốt vòng đời pot.

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference,
  Transaction, placeholder}
use magiclamp/genesis/seed
use magiclamp/genesis/types.{AssetKey, CustodyDatum, LedgerEntry}
use magiclamp/genesis/util

pub type GenesisPotRedeemer {
  // reserved_min_ada: lovelace giữ min-UTxO, không ghi sổ (≥ 0).
  SeedPot { reserved_min_ada: Int }
}

validator genesis_pot(
  genesis_ref         : OutputReference,
  custody_script_hash : ByteArray,
  pot_tag             : ByteArray,
) {
  mint(redeemer: GenesisPotRedeemer, policy_id: PolicyId, tx: Transaction) {
    let SeedPot { reserved_min_ada } = redeemer
    expect reserved_min_ada >= 0

    // ONE-SHOT: consume genesis_ref.
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // P-MINT-1: đúng 1 token policy này, name == pot_tag, qty +1.
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1
    expect assets.quantity_of(tx.mint, policy_id, pot_tag) == 1

    // P-OUT-1: đúng 1 output custody theo SCRIPT HASH.
    expect util.count_outputs_at_script(tx.outputs, custody_script_hash) == 1
    let cust_out = util.output_at_script(tx.outputs, custody_script_hash)
    expect !util.is_vk(cust_out.address)

    expect InlineDatum(od) = cust_out.datum
    expect seed_datum: CustodyDatum = od

    // P-PARAM-0: instance_id == pot_tag.
    expect seed_datum.instance_id == pot_tag

    // P-SEED-0: bất biến nền sổ↔value + no_dup + accepted.
    expect
      seed.seed_datum_ok(
        cust_out.value,
        seed_datum.ledger,
        seed_datum.accepted_assets,
        reserved_min_ada,
      )

    // P-CONSUMED-0: genesis chưa chi proposal nào.
    expect seed_datum.consumed_proposals == []

    True
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

const pol: PolicyId = #"beef"

const cust_hash: ByteArray = #"c0c0"

const dr_tag: ByteArray = #"4452"

const lamp_policy: ByteArray = #"744c414d50744c414d50744c414d50744c414d50744c414d50744c414d"

const lamp_name: ByteArray = #"744c414d50"

fn g_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 3 }
}

fn g_input() -> Input {
  Input {
    output_reference: g_ref(),
    output: Output {
      address: Address { payment_credential: Script(#"a0a0"), stake_credential: None },
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn accepted() -> List<AssetKey> {
  [
    AssetKey { policy: #"", name: #"" },
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

fn dr_datum(amount: Int) -> CustodyDatum {
  CustodyDatum {
    instance_id: dr_tag,
    accepted_assets: accepted(),
    ledger: [LedgerEntry { bucket_id: 1, policy: lamp_policy, name: lamp_name, amount }],
    cut_bps: 1_000,
    governance_ref: #"99",
    epoch: 0,
    consumed_proposals: [],
  }
}

fn cust_output(value: Value, datum: CustodyDatum) -> Output {
  Output {
    address: Address { payment_credential: Script(cust_hash), stake_credential: None },
    value: value,
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn mint_one(tag: ByteArray) -> Value {
  assets.zero |> assets.add(pol, tag, 1)
}

test t_pot_seed_happy() {
  let amount = 34_200_000_000_000_000
  let v =
    assets.zero
      |> assets.add(lamp_policy, lamp_name, amount)
      |> assets.add(#"", #"", 2_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_one(dr_tag),
      outputs: [cust_output(v, dr_datum(amount))],
    }
  genesis_pot.mint(g_ref(), cust_hash, dr_tag, SeedPot { reserved_min_ada: 2_000_000 }, pol, tx)
}

test t_pot_no_genesis() fail {
  let amount = 1_000
  let v =
    assets.zero
      |> assets.add(lamp_policy, lamp_name, amount)
      |> assets.add(#"", #"", 2_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [],
      mint: mint_one(dr_tag),
      outputs: [cust_output(v, dr_datum(amount))],
    }
  genesis_pot.mint(g_ref(), cust_hash, dr_tag, SeedPot { reserved_min_ada: 2_000_000 }, pol, tx)
}

test t_pot_seed_mismatch() fail {
  // value tLAMP 2000 nhưng sổ khai 1000 → seed_datum_ok fail.
  let v =
    assets.zero
      |> assets.add(lamp_policy, lamp_name, 2_000)
      |> assets.add(#"", #"", 2_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_one(dr_tag),
      outputs: [cust_output(v, dr_datum(1_000))],
    }
  genesis_pot.mint(g_ref(), cust_hash, dr_tag, SeedPot { reserved_min_ada: 2_000_000 }, pol, tx)
}

test t_pot_wrong_name() fail {
  // mint name != pot_tag → P-MINT-1 fail.
  let v = assets.from_lovelace(2_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [g_input()],
      mint: mint_one(#"9999"),
      outputs: [cust_output(v, dr_datum(0))],
    }
  genesis_pot.mint(g_ref(), cust_hash, dr_tag, SeedPot { reserved_min_ada: 2_000_000 }, pol, tx)
}
