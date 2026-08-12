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
//
// THU HỒI (Burn/Retire — thêm 2026-08-12, vá review PR #20 §1): Deploy KHÔNG chứng minh được
// "chưa có registry nào cho DID này" (không proof-of-absence on-chain), nên registry THỨ HAI cùng
// governing_did là DỰNG ĐƯỢC — và read-side `registry.ak.find_registry_datum` đòi ĐÚNG 1 carrier
// ⇒ mint LAMP của DID đó KHOÁ. Bản đầu KHÔNG có đường đốt (`expect qty == 1` chặn mọi burn, spend
// luôn ép continuing output) ⇒ khoá VĨNH VIỄN, không cứu được. Tệ hơn: redeemer rỗng + không nonce
// nghĩa là chỉ cần controller KÝ NHẦM một tx do builder lỗi/độc dựng là brick — không cần cố ý.
// Nay thêm `Burn` (mint, constr 1) + `Retire` (spend, constr 1): controller hiện tại đốt 1
// Registry-NFT để gỡ bản trùng. Deploy/Update VẪN ở constr 0 ⇒ `registry_mint.rs` KHÔNG phải sửa.

use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/address.{Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{OutputReference, Transaction}
use magiclamp/genesis/registry.{Authority, MultiSig, RegistryDatum, RegistryEntry, SinglePkh}
use magiclamp/genesis/registry_write_logic.{
  controller_authorized, controller_signed_any_status, count_carriers_at_script,
  entries_well_formed, find_fresh_output, minted_pair,
}
use magiclamp/genesis/taad_mirror.{
  Active, Migrated, Person, Recovering, TaadAnchorV2, TaadStatusShape, genesis_anchor,
}
use magiclamp/genesis/util

/// Constr 0 `Deploy` (Core `registry_mint.rs` gửi empty-constr — KHÔNG đổi) · 1 `Burn` (thu hồi).
pub type RegistryMintRedeemer {
  Deploy
  Burn
}

/// Constr 0 `Update` (Core empty-constr — KHÔNG đổi) · 1 `Retire` (đồng ý cho đốt NFT trong tx).
pub type RegistrySpendRedeemer {
  Update
  Retire
}

validator registry_write(taad_policy: PolicyId) {
  mint(r: RegistryMintRedeemer, own_policy: PolicyId, tx: Transaction) {
    // ĐÚNG 1 asset-name chuyển động dưới policy này (chặn mint/burn đa-tên trong 1 tx).
    expect Some((name, qty)) = minted_pair(tx.mint, own_policy)
    when r is {
      // ── GENESIS: mint Registry-NFT + khoá RegistryDatum đầu tiên ─────────
      Deploy -> {
        expect qty == 1
        expect Some(out) = find_fresh_output(tx.outputs, own_policy, name)
        expect d: RegistryDatum = util.inline_datum(out)
        and {
          // A-1 binding: asset name == blake2b_256(governing_did) của CHÍNH datum genesis.
          name == blake2b_256(d.governing_did),
          entries_well_formed(d.entries),
          util.value_only_nft_and_ada(out.value, own_policy),
          out.reference_script == None,
          controller_authorized(
            tx.reference_inputs,
            taad_policy,
            d.governing_did,
            tx.extra_signatories,
          ),
        }
      }
      // ── THU HỒI: đốt ĐÚNG 1 Registry-NFT (gỡ bản trùng) ───────────────────
      // Đây là purpose ÉP AUTHORITY cho đường đốt; `spend/Retire` chỉ đồng thuận (mint purpose
      // LUÔN chạy khi tx.mint chạm policy này, nên không có đường vòng bỏ qua gate).
      Burn -> {
        expect qty == -1
        // Carrier bị đốt PHẢI là UTxO đang bị spend TẠI CHÍNH script này (D8-#3, không tin
        // "NFT chỉ có thể nằm ở đây" — bất biến đó là của validator này, vẫn kiểm tận nơi).
        expect [carrier] =
          list.filter(
            tx.inputs,
            fn(i) {
              quantity_of(i.output.value, own_policy, name) == 1 && util.is_at_script(
                i.output.address,
                own_policy,
              )
            },
          )
        expect d: RegistryDatum = util.inline_datum(carrier.output)
        and {
          name == blake2b_256(d.governing_did),
          // ⚠ CỐ Ý dùng gate KHÔNG đòi status Active — xem lý do đầy đủ ở
          // `registry_write_logic.controller_signed_any_status`. Tóm tắt: DID bị Revoke xong
          // mà Burn vẫn đòi Active thì registry của DID chết ĐÓNG BĂNG VĨNH VIỄN, thu hồi DID
          // thành hình thức. Burn chỉ PHÁ, không cấp quyền cho ai ⇒ nới ở đây an toàn.
          controller_signed_any_status(
            tx.reference_inputs,
            taad_policy,
            d.governing_did,
            tx.extra_signatories,
          ),
        }
      }
    }
  }

  spend(
    datum_opt: Option<RegistryDatum>,
    r: RegistrySpendRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d_in) = datum_opt
    let own_out = util.own_input(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_out)
    let nft_name = blake2b_256(d_in.governing_did)

    // D8-#3 style: UTxO bị spend PHẢI mang đúng Registry-NFT thật (không tin ngồi-ở-script-này).
    expect quantity_of(own_out.value, own_hash, nft_name) == 1

    when r is {
      // ── LIFECYCLE: sửa entries (Update) — chỉ controller hiện tại ────────
      Update -> {
        // NFT KHÔNG mint/burn trong tx Update (chống burn).
        expect quantity_of(tx.mint, own_hash, nft_name) == 0

        // 🔴 CHỐNG DOUBLE-SATISFACTION (vá review PR #20 §2): ép ĐÚNG 1 carrier BỊ TIÊU.
        // Không có mệnh đề này, tx tiêu 2 bản Registry-NFT TRÙNG (cùng did ⇒ cùng asset-name)
        // rót 1 bản về script + 1 bản ra VÍ vẫn PASS cả hai lần chạy, vì bộ lọc output bên
        // dưới chỉ đếm output Ở SCRIPT nên không thấy bản ra ví. Chi tiết + hậu quả (NFT ra
        // ví ⇒ đính datum tuỳ ý ⇒ tự cấp quyền đúc LAMP, thoát vòng đời DID) ghi ở
        // `registry_write_logic.count_carriers_at_script`.
        expect count_carriers_at_script(tx.inputs, own_hash, nft_name) == 1

        // Continuing output DUY NHẤT: đúng NFT, đúng script address.
        let outs =
          list.filter(
            tx.outputs,
            fn(o) {
              quantity_of(o.value, own_hash, nft_name) == 1 && o.address.payment_credential == Script(
                own_hash,
              )
            },
          )
        expect [out] = outs
        expect d_out: RegistryDatum = util.inline_datum(out)

        and {
          d_out.governing_did == d_in.governing_did,
          entries_well_formed(d_out.entries),
          util.value_only_nft_and_ada(out.value, own_hash),
          out.reference_script == None,
          controller_authorized(
            tx.reference_inputs,
            taad_policy,
            d_in.governing_did,
            tx.extra_signatories,
          ),
        }
      }
      // ── THU HỒI: NFT của CHÍNH UTxO này bị đốt trong tx ───────────────────
      // Authority + carrier-binding do `mint/Burn` ép (luôn chạy vì tx.mint chạm policy này).
      // Không đòi continuing output — NFT biến mất là mục đích.
      Retire -> quantity_of(tx.mint, own_hash, nft_name) == -1
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

// Anchor ref-input dựng bằng hình dạng ĐẦY ĐỦ 15 trường (`genesis_anchor`), tức là đúng cái
// mà PhoenixKey thật sự đặt on-chain. Bộ test CŨ dựng bằng type 10 trường tự chế nên nó xanh
// trong khi đường chạy thật CRASH — đây là chỗ sửa cái đó.
fn taad_datum(did: ByteArray, ctrl: ByteArray, status: TaadStatusShape) -> TaadAnchorV2 {
  genesis_anchor(did, Person, ctrl, status)
}

fn taad_ref_input(policy: PolicyId, did: ByteArray, ctrl: ByteArray, status: TaadStatusShape, ix: Int) -> transaction.Input {
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

fn run_mint(r: RegistryMintRedeemer, tx: Transaction) -> Bool {
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
    Recovering {
      pending_controller_pkh: new_ctrl_pkh,
      pending_hw_pubkey: #"",
      deadline_ms: 100,
      collateral_lovelace: 5_000_000,
      collateral_refund_pkh: #"9a",
      pending_device_pkh: #"9b",
    }
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

fn run_spend(datum: Option<RegistryDatum>, r: RegistrySpendRedeemer, own_ref: OutputReference, tx: Transaction) -> Bool {
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
  // NFT GIỮ NGUYÊN asset-name cũ (blake2b_256(gov_did)) — chỉ DATUM đổi governing_did.
  // Phải giữ đúng asset-name thì mới chạm được `d_out.governing_did == d_in.governing_did`;
  // nếu đổi cả asset-name (bản trước) thì tx chết sớm ở `expect [out] = outs` và mệnh đề
  // did KHÔNG BAO GIỜ được chạy. Chính mệnh đề này chặn gộp NFT của 2 DID vào 1 output.
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1)
  let bad_out =
    util.mk_output(util.script_address(reg_pol), v, reg_datum("did:phoenix:org:hijacked", old))
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

test update_output_asset_name_swapped_fails() fail {
  // Bản CŨ của test trên (đổi cả asset-name) — giữ lại vì vẫn là ca âm thật, nhưng chết ở
  // `expect [out] = outs`, KHÔNG phải ở gate did.
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input(gov_did, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [reg_output("did:phoenix:org:hijacked", old)],
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

// ─── thu hồi: mint(Burn) + spend(Retire) ────────────────────────────

fn base_burn_tx(
  sigs: List<ByteArray>,
  refs: List<transaction.Input>,
  ins: List<transaction.Input>,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: ins,
    reference_inputs: refs,
    outputs: [],
    mint: mint_reg_nft(-1),
    extra_signatories: sigs,
  }
}

fn dup_entry() -> List<RegistryEntry> {
  one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
}

fn burn_tx_default() -> Transaction {
  base_burn_tx([ctrl_pkh], [taad_ok_ref()], [reg_input(gov_did, dup_entry())])
}

// ── HAPPY: gỡ bản registry TRÙNG (cả 2 purpose phải pass trong CÙNG tx) ──

test burn_duplicate_registry_mint_purpose_ok() {
  run_mint(Burn, burn_tx_default())
}

test burn_duplicate_registry_spend_purpose_ok() {
  run_spend(own_datum(dup_entry()), Retire, util.mk_ref(0), burn_tx_default())
}

// ── NEGATIVE: burn ──────────────────────────────────────────────

test burn_stranger_signs_fails() fail {
  run_mint(Burn, base_burn_tx([stranger], [taad_ok_ref()], [reg_input(gov_did, dup_entry())]))
}

// 🔴 ĐẢO CHIỀU so với bản trước (vá review PR #20 §3). Bản trước ghi ca này là `fail` — tức
// CHỐT rằng DID đã Revoke thì KHÔNG đốt được registry nữa. Đó chính là cái bẫy: registry của
// một DID đã chết đóng băng vĩnh viễn với entries lúc bị lộ. Nay là ca DƯƠNG.
test burn_on_revoked_did_ok() {
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, taad_mirror.Revoked, 5)]
  run_mint(Burn, base_burn_tx([ctrl_pkh], refs, [reg_input(gov_did, dup_entry())]))
}

test burn_on_migrated_did_ok() {
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, Migrated, 5)]
  run_mint(Burn, base_burn_tx([ctrl_pkh], refs, [reg_input(gov_did, dup_entry())]))
}

/// Nới status KHÔNG được nới sang chữ ký: người lạ vẫn không đốt được registry của DID chết.
test burn_on_revoked_did_stranger_still_fails() fail {
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, taad_mirror.Revoked, 5)]
  run_mint(Burn, base_burn_tx([stranger], refs, [reg_input(gov_did, dup_entry())]))
}

/// Và KHÔNG nới sang các cổng cấp quyền: Deploy/Update vẫn đòi Active như cũ
/// (`deploy_anchor_revoked_fails`, `update_anchor_revoked_fails` ở trên vẫn là ca âm).
test burn_on_revoked_did_did_mismatch_still_fails() fail {
  let refs = [taad_ref_input(taad_pol, gov_did, ctrl_pkh, taad_mirror.Revoked, 5)]
  let liar =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        util.script_address(reg_pol),
        assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1),
        reg_datum("did:phoenix:org:other", dup_entry()),
      ),
    )
  run_mint(Burn, base_burn_tx([ctrl_pkh], refs, [liar]))
}

test burn_no_anchor_ref_fails() fail {
  run_mint(Burn, base_burn_tx([ctrl_pkh], [], [reg_input(gov_did, dup_entry())]))
}

test burn_carrier_off_script_fails() fail {
  // NFT bị đốt đến từ UTxO ở VÍ, không phải script này → không có carrier hợp lệ → reject.
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1)
  let wallet_in =
    util.mk_input(
      util.mk_ref(9),
      util.mk_output(util.vk_address(#"beef"), v, reg_datum(gov_did, dup_entry())),
    )
  run_mint(Burn, base_burn_tx([ctrl_pkh], [taad_ok_ref()], [wallet_in]))
}

test burn_two_carriers_spent_fails() fail {
  // Spend CẢ 2 bản trùng nhưng chỉ đốt 1 → mơ hồ bản nào chết → reject (fail-closed).
  let dup =
    util.mk_input(
      util.mk_ref(1),
      util.mk_output(
        util.script_address(reg_pol),
        assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1),
        reg_datum(gov_did, dup_entry()),
      ),
    )
  run_mint(Burn, base_burn_tx([ctrl_pkh], [taad_ok_ref()], [reg_input(gov_did, dup_entry()), dup]))
}

test burn_carrier_did_mismatch_fails() fail {
  // Carrier mang NFT name của gov_did nhưng datum khai DID khác → A-1 binding gãy.
  let liar =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(
        util.script_address(reg_pol),
        assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1),
        reg_datum("did:phoenix:org:other", dup_entry()),
      ),
    )
  run_mint(Burn, base_burn_tx([ctrl_pkh], [taad_ok_ref()], [liar]))
}

test burn_redeemer_but_tx_mints_fails() fail {
  let tx = Transaction { ..burn_tx_default(), mint: mint_reg_nft(1) }
  run_mint(Burn, tx)
}

test deploy_redeemer_on_burn_tx_fails() fail {
  // Đốt mà gửi redeemer Deploy (constr 0) → `expect qty == 1` chặn — luật cũ KHÔNG nới.
  run_mint(Deploy, burn_tx_default())
}

test retire_without_actual_burn_fails() fail {
  // spend Retire nhưng tx KHÔNG đốt gì → NFT rơi đi đâu tùy ý → chặn.
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [reg_input(gov_did, dup_entry())],
      reference_inputs: [taad_ok_ref()],
      outputs: [],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(dup_entry()), Retire, util.mk_ref(0), tx)
}

test retire_input_missing_real_nft_fails() fail {
  let tx = base_burn_tx([ctrl_pkh], [taad_ok_ref()], [reg_input_no_nft(gov_did, dup_entry())])
  run_spend(own_datum(dup_entry()), Retire, util.mk_ref(0), tx)
}


// ══════════════════════════════════════════════════════════════
// DOUBLE-SATISFACTION — ca dựng lại đúng PoC của review PR #20 §2
// ══════════════════════════════════════════════════════════════
// Hai bản Registry-NFT TRÙNG (cùng governing_did ⇒ CÙNG asset-name — tồn dư đã ghi ở đầu
// `registry_write_logic.ak`). Tx tiêu CẢ HAI, rót 1 bản về script và 1 bản ra VÍ.
// TRƯỚC bản vá: bộ lọc output chỉ đếm output ngụ ở `Script(own_hash)` nên KHÔNG thấy bản ra
// ví ⇒ đếm được "đúng 1 continuing output" ⇒ CẢ HAI lần chạy validator đều PASS ⇒ một
// Registry-NFT thật rời khỏi script và mang datum tuỳ ý được.
// SAU bản vá: `count_carriers_at_script(tx.inputs, …) == 1` chặn ngay ở đầu.

fn dup_reg_input(ix: Int, entries: List<RegistryEntry>) -> transaction.Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1)
  util.mk_input(util.mk_ref(ix), util.mk_output(util.script_address(reg_pol), v, reg_datum(gov_did, entries)))
}

test update_double_satisfaction_nft_escapes_to_wallet_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let v = assets.from_lovelace(2_000_000) |> assets.add(reg_pol, blake2b_256(gov_did), 1)
  let escape_out = util.mk_output(util.vk_address(#"beef"), v, reg_datum(gov_did, old))
  let tx =
    Transaction {
      ..transaction.placeholder,
      // hai carrier TRÙNG cùng bị tiêu
      inputs: [dup_reg_input(0, old), dup_reg_input(1, old)],
      reference_inputs: [taad_ok_ref()],
      // một ở lại script (đủ để bộ lọc cũ thấy "đúng 1"), một CHUỒN ra ví
      outputs: [reg_output(gov_did, old), escape_out],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

/// Biến thể: cả hai ra script → bộ lọc thấy 2 output ⇒ đã chết ở `expect [out]` từ TRƯỚC bản
/// vá. Giữ để chốt rằng bản vá KHÔNG nới ca này.
test update_two_carriers_two_script_outputs_fails() fail {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [dup_reg_input(0, old), dup_reg_input(1, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [reg_output(gov_did, old), reg_output(gov_did, old)],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}

/// Ca DƯƠNG đối chứng: đúng 1 carrier vào, đúng 1 continuing output ⇒ vẫn chạy bình thường.
/// (Bản vá không được siết nhầm đường dùng thật.)
test update_single_carrier_still_ok() {
  let old = one_entry(lamp_tag, SinglePkh { pkh: ctrl_pkh })
  let new = one_entry(farm_tag, SinglePkh { pkh: ctrl_pkh })
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [dup_reg_input(0, old)],
      reference_inputs: [taad_ok_ref()],
      outputs: [reg_output(gov_did, new)],
      extra_signatories: [ctrl_pkh],
    }
  run_spend(own_datum(old), Update, util.mk_ref(0), tx)
}
