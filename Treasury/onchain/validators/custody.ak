// Custody validator — Treasury instance giữ value đa-asset + sổ bucket trong datum.
// v1: triển khai nhánh COLLECT (CONTRACT §3, §9 T2/T3; TECH §4) + RELEASE
// (CONTRACT §4, §9 T1/T5 — Model A; TECH §7).
//
// AUTHENTICITY (C-NFT, đợt hardening #5): custody "thật" của instance = UTxO MANG
//   đúng 1 NFT (seed_policy, instance_id) do custody_seed mint one-shot. Cả hai nhánh
//   ép NFT hiện diện ở cust_in VÀ cust_out → chống dựng custody-GIẢ tại địa chỉ script
//   (địa chỉ công khai) với datum bịa (vd cut_bps né, sổ bịa) để spend.
//
// Nhánh COLLECT ÉP:
//   C-MINT-0  KHÔNG mint/burn (LAMP fixed-supply — value chỉ chuyển trạng thái).
//   C-NFT     cust_in/out mang đúng 1 NFT (seed_policy, instance_id).
//   C-COL-1   ĐÚNG 1 custody input + 1 custody output theo PAYMENT SCRIPT HASH.
//   C-COL-2   params instance (id, accepted, governance_ref, cut_bps) bảo toàn.
//   C-COL-3   Sổ: ledger_out == ledger_in + Σcut tại đúng (category, asset), CANONICAL.
//   C-COL-4   Value: custody_out.value == custody_in.value ⊕ cut_value(items) — Σout=Σin.
//   C-COL-5   Mọi item: amount ≥ 0 + asset ∈ accepted_assets.
//   C-COL-ADDR      cust_out.address == cust_in.address (GHIM CẢ stake credential).
//   C-COL-REFSCRIPT cust_out.reference_script == None.
//   C-EPOCH   out.epoch == get_epoch(tx) ∧ get_epoch(tx) ≥ in.epoch (neo chain, audit thật).
//
// Nhánh RELEASE ÉP (Model A — Treasury KHÔNG tự tính ngưỡng; đọc cờ Governance):
//   C-REL-10  KHÔNG mint/burn.
//   C-NFT     cust_in/out mang đúng 1 NFT (seed_policy, instance_id).
//   C-REL-4   ĐÚNG 1 custody input + 1 custody output theo PAYMENT SCRIPT HASH.
//   C-REL-1   reference input tại proposal_ref Ở ĐÚNG governance_ref + mang ĐÚNG 1 Proposal NFT.
//   C-REL-2   ProposalResult.status == Executed.
//   C-REL-3   spend_spec_hash(draws) == proposal.spend_spec_hash (khóa đích chi).
//   C-REL-8   current_epoch ≥ proposal.execute_after_epoch (time-lock).
//   C-REL-5   Value: custody_out.value == custody_in.value ⊖ Σdraw — Σout=Σin per-asset.
//   C-REL-6   Sổ: ledger_out[(b,a)] == ledger_in[(b,a)] − Σdraw(b,a) ∧ draw ≤ số dư, CANONICAL.
//   C-REL-7   Người nhận: Σ output tới `to` ≥ Σ draw(to,asset) ∧ to ≠ custody.
//   C-REL-9   SINGLE-USE proposal (chống replay / chi vượt ngưỡng duyệt).
//   C-REL-ADDR      cust_out.address == cust_in.address (GHIM CẢ stake credential).
//   C-REL-REFSCRIPT cust_out.reference_script == None.
//   C-EPOCH   out.epoch == get_epoch(tx) ∧ get_epoch(tx) ≥ in.epoch.
//
// Nhánh MIGRATE-IN ÉP (v1.x — nạp Δ LAMP vừa mint từ Reserve vào kho; lib migrate.ak):
//   C-MIG-1   ĐÚNG 1 custody input + 1 custody output theo PAYMENT SCRIPT HASH.
//   C-MIG-2   cust_in/out mang đúng 1 NFT (seed_policy, instance_id).
//   C-MIG-3   params instance bảo toàn (id, accepted, governance_ref, cut_bps, consumed).
//   C-MIG-4   out.epoch == get_epoch(tx) ∧ get_epoch(tx) ≥ in.epoch.
//   C-MIG-5   cust_out ở SCRIPT, không ví thường.
//   C-MIG-6   mint CÓ KIỂM SOÁT: tx.mint chứa ĐÚNG (lamp_policy, token_name), Δ > 0.
//   C-MIG-7   Value: cust_out.value == cust_in.value ⊕ Δ; mọi asset khác NGUYÊN.
//   C-MIG-8   Sổ: ledger_out == ledger_in + Δ tại ĐÚNG 1 (bucket, asset), CANONICAL;
//             bucket là HẰNG dành riêng cho nguồn Reserve, `source` phải khớp nhãn.
//   C-MIG-9   (lamp_policy, token_name) ∈ accepted_assets.
//   C-MIG-ADDR      cust_out.address == cust_in.address (GHIM CẢ stake credential).
//   C-MIG-REFSCRIPT cust_out.reference_script == None.
//
// VÌ SAO PHẢI GHIM ĐỊA CHỈ ĐẦY ĐỦ, không chỉ `!is_vk` (F2):
//   `count_*_at_script` so PAYMENT credential thôi, nên stake credential của kho hoàn
//   toàn tự do. `MigrateIn` là nhánh PERMISSIONLESS đầu tiên ⇒ bất kỳ ai dựng được tx
//   draw hợp lệ cũng đặt được `cust_out.address.stake_credential` thành khoá stake CỦA
//   HẮN. Hệ quả: phần thưởng uỷ quyền trên toàn bộ ADA của kho chảy về hắn, lặp mỗi
//   epoch với chi phí một phí tx; và địa chỉ bech32 của kho đổi mỗi epoch nên mọi bên
//   index theo địa chỉ mất dấu. `!is_vk` KHÔNG chặn được vì payment credential vẫn Script.
//
// VÌ SAO GHIM `reference_script == None` (F3):
//   Đối xứng `Genesis/onchain/validators/lamp_mint.ak` và `Reserve/.../reserve_draw.ak`
//   — cả hai đã ghim trên state của mình. Không ghim thì kẻ griefing đính một script
//   tham chiếu nhỏ vào kho mỗi lượt, ăn dần dư địa min-ADA cho tới lúc kho không dựng
//   nổi output hợp lệ. Ba nhánh dùng chung một hình dạng nên viết y hệt nhau.
//
// MigrateIn KHÔNG phải đường vòng cho Collect/Release: nó KHÔNG đụng consumed_proposals,
// KHÔNG chi ra cho ai, KHÔNG giảm value (C-MIG-3 + C-MIG-7 khoá cả ba).

use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use magiclamp/treasury/collect
use magiclamp/treasury/migrate
use magiclamp/treasury/release
use magiclamp/treasury/types.{
  Collect, CustodyDatum, CustodyRedeemer, Executed, MigrateIn, Release,
}
use magiclamp/treasury/util

/// Release validator parameterized bởi:
///   proposal_policy — PolicyId của Proposal authenticity NFT (Governance one-shot).
///   seed_policy     — PolicyId của custody authenticity NFT (custody_seed one-shot).
///   ms_per_epoch    — quy đổi POSIX ms → epoch (time-lock C-REL-8 + neo C-EPOCH).
///   lamp_policy     — minting policy LAMP/tLAMP (Genesis lamp_mint). MigrateIn đo Δ theo đây.
///   token_name      — asset name LAMP/tLAMP (testnet "tLAMP" / mainnet "LAMP").
///
/// ⚠ lamp_policy/token_name là THAM SỐ apply-time ⇒ nướng vào script hash ⇒ custody phải
/// được đúc lại khi đổi. Đã tính: không có cách nào để MigrateIn đo Δ mà không biết token
/// nào là LAMP, và đọc "token nào là LAMP" từ datum thì datum do người gửi đặt.
validator custody(
  proposal_policy: assets.PolicyId,
  seed_policy: assets.PolicyId,
  ms_per_epoch: Int,
  lamp_policy: assets.PolicyId,
  token_name: ByteArray,
) {
  spend(
    datum_opt : Option<CustodyDatum>,
    redeemer  : CustodyRedeemer,
    own_ref   : OutputReference,
    tx        : Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_addr = util.own_address(own_ref, tx.inputs)
    let own_hash = util.own_script_hash(own_addr)

    when redeemer is {
      Collect { items } -> {
        // C-MINT-0: tuyệt đối không mint/burn.
        expect assets.is_zero(tx.mint)

        // C-COL-1: đúng 1 custody input + 1 custody output theo SCRIPT HASH.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

        let cust_in = util.input_at_script(tx.inputs, own_hash)
        let cust_out = util.output_at_script(tx.outputs, own_hash)

        // C-COL-2: datum params instance bảo toàn (chỉ ledger + epoch được đổi).
        expect InlineDatum(od) = cust_out.datum
        expect out_datum: CustodyDatum = od
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.governance_ref == datum.governance_ref
        expect out_datum.cut_bps == datum.cut_bps
        // Collect KHÔNG đụng marker single-use proposal — bảo toàn nguyên.
        expect out_datum.consumed_proposals == datum.consumed_proposals

        // C-NFT: cust_in/out mang đúng 1 NFT authenticity (seed_policy, instance_id).
        // Chống custody-GIẢ (không NFT) dựng tại địa chỉ script với datum bịa.
        expect
          assets.quantity_of(cust_in.value, seed_policy, datum.instance_id) == 1
        expect
          assets.quantity_of(cust_out.value, seed_policy, out_datum.instance_id) == 1

        // C-EPOCH: neo epoch vào chain GỌN 1 epoch (audit thật, không lùi, không đóng băng).
        let cur = util.get_epoch_bounded(tx, ms_per_epoch)
        expect cur >= datum.epoch
        expect out_datum.epoch == cur

        // C-COL-2 (custody tách ví): output custody ở SCRIPT, không ví thường.
        expect !util.is_vk(cust_out.address)

        // C-COL-ADDR (F2): địa chỉ kho GIỮ NGUYÊN, kể cả stake credential.
        expect cust_out.address == cust_in.address

        // C-COL-REFSCRIPT (F3): không đính script tham chiếu vào kho.
        expect cust_out.reference_script == None

        // C-COL-5: mọi item hợp lệ + asset được nhận.
        expect collect.all_items_valid(items, datum.accepted_assets)

        // C-COL-11 (F3): Collect PHẢI sinh cut > 0 (custody thực sự nhận value). Chống
        // griefing no-op: items rỗng / mọi cut=0 → respend miễn phí mỗi block gây
        // contention chặn settlement thật. Buộc mỗi Collect có ích (Σcut per-asset > 0).
        expect !assets.is_zero(collect.cut_value(items, datum.cut_bps))

        // C-COL-3: sổ tăng đúng Σcut tại (category, asset) — canonical, incremental.
        expect
          collect.ledger_ok(datum.ledger, out_datum.ledger, items, datum.cut_bps)

        // C-COL-4: value bảo toàn Σout=Σin per-asset, custody nhận đúng Σcut.
        expect collect.value_ok(cust_in.value, cust_out.value, items, datum.cut_bps)

        True
      }

      Release { proposal_ref, draws } -> {
        // C-REL-10: tuyệt đối không mint/burn (LAMP fixed-supply).
        expect assets.is_zero(tx.mint)

        // C-REL-4: đúng 1 custody input + 1 custody output theo SCRIPT HASH.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

        let cust_in = util.input_at_script(tx.inputs, own_hash)
        let cust_out = util.output_at_script(tx.outputs, own_hash)

        // Params instance bảo toàn (chỉ ledger + epoch + consumed được đổi) — mirror C-COL-2.
        expect InlineDatum(od) = cust_out.datum
        expect out_datum: CustodyDatum = od
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.governance_ref == datum.governance_ref
        expect out_datum.cut_bps == datum.cut_bps
        // custody output ở SCRIPT, không ví thường.
        expect !util.is_vk(cust_out.address)

        // C-REL-ADDR (F2): địa chỉ kho GIỮ NGUYÊN, kể cả stake credential.
        expect cust_out.address == cust_in.address

        // C-REL-REFSCRIPT (F3): không đính script tham chiếu vào kho.
        expect cust_out.reference_script == None

        // C-NFT: cust_in/out mang đúng 1 NFT authenticity (seed_policy, instance_id).
        expect
          assets.quantity_of(cust_in.value, seed_policy, datum.instance_id) == 1
        expect
          assets.quantity_of(cust_out.value, seed_policy, out_datum.instance_id) == 1

        // C-EPOCH: neo epoch vào chain GỌN 1 epoch (không lùi, không đóng băng).
        let cur = util.get_epoch_bounded(tx, ms_per_epoch)
        expect cur >= datum.epoch
        expect out_datum.epoch == cur

        // C-REL-13 (F2): draws KHÔNG rỗng — proposal rỗng chỉ nhồi consumed_proposals
        // (phình datum → kẹt) mà không chi gì. Một Release phải chi thật.
        expect draws != []

        // C-REL-1: đọc + xác thực ProposalResult — proposal Ở ĐÚNG governance_ref +
        // mang đúng Proposal NFT (chống NFT dời sang datum giả / replay chéo instance).
        let proposal =
          release.read_proposal(
            tx.reference_inputs,
            proposal_ref,
            proposal_policy,
            datum.governance_ref,
          )

        // C-REL-2: CHỈ chi khi status == Executed.
        expect proposal.status == Executed

        // C-REL-3: hash canonical (instance_id, draws) thực tế == spend_spec_hash đã duyệt.
        // F10/#1B: gồm instance_id → proposal của instance A KHÔNG dùng được cho instance B
        // dù CÙNG governance_ref (spec_hash khác instance ⇒ không khớp).
        expect
          release.spend_spec_hash(datum.instance_id, draws) == proposal.spend_spec_hash

        // C-REL-8: time-lock — epoch hiện tại ≥ execute_after_epoch.
        expect cur >= proposal.execute_after_epoch

        // C-REL-9: SINGLE-USE proposal (chống replay). proposal_id CHƯA chi + append đúng.
        expect
          release.proposal_is_fresh(datum.consumed_proposals, proposal.proposal_id)
        expect
          release.consumed_appended_ok(
            datum.consumed_proposals,
            out_datum.consumed_proposals,
            proposal.proposal_id,
          )

        // C-REL-6: sổ giảm đúng bucket + draw ≤ số dư, canonical (prune dòng cạn 0).
        expect release.ledger_ok(datum.ledger, out_datum.ledger, draws)

        // C-REL-5: value bảo toàn Σout=Σin per-asset, custody RA đúng Σdraw (no drain).
        expect release.value_ok(cust_in.value, cust_out.value, draws)

        // C-REL-7: người nhận đúng — tổng-khớp per (to,asset), to ≠ custody.
        expect release.recipients_ok(tx.outputs, draws, own_hash)

        True
      }

      MigrateIn { source } -> {
        // ── C-MIG-6: mint CÓ KIỂM SOÁT (KHÔNG mở toang) ───────────────────
        // Δ = lượng (lamp_policy, token_name) mint trong tx. Đây là chỗ dễ mở lỗ nhất:
        // nếu chỉ ép Δ > 0 thì cùng tx còn đúc được asset khác (kể cả NFT authenticity
        // của instance khác) mà nhánh này không nhìn tới. `migrate.mint_ok` ép tx.mint
        // chứa ĐÚNG một cặp (lamp_policy, token_name) — không policy khác, không name
        // khác cùng policy, không lượng âm ở đâu.
        let delta = assets.quantity_of(tx.mint, lamp_policy, token_name)
        expect migrate.mint_ok(tx.mint, lamp_policy, token_name, delta)

        // ── C-MIG-1: đúng 1 custody input + 1 custody output theo SCRIPT HASH ──
        // Chống double-satisfaction (2 custody input chia chung 1 output) VÀ chống
        // đúng hình dạng đã gây ra lỗ: rót Δ vào một UTxO thứ hai (không datum) tại
        // địa chỉ custody → count_outputs_at_script == 2 → từ chối tại đây.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1

        let cust_in = util.input_at_script(tx.inputs, own_hash)
        let cust_out = util.output_at_script(tx.outputs, own_hash)

        // ── C-MIG-3: params instance bảo toàn (chỉ ledger + epoch được đổi) ──
        expect InlineDatum(od) = cust_out.datum
        expect out_datum: CustodyDatum = od
        expect out_datum.instance_id == datum.instance_id
        expect out_datum.accepted_assets == datum.accepted_assets
        expect out_datum.governance_ref == datum.governance_ref
        expect out_datum.cut_bps == datum.cut_bps
        // MigrateIn KHÔNG được dùng làm đường vòng cho Release: marker single-use
        // proposal giữ NGUYÊN (không tiêu, không thêm).
        expect out_datum.consumed_proposals == datum.consumed_proposals

        // ── C-MIG-5: custody output ở SCRIPT, không ví thường ──────────────
        // Ghi chú trung thực: vế này HỆ QUẢ của C-MIG-1 (`output_at_script` đã lọc theo
        // payment credential Script), nên đột biến một dòng sẽ không có bài nào đỏ.
        // Giữ lại để soi gương C-COL-2/C-REL và để bất biến đọc được ngay tại chỗ.
        expect !util.is_vk(cust_out.address)

        // ── C-MIG-ADDR (F2): địa chỉ kho GIỮ NGUYÊN, kể cả stake credential ──
        // Nhánh permissionless duy nhất ⇒ đây là chỗ vế này thực sự mua được thứ gì.
        expect cust_out.address == cust_in.address

        // ── C-MIG-REFSCRIPT (F3): không đính script tham chiếu vào kho ──────
        expect cust_out.reference_script == None

        // ── C-MIG-2: cust_in/out mang đúng 1 NFT (seed_policy, instance_id) ──
        // Chống custody-GIẢ dựng tại địa chỉ script (địa chỉ công khai) với datum bịa.
        expect
          assets.quantity_of(cust_in.value, seed_policy, datum.instance_id) == 1
        expect
          assets.quantity_of(cust_out.value, seed_policy, out_datum.instance_id) == 1

        // ── C-MIG-4: neo epoch vào chain GỌN 1 epoch (không lùi, không đóng băng) ──
        let cur = util.get_epoch_bounded(tx, ms_per_epoch)
        expect cur >= datum.epoch
        expect out_datum.epoch == cur

        // ── C-MIG-9: kho phải khai là nhận asset này ───────────────────────
        expect
          migrate.asset_accepted(datum.accepted_assets, lamp_policy, token_name)

        // ── C-MIG-8 (nhãn nguồn): `source` ghim vào hằng dành riêng cho Reserve ──
        // Bucket đích là HẰNG, không do người gọi chọn; `source` phải khớp nhãn của
        // hằng đó → không có đường dùng MigrateIn để nạp vào bucket khác.
        expect source == migrate.reserve_source_tag

        // ── C-MIG-7: value tăng ĐÚNG Δ, mọi asset khác NGUYÊN ──────────────
        expect
          migrate.value_ok(
            cust_in.value,
            cust_out.value,
            lamp_policy,
            token_name,
            delta,
          )

        // ── C-MIG-8: sổ tăng ĐÚNG Δ tại đúng một (bucket, asset), canonical ──
        // Đích không phải một ĐỊA CHỈ mà là một DÒNG SỔ: value tăng mà sổ không tăng
        // thì Release không rút lại được — value kẹt ngoài sổ, tức đốt trá hình.
        expect
          migrate.ledger_ok(
            datum.ledger,
            out_datum.ledger,
            migrate.reserve_inflow_bucket_id,
            lamp_policy,
            token_name,
            delta,
          )

        True
      }

      // v1 triển khai Collect + Release + MigrateIn; Rebalance thêm ở v1.x.
      _ -> fail
    }
  }

  else(_) {
    fail
  }
}
