// reserve_auth — minting policy ONE-SHOT cho Treasury "kéo" Reserve (Treasury-pull).
//
// VAI TRÒ (cầu Reserve↔Treasury): reserve_draw.ak (module Reserve) chỉ nhả khi tx có
// 1 input mang NFT (treasury_auth_policy, treasury_auth_name) qty ≥ 1 — bằng chứng
// "Treasury chủ động kéo". NFT đó ĐÍCH THỊ là token policy NÀY đúc. reserve_draw KHÔNG
// biết logic sàn (parked < floor); ràng buộc sàn nằm ở reserve_gate.ak — validator giữ
// auth NFT này và chỉ cho spend khi Treasury parked < floor. Vì auth NFT bị KHÓA tại
// reserve_gate, mọi lần nó thành input đều đã qua kiểm sàn → Reserve nhả CHỈ khi dưới sàn.
//
// FIRST-PRINCIPLES — one-shot (mirror custody_seed.ak / thread_nft.ak):
//   Policy param = genesis_ref (OutputReference) + auth_name (ByteArray). Mint hợp lệ chỉ
//   khi tx CONSUME đúng UTxO genesis đó. 1 UTxO spend ≤ 1 lần trong lịch sử chain → policy
//   chạy ≤ 1 lần → đúc đúng 1 (auth_name, +1) đúng MỘT lần → KHÔNG thể tạo auth NFT thứ 2
//   → KHÔNG thể giả "Treasury-pull" để vắt Reserve. Đây là credential DUY NHẤT, BẤT BIẾN.
//
// MINT shape: đúng 1 asset name (auth_name) của policy này, qty == 1. KHÔNG name lạ kèm.
// BURN — CẤM hoàn toàn (else fail): auth NFT sống suốt vòng đời cầu, tái dùng vô hạn.

use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, VerificationKey}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction,
  placeholder}

/// Redeemer minting policy. Một action duy nhất; KHÔNG có Burn (else fail).
pub type ReserveAuthRedeemer {
  MintAuth
}

/// reserve_auth parameterized bởi (genesis_ref, auth_name, floor_oildrop).
///   genesis_ref   — UTxO genesis tiêu đúng 1 lần (one-shot).
///   auth_name     — asset name auth NFT (phải khớp treasury_auth_name của reserve_draw + reserve_gate).
///   floor_oildrop — SÀN parked của reserve_gate. Ở ĐÂY nó KHÔNG được dùng để so sánh gì cả;
///                   nó chỉ tồn tại để cổng A-FLOOR-1 dưới đây bác một cấu hình chết. Phải
///                   truyền ĐÚNG giá trị đã/sẽ truyền cho `reserve_gate` (khe #5) — xem
///                   khối "RESIDUAL" ở A-FLOOR-1.
validator reserve_auth(
  genesis_ref   : OutputReference,
  auth_name     : ByteArray,
  floor_oildrop : Int,
) {
  mint(_r: ReserveAuthRedeemer, policy_id: PolicyId, tx: Transaction) {
    // ── A-FLOOR-1: SÀN phải DƯƠNG — chặn cấu hình khoá chết 9,63 tỷ LAMP ──────
    //
    // VÌ SAO Ở ĐÂY, KHÔNG Ở `reserve_gate`:
    //   `reserve_gate.ak` ép `parked < floor_oildrop`, mà `parked` lấy bằng `quantity_of`
    //   trên value của một Output ⟹ sổ cái bảo đảm `parked >= 0`. Với `floor_oildrop <= 0`
    //   thì `parked < floor_oildrop` KHÔNG BAO GIỜ đúng ⟹ auth NFT không rời gate được ⟹
    //   `reserve_draw` Luật 5 vĩnh viễn không thoả ⟹ đường Reserve chết hẳn.
    //   Đặt `expect floor_oildrop > 0` trong `reserve_gate.spend` là MÃ CHẾT: ở đó nó không
    //   đổi kết quả của bất kỳ giao dịch nào (nhánh đã hỏng sẵn), nên không ca kiểm THẬT nào
    //   phân biệt được có nó hay không — chỉ một ca dựng `parked` âm mới phân biệt, mà trạng
    //   thái đó sổ cái không cho tồn tại. Ghim một chốt bằng một ca không thể xảy ra là tự lừa.
    //
    // VÌ SAO ĐÂY LÀ NHÁNH SINH, KHÔNG PHẢI CHỖ TIỆN:
    //   Auth NFT là chìa DUY NHẤT của gate (`reserve_draw` Luật 5 đòi nó, `reserve_gate`
    //   G-NOBURN-1 cấm đúc lại), và policy này one-shot ⟹ chạy ĐÚNG MỘT LẦN trong lịch sử
    //   chain. Ép được một lần là ép mãi mãi. Sàn sai ⟹ mint hỏng ⟹ `genesis_ref` KHÔNG bị
    //   tiêu (tx không lên chuỗi) ⟹ sửa cấu hình rồi gửi LẠI CHÍNH tx đó, policy-id không đổi,
    //   chưa có gì bị cam kết. Phát hiện muộn hơn — lúc kéo — thì không còn đường nào sửa,
    //   vì `floor_oildrop` đã nướng vào hash của `reserve_gate`.
    //
    // ⚠ RESIDUAL (validator KHÔNG tự bảo đảm): `reserve_gate` nướng `auth_policy` (= policy-id
    //   của chính validator này), nên validator này KHÔNG thể nướng ngược `gate_script_hash`
    //   — vòng apply-param. Hệ quả: nếu người vận hành truyền `floor_oildrop = 5` vào đây và
    //   `= 0` vào `reserve_gate` thì hai script vẫn đúc ra được và gate vẫn chết. Đây đúng
    //   hạng nguy hiểm "cặp tham số phải trùng" đã ghi ở `reserve_draw.ak` (khối `kho_nft_*`):
    //   không tầng nào báo, cả hai vẫn xanh. Cả hai giá trị PHẢI lấy từ MỘT biến cấu hình.
    expect floor_oildrop > 0

    // ── ONE-SHOT: consume đúng UTxO genesis (1 lần duy nhất trong lịch sử chain) ──
    expect list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })

    // ── Đúng 1 asset name của policy này (chống đúc kèm name lạ cùng policy) ──
    let own_tokens = assets.tokens(tx.mint, policy_id)
    expect dict.size(own_tokens) == 1

    // ── Đúng (auth_name, +1): name khớp param, qty đúng 1 (không hơn, không âm) ──
    expect assets.quantity_of(tx.mint, policy_id, auth_name) == 1

    True
  }

  // BURN + mọi purpose khác → CẤM (chống đốt/đúc lại auth credential).
  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Tests (≥4)
// ══════════════════════════════════════════════════════════════

const pol: PolicyId = #"a1a1"

// auth_name = "TPULL" (Treasury-pull) hex.
const auth_nm: ByteArray = #"5450554c4c"

fn g_ref() -> OutputReference {
  OutputReference { transaction_id: #"bb", output_index: 3 }
}

fn other_ref() -> OutputReference {
  OutputReference { transaction_id: #"cc", output_index: 0 }
}

fn vk_addr(pkh: ByteArray) -> Address {
  Address {
    payment_credential: VerificationKey(pkh),
    stake_credential: None,
  }
}

fn mk_input(ref: OutputReference) -> Input {
  Input {
    output_reference: ref,
    output: Output {
      address: vk_addr(#"a0"),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

// SÀN hợp lệ dùng cho mọi ca kiểm cũ (dương) — đối chứng dương của A-FLOOR-1.
const floor_ok: Int = 100

fn run(redeemer: ReserveAuthRedeemer, mint: Value, inputs: List<Input>) -> Bool {
  run_with_floor(floor_ok, redeemer, mint, inputs)
}

/// Biến thể cho phép đổi RIÊNG `floor_oildrop` — mọi vế khác giữ nguyên hình dạng happy,
/// nên ca âm của A-FLOOR-1 trung lập hoá đúng mọi cổng đứng SAU nó (one-shot, đúng-1-name,
/// đúng-qty-1). Đó là điều kiện để ca âm đo đúng cổng mang tên nó thay vì chết ở hàng xóm.
fn run_with_floor(
  floor    : Int,
  redeemer : ReserveAuthRedeemer,
  mint     : Value,
  inputs   : List<Input>,
) -> Bool {
  reserve_auth.mint(
    g_ref(),
    auth_nm,
    floor,
    redeemer,
    pol,
    Transaction { ..placeholder, inputs: inputs, mint: mint },
  )
}

/// tx đúc chuẩn (hợp lệ ở MỌI cổng khác) — chỉ `floor` thay đổi giữa các ca A-FLOOR-1.
fn happy_mint() -> Value {
  assets.zero |> assets.add(pol, auth_nm, 1)
}

// ── HAPPY ────────────────────────────────────────────────────

test auth_happy_mint_one() {
  // Consume genesis + đúc đúng 1 (auth_name, +1) → pass.
  let mint = assets.zero |> assets.add(pol, auth_nm, 1)
  run(MintAuth, mint, [mk_input(g_ref())])
}

// ── NEGATIVE ─────────────────────────────────────────────────

test auth_reject_no_genesis() fail {
  // KHÔNG consume genesis_ref → one-shot reject (không thể đúc nếu thiếu genesis).
  let mint = assets.zero |> assets.add(pol, auth_nm, 1)
  run(MintAuth, mint, [mk_input(other_ref())])
}

test auth_reject_qty_two() fail {
  // Đúc qty 2 (không phải đúng 1) → reject (quantity_of == 1 sai).
  let mint = assets.zero |> assets.add(pol, auth_nm, 2)
  run(MintAuth, mint, [mk_input(g_ref())])
}

test auth_reject_extra_name() fail {
  // Đúc kèm asset name lạ cùng policy (dict.size == 2 ≠ 1) → reject.
  let mint =
    assets.zero
      |> assets.add(pol, auth_nm, 1)
      |> assets.add(pol, #"dead", 1)
  run(MintAuth, mint, [mk_input(g_ref())])
}

test auth_reject_wrong_name() fail {
  // Đúc đúng 1 token nhưng SAI name (≠ auth_name) → quantity_of(auth_name) == 0 → reject.
  let mint = assets.zero |> assets.add(pol, #"beef", 1)
  run(MintAuth, mint, [mk_input(g_ref())])
}

test auth_reject_burn() fail {
  // Burn (qty âm) → quantity_of(auth_name) == -1 ≠ 1 → reject (cấm đốt auth).
  let mint = assets.zero |> assets.add(pol, auth_nm, -1)
  run(MintAuth, mint, [mk_input(g_ref())])
}

// ── A-FLOOR-1: SÀN phải DƯƠNG ────────────────────────────────
// Ba ca dưới khác nhau ĐÚNG MỘT biến: `floor_oildrop`. Mọi vế khác là hình dạng đúc hợp lệ,
// nên chúng phân biệt được hai bên đột biến (gỡ `expect floor_oildrop > 0` ⟹ hai ca âm
// chuyển thành đúc HỢP LỆ ⟹ bài `fail` đỏ tại đúng tên nó).

test auth_floor_positive_mints() {
  // ĐỐI CHỨNG DƯƠNG: sàn dương + tx đúc hợp lệ → pass. Nếu thiếu ca này thì hai ca âm
  // dưới không chứng minh được cổng đang đo SÀN chứ không đo thứ khác.
  run_with_floor(1, MintAuth, happy_mint(), [mk_input(g_ref())])
}

test auth_reject_floor_zero() fail {
  // floor_oildrop == 0: `reserve_gate` ép `parked < 0` mà `parked >= 0` luôn đúng ⟹ auth NFT
  // không bao giờ rời gate ⟹ 9,63 tỷ LAMP Reserve không phát hành được. Chặn NGAY lúc đúc.
  run_with_floor(0, MintAuth, happy_mint(), [mk_input(g_ref())])
}

test auth_reject_floor_negative() fail {
  // floor_oildrop < 0: cùng hậu quả, và `> 0` bắt cả hai chiều (không so thiếu chiều).
  run_with_floor(-1, MintAuth, happy_mint(), [mk_input(g_ref())])
}
