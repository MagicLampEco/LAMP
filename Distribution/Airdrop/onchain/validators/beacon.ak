// beacon (airdrop) — committee post MerkleRoot mỗi epoch. Authenticity = NFT.
// Genesis beacon tạo lúc deploy (pay-to-address + NFT). Update sau: spend + re-create
// với epoch tăng, kind & NFT bảo toàn. TÁI DÙNG cơ chế đã audit (C-BCN-1).

use aiken/collection/list
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction, placeholder}
use magiclamp/airdrop/types.{BeaconDatum, BeaconRedeemer, MerkleRoot, PostBeacon}
use magiclamp/airdrop/util

validator beacon(
  committee         : List<ByteArray>,
  threshold         : Int,
  beacon_nft_policy : ByteArray,
) {
  spend(
    datum_opt : Option<BeaconDatum>,
    _redeemer : BeaconRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    expect assets.is_zero(tx.mint)
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
    expect util.count_committee_sigs(committee, tx.extra_signatories) >= threshold

    let beacon_in = util.input_at_script(tx.inputs, own_hash)
    let beacon_out = util.output_at_script(tx.outputs, own_hash)
    expect InlineDatum(d) = beacon_out.datum
    expect out_datum: BeaconDatum = d

    // epoch đơn điệu tăng; kind bảo toàn
    expect out_datum.epoch > datum.epoch
    expect out_datum.kind == datum.kind

    // authenticity: input PHẢI mang đúng NFT beacon (chống decoy UTxO tại script address)
    let nft_name = util.beacon_name(datum.kind)
    expect assets.quantity_of(beacon_in.value, beacon_nft_policy, nft_name) == 1

    // value BẢO TOÀN TUYỆT ĐỐI: post root chỉ đổi datum, KHÔNG rút ADA/token nào (gồm cả
    // NFT ở output) — chặn committee siphon value thừa mỗi lần post (đồng bộ claim_account/treasury).
    expect beacon_out.value == beacon_in.value

    True
  }

  else(_) {
    fail
  }
}

// ── Tests ─────────────────────────────────────────────────────

const bt_sh: ByteArray = #"b0b0b0b0"

const bt_committee: List<ByteArray> = [#"c1", #"c2", #"c3"]

const bt_threshold: Int = 2

const bt_nft_policy: ByteArray = #"beac"

fn bt_datum(epoch: Int) -> BeaconDatum {
  BeaconDatum { epoch: epoch, kind: MerkleRoot, value: #"00" }
}

fn beacon_tx(
  in_epoch  : Int,
  out_epoch : Int,
  sigs      : List<ByteArray>,
  out_nft   : Int,
) -> Transaction {
  let addr = util.script_address(bt_sh)
  let in_val =
    assets.add(assets.from_lovelace(2_000_000), bt_nft_policy, util.beacon_name(MerkleRoot), 1)
  let out_val =
    assets.add(assets.from_lovelace(2_000_000), bt_nft_policy, util.beacon_name(MerkleRoot), out_nft)
  let b_in = util.mk_input(util.mk_ref(0), util.mk_output(addr, in_val, bt_datum(in_epoch)))
  let b_out = util.mk_output(addr, out_val, bt_datum(out_epoch))
  Transaction {
    ..placeholder,
    inputs: [b_in],
    outputs: [b_out],
    extra_signatories: sigs,
    mint: assets.zero,
  }
}

test beacon_happy() {
  let tx = beacon_tx(5, 6, [#"c1", #"c2"], 1)
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, Some(bt_datum(5)), PostBeacon, util.mk_ref(0), tx,
  )
}

test beacon_epoch_not_increasing() fail {
  let tx = beacon_tx(5, 5, [#"c1", #"c2"], 1)
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, Some(bt_datum(5)), PostBeacon, util.mk_ref(0), tx,
  )
}

test beacon_insufficient_committee() fail {
  let tx = beacon_tx(5, 6, [#"c1"], 1)
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, Some(bt_datum(5)), PostBeacon, util.mk_ref(0), tx,
  )
}

test beacon_nft_dropped() fail {
  // NFT không còn trên output (out_nft=0) → authenticity vỡ → reject
  let tx = beacon_tx(5, 6, [#"c1", #"c2"], 0)
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, Some(bt_datum(5)), PostBeacon, util.mk_ref(0), tx,
  )
}

test beacon_value_siphon_rejected() fail {
  // committee cố rút bớt 1 ADA khỏi beacon (NFT + epoch vẫn hợp lệ) → value ≠ → reject
  let addr = util.script_address(bt_sh)
  let nft = util.beacon_name(MerkleRoot)
  let in_val = assets.add(assets.from_lovelace(2_000_000), bt_nft_policy, nft, 1)
  let out_val = assets.add(assets.from_lovelace(1_000_000), bt_nft_policy, nft, 1) // rút 1 ADA
  let b_in = util.mk_input(util.mk_ref(0), util.mk_output(addr, in_val, bt_datum(5)))
  let b_out = util.mk_output(addr, out_val, bt_datum(6))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [b_in],
      outputs: [b_out],
      extra_signatories: [#"c1", #"c2"],
      mint: assets.zero,
    }
  beacon.spend(
    bt_committee, bt_threshold, bt_nft_policy, Some(bt_datum(5)), PostBeacon, util.mk_ref(0), tx,
  )
}
