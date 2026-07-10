// airdrop_nft — minting policy đúc POOL NFT + N claim-slot (SETUP one-shot) và
// BURN slot (lúc Claim/Sweep).
//
// ─────────────────────────────────────────────────────────────────────────
// VÌ SAO 1 POLICY NHIỀU TOKEN (POOL + SLOT)?
//   Pool validator nhận diện chính nó qua "POOL NFT cùng airdrop_nft_policy".
//   Mỗi leaf có 1 claim-slot NFT (name = leaf) đúc cùng policy. Dùng CHUNG 1
//   policy id → pool + marker chỉ cần 1 param `airdrop_nft_policy` (tính từ
//   genesis_ref ở deploy). KHÔNG hash-param chéo → KHÔNG vòng tròn.
//
// ─────────────────────────────────────────────────────────────────────────
// MintPool (Constr 0) — SETUP one-shot:
//   Đúc POOL NFT (qty 1) + toàn bộ N claim-slot (mỗi leaf name qty 1). One-shot:
//   tx ĐẦU consume genesis_ref (1 UTxO spend ≤ 1 lần → SETUP chạy ≤ 1 lần) → POOL
//   supply = 1 + mỗi leaf slot qty 1 VĨNH VIỄN. Slot tiêu rồi KHÔNG tái sinh
//   (re-mint đòi genesis_ref đã bị tiêu) → SPEND-ONCE tuyệt đối.
//
//   N LỚN VƯỢT 1 TX (giới hạn tx size): SETUP chia nhiều tx.
//     · Tx ĐẦU: consume genesis_ref → đúc POOL NFT + SETUP authority token
//       (setup_authority_name, qty 1) + lô slot đầu. (Có genesis_ref ⇒ bỏ qua
//       đòi authority.)
//     · Tx GIỮA: KHÔNG có genesis_ref → đòi SETUP authority token làm INPUT (ủy
//       quyền tiếp tục SETUP) + giữ lại authority ở output (qty mint authority 0).
//       Chỉ đúc thêm slot (KHÔNG đúc POOL NFT lần nữa: qty POOL == 0).
//     · Tx CUỐI: đòi authority input, BURN authority (qty mint authority -1) →
//       đóng SETUP. Sau đó KHÔNG tx nào đúc thêm slot được (không genesis, không
//       authority).
//   Bản kiểm onchain cho MintPool ép cấu trúc tối thiểu + bất biến one-shot; phân
//   bổ leaf cụ thể (đúng N slot, không trùng name) do deployBuilder off-chain dựng
//   tất định từ snapshot (cây Merkle cố định) — onchain ép POOL qty + KHÔNG đúc
//   POOL khi đã có authority (chống đúc POOL NFT thứ 2).
//
//   MÔ HÌNH TIN CẬY (nói thật): SETUP INTEGRITY (đúc đúng 1 slot/leaf, không trùng,
//   đủ N) = DEPLOYER-TRUSTED — committee dựng tất định off-chain, onchain không liệt
//   kê từng leaf. CHỐNG DOUBLE-CLAIM phía CLAIMER = TRUSTLESS on-chain qua 2 khoá:
//   spend-once (one-shot, burn lúc claim) + GATE claimed_count == 0 (mọi tx đúc slot
//   — genesis lẫn continuation — tham chiếu POOL UTxO, ép claimed_count == 0). Burn
//   slot chỉ xảy ra lúc claim (count↑); nên sau khi claim mở (count>0) KHÔNG AI đúc
//   lại được slot đã burn, kể cả kẻ cầm authority. Continuation thêm: cấm re-mint
//   authority. YÊU CẦU VẬN HÀNH: committee PHẢI BURN authority token TRƯỚC khi mở claim.
//
// BurnSlot (Constr 1, GIỮ index để codec offchain không lệch) — Claim/Sweep:
//   Ép quantity_of(mint, policy, name) == -1 cho slot bị tiêu (≥1 slot burn), có
//   POOL NFT input (pool ủy quyền), KHÔNG đụng POOL NFT (qty POOL == 0). KHÔNG đúc
//   bất kỳ token policy này (mọi qty ≤ 0) → chống "tái tạo slot" trong tx claim.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{Input, Output, OutputReference, Transaction, placeholder}
use magiclamp/airdrop/ledger.{
  AirdropNftRedeemer, AirdropPool, BurnSlot, MintPool, pool_nft_name,
  setup_authority_name,
}
use magiclamp/airdrop/util

validator airdrop_nft(genesis_ref: OutputReference) {
  mint(redeemer: AirdropNftRedeemer, policy_id: PolicyId, tx: Transaction) {
    when redeemer is {
      // ── MintPool: SETUP one-shot (POOL + N slot) ──────────────────────
      MintPool -> {
        let has_genesis =
          list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })
        let has_authority_in =
          util.count_inputs_with_nft(
            tx.inputs,
            policy_id,
            setup_authority_name,
          ) >= 1
        // Ủy quyền SETUP: hoặc tx ĐẦU (genesis_ref), hoặc tx tiếp (authority input).
        expect has_genesis || has_authority_in

        let pool_minted = assets.quantity_of(tx.mint, policy_id, pool_nft_name)
        if has_genesis {
          // Tx ĐẦU (genesis): đúc đúng 1 POOL NFT (one-shot). Authority (nếu N lớn)
          // đúc kèm: qty 0 (single-tx) hoặc +1 (multi-tx). KHÔNG ép số slot ở đây —
          // deployBuilder dựng tất định từ snapshot.
          expect pool_minted == 1
          // KHOÁ TRUSTLESS phía CLAIMER: pool VỪA TẠO ở output này PHẢI có
          // claimed_count == 0 (mọi đúc slot chỉ xảy ra khi pool chưa ai claim).
          // Tự thoả ở genesis (pool khởi tạo count=0) — ép tường minh để bất biến
          // đồng nhất với nhánh continuation, chống deployer khởi tạo count lệch.
          let pool_out =
            util.output_with_nft(tx.outputs, policy_id, pool_nft_name)
          expect util.output_claimed_count(pool_out) == 0
          True
        } else {
          // Tx tiếp (authority input): KHÔNG đúc POOL NFT lần nữa (chống POOL thứ 2).
          expect pool_minted == 0
          // CHỐNG RE-MINT AUTHORITY: continuation KHÔNG BAO GIỜ đúc thêm authority
          // token (chỉ tx genesis đúc authority; sau đó chỉ luân chuyển/burn). Nếu
          // cho đúc thêm → kẻ tấn công tự cấp authority mới sau khi committee burn.
          expect
            assets.quantity_of(tx.mint, policy_id, setup_authority_name) <= 0
          // KHOÁ TRUSTLESS phía CLAIMER (vá LỖ HỔNG HIGH): pool đã tồn tại →
          // tham chiếu nó (input hoặc reference_input) + ép claimed_count == 0.
          // Burn slot CHỈ xảy ra lúc claim (claimed_count tăng ≥1). Nếu cấm đúc khi
          // claimed_count > 0 thì slot ĐÃ BURN không bao giờ tái sinh — dù kẻ tấn
          // công cầm authority UTxO đúc lại tên = leaf đã burn → reject. Khép kín
          // double-claim phía public KHÔNG cần tin committee sau khi claim mở.
          let pool_out =
            util.pool_from_inputs_or_refs(
              tx.inputs,
              tx.reference_inputs,
              policy_id,
              pool_nft_name,
            )
          expect util.output_claimed_count(pool_out) == 0
          True
        }
      }

      // ── BurnSlot: tiêu + burn slot (Claim/Sweep) ──────────────────────
      BurnSlot -> {
        // Tx phải có POOL NFT input → pool đang spend → pool đã verify proof/deadline.
        expect
          util.count_inputs_with_nft(tx.inputs, policy_id, pool_nft_name) >= 1
        // KHÔNG đụng POOL NFT (pool NFT chỉ luân chuyển, bất biến).
        expect assets.quantity_of(tx.mint, policy_id, pool_nft_name) == 0
        // KHÔNG đúc (qty > 0) BẤT KỲ token policy này — chỉ burn (qty < 0). Chống
        // "tái tạo slot" hay đúc authority/POOL chen trong tx claim.
        let own_tokens = assets.tokens(tx.mint, policy_id)
        expect
          dict.foldr(
            own_tokens,
            True,
            fn(_name, qty, acc) { acc && qty < 0 },
          )
        // Ít nhất 1 slot bị burn (tx claim luôn tiêu ≥1 slot).
        expect dict.size(own_tokens) >= 1
        True
      }
    }
  }

  else(_) {
    fail
  }
}

// ══════════════════════════════════════════════════════════════
// Validator tests (mock Transaction)
// ══════════════════════════════════════════════════════════════

const an_policy: PolicyId = #"facef00d"

const an_leaf: ByteArray = #"abcdef01"

const an_leaf2: ByteArray = #"abcdef02"

fn an_genesis_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 5 }
}

fn an_genesis_input() -> Input {
  util.mk_input(
    an_genesis_ref(),
    util.mk_output_no_datum(
      util.vk_address(#"a0"),
      assets.from_lovelace(2_000_000),
    ),
  )
}

fn an_other_input() -> Input {
  util.mk_input(
    util.mk_ref(0),
    util.mk_output_no_datum(
      util.vk_address(#"a0"),
      assets.from_lovelace(2_000_000),
    ),
  )
}

/// Input mang POOL NFT (pool đang spend).
fn an_pool_input() -> Input {
  let v =
    assets.from_lovelace(5_000_000) |> assets.add(an_policy, pool_nft_name, 1)
  util.mk_input(
    util.mk_ref(1),
    util.mk_output_no_datum(util.vk_address(#"b0"), v),
  )
}

// ── Pool datum / output / reference (cho gate claimed_count == 0) ──
const an_pool_sh: ByteArray = #"facade"

const an_marker_sh: ByteArray = #"5a5a5a5a"

const an_treasury_sh: ByteArray = #"77777777"

fn an_pool_datum(count: Int) -> AirdropPool {
  AirdropPool {
    merkle_root: #"abcd",
    deadline_epoch: 500,
    treasury_dest: util.script_address(an_treasury_sh),
    marker_dest: util.script_address(an_marker_sh),
    claimed_count: count,
  }
}

/// POOL UTxO output (POOL NFT + datum claimed_count) — genesis tạo pool ở output.
fn an_pool_output(count: Int) -> Output {
  let v =
    assets.from_lovelace(5_000_000) |> assets.add(an_policy, pool_nft_name, 1)
  util.mk_output(util.script_address(an_pool_sh), v, an_pool_datum(count))
}

/// POOL UTxO làm input mang datum claimed_count (continuation tham chiếu pool).
fn an_pool_input_with_count(count: Int) -> Input {
  let v =
    assets.from_lovelace(5_000_000) |> assets.add(an_policy, pool_nft_name, 1)
  util.mk_input(
    util.mk_ref(1),
    util.mk_output(util.script_address(an_pool_sh), v, an_pool_datum(count)),
  )
}

/// Input mang SETUP authority token.
fn an_authority_input() -> Input {
  let v =
    assets.from_lovelace(2_000_000)
      |> assets.add(an_policy, setup_authority_name, 1)
  util.mk_input(
    util.mk_ref(7),
    util.mk_output_no_datum(util.vk_address(#"c0"), v),
  )
}

fn an_mint(name: ByteArray, qty: Int) -> Value {
  assets.zero |> assets.add(an_policy, name, qty)
}

// ── MintPool / SETUP ─────────────────────────────────────────────

test an_mint_pool_happy() {
  // SETUP 1 tx: genesis + đúc POOL NFT + 2 slot (single-tx). Pool output count=0.
  let mint =
    assets.zero
      |> assets.add(an_policy, pool_nft_name, 1)
      |> assets.add(an_policy, an_leaf, 1)
      |> assets.add(an_policy, an_leaf2, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_other_input(), an_genesis_input()],
      outputs: [an_pool_output(0)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test mint_pool_reject_genesis_count_nonzero() fail {
  // genesis nhưng pool output khởi tạo claimed_count != 0 → reject (bất biến gate).
  let mint =
    assets.zero
      |> assets.add(an_policy, pool_nft_name, 1)
      |> assets.add(an_policy, an_leaf, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_genesis_input()],
      outputs: [an_pool_output(3)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test mint_slots_requires_genesis() fail {
  // Đúc POOL + slot mà KHÔNG có genesis_ref VÀ KHÔNG có authority input → reject.
  let mint =
    assets.zero
      |> assets.add(an_policy, pool_nft_name, 1)
      |> assets.add(an_policy, an_leaf, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_other_input()],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test an_mint_pool_wrong_pool_qty() fail {
  // genesis có nhưng đúc POOL NFT qty 2 → reject (POOL one-shot qty 1).
  let mint =
    assets.zero |> assets.add(an_policy, pool_nft_name, 2)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_genesis_input()],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test mint_setup_continuation_with_authority() {
  // Tx GIỮA SETUP: không genesis, có authority input, pool input count=0, KHÔNG đúc
  // POOL, đúc thêm slot. (Gate claimed_count == 0 thoả → cho đúc tiếp.)
  let mint = an_mint(an_leaf2, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_authority_input(), an_pool_input_with_count(0)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test mint_setup_continuation_pool_via_reference() {
  // Continuation tham chiếu pool qua REFERENCE INPUT (không tiêu pool) — vẫn đọc
  // được claimed_count == 0 → cho đúc thêm slot.
  let mint = an_mint(an_leaf2, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_authority_input()],
      reference_inputs: [an_pool_input_with_count(0)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test mint_setup_continuation_reject_second_pool() fail {
  // Tx tiếp (authority input) MƯU đúc POOL NFT thứ 2 → reject (pool_minted phải 0).
  let mint =
    assets.zero
      |> assets.add(an_policy, pool_nft_name, 1)
      |> assets.add(an_policy, an_leaf2, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_authority_input(), an_pool_input_with_count(0)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

// ── VÁ LỖ HỔNG HIGH: gate claimed_count + cấm re-mint authority ────

test mint_slot_reject_resurrect_via_authority_after_claim() fail {
  // KỊCH BẢN TẤN CÔNG: claim đã mở (claimed_count > 0). Kẻ cầm authority UTxO MƯU
  // đúc lại slot tên = leaf ĐÃ BURN để double-claim. Gate ép claimed_count == 0 →
  // reject. Đây là khoá trustless khép kín phía CLAIMER.
  let mint = an_mint(an_leaf, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_authority_input(), an_pool_input_with_count(1)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test mint_authority_reject_remint() fail {
  // Continuation MƯU đúc THÊM authority token (tự cấp authority mới sau khi committee
  // dự định burn) → quantity_of(authority) > 0 → reject.
  let mint =
    assets.zero
      |> assets.add(an_policy, an_leaf2, 1)
      |> assets.add(an_policy, setup_authority_name, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_authority_input(), an_pool_input_with_count(0)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

test mint_authority_allow_burn() {
  // Continuation tx CUỐI: burn authority (-1) đóng SETUP, đúc thêm slot, count==0
  // → hợp lệ (quantity_of(authority) <= 0 thoả).
  let mint =
    assets.zero
      |> assets.add(an_policy, an_leaf2, 1)
      |> assets.add(an_policy, setup_authority_name, -1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_authority_input(), an_pool_input_with_count(0)],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), MintPool, an_policy, tx)
}

// ── BurnSlot ─────────────────────────────────────────────────────

test an_burn_slot_happy() {
  // có POOL input → burn slot leaf (-1) hợp lệ.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_pool_input()],
      mint: an_mint(an_leaf, -1),
    }
  airdrop_nft.mint(an_genesis_ref(), BurnSlot, an_policy, tx)
}

test burn_slot_requires_pool_input() fail {
  // burn slot mà KHÔNG có POOL NFT input → không ai ủy quyền → reject.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_other_input()],
      mint: an_mint(an_leaf, -1),
    }
  airdrop_nft.mint(an_genesis_ref(), BurnSlot, an_policy, tx)
}

test mint_slot_reject_resurrect_after_burn() fail {
  // MƯU "tái sinh" slot qua BurnSlot: đúc lại 1 slot (qty +1) chen vào → reject
  // (BurnSlot cấm mọi qty > 0). One-shot SETUP đã đóng (genesis tiêu) nên đây là
  // đường duy nhất kẻ tấn công có POOL input — và nó bị chặn.
  let mint =
    assets.zero
      |> assets.add(an_policy, an_leaf, -1)
      |> assets.add(an_policy, an_leaf2, 1)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [an_pool_input()],
      mint: mint,
    }
  airdrop_nft.mint(an_genesis_ref(), BurnSlot, an_policy, tx)
}

test an_burn_slot_touches_pool_nft() fail {
  // MƯU burn POOL NFT qua BurnSlot → quantity_of(POOL) != 0 → reject.
  let mint =
    assets.zero
      |> assets.add(an_policy, an_leaf, -1)
      |> assets.add(an_policy, pool_nft_name, -1)
  let tx =
    Transaction { ..placeholder, inputs: [an_pool_input()], mint: mint }
  airdrop_nft.mint(an_genesis_ref(), BurnSlot, an_policy, tx)
}
