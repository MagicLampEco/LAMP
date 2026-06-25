// Supply cap — bộ đếm tổng-phát-hành-lịch-sử ÉP CỨNG tổng cung LAMP ≤ 36 tỷ.
//
// ─── VẤN ĐỀ (lỗ C-2) ─────────────────────────────────────────────────────────
// did_token_mint / lamp_mint gate AI mint (authority qua DID/bảng) + AI tên token
// (asset-name), NHƯNG KHÔNG gate BAO NHIÊU. Controller hợp lệ có thể mint vô hạn
// LAMP → vỡ bất biến "cố định 36 tỷ, không đốt" (SPEC §1.1/§QĐ-1).
//
// ─── FIRST-PRINCIPLES — SupplyState là bộ đếm đơn điệu ────────────────────────
// "fixed-supply" KHÔNG đòi 36 tỷ nằm sẵn on-chain (xem QĐ-1: lazy-mint). Chỉ đòi
// TỔNG PHÁT HÀNH LỊCH SỬ ≤ cap. Hiện thực: MỘT state UTxO (SupplyState) đậu một
// NFT thread one-shot (name cố định, bound genesis_ref → KHÔNG re-mint, KHÔNG giả
// được), datum giữ `minted_total: Int` (genesis = 0). MỖI lần mint LAMP, tx PHẢI
// spend + tái-tạo SupplyState UTxO; spend validator ép:
//     minted_total' = minted_total + minted_amount   (minted_amount = qty LAMP
//                                                       trong tx.mint, đọc trực tiếp)
//     minted_total' ≤ CAP                             (chặn tại trần)
//     minted_amount ≥ 0                               (no-burn ngược; monotonic)
//     NFT thread bảo toàn ở Script(own)               (state machine continuity)
//
// ─── CAP raw-unit ─────────────────────────────────────────────────────────────
// SPEC §dòng đầu + §types: 1 LAMP = 10⁶ oildrop (decimals = 6). Tổng cung cố định
// 36 tỷ LAMP = 36_000_000_000 × 10⁶ = 36_000_000_000_000_000 oildrop (= 36×10¹⁵).
// CAP là tham số BAKE (Int, raw-unit oildrop) — neo vào tham số validator, KHÔNG hằng
// hard-code, để cùng engine tái dùng cho token opt-in cap khác (cap khác nhau).
//
// ─── BINDING (chống double-count / bypass) — xem supply_state.ak + did_token_mint ─
// minted_amount đọc TỪ tx.mint (tổng mint của cả tx, ledger gộp sẵn) → KHÔNG thể
// đếm 2 lần trong cùng tx. SupplyState NFT one-shot (1 thread duy nhất) → đúng 1
// input SupplyState bị spend/tx → đúng 1 lần cộng. did_token_mint (biến thể có cap)
// ÉP phải có SupplyState input → KHÔNG thể mint LAMP mà bỏ qua bộ đếm.
//
// Aiken 1.1.x / Plutus V3.

use aiken/collection/dict
use cardano/address.{Script}
use cardano/assets.{AssetName, PolicyId, quantity_of, tokens}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}

// ─── Hợp đồng datum ───────────────────────────────────────────────────────────

/// State object đếm tổng-đã-đúc. Constr index 0 (HỢP ĐỒNG CBOR).
/// `minted_total` = tổng LAMP (oildrop) đã phát hành lịch sử qua bộ đếm này.
/// Genesis = 0. Đơn điệu KHÔNG giảm.
/// `lamp_policy` / `lamp_asset_name` = token được đếm — ĐƯA VÀO DATUM (không còn
/// là tham số validator) để PHÁ VÒNG PHỤ THUỘC HASH với did_token_mint:
///   • supply_state hash phụ-thuộc lamp_policy (= did_token_mint hash) khi là tham số
///   • did_token_mint hash phụ-thuộc supply_state hash (supply_state_nft_policy)
///   → vòng → không tính được hash nào. Datum-hoá lamp_policy → supply_state hash
///   ĐỘC LẬP did_token_mint → 1 chiều, hết vòng. Set lúc genesis, BẤT BIẾN qua spend.
/// Thứ tự field: minted_total, lamp_policy, lamp_asset_name (2 field mới chèn CUỐI).
pub type SupplyStateDatum {
  minted_total: Int,
  lamp_policy: PolicyId,
  lamp_asset_name: AssetName,
}

/// Redeemer spend SupplyState — chỉ một action (mint qua bộ đếm). CBOR xác định.
pub type SupplyStateRedeemer {
  CountMint
}

/// Redeemer mint SupplyState NFT — chỉ một action (genesis). CBOR xác định.
pub type SupplyStateNft {
  MintSupplyState
}

// ════════════════════════════════════════════════════════════════════════════
// (1) GENESIS — mint SupplyState NFT one-shot, hard-bind Script(own), total = 0
// ════════════════════════════════════════════════════════════════════════════

/// Mint hợp lệ ⟺ TẤT CẢ:
///   (a) ONE-SHOT: tx CONSUME đúng UTxO genesis (`genesis_ref`) → policy chạy
///       tối đa 1 lần trong lịch sử chain → KHÔNG re-mint (chống 2 SupplyState giả).
///   (b) mint dưới own_policy ĐÚNG 1 asset-name = `state_name`, qty = +1 (singleton).
///   (c) NFT đó đậu ĐÚNG 1 output tại Script(own_policy) — hard-bind vào chính
///       validator (Design-2: own_policy ≡ script hash). NFT ra ví → None → từ chối.
///   (d) output đó mang inline SupplyStateDatum parse được, minted_total == 0
///       (KHÔNG cho seed trước số dương để "burn" sạch quota lén). datum mới mang
///       lamp_policy/lamp_asset_name (token được đếm) — set lúc genesis, bất biến
///       qua spend (validate_spend ép giữ nguyên). Genesis CHỈ định nghĩa chúng;
///       off-chain phải set datum.lamp_policy = did_token_mint hash (xem THỨ TỰ
///       DEPLOY ở supply_state.ak).
pub fn validate_genesis(
  own_policy: PolicyId,
  state_name: AssetName,
  genesis_ref: transaction.OutputReference,
  self: Transaction,
) -> Bool {
  expect
    aiken_list_any_consumes(self, genesis_ref)
  expect mint_is_single_nft(self, own_policy, state_name)
  expect Some(state_out) =
    find_unique_nft_output_at_script(self.outputs, own_policy, state_name)
  expect Some(state) = read_supply(state_out)
  state.minted_total == 0
}

// ════════════════════════════════════════════════════════════════════════════
// (2) SPEND — đếm mint LAMP: total' = total + minted_amount; total' ≤ CAP
// ════════════════════════════════════════════════════════════════════════════

/// Spend hợp lệ ⟺ TẤT CẢ:
///   (s1) own_input thực mang SupplyState NFT (state_nft_policy, state_name) qty 1
///        — chống spend nhầm UTxO khác cùng địa chỉ.
///   (s2) ĐÚNG 1 input tại Script(own) mang SupplyState NFT — chống 2 SupplyState
///        (kẻ tấn công nhân đôi bộ đếm để đếm thiếu).
///   (s3) continuing output: ĐÚNG 1 output tại Script(own) mang SupplyState NFT
///        (NFT thread bảo toàn ở chính validator; mất NFT / ra ví → từ chối).
///   (s4) minted_amount = qty của (lamp_policy, lamp_asset_name) trong tx.mint,
///        ĐỌC TỪ DATUM (datum_in.lamp_policy / datum_in.lamp_asset_name) — KHÔNG
///        còn là tham số validator (phá vòng phụ-thuộc-hash với did_token_mint).
///        Đọc TRỰC TIẾP từ tx.mint (ledger gộp toàn-tx) → không double-count.
///   (s5) minted_amount ≥ 0 (no-burn ngược; bộ đếm KHÔNG được kéo lùi bằng burn).
///   (s6) minted_total' == minted_total + minted_amount (bộ đếm khớp đúng mint).
///   (s7) minted_total' ≤ cap (CHẶN TẠI TRẦN — bất biến cốt lõi).
///   (s8) datum_out.lamp_policy == datum_in.lamp_policy VÀ
///        datum_out.lamp_asset_name == datum_in.lamp_asset_name — token được đếm
///        BẤT BIẾN qua spend (chống đổi mục-tiêu-đếm để né cap của token thật).
/// Hệ quả: minted_total' ≥ minted_total (monotonic) suy ra từ (s5)+(s6).
///
/// own_script = payment script hash của chính validator (own_policy ≡ own_script:
/// Design-2 NFT one-shot bound vào script). Validator truyền own_script.
pub fn validate_spend(
  own_script: ByteArray,
  state_nft_policy: PolicyId,
  state_name: AssetName,
  cap: Int,
  datum_in: SupplyStateDatum,
  own_ref: transaction.OutputReference,
  self: Transaction,
) -> Bool {
  // (s1) own_input mang SupplyState NFT.
  expect Some(own_in) = find_input_by_ref(self.inputs, own_ref)
  expect quantity_of(own_in.output.value, state_nft_policy, state_name) == 1

  // (s2) đúng 1 input tại Script(own) mang SupplyState NFT.
  expect
    count_inputs_at_script_with_nft(
      self.inputs,
      own_script,
      state_nft_policy,
      state_name,
    ) == 1

  // (s3) đúng 1 continuing output tại Script(own) mang SupplyState NFT.
  expect Some(state_out) =
    find_unique_nft_output_at_script_hash(
      self.outputs,
      own_script,
      state_nft_policy,
      state_name,
    )
  expect Some(datum_out) = read_supply(state_out)

  // (s4) minted_amount = qty LAMP trong tx.mint (toàn-tx, không double-count).
  // Token được đếm ĐỌC TỪ DATUM (datum_in) — không còn tham số validator.
  let minted_amount =
    quantity_of(self.mint, datum_in.lamp_policy, datum_in.lamp_asset_name)

  and {
    // (s5) no-burn ngược / monotonic.
    minted_amount >= 0,
    // (s6) bộ đếm cộng đúng.
    datum_out.minted_total == datum_in.minted_total + minted_amount,
    // (s7) chặn tại trần.
    datum_out.minted_total <= cap,
    // (s8) token được đếm bất biến qua spend.
    datum_out.lamp_policy == datum_in.lamp_policy,
    datum_out.lamp_asset_name == datum_in.lamp_asset_name,
  }
}

// ─── Helpers (thuần, test-được) ───────────────────────────────────────────────

fn aiken_list_any_consumes(
  self: Transaction,
  genesis_ref: transaction.OutputReference,
) -> Bool {
  list_any_input(self.inputs, genesis_ref)
}

fn list_any_input(
  inputs: List<Input>,
  genesis_ref: transaction.OutputReference,
) -> Bool {
  when inputs is {
    [] -> False
    [h, ..t] ->
      if h.output_reference == genesis_ref {
        True
      } else {
        list_any_input(t, genesis_ref)
      }
  }
}

fn find_input_by_ref(
  inputs: List<Input>,
  ref: transaction.OutputReference,
) -> Option<Input> {
  when inputs is {
    [] -> None
    [h, ..t] ->
      if h.output_reference == ref {
        Some(h)
      } else {
        find_input_by_ref(t, ref)
      }
  }
}

/// tx.mint dưới `policy` ĐÚNG 1 asset-name = `name`, qty == +1 (NFT singleton).
fn mint_is_single_nft(self: Transaction, policy: PolicyId, name: AssetName) -> Bool {
  let moved = dict.to_pairs(tokens(self.mint, policy))
  when moved is {
    [p] -> and { p.1st == name, p.2nd == 1 }
    _ -> False
  }
}

/// Output DUY NHẤT mang đúng 1 (policy,name) VÀ đậu tại Script(policy).
/// Dùng ở GENESIS (own_policy ≡ script hash → địa chỉ = Script(own_policy)).
fn find_unique_nft_output_at_script(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Option<Output> {
  let matches =
    filter_outputs(
      outputs,
      fn(o) {
        quantity_of(o.value, policy, name) == 1 && o.address.payment_credential == Script(
          policy,
        )
      },
    )
  when matches is {
    [single] -> Some(single)
    _ -> None
  }
}

/// Output DUY NHẤT tại Script(script_hash) mang NFT (nft_policy, name) qty 1.
/// Dùng ở SPEND: NFT policy ≡ own script hash (Design-2) nhưng tách tham số để
/// tường minh — script_hash chọn địa chỉ, nft_policy chọn token.
fn find_unique_nft_output_at_script_hash(
  outputs: List<Output>,
  script_hash: ByteArray,
  nft_policy: PolicyId,
  name: AssetName,
) -> Option<Output> {
  let matches =
    filter_outputs(
      outputs,
      fn(o) {
        quantity_of(o.value, nft_policy, name) == 1 && o.address.payment_credential == Script(
          script_hash,
        )
      },
    )
  when matches is {
    [single] -> Some(single)
    _ -> None
  }
}

/// Đếm input tại Script(script_hash) mang NFT (nft_policy, name) qty 1.
fn count_inputs_at_script_with_nft(
  inputs: List<Input>,
  script_hash: ByteArray,
  nft_policy: PolicyId,
  name: AssetName,
) -> Int {
  count_inputs(
    inputs,
    fn(i) {
      i.output.address.payment_credential == Script(script_hash) && quantity_of(
        i.output.value,
        nft_policy,
        name,
      ) == 1
    },
  )
}

fn filter_outputs(outputs: List<Output>, pred: fn(Output) -> Bool) -> List<Output> {
  when outputs is {
    [] -> []
    [h, ..t] ->
      if pred(h) {
        [h, ..filter_outputs(t, pred)]
      } else {
        filter_outputs(t, pred)
      }
  }
}

fn count_inputs(inputs: List<Input>, pred: fn(Input) -> Bool) -> Int {
  when inputs is {
    [] -> 0
    [h, ..t] ->
      if pred(h) {
        1 + count_inputs(t, pred)
      } else {
        count_inputs(t, pred)
      }
  }
}

fn read_supply(output: Output) -> Option<SupplyStateDatum> {
  when output.datum is {
    InlineDatum(data) -> {
      expect parsed: SupplyStateDatum = data
      Some(parsed)
    }
    _ -> None
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (3) BINDING — token-có-cap PHẢI spend SupplyState trong cùng tx
// ════════════════════════════════════════════════════════════════════════════

/// `requires_supply_state_spent(self, policy, name)` = True ⟺ có ĐÚNG 1 input
/// mang SupplyState NFT (policy, name) qty 1 trong tx.
///
/// did_token_mint (biến thể có cap) gọi hàm này: nếu có SupplyState NFT bị spend,
/// validator spend của SupplyState BẮT BUỘC chạy (ledger kích spend khi consume
/// UTxO ở script) → bộ đếm cập nhật minted_amount = qty LAMP toàn-tx → cap được ép.
/// "ĐÚNG 1" (không ≥1) để chống kẻ tấn công kèm SupplyState giả thứ 2 (NFT one-shot
/// đảm bảo chỉ 1 thread thật tồn tại, nhưng đòi-đúng-1 là phòng-thủ-thêm).
pub fn requires_supply_state_spent(
  self: Transaction,
  state_nft_policy: PolicyId,
  state_name: AssetName,
) -> Bool {
  count_inputs(
    self.inputs,
    fn(i) { quantity_of(i.output.value, state_nft_policy, state_name) == 1 },
  ) == 1
}
