// Thân của `pot_vault.spend` và `pot_vault.mint`, tách ra thành hàm `pub` để ca
// kiểm ở module KHÁC gọi được (Aiken không xuất handler của validator ra ngoài
// module — `use pot_vault` rồi gọi `pot_vault.spend` trả
// `aiken::check::unknown::module_value`).
//
// ═════════════════════════════════════════════════════════════════════════
// BẤT BIẾN CỦA KÉT POT (đọc trước khi sửa một dòng nào dưới đây)
// ═════════════════════════════════════════════════════════════════════════
//  1. Đúng MỘT UTxO pot tồn tại mãi mãi: NFT (own_hash, "") one-shot, không có
//     đường đốt, và mọi nhánh đều ép nó ở lại địa chỉ enterprise `Script(own_hash)`.
//  2. `reserve_hash` ghi một lần lúc đúc (28 byte), bất biến sau đó.
//  3. `drawn_total` chỉ tăng; `Feed` cộng đúng lượng LAMP rời pot; `Absorb` không
//     đụng tới nó. Luôn `drawn_total ≤ total_cap`.
//  4. `last_window` tăng NGẶT mỗi `Feed` ⇒ tối đa một `Feed` mỗi cửa sổ.
//  5. `Feed` chuyển đúng `d > 0` LAMP sang két swap định danh bởi NFT
//     `(reserve_hash, "")`, ở đúng địa chỉ `Script(reserve_hash)` không stake
//     credential; LAMP của két sau lượt đó ≤ `window_cap`.
//  6. `Feed` không rút được ADA của pot, không đưa được token lạ vào pot, không
//     đúc/đốt dưới policy pot, và KHÔNG đứng chung tx với việc hút UTxO lạc.
//  7. `Absorb` hút ≥1 UTxO lạc: toàn bộ LAMP của chúng phải vào pot, token lạ
//     KHÔNG được vào pot, ADA của pot không giảm (ADA của UTxO lạc là công của
//     người dọn), datum y nguyên.
//  8. Không nhánh nào đòi chữ ký. An toàn đến từ ràng buộc giá trị + datum.
//  9. Chống thoả mãn kép: đúng 1 input mang NFT pot mỗi tx, và đúng 1 output ở
//     địa chỉ pot.

use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Spend, Transaction}
use magiclamp/potvault/types.{
  Absorb, Feed, MintPot, PotDatum, PotMintRedeemer, PotRedeemer, max_range_ms,
  pot_nft_name, reserve_nft_name, script_hash_length,
}
use magiclamp/potvault/util

// ═════════════════════════════════════════════════════════════════════════
// SPEND — hai loại UTxO ở CÙNG một địa chỉ, phân loại bằng NFT
// ═════════════════════════════════════════════════════════════════════════
// UTxO pot  = input mang NFT (own_hash, ""). Chỉ nó mới parse `PotDatum`.
// UTxO lạc  = mọi input khác ở địa chỉ pot. Datum của nó do NGƯỜI GỬI đặt, nên
//             nhận kiểu `Data` và KHÔNG parse — phân loại bằng token, không bằng
//             hình dạng datum (hai datum khác nhau đều có thể là Constr 0).
//
// Datum nhận `Option<Data>` chứ không `Option<PotDatum>`: Plutus V3 cho tiêu một
// input script KHÔNG datum, nên `None` là hình dạng có thật và phải chạy được.
// `expect Some(..)` ở đầu hàm sẽ khoá chết mọi UTxO lạc gửi tới bằng ví thường.
pub fn pot_spend(
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  ms_per_epoch: Int,
  window_cap: Int,
  total_cap: Int,
  datum_opt: Option<Data>,
  redeemer: PotRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  let own_out = util.own_output(own_ref, tx.inputs)
  let own_hash = util.own_script_hash(own_out.address)

  // ── CHỐNG THOẢ MÃN KÉP ──────────────────────────────────────────────────
  // Đúng 1 input mang NFT pot trong CẢ tx. Không có dòng này, hai UTxO pot (hai
  // NFT không thể cùng tồn tại, nhưng cổng phải đứng độc lập với giả định đó)
  // hoặc hai lượt gọi cùng nhìn vào MỘT output tiếp nối và cùng thoả.
  // Ghim bởi `absorb_hai_input_pot_nft` (đo bằng đột biến 2026-09-28). KHÔNG
  // phải `feed_hai_input_pot_nft` — ca đó đỏ ở F-0 và vẫn đỏ khi gỡ dòng này.
  expect util.count_inputs_with_nft(tx.inputs, own_hash, pot_nft_name) == 1
  let pot_input = util.input_with_nft(tx.inputs, own_hash, pot_nft_name)

  // NFT pot phải đứng ở ĐÚNG địa chỉ enterprise của script này ⇒ validator này
  // chắc chắn CHẠY cho nó. Thiếu dòng này, nhánh UTxO lạc uỷ quyền cho một input
  // mà không validator nào kiểm (NFT nằm ở ví) ⇒ ai cũng vét được UTxO lạc.
  // Ghim bởi `spend_lac_pot_nft_o_vi`.
  expect pot_input.output.address == util.script_address(own_hash)

  if util.has_nft(own_out, own_hash, pot_nft_name) {
    // ── UTxO POT: nơi ép toàn bộ luật thật ────────────────────────────────
    expect Some(raw_datum) = datum_opt
    expect pot: PotDatum = raw_datum
    let pot_lamp_in = assets.quantity_of(own_out.value, lamp_policy, lamp_name)

    when redeemer is {
      // ══ FEED (ai cũng gọi, không chữ ký) ═════════════════════════════════
      Feed -> {
        // F-0: `Feed` và `Absorb` RỜI NHAU — không UTxO lạc nào trong input.
        // Hai nhánh ngược dấu về LAMP vào pot (`Feed` bắt giảm, `Absorb` bắt
        // tăng đúng tổng UTxO lạc); để chúng đứng chung tx thì một lượt Feed
        // "trả tiền" bằng LAMP của UTxO lạc và cả hai chốt cùng mất nghĩa.
        // Ghim bởi `feed_kem_utxo_lac`.
        expect util.count_inputs_at_script(tx.inputs, own_hash) == 1

        // F-1: cửa sổ neo vào thời gian thật, và TĂNG NGẶT.
        // Ghim bởi `feed_hai_lan_mot_cua_so`.
        let now = util.get_epoch_pinned(tx, ms_per_epoch, max_range_ms)
        expect now > pot.last_window

        // F-2: đúng 1 output tiếp nối, ở ĐÚNG địa chỉ pot, không script-carrier.
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let pot_out = util.output_at_script(tx.outputs, own_hash)
        expect pot_out.address == util.script_address(own_hash)
        expect util.has_nft(pot_out, own_hash, pot_nft_name)
        expect pot_out.reference_script == None
        expect InlineDatum(out_raw) = pot_out.datum
        expect out_pot: PotDatum = out_raw
        expect out_pot.reserve_hash == pot.reserve_hash
        expect out_pot.last_window == now

        // F-3: value pot chỉ ADA + NFT + LAMP; ADA không giảm; `d` suy từ LAMP.
        expect
          util.only_ada_nft_lamp(
            pot_out.value,
            own_hash,
            pot_nft_name,
            lamp_policy,
            lamp_name,
          )
        expect
          assets.lovelace_of(pot_out.value) >= assets.lovelace_of(own_out.value)
        let pot_lamp_out =
          assets.quantity_of(pot_out.value, lamp_policy, lamp_name)
        // `d` KHÔNG do redeemer khai: nó là hiệu LAMP thật của pot. Một con số
        // trong redeemer thì người dựng tx điều khiển được, hiệu value thì không.
        let d = pot_lamp_in - pot_lamp_out

        // F-4: rót thật, và sổ gộp không vượt trần tích luỹ kênh.
        expect d > 0
        expect out_pot.drawn_total == pot.drawn_total + d
        expect out_pot.drawn_total <= total_cap

        // F-5: két swap PHẢI bị tiêu trong cùng tx (redeemer của két là việc
        // của két). Định vị bằng NFT két ⇒ pot không ôm hash két làm tham số.
        expect
          util.count_inputs_with_nft(
            tx.inputs,
            pot.reserve_hash,
            reserve_nft_name,
          ) == 1
        let reserve_in =
          util.input_with_nft(tx.inputs, pot.reserve_hash, reserve_nft_name).output

        // F-6: đúng 1 output két, ở ĐÚNG địa chỉ két không stake credential,
        // nhận đúng `d`, và sau lượt này LAMP két ≤ trần cửa sổ.
        expect
          util.count_outputs_with_nft(
            tx.outputs,
            pot.reserve_hash,
            reserve_nft_name,
          ) == 1
        let reserve_out =
          util.output_with_nft(tx.outputs, pot.reserve_hash, reserve_nft_name)
        expect reserve_out.address == util.script_address(pot.reserve_hash)
        let reserve_lamp_in =
          assets.quantity_of(reserve_in.value, lamp_policy, lamp_name)
        let reserve_lamp_out =
          assets.quantity_of(reserve_out.value, lamp_policy, lamp_name)
        expect reserve_lamp_out - reserve_lamp_in == d
        expect reserve_lamp_out <= window_cap

        // F-7: không đúc/đốt gì dưới policy pot.
        expect util.no_mint_under(tx, own_hash)
        True
      }

      // ══ ABSORB (ai cũng gọi) ═════════════════════════════════════════════
      Absorb -> {
        // A-2: đúng 1 output tiếp nối, ở ĐÚNG địa chỉ pot, không script-carrier.
        expect util.count_outputs_at_script(tx.outputs, own_hash) == 1
        let pot_out = util.output_at_script(tx.outputs, own_hash)
        expect pot_out.address == util.script_address(own_hash)
        expect util.has_nft(pot_out, own_hash, pot_nft_name)
        expect pot_out.reference_script == None
        expect InlineDatum(out_raw) = pot_out.datum
        expect out_pot: PotDatum = out_raw

        // A-1: datum Y NGUYÊN, kể cả `drawn_total` — LAMP trả về KHÔNG hoàn trần.
        // Ghim bởi `absorb_doi_datum` · `absorb_hoan_tran_drawn_total`.
        expect out_pot == pot

        // A-3: ≥1 UTxO lạc, và TOÀN BỘ LAMP của chúng vào pot. Token lạ thì
        // không (`only_ada_nft_lamp`) — nó theo người dọn, cùng với ADA lạc.
        expect util.count_inputs_at_script(tx.inputs, own_hash) >= 2
        expect
          util.only_ada_nft_lamp(
            pot_out.value,
            own_hash,
            pot_nft_name,
            lamp_policy,
            lamp_name,
          )
        expect
          assets.lovelace_of(pot_out.value) >= assets.lovelace_of(own_out.value)
        let stray_lamp =
          util.stray_lamp_total(
            tx.inputs,
            own_hash,
            pot_nft_name,
            lamp_policy,
            lamp_name,
          )
        expect
          assets.quantity_of(pot_out.value, lamp_policy, lamp_name) == pot_lamp_in + stray_lamp

        // A-4: không đúc/đốt gì dưới policy pot.
        expect util.no_mint_under(tx, own_hash)
        True
      }
    }
  } else {
    // ── UTxO LẠC: uỷ quyền, KHÔNG lặp kiểm ────────────────────────────────
    // A-STRAY-3: chính input này cũng phải dùng redeemer `Absorb` (một tx hút
    // UTxO lạc thì mọi input script trong đó là một lượt hút).
    expect redeemer == Absorb
    // A-STRAY-1 đã ép ở đầu hàm: đúng 1 input mang NFT pot, ở địa chỉ pot ⇒
    // nhánh UTxO pot CHẠY và ép A-1..A-4, trong đó A-3 buộc LAMP của input này
    // vào pot. Ghim bởi `spend_lac_khong_co_pot`.
    //
    // A-STRAY-2: redeemer của input pot phải là `Absorb`. Suy được từ F-0 (Feed
    // cấm UTxO lạc) nên đây là lớp thứ hai; giữ lại vì nó biến một suy luận
    // liên-nhánh thành một dòng đọc được tại chỗ.
    // Ghim bởi `spend_lac_pot_dung_redeemer_feed`.
    expect Some(pot_redeemer_raw) =
      pairs.get_first(tx.redeemers, Spend(pot_input.output_reference))
    expect pot_redeemer: PotRedeemer = pot_redeemer_raw
    expect pot_redeemer == Absorb
    True
  }
}

// ═════════════════════════════════════════════════════════════════════════
// MINT — `MintPot` one-shot. CỔNG DUY NHẤT ép trạng thái khởi tạo.
// ═════════════════════════════════════════════════════════════════════════
// Sau tx này không còn nhánh nào ghi được `reserve_hash` (F-2 và A-1 đều ép giữ
// nguyên) và NFT pot không đúc lại được (`genesis_ref` đã tiêu), nên MỌI ràng
// buộc về trạng thái gốc phải đứng ở đây. Không có nhánh đốt ⇒ NFT pot không
// biến mất được (M-2 đòi đúng `+1`, nên mọi số lượng âm bị từ chối).
pub fn pot_mint(
  genesis_ref: OutputReference,
  lamp_policy: PolicyId,
  lamp_name: AssetName,
  ms_per_epoch: Int,
  window_cap: Int,
  total_cap: Int,
  redeemer: PotMintRedeemer,
  policy_id: PolicyId,
  tx: Transaction,
) -> Bool {
  // Một nhánh duy nhất: không có đường đốt, và mọi lượt đúc đi qua đây.
  let MintPot = redeemer

  // ── M-7: THAM SỐ BIÊN DỊCH nằm trong miền dùng được (THÊM ngoài spec) ──────
  // `ms_per_epoch == 0` là chia cho 0 ⇒ mọi lượt Feed vỡ; `window_cap` hay
  // `total_cap` bằng 0 ⇒ trần không bao giờ thoả; LAMP trùng NFT pot ⇒ hai sổ
  // lẫn nhau. Cả bốn đều khoá vốn vĩnh viễn, và đây là chỗ duy nhất còn đọc
  // được tham số trước khi tiền vào két.
  //
  // VÌ SAO ĐẶT TRƯỚC M-5, không phải cuối hàm: `only_ada_nft_lamp` dựng lại
  // value từ ba thành phần, nên khi LAMP TRÙNG NFT pot nó cộng NFT hai lần và
  // TỰ từ chối trước. Đặt vế "LAMP ≠ NFT pot" sau M-5 thì nó thành một chốt
  // không bao giờ chạy tới — đo được: ca `mintpot_lamp_trung_nft_pot` đỏ ở
  // `only_ada_nft_lamp` chứ không ở dòng mang tên nó (2026-09-28).
  expect ms_per_epoch > 0
  expect window_cap > 0
  expect total_cap > 0
  // Vế dưới đây CHƯA ĐƯỢC GHIM và không ghim được: M-5 dựng lại value từ ba
  // thành phần, nên khi LAMP trùng NFT pot nó cộng NFT hai lần và từ chối MỌI
  // đường (M-3 đã buộc có đúng một output mang NFT). Gỡ vế này ra thì 0 bài đỏ —
  // đo bằng đột biến 2026-09-28. Giữ lại vì nó biến một lỗi "value không khớp"
  // khó truy thành một dòng nói đúng nguyên nhân, ở giây deploy.
  expect !and {
      lamp_policy == policy_id,
      lamp_name == pot_nft_name,
    }

  // M-1: one-shot — tiêu `genesis_ref` ⇒ policy chạy tối đa một lần.
  expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

  // M-2: đúc ĐÚNG { (own_policy, "") : 1 } và không gì khác dưới policy này.
  // Phép so cả danh sách đóng luôn cả "đúc kèm tên thứ hai" và "đốt".
  expect
    dict.to_pairs(assets.tokens(tx.mint, policy_id)) == [Pair(pot_nft_name, 1)]

  // M-3: đúng 1 output mang NFT, ở ĐÚNG địa chỉ enterprise của script này,
  // không script-carrier. Đúc thẳng vào ví ⇒ validator pot không bao giờ chạy.
  expect util.count_outputs_with_nft(tx.outputs, policy_id, pot_nft_name) == 1
  let pot_out = util.output_with_nft(tx.outputs, policy_id, pot_nft_name)
  expect pot_out.address == util.script_address(policy_id)
  expect pot_out.reference_script == None

  // M-4: datum inline hợp lệ + trạng thái gốc sạch.
  expect InlineDatum(raw) = pot_out.datum
  expect pot: PotDatum = raw
  expect bytearray.length(pot.reserve_hash) == script_hash_length
  expect pot.drawn_total == 0
  // −1 (không phải 0): cửa sổ 0 là một cửa sổ THẬT, đặt 0 là tặng sẵn một
  // lượt Feed ở bucket 0 mà `now > last_window` vẫn thoả.
  expect pot.last_window == -1

  // M-5: value chỉ ADA + NFT + (tuỳ) LAMP — lượt nạp đầu được kèm ở đây.
  expect
    util.only_ada_nft_lamp(
      pot_out.value,
      policy_id,
      pot_nft_name,
      lamp_policy,
      lamp_name,
    )

  // ── M-6: chống tự tham chiếu (THÊM ngoài spec) ────────────────────────────
  // `reserve_hash == policy_id` làm F-5/F-6 đòi cùng một NFT cho hai vai ⇒
  // `d == −d` ⇒ không lượt Feed nào thoả được ⇒ pot chết mà không dòng nào báo.
  expect pot.reserve_hash != policy_id
  True
}
