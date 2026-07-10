// registry_write — Mint-Authority Registry WRITE-side (CONTRACT: `SPEC/lamp-mint-core-adapter.md`
// §3, brief write-side 2026-07-10). Validator MỎNG — toàn bộ luật thuần ở
// `lib/magiclamp/genesis/registry_write_logic.ak` (đã test riêng). File này chỉ forward.
//
// MULTI-PURPOSE (Design 2, mirror `PhoenixKey-Validator/validators/taad.ak`): MỘT script vừa
// `mint` (Deploy — tạo Registry-NFT genesis cho 1 governing_did) vừa `spend` (Update — sửa
// entries của registry đã có). Vì cùng 1 script, policy id CỦA MINT ≡ script hash CỦA SPEND
// → hard-bind NFT genesis vào Script(own_policy) không cần param, không vòng lặp (giống TAAD
// Design 2 giải quyết vòng phụ thuộc policy↔địa chỉ).
//
// Registry-NFT: policy ≡ script hash của CHÍNH validator này; asset name = blake2b_256
// (governing_did) — khớp `registry.ak:1-17`/`registry_mint.rs:26-30` (Core, byte-perfect).
//
// Param: `taad_policy` — script hash của TAAD validator (PhoenixKey-Validator `taad.ak`), TAAD
// anchor NFT policy. Baked lúc deploy (TAAD deploy trước Registry, tuyến tính không vòng: Registry
// biết TAAD, TAAD không biết Registry).
//
// AUTHORITY (mint Deploy VÀ spend Update dùng CHUNG 1 gate — `registry_write.controller_authorized`):
// đúng 1 reference input mang TAAD anchor NFT của governing_did, datum status Active,
// controller_pkh (TAADDatum field 2) ∈ extra_signatories. "Chỉ controller HIỆN TẠI của DID mới
// tạo/sửa được registry của DID mình" — một nguồn sự thật cho CẢ 2 purpose.
//
// Redeemer = Constr rỗng (Deploy/Update đều Constr 0 []) — khớp byte-perfect
// `registry_mint.rs:605-619` (deploy) + `:770-788` (update), Core ĐANG gửi empty-constr cho cả
// 2 builder. Lý do KHÔNG thêm field one-shot (vd genesis_ref kiểu thread_nft.ak) + rủi ro tồn dư
// đã ghi đầy đủ ở đầu `lib/.../registry_write_logic.ak`.

use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/address.{Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{OutputReference, Transaction}
use magiclamp/genesis/registry.{Authority, MultiSig, RegistryDatum, RegistryEntry, SinglePkh}
use magiclamp/genesis/registry_write_logic.{
  controller_authorized, entries_well_formed, find_fresh_output, minted_pair,
}
use magiclamp/genesis/taad_mirror.{Active, Migrated, Person, Recovering, TAADDatum}
use magiclamp/genesis/util

pub type RegistryDeployRedeemer {
  Deploy
}

pub type RegistryUpdateRedeemer {
  Update
}

validator registry_write(taad_policy: PolicyId) {
  // ── GENESIS: mint Registry-NFT + khoá RegistryDatum đầu tiên ─────────────
  mint(_r: RegistryDeployRedeemer, own_policy: PolicyId, tx: Transaction) {
    expect Some((name, qty)) = minted_pair(tx.mint, own_policy)
    expect qty == 1
    expect Some(out) = find_fresh_output(tx.outputs, own_policy, name)
    expect d: RegistryDatum = util.inline_datum(out)
    and {
      // A-1 binding: asset name == blake2b_256(governing_did) của CHÍNH datum genesis.
      name == blake2b_256(d.governing_did),
      entries_well_formed(d.entries),
      util.value_only_nft_and_ada(out.value, own_policy),
      out.reference_script == None,
      controller_authorized(tx.reference_inputs, taad_policy, d.governing_did, tx.extra_signatories),
    }
  }

  // ── LIFECYCLE: sửa entries (Update) — chỉ controller hiện tại ────────────
  spend(
    datum_opt: Option<RegistryDatum>,
    _r: RegistryUpdateRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d_in) = datum_opt
    let own_out = util.own_input(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_out)
    let nft_name = blake2b_256(d_in.governing_did)

    // D8-#3 style: UTxO bị spend PHẢI mang đúng Registry-NFT thật (không tin ngồi-ở-script-này).
    expect quantity_of(own_out.value, own_hash, nft_name) == 1
    // NFT KHÔNG mint/burn trong tx Update (chống burn).
    expect quantity_of(tx.mint, own_hash, nft_name) == 0

    // Continuing output DUY NHẤT: đúng NFT, đúng script address.
    let outs =
      list.filter(
        tx.outputs,
        fn(o) { quantity_of(o.value, own_hash, nft_name) == 1 && o.address.payment_credential == Script(
          own_hash,
        ) },
      )
    expect [out] = outs
    expect d_out: RegistryDatum = util.inline_datum(out)

    and {
      d_out.governing_did == d_in.governing_did,
      entries_well_formed(d_out.entries),
      util.value_only_nft_and_ada(out.value, own_hash),
      out.reference_script == None,
      controller_authorized(tx.reference_inputs, taad_policy, d_in.governing_did, tx.extra_signatories),
    }
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests — mint(Deploy) + spend(Update): dương + âm
// ══════════════════════════════════════════════════════════════

const taad_pol: PolicyId = #"7a4a"

const fake_taad_pol: PolicyId = #"bad0"

const reg_pol: PolicyId = #"c0de"

const gov_did: ByteArray = "did:phoenix:org:greensun"

const ctrl_pkh: ByteArray = #"c07401"

const new_ctrl_pkh: ByteArray = #"c0ffee"

const stranger: ByteArray = #"ba0bad"

const lamp_tag: ByteArray = #"4c414d50"

const farm_tag: ByteArray = #"4641524d"

// ─── TAAD anchor fixtures ─────────────────────────────────────────

fn taad_datum(did: ByteArray, ctrl: ByteArray, status: taad_mirror.TAADStatus) -> TAADDatum {
  TAADDatum {
    did,
    entity_type: Person,
    controller_pkh: ctrl,
    hw_key_pubkey: #"",
    sequence: 0,
    status,
    guardians: [],
    parent_did: None,
    revoked_slot: None,
    recovery_anchor: None,
  }
}

fn taad_ref_input(policy: PolicyId, did: ByteArray, ctrl: ByteArray, status: taad_mirror.TAADStatus, ix: Int) -> transaction.Input {
  let v =
    assets.from_lovelace(2_000_000) |> assets.add(policy, blake2b_256(did), 1)
  util.mk_input(util.mk_ref(ix), util.mk_output(util.script_address(policy), v, taad_datum(did, ctrl, status)))
}

fn taad_ok_ref() -> transaction.Input {
  taad_ref_input(taad_pol, gov_did, ctrl_pkh, Active, 5)
}

// ─── RegistryDatum fixtures ────────────────────────────────────────

fn one_entry(tag: ByteArray, auth: Authority) -> List<RegistryEntry> {
  [RegistryEntry { token_tag: tag, authority: auth }]
}

fn reg_datum(did: ByteArray, entries: List<RegistryEntry>) -> RegistryDatum {
  RegistryDatum { governing_did: did, entries: entries }
}

// ─── mint(Deploy) test scaffolding ──────────────────────────────────

fn genesis_output(entries: List<RegistryEntry>) -> transaction.Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1)
  util.mk_output(util.script_address(reg_pol), v, reg_datum(gov_did, entries))
}

fn mint_reg_nft(qty: Int) -> assets.Value {
  assets.zero |> assets.add(reg_pol, blake2b_256(gov_did), qty)
}

fn base_deploy_tx(entries: List<RegistryEntry>, sigs: List<ByteArray>, refs: List<transaction.Input>) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    reference_inputs: refs,
    outputs: [genesis_output(entries)],
    mint: mint_reg_nft(1),
    extra_signatories: sigs,
  }
}

fn run_mint(r: RegistryDeployRedeemer, tx: Transaction) -> Bool {
  registry_write.mint(taad_pol, r, reg_pol, tx)
}

// ── HAPPY: deploy ────────────────────────────────────────────────

test deploy_happy() {
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], [taad_ok_ref()]))
}

test deploy_multisig_ok() {
  let auth = MultiSig { pkhs: [ctrl_pkh, new_ctrl_pkh], threshold: 2 }
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, auth), [ctrl_pkh], [taad_ok_ref()]))
}

// ── NEGATIVE: deploy ─────────────────────────────────────────────

test deploy_no_anchor_ref_fails() fail {
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], []))
}

test deploy_stranger_signs_fails() fail {
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [stranger], [taad_ok_ref()]))
}

test deploy_anchor_recovering_fails() fail {
  let recovering =
    Recovering { pending_controller_pkh: new_ctrl_pkh, pending_hw_pubkey: #"", deadline_slot: 100, collateral_lovelace: 5_000_000 }
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, recovering, 5)]
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], refs))
}

test deploy_anchor_revoked_fails() fail {
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, taad_mirror.Revoked, 5)]
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], refs))
}

test deploy_anchor_migrated_fails() fail {
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, Migrated, 5)]
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], refs))
}

test deploy_anchor_fake_policy_fails() fail {
  // NFT khớp asset-name nhưng đúc dưới policy KHÁC taad_policy (kẻ giả anchor) → find_taad_datum
  // lọc theo (taad_policy, name) không thấy carrier → None → controller_authorized False.
  let refs = [taad_ref_input(fake_taad_pol, gov_did, ctrl_pkh, Active, 5)]
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], refs))
}

test deploy_two_anchor_refs_ambiguous_fails() fail {
  let refs = [taad_ok_ref(), taad_ref_input(taad_pol, gov_did, new_ctrl_pkh, Active, 6)]
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], refs))
}

test deploy_dup_token_tag_fails() fail {
  let entries =
    [
      RegistryEntry { token_tag: lamp_tag, authority: SinglePkh { pkh: ctrl_pkh } },
      RegistryEntry { token_tag: lamp_tag, authority: SinglePkh { pkh: stranger } },
    ]
  run_mint(Deploy, base_deploy_tx(entries, [ctrl_pkh], [taad_ok_ref()]))
}

test deploy_multisig_threshold_zero_fails() fail {
  let auth = MultiSig { pkhs: [ctrl_pkh, new_ctrl_pkh], threshold: 0 }
  run_mint(Deploy, base_deploy_tx(one_entry(lamp_tag, auth), [ctrl_pkh], [taad_ok_ref()]))
}

test deploy_wrong_asset_name_fails() fail {
  // mint đúng policy nhưng asset-name KHÔNG khớp blake2b_256(governing_did) trong datum.
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, #"deadbeef", 1)
  let out = util.mk_output(util.script_address(reg_pol), v, reg_datum(gov_did, one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })))
  let tx =
    Transaction {
      ..transaction.placeholder,
      reference_inputs: [taad_ok_ref()],
      outputs: [out],
      mint: assets.zero |> assets.add(reg_pol, #"deadbeef", 1),
      extra_signatories: [ctrl_pkh],
    }
  run_mint(Deploy, tx)
}

test deploy_qty_two_fails() fail {
  let tx =
    Transaction {
      ..base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], [taad_ok_ref()]),
      mint: mint_reg_nft(2),
    }
  run_mint(Deploy, tx)
}

test deploy_two_different_dids_one_tx_fails() fail {
  // Mint 2 registry (2 governing_did khác nhau) cùng tx dưới CÙNG policy → policy_name_count
  // (qua minted_pair) thấy ≥2 tên → None → reject (mirror TAAD person_two_dids_one_tx_fails).
  let mixed =
    assets.zero
      |> assets.add(reg_pol, blake2b_256(gov_did), 1)
      |> assets.add(reg_pol, blake2b_256("did:phoenix:org:another"), 1)
  let tx =
    Transaction {
      ..base_deploy_tx(one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh }), [ctrl_pkh], [taad_ok_ref()]),
      mint: mixed,
    }
  run_mint(Deploy, tx)
}

test deploy_output_off_script_fails() fail {
  // NFT + datum ra VÍ (VK address) thay vì Script(own_policy) → hard-bind fail.
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1)
  let out = util.mk_output(util.vk_address(#"beef"), v, reg_datum(gov_did, one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })))
  let tx =
    Transaction {
      ..transaction.placeholder,
      reference_inputs: [taad_ok_ref()],
      outputs: [out],
      mint: mint_reg_nft(1),
      extra_signatories: [ctrl_pkh],
    }
  run_mint(Deploy, tx)
}

test deploy_output_foreign_token_fails() fail {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(reg_pol, blake2b_256(gov_did), 1)
      |> assets.add(#"aaaa", #"1234", 7)
  let out = util.mk_output(util.script_address(reg_pol), v, reg_datum(gov_did, one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })))
  let tx =
    Transaction {
      ..transaction.placeholder,
      reference_inputs: [taad_ok_ref()],
      outputs: [out],
      mint: mint_reg_nft(1),
      extra_signatories: [ctrl_pkh],
    }
  run_mint(Deploy, tx)
}

// ─── spend(Update) test scaffolding ─────────────────────────────────

fn reg_input(did: ByteArray, entries: List<RegistryEntry>) -> transaction.Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(did), 1)
  util.mk_input(util.mk_ref(0), util.mk_output(util.script_address(reg_pol), v, reg_datum(did, entries)))
}

fn reg_input_no_nft(did: ByteArray, entries: List<RegistryEntry>) -> transaction.Input {
  util.mk_input(util.mk_ref(0), util.mk_output(util.script_address(reg_pol), assets.from_lovelace(2_000_000), reg_datum(did, entries)))
}

fn reg_output(did: ByteArray, entries: List<RegistryEntry>) -> transaction.Output {
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(did), 1)
  util.mk_output(util.script_address(reg_pol), v, reg_datum(did, entries))
}

fn run_spend(datum: Option<RegistryDatum>, r: RegistryUpdateRedeemer, own_ref: OutputReference, tx: Transaction) -> Bool {
  registry_write.spend(taad_pol, datum, r, own_ref, tx)
}

fn base_update_tx(
  old_entries: List<RegistryEntry>,
  new_entries: List<RegistryEntry>,
  sigs: List<ByteArray>,
  refs: List<transaction.Input>,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [reg_input(gov_did, old_entries)],
    reference_inputs: refs,
    outputs: [reg_output(gov_did, new_entries)],
    extra_signatories: sigs,
  }
}

fn own_datum(entries: List<RegistryEntry>) -> Option<RegistryDatum> {
  Some(reg_datum(gov_did, entries))
}

// ── HAPPY: update ────────────────────────────────────────────────

test update_happy_change_authority() {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let new = one_entry(lamp_tag, MultiSig { pkhs: [ctrl_pkh, new_ctrl_pkh], threshold: 2 })
  let tx = base_update_tx(old, new, [ctrl_pkh], [taad_ok_ref()])
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_rotate_controller_via_new_anchor_ok() {
  // Anchor TAAD giờ báo controller_pkh MỚI (đã rotate ở tầng TAAD) → khoá mới ký PASS, KHÔNG
  // cần redeploy registry_write (authority đọc ĐỘNG từ anchor, không bake pkh tĩnh).
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let new = one_entry(farm_tag, SinglePkh { pkh: new_ctrl_pkh })
  let refs = [taad_ref_input(taad_pol, gov_did, new_ctrl_pkh, Active, 5)]
  let tx = base_update_tx(old, new, [new_ctrl_pkh], refs)
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

// ── NEGATIVE: update ─────────────────────────────────────────────

test update_missing_signature_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let tx = base_update_tx(old, old, [stranger], [taad_ok_ref()])
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_governing_did_changed_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let bad_out = reg_output("did:phoenix:org:hijacked", old)
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input(gov_did, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [bad_out],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_dup_token_tag_new_entries_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let bad_new =
    [
      RegistryEntry { token_tag: lamp_tag, authority: SinglePkh { pkh: ctrl_pkh } },
      RegistryEntry { token_tag: lamp_tag, authority: SinglePkh { pkh: new_ctrl_pkh } },
    ]
  let tx = base_update_tx(old, bad_new, [ctrl_pkh], [taad_ok_ref()])
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_nft_moved_off_script_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1)
  let wallet_out = util.mk_output(util.vk_address(#"beef"), v, reg_datum(gov_did, old))
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input(gov_did, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [wallet_out],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_nft_burned_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let tx =
    Transaction {
      ..base_update_tx(old, old, [ctrl_pkh], [taad_ok_ref()]),
      mint: assets.zero |> assets.add(reg_pol, blake2b_256(gov_did), -1),
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_two_continuing_outputs_ambiguous_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input(gov_did, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [reg_output(gov_did, old), reg_output(gov_did, old)],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_output_foreign_token_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(reg_pol, blake2b_256(gov_did), 1)
      |> assets.add(#"aaaa", #"1234", 3)
  let dirty = util.mk_output(util.script_address(reg_pol), v, reg_datum(gov_did, old))
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input(gov_did, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [dirty],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_anchor_revoked_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, taad_mirror.Revoked, 5)]
  let tx = base_update_tx(old, old, [ctrl_pkh], refs)
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_input_missing_real_nft_fails() fail {
  // D8-#3: UTxO bị spend KHÔNG mang NFT thật (datum claim gov_did nhưng value trống) → reject.
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input_no_nft(gov_did, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [reg_output(gov_did, old)],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_two_anchor_refs_ambiguous_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let refs = [taad_ok_ref(), taad_ref_input(taad_pol, gov_did, new_ctrl_pkh, Active, 6)]
  let tx = base_update_tx(old, old, [ctrl_pkh], refs)
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

test update_no_continuing_output_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input(gov_did, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [util.mk_output_no_datum(util.vk_address(#"a0"), assets.from_lovelace(2_000_000))],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}
