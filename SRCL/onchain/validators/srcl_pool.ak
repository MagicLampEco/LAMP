// srcl_pool — UTxO kho LAMP + POOL NFT cho SRCL reward-redirect.
//
// ─────────────────────────────────────────────────────────────────────────
// PARAM (KHÔNG hash-param chéo — xem types.ak)
//   srcl_nft_policy   : policy id đúc POOL + SLOT NFT. Tính từ genesis_ref ở
//                       deploy. Pool tham chiếu param này → KHÔNG vòng tròn.
//   lamp_policy       : policy id LAMP.
//   lamp_name         : asset name LAMP.
//   admin             : List pkh admin (SetRoot cần ngưỡng admin_threshold).
//   admin_threshold   : số chữ ký admin tối thiểu để SetRoot.
//   slot_registry_hash: script hash của srcl_marker (registry GIỮ claim-slot).
//                       PARAM MỚI (≠ datum → KHÔNG phá interface contract; chấp
//                       nhận đổi địa chỉ deploy pool). Pool ép Claim consume slot
//                       TỪ registry này; SetRoot ép gửi bộ slot VÀO registry này.
//   campaign_id       : 32-byte blake2b_256(tên_chiến_dịch) — BAKE vào leaf (schema
//                       C). Cô lập proof theo chiến dịch: pot campaign khác KHÔNG
//                       chia sẻ leaf hợp lệ. Xem lib/merkle.ak §SCHEMA C.
//   role              : 1-byte vai (SPO/SRCL = 4, spec §1 — CẤM đổi số). BAKE vào
//                       leaf → cô lập proof theo vai trong cùng chiến dịch.
//
// ─────────────────────────────────────────────────────────────────────────
// 3 REDEEMER
//   SetRoot{root} — admin nạp Merkle root cho epoch KẾ TIẾP (append epoch_roots)
//                   + đúc BỘ SLOT (1 slot/owner của root mới) gửi vào registry.
//                   pool.value bảo toàn TUYỆT ĐỐI (không rút LAMP). Chỉ epoch_roots
//                   tăng đúng 1 phần tử; field khác bất biến.
//   Claim{claim}  — delegator chứng minh (epoch, owner, amount) ∈ root[epoch] qua
//                   Merkle proof → owner nhận đúng `amount` LAMP. CHỐNG DOUBLE-CLAIM
//                   phía claimer: consume + BURN slot (epoch,owner) TỪ registry
//                   (spend-once). distributed_total += amount. pool.value = in − amount LAMP.
//   Sweep         — sau end_epoch: quét LAMP dư về Treasury (treasury_dest). POOL NFT
//                   + epoch_roots + sổ bất biến (pool đóng băng); LAMP còn lại → Treasury.
//
// ─────────────────────────────────────────────────────────────────────────
// CHỐNG DOUBLE-CLAIM per (epoch, owner) — CLAIM-SLOT spend-once
//   marker_name = blake2b_256(epoch_be8 || owner) (merkle.marker_name) = tên slot.
//   SetRoot epoch e đúc bộ slot {(srcl_nft_policy, marker_name(e,owner)) : owner ∈ e}
//   gửi vào Script(slot_registry_hash). Claim ép: consume ĐÚNG slot (epoch,owner)
//   từ registry + BURN nó (mint qty −1).
//
//   TRUSTLESS phía CLAIMER (mạnh): với bộ slot CHO TRƯỚC, slot tiêu 1 lần là HẾT
//   → claimer KHÔNG claim lại được cặp (epoch,owner) đã burn. Tính duy-nhất này
//   dựa SPEND-ONCE của ledger eUTxO — ĐỘC LẬP indexer off-chain.
//
// ─────────────────────────────────────────────────────────────────────────
// §GIỚI HẠN — slot-set integrity là ADMIN-THRESHOLD-TRUSTED, KHÔNG trustless tuyệt đối
//   On-chain SetRoot CHỈ ép: slot không rò ra ngoài registry (policy_qty_outside
//   _script == 1) + không đụng POOL NFT. KHÔNG ép tên slot mã hoá đúng `epoch`
//   đang append, cũng KHÔNG ép bộ slot khớp đúng leaf của root.
//
//   HỆ QUẢ: admin đủ ngưỡng, NẾU cấu kết, tại SetRoot epoch sau CÓ THỂ đúc lại
//   slot tên = marker_name(epoch_cũ, owner) đã burn (MintSlots chỉ đòi POOL input
//   + qty>0; pool chỉ đòi slot vào registry). → tái tạo nullifier đã cháy → mở lại
//   double-claim epoch cũ. Vậy double-claim KHÔNG bị chặn TUYỆT ĐỐI; nó bị chặn
//   Ở MỨC tin cậy admin-threshold — CÙNG mức tin cậy vốn đã cần để nạp root đúng.
//
//   VÌ SAO KHÔNG SIẾT RẺ ON-CHAIN: tên slot = blake2b_256(epoch||owner) là HASH;
//   validator KHÔNG có preimage (epoch, owner) ⇒ không kiểm được rẻ "tên này thuộc
//   epoch đang append". Truyền danh sách owner qua redeemer thì phải re-hash mọi
//   owner trên-chain (đắt ExUnit) MÀ vẫn không chứng minh được danh sách khớp leaf
//   của root (leaf còn nhúng amount). Không có đại lượng rẻ để neo bộ slot vào
//   epoch. Mọi siết "giả" chỉ tạo ảo giác an toàn → KHÔNG làm. Test
//   `setroot_remint_burned_slot_admin_trusted` minh hoạ giả định này.

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference,
  Transaction, placeholder}
use magiclamp/srcl/merkle
use magiclamp/srcl/types.{
  Claim, ClaimProof, SrclDatum, SrclRedeemer, MerkleStep, SetRoot, Sweep,
  pool_nft_name,
}
use magiclamp/srcl/util

validator srcl_pool(
  srcl_nft_policy: ByteArray,
  lamp_policy: ByteArray,
  lamp_name: ByteArray,
  admin: List<ByteArray>,
  admin_threshold: Int,
  slot_registry_hash: ByteArray,
  campaign_id: ByteArray,
  role: Int,
) {
  spend(
    datum_opt: Option<SrclDatum>,
    redeemer: SrclRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d) = datum_opt

    // Đúng 1 POOL input + 1 POOL output theo POOL NFT (authenticity, chống
    // double-satisfaction). Pool chính danh = pool mang POOL NFT.
    expect util.count_inputs_with_nft(tx.inputs, srcl_nft_policy, pool_nft_name) == 1

    let pool_in = util.input_with_nft(tx.inputs, srcl_nft_policy, pool_nft_name)

    // own_ref phải TRỎ chính pool input (chống spoof own_ref).
    let own_addr = util.own_address(own_ref, tx.inputs)
    expect own_addr == pool_in.address

    let lamp_in = assets.quantity_of(pool_in.value, lamp_policy, lamp_name)

    when redeemer is {
      // ── SETROOT (admin nạp root epoch kế tiếp) ────────────────────────
      SetRoot { root } -> {
        expect util.count_outputs_with_nft(tx.outputs, srcl_nft_policy, pool_nft_name) == 1
        let pool_out = util.output_with_nft(tx.outputs, srcl_nft_policy, pool_nft_name)
        expect InlineDatum(od) = pool_out.datum
        expect out_d: SrclDatum = od

        // Ngưỡng admin.
        expect util.count_committee_sigs(admin, tx.extra_signatories) >= admin_threshold

        // pool.value bảo toàn TUYỆT ĐỐI (SetRoot không đụng LAMP/ADA/NFT).
        expect pool_out.value == pool_in.value

        // epoch_roots tăng đúng 1 phần tử (append root ở CUỐI). Field khác bất biến.
        expect out_d.epoch_roots == list.concat(d.epoch_roots, [root])
        expect out_d.distributed_total == d.distributed_total
        expect out_d.end_epoch == d.end_epoch
        expect out_d.treasury_dest == d.treasury_dest
        expect out_d.ms_per_epoch == d.ms_per_epoch

        // Không vượt 36 epoch (0..end_epoch) → tối đa end_epoch+1 root.
        expect list.length(out_d.epoch_roots) <= d.end_epoch + 1

        // ── ĐÚC BỘ SLOT cho epoch mới, gửi VÀO registry ──────────────────
        // KHÔNG đúc/burn POOL NFT (POOL bất biến — chỉ luân chuyển ở pool_out).
        expect assets.quantity_of(tx.mint, srcl_nft_policy, pool_nft_name) == 0
        // Slot KHÔNG được rò rỉ ra ngoài registry: tổng token srcl_nft_policy ở
        // mọi output NGOÀI registry == ĐÚNG 1 (= POOL NFT ở pool_out, đã chốt
        // pool_out.value == pool_in.value ⇒ chứa đúng 1 POOL NFT). Mọi slot mới
        // PHẢI nằm ở Script(slot_registry_hash) → admin không thể tuồn slot ra ví.
        //
        // GIỚI HẠN (xem header §GIỚI HẠN): on-chain KHÔNG kiểm tên slot khớp epoch
        // đang append (tên là hash, không có preimage). Việc bộ slot đúng leaf của
        // root + KHÔNG re-mint slot epoch cũ đã burn = TIN CẬY admin-threshold (ép
        // bởi `count_committee_sigs >= admin_threshold` ở trên), KHÔNG ép on-chain.
        expect
          util.policy_qty_outside_script(
            tx.outputs, srcl_nft_policy, slot_registry_hash,
          ) == 1
        True
      }

      // ── CLAIM (delegator nhận LAMP epoch e) ───────────────────────────
      Claim { claim } -> {
        let ClaimProof { epoch, owner, amount, proof } = claim
        expect amount > 0
        expect epoch >= 0

        expect util.count_outputs_with_nft(tx.outputs, srcl_nft_policy, pool_nft_name) == 1
        let pool_out = util.output_with_nft(tx.outputs, srcl_nft_policy, pool_nft_name)
        expect InlineDatum(od) = pool_out.datum
        expect out_d: SrclDatum = od

        // root của epoch lấy từ epoch_roots[epoch]. Phải đã được admin nạp.
        expect Some(root) = util.list_at(d.epoch_roots, epoch)

        // Merkle: (campaign_id, epoch, role, owner, amount) ∈ root[epoch].
        // campaign_id + role BAKE (param) → proof pot khác campaign/role KHÔNG khớp.
        expect merkle.verify(root, campaign_id, epoch, role, owner, amount, proof)

        // pool.value = pool_in − amount LAMP (giữ POOL NFT + ADA + asset khác).
        expect
          pool_out.value == assets.add(pool_in.value, lamp_policy, lamp_name, -amount)

        // owner nhận ≥ amount LAMP (ví owner = VerificationKey(owner)).
        expect util.lamp_to_owner(tx.outputs, owner, lamp_policy, lamp_name) >= amount

        // Sổ kế toán: distributed_total += amount; epoch_roots + cấu hình bất biến.
        expect out_d.epoch_roots == d.epoch_roots
        expect out_d.distributed_total == d.distributed_total + amount
        expect out_d.end_epoch == d.end_epoch
        expect out_d.treasury_dest == d.treasury_dest
        expect out_d.ms_per_epoch == d.ms_per_epoch

        // CHỐNG DOUBLE-CLAIM phía claimer (epoch,owner): consume + BURN claim-slot.
        // slot name = marker_name(epoch,owner) — ĐÚNG cặp này, chống dùng slot
        // owner/epoch khác. Slot PHẢI đến từ registry (Script(slot_registry_hash))
        // → chống slot tự chế ở ví bất kỳ. ĐÚNG 1 slot consume. (Tính duy-nhất chỉ
        // mạnh khi bộ slot KHÔNG bị admin re-mint — xem header §GIỚI HẠN.)
        let sname = merkle.marker_name(epoch, owner)
        expect
          util.count_inputs_with_nft_at_script(
            tx.inputs, srcl_nft_policy, sname, slot_registry_hash,
          ) == 1
        // BURN slot (qty −1) → spend-once: claim-2 KHÔNG còn slot (trừ khi admin
        // re-mint, §GIỚI HẠN). KHÔNG tái đúc trong tx này.
        expect assets.quantity_of(tx.mint, srcl_nft_policy, sname) == -1

        // KHÔNG đúc/burn POOL NFT (POOL bất biến). Slot là token DUY NHẤT chạm tx.mint.
        expect assets.quantity_of(tx.mint, srcl_nft_policy, pool_nft_name) == 0
        True
      }

      // ── SWEEP (sau end_epoch → LAMP dư về Treasury) ───────────────────
      Sweep -> {
        // now > end_epoch (cận dưới validity_range → chỉ quét khi CHẮC hết SRCL).
        let now = util.get_epoch(tx, d.ms_per_epoch)
        expect now > d.end_epoch

        // Toàn bộ LAMP còn trong pool → Treasury (treasury_dest, Script). POOL NFT
        // KHÔNG cần re-output (pool có thể đóng); chỉ ép LAMP về đúng đích.
        expect
          util.lamp_to_script(tx.outputs, d.treasury_dest, lamp_policy, lamp_name) >= lamp_in
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

const ip_nft_policy: ByteArray = #"15f00d"

const ip_lamp_policy: ByteArray = #"1a3b"

const ip_lamp_name: ByteArray = #"4c414d50"

const ip_pool_sh: ByteArray = #"facade"

const ip_registry_sh: ByteArray = #"5e9157"

const ip_admin: List<ByteArray> = [#"ad01", #"ad02", #"ad03"]

const ip_admin_threshold: Int = 2

const ip_treasury: ByteArray = #"7a7a7a7a"

const ip_mspe: Int = 432_000_000

const ip_end_epoch: Int = 35

// campaign_id + role (schema C) BAKE làm param pool. campaign_id = blake2b_256(
// "LAMP-SRCL-1"); role SPO/SRCL = 4 (spec §1).
const ip_campaign_id: ByteArray =
  #"5286f2c03f9f7c8b4e0d7da40f325ed5ecdc5d3eaf858efaf297aaefa6f1aedd"

const ip_role: Int = 4

// owner A/B (payment key-hash — spec §3.1; payout so payment_credential).
const owner_a: ByteArray = #"0a0a"

const owner_b: ByteArray = #"0b0b"

// ── Merkle fixtures (cây 2 leaf cho epoch 0) ──────────────────────
// L0 = leaf(cid,0,role,owner_a,1000); L1 = leaf(cid,0,role,owner_b,2000).
// root0 = node(L0,L1). proof(A) = [L1 phải]; proof(B) = [L0 trái].

fn leaf_a() -> ByteArray {
  merkle.leaf_hash(ip_campaign_id, 0, ip_role, owner_a, 1000)
}

fn leaf_b() -> ByteArray {
  merkle.leaf_hash(ip_campaign_id, 0, ip_role, owner_b, 2000)
}

fn root0() -> ByteArray {
  merkle.node_hash(leaf_a(), leaf_b())
}

fn ip_datum(roots: List<ByteArray>, dist: Int) -> SrclDatum {
  SrclDatum {
    epoch_roots: roots,
    distributed_total: dist,
    end_epoch: ip_end_epoch,
    treasury_dest: ip_treasury,
    ms_per_epoch: ip_mspe,
  }
}

/// pool value: lovelace + POOL NFT + LAMP qty.
fn ip_pool_val(lovelace: Int, lamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(ip_nft_policy, pool_nft_name, 1)
    |> assets.add(ip_lamp_policy, ip_lamp_name, lamp)
}

// ── CLAIM tests ───────────────────────────────────────────────────
//
// Mô hình MỚI (slot spend-once): Claim consume + BURN claim-slot từ registry.
// claim_tx dựng: pool in/out + slot input (registry, mang slot NFT) + owner nhận
// LAMP (KHÔNG marker NFT) + mint = burn slot (−1).

/// burn slot NFT (epoch,owner) trong tx.mint với qty (mặc định −1 = burn).
fn slot_burn(epoch: Int, owner: ByteArray, qty: Int) -> assets.Value {
  assets.zero |> assets.add(ip_nft_policy, merkle.marker_name(epoch, owner), qty)
}

/// Slot UTxO ở 1 địa chỉ, mang đúng 1 slot NFT (epoch,owner).
fn slot_input(addr_hash: ByteArray, slot_name: ByteArray) -> Input {
  let v = assets.from_lovelace(2_000_000) |> assets.add(ip_nft_policy, slot_name, 1)
  util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.script_address(addr_hash), v))
}

/// Dựng tx Claim đầy đủ (slot từ registry, burn slot, owner nhận LAMP).
/// Tham số mở để test negative: slot_addr (đổi nguồn slot), slot_name (đổi tên
/// slot), burn_qty (đổi qty burn). consume_slot=False → bỏ hẳn slot input.
fn claim_tx_full(
  in_roots: List<ByteArray>,
  in_dist: Int,
  out_dist: Int,
  pool_lamp_in: Int,
  pool_lamp_out: Int,
  owner: ByteArray,
  owner_lamp_out: Int,
  slot_addr: ByteArray,
  slot_name: ByteArray,
  consume_slot: Bool,
  burn_qty: Int,
) -> Transaction {
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, pool_lamp_in), ip_datum(in_roots, in_dist)))
  let pool_out =
    util.mk_output(pool_addr, ip_pool_val(10_000_000, pool_lamp_out), ip_datum(in_roots, out_dist))
  let owner_val =
    assets.from_lovelace(2_000_000)
      |> assets.add(ip_lamp_policy, ip_lamp_name, owner_lamp_out)
  let owner_out = util.mk_output(util.vk_address(owner), owner_val, leaf_a())
  let inputs =
    if consume_slot {
      [pool_in, slot_input(slot_addr, slot_name)]
    } else {
      [pool_in]
    }
  Transaction {
    ..placeholder,
    inputs: inputs,
    outputs: [pool_out, owner_out],
    mint: slot_burn(0, owner, 0) |> assets.add(ip_nft_policy, slot_name, burn_qty),
  }
}

/// Dựng tx Claim HỢP LỆ chuẩn (slot đúng từ registry, burn −1).
fn claim_tx(
  in_roots: List<ByteArray>,
  in_dist: Int,
  out_dist: Int,
  epoch: Int,
  owner: ByteArray,
  pool_lamp_in: Int,
  pool_lamp_out: Int,
  owner_lamp_out: Int,
) -> Transaction {
  let sname = merkle.marker_name(epoch, owner)
  claim_tx_full(
    in_roots, in_dist, out_dist, pool_lamp_in, pool_lamp_out, owner,
    owner_lamp_out, ip_registry_sh, sname, True, -1,
  )
}

fn run_claim(in_d: SrclDatum, claim: ClaimProof, tx: Transaction) -> Bool {
  srcl_pool.spend(
    ip_nft_policy, ip_lamp_policy, ip_lamp_name, ip_admin, ip_admin_threshold,
    ip_registry_sh, ip_campaign_id, ip_role, Some(in_d), Claim { claim }, util.mk_ref(0), tx,
  )
}

fn proof_a() -> ClaimProof {
  ClaimProof {
    epoch: 0,
    owner: owner_a,
    amount: 1000,
    proof: [MerkleStep { hash: leaf_b(), left: False }],
  }
}

test claim_happy_epoch0() {
  // owner_a claim 1000 LAMP epoch 0 (slot từ registry, burn −1).
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 100_000, 99_000, 1000)
  run_claim(in_d, proof_a(), tx)
}

test claim_multi_epoch() {
  // Cùng owner_a claim ở 2 epoch khác nhau (0 và 1). Mỗi epoch slot riêng.
  let root1 = merkle.leaf_hash(ip_campaign_id, 1, ip_role, owner_a, 500)
  let roots = [root0(), root1]
  let in_d = ip_datum(roots, 0)
  let r0 =
    run_claim(in_d, proof_a(), claim_tx(roots, 0, 1000, 0, owner_a, 100_000, 99_000, 1000))
  let claim1 = ClaimProof { epoch: 1, owner: owner_a, amount: 500, proof: [] }
  let r1 =
    run_claim(in_d, claim1, claim_tx(roots, 0, 500, 1, owner_a, 100_000, 99_500, 500))
  r0 && r1
}

test claim_owner_b() {
  // owner_b claim 2000 LAMP epoch 0 (proof khác hướng, slot của B).
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let proof_b =
    ClaimProof {
      epoch: 0, owner: owner_b, amount: 2000,
      proof: [MerkleStep { hash: leaf_a(), left: True }],
    }
  let tx = claim_tx(roots, 0, 2000, 0, owner_b, 100_000, 98_000, 2000)
  run_claim(in_d, proof_b, tx)
}

test claim_amount_proportional() {
  // A có entitlement 1000, B có 2000 (tỷ lệ 1:2). Cả 2 claim đúng amount → pass.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let proof_b =
    ClaimProof {
      epoch: 0, owner: owner_b, amount: 2000,
      proof: [MerkleStep { hash: leaf_a(), left: True }],
    }
  let ra = run_claim(in_d, proof_a(), claim_tx(roots, 0, 1000, 0, owner_a, 100_000, 99_000, 1000))
  let rb = run_claim(in_d, proof_b, claim_tx(roots, 0, 2000, 0, owner_b, 100_000, 98_000, 2000))
  ra && rb
}

test claim_wrong_amount_rejected() fail {
  // sai amount (claim 1500 thay 1000) → leaf khác → root mismatch → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let bad =
    ClaimProof {
      epoch: 0, owner: owner_a, amount: 1500,
      proof: [MerkleStep { hash: leaf_b(), left: False }],
    }
  let tx = claim_tx(roots, 0, 1500, 0, owner_a, 100_000, 98_500, 1500)
  run_claim(in_d, bad, tx)
}

test claim_wrong_proof_rejected() fail {
  // proof sai (anh-em hash bịa) → root mismatch → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let bad =
    ClaimProof {
      epoch: 0, owner: owner_a, amount: 1000,
      proof: [MerkleStep { hash: #"deadbeef", left: False }],
    }
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 100_000, 99_000, 1000)
  run_claim(in_d, bad, tx)
}

test claim_reject_no_slot_consumed() fail {
  // KHÔNG consume slot (chỉ pool input, không slot input) → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let sname = merkle.marker_name(0, owner_a)
  let tx =
    claim_tx_full(roots, 0, 1000, 100_000, 99_000, owner_a, 1000, ip_registry_sh, sname, False, -1)
  run_claim(in_d, proof_a(), tx)
}

test claim_reject_slot_wrong_owner_epoch() fail {
  // slot consume là của (epoch,owner) KHÁC (owner_b) → name ≠ marker_name(0,A)
  // → count slot đúng tên == 0 → reject. (burn cũng theo tên sai.)
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let wrong_name = merkle.marker_name(0, owner_b)
  let tx =
    claim_tx_full(roots, 0, 1000, 100_000, 99_000, owner_a, 1000, ip_registry_sh, wrong_name, True, -1)
  run_claim(in_d, proof_a(), tx)
}

test claim_reject_slot_not_from_registry() fail {
  // slot đúng tên nhưng đến từ địa chỉ KHÁC registry (ví/script lạ) → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let sname = merkle.marker_name(0, owner_a)
  let tx =
    claim_tx_full(roots, 0, 1000, 100_000, 99_000, owner_a, 1000, #"badd00", sname, True, -1)
  run_claim(in_d, proof_a(), tx)
}

test claim_reject_slot_not_burned() fail {
  // slot consume từ registry nhưng KHÔNG burn (qty 0) → reject (spend-once
  // không thực thi: slot có thể bị tái tạo).
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let sname = merkle.marker_name(0, owner_a)
  let tx =
    claim_tx_full(roots, 0, 1000, 100_000, 99_000, owner_a, 1000, ip_registry_sh, sname, True, 0)
  run_claim(in_d, proof_a(), tx)
}

test claim_reject_redeem_same_epoch_owner_twice() fail {
  // Mưu toan double-claim TRONG 1 tx: 2 slot input cùng (epoch,owner) từ
  // registry → count_inputs_with_nft_at_script == 2 ≠ 1 → reject. (Spend-once
  // chặn double Ở 2 tx; đây chặn double trong cùng tx.)
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let sname = merkle.marker_name(0, owner_a)
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, 100_000), ip_datum(roots, 0)))
  let pool_out =
    util.mk_output(pool_addr, ip_pool_val(10_000_000, 99_000), ip_datum(roots, 1000))
  let owner_val =
    assets.from_lovelace(2_000_000) |> assets.add(ip_lamp_policy, ip_lamp_name, 1000)
  let owner_out = util.mk_output(util.vk_address(owner_a), owner_val, leaf_a())
  // 2 slot input cùng tên (mưu toan), ref khác nhau.
  let slot1 =
    util.mk_input(util.mk_ref(7), util.mk_output_no_datum(util.script_address(ip_registry_sh), assets.from_lovelace(2_000_000) |> assets.add(ip_nft_policy, sname, 1)))
  let slot2 =
    util.mk_input(util.mk_ref(8), util.mk_output_no_datum(util.script_address(ip_registry_sh), assets.from_lovelace(2_000_000) |> assets.add(ip_nft_policy, sname, 1)))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_in, slot1, slot2],
      outputs: [pool_out, owner_out],
      mint: assets.zero |> assets.add(ip_nft_policy, sname, -2),
    }
  run_claim(in_d, proof_a(), tx)
}

test claim_pool_overdrain_rejected() fail {
  // pool nhả nhiều hơn amount → value-eq lệch.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 1000, 0, owner_a, 100_000, 98_000, 1000)
  run_claim(in_d, proof_a(), tx)
}

test claim_dist_total_tamper() fail {
  // distributed_total không tăng đúng amount → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let tx = claim_tx(roots, 0, 0, 0, owner_a, 100_000, 99_000, 1000)
  run_claim(in_d, proof_a(), tx)
}

test claim_epoch_no_root() fail {
  // claim epoch 1 nhưng epoch_roots chỉ có root epoch 0 → list_at None → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let bad =
    ClaimProof {
      epoch: 1, owner: owner_a, amount: 1000,
      proof: [MerkleStep { hash: leaf_b(), left: False }],
    }
  let tx = claim_tx(roots, 0, 1000, 1, owner_a, 100_000, 99_000, 1000)
  run_claim(in_d, bad, tx)
}

test claim_double_satisfaction() fail {
  // 2 pool input cùng hash (khác stake) → count_inputs_with_nft==2 → reject.
  let roots = [root0()]
  let in_d = ip_datum(roots, 0)
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, 100_000), ip_datum(roots, 0)))
  let pool_in2 =
    util.mk_input(util.mk_ref(1), util.mk_output(util.script_address_staked(ip_pool_sh, #"99"), ip_pool_val(10_000_000, 100_000), ip_datum(roots, 0)))
  let pool_out =
    util.mk_output(pool_addr, ip_pool_val(10_000_000, 99_000), ip_datum(roots, 1000))
  let sname = merkle.marker_name(0, owner_a)
  let owner_val =
    assets.from_lovelace(2_000_000) |> assets.add(ip_lamp_policy, ip_lamp_name, 1000)
  let owner_out = util.mk_output(util.vk_address(owner_a), owner_val, leaf_a())
  let slot =
    slot_input(ip_registry_sh, sname)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_in, pool_in2, slot],
      outputs: [pool_out, owner_out],
      mint: assets.zero |> assets.add(ip_nft_policy, sname, -1),
    }
  run_claim(in_d, proof_a(), tx)
}

// ── SETROOT tests ─────────────────────────────────────────────────

fn setroot_tx(
  in_roots: List<ByteArray>,
  out_roots: List<ByteArray>,
  sigs: List<ByteArray>,
  pool_val_out: assets.Value,
) -> Transaction {
  setroot_tx_slots(in_roots, out_roots, sigs, pool_val_out, [])
}

/// SetRoot tx kèm danh sách output slot (mỗi (addr_hash, slot_name) → 1 slot NFT).
fn setroot_tx_slots(
  in_roots: List<ByteArray>,
  out_roots: List<ByteArray>,
  sigs: List<ByteArray>,
  pool_val_out: assets.Value,
  slot_outs: List<(ByteArray, ByteArray)>,
) -> Transaction {
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, 100_000), ip_datum(in_roots, 0)))
  let pool_out = util.mk_output(pool_addr, pool_val_out, ip_datum(out_roots, 0))
  let extra =
    list.map(
      slot_outs,
      fn(s) {
        let (addr_hash, sname) = s
        util.mk_output_no_datum(
          util.script_address(addr_hash),
          assets.from_lovelace(2_000_000) |> assets.add(ip_nft_policy, sname, 1),
        )
      },
    )
  // mint = bộ slot (mỗi name +1) để khớp đúc thực tế (pool không kiểm mint slot
  // chi tiết ở SetRoot, nhưng dựng tx thực để gần thật).
  let mint =
    list.foldl(
      slot_outs,
      assets.zero,
      fn(s, acc) {
        let (_a, sname) = s
        assets.add(acc, ip_nft_policy, sname, 1)
      },
    )
  Transaction {
    ..placeholder,
    inputs: [pool_in],
    outputs: list.concat([pool_out], extra),
    mint: mint,
    extra_signatories: sigs,
  }
}

fn run_setroot(in_d: SrclDatum, root: ByteArray, tx: Transaction) -> Bool {
  srcl_pool.spend(
    ip_nft_policy, ip_lamp_policy, ip_lamp_name, ip_admin, ip_admin_threshold,
    ip_registry_sh, ip_campaign_id, ip_role, Some(in_d), SetRoot { root }, util.mk_ref(0), tx,
  )
}

test setroot_happy() {
  // append root epoch 0 (roots rỗng → [root0]). 2 admin sig.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 100_000))
  run_setroot(in_d, root0(), tx)
}

test setroot_insufficient_admin() fail {
  // chỉ 1 admin sig < threshold 2 → reject.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0()], [#"ad01"], ip_pool_val(10_000_000, 100_000))
  run_setroot(in_d, root0(), tx)
}

test setroot_drains_lamp() fail {
  // SetRoot mưu toan rút LAMP (pool_out LAMP < in) → value bảo toàn lệch → reject.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 50_000))
  run_setroot(in_d, root0(), tx)
}

test setroot_wrong_append() fail {
  // out_roots không phải append đúng (thêm 2 root cùng lúc) → reject.
  let in_d = ip_datum([], 0)
  let tx = setroot_tx([], [root0(), root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 100_000))
  run_setroot(in_d, root0(), tx)
}

test setroot_mints_slot_set_to_registry() {
  // SetRoot epoch 0 + đúc bộ slot (A, B) gửi VÀO registry → pass (slot không rò rỉ
  // ra ngoài registry; chỉ POOL NFT ở pool_out ngoài registry).
  let in_d = ip_datum([], 0)
  let slot_a = merkle.marker_name(0, owner_a)
  let slot_b = merkle.marker_name(0, owner_b)
  let tx =
    setroot_tx_slots(
      [], [root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 100_000),
      [(ip_registry_sh, slot_a), (ip_registry_sh, slot_b)],
    )
  run_setroot(in_d, root0(), tx)
}

test setroot_reject_slot_to_wrong_dest() fail {
  // 1 slot gửi tới địa chỉ KHÁC registry (ví/script lạ) → rò rỉ slot → reject.
  let in_d = ip_datum([], 0)
  let slot_a = merkle.marker_name(0, owner_a)
  let tx =
    setroot_tx_slots(
      [], [root0()], [#"ad01", #"ad02"], ip_pool_val(10_000_000, 100_000),
      [(#"badd00", slot_a)],
    )
  run_setroot(in_d, root0(), tx)
}

test setroot_remint_burned_slot_admin_trusted() {
  // ── MINH HOẠ GIỚI HẠN (audit MEDIUM): on-chain KHÔNG chặn admin re-mint slot
  // của EPOCH CŨ đã burn. SetRoot epoch 1 (đã có root0 ở epoch 0) append root1,
  // NHƯNG admin đúc slot tên = marker_name(0, owner_a) (epoch 0!) gửi vào registry.
  // Pool chỉ ép: slot không rò ngoài registry + không đụng POOL NFT → tx PASS.
  // ⇒ slot epoch-0 (đã claim+burn) được TÁI TẠO → owner_a có thể claim lại epoch 0.
  // Test PASS = bằng chứng việc chặn double-claim ở đây dựa TIN CẬY admin-threshold,
  // KHÔNG phải trustless tuyệt đối. (Nếu một bản vá tương lai siết được tên slot
  // theo epoch trên-chain, test này phải đổi sang `fail`.)
  let in_d = ip_datum([root0()], 0)
  let stale_slot = merkle.marker_name(0, owner_a)
  let root1 = merkle.leaf_hash(ip_campaign_id, 1, ip_role, owner_a, 500)
  let tx =
    setroot_tx_slots(
      [root0()], [root0(), root1], [#"ad01", #"ad02"],
      ip_pool_val(10_000_000, 100_000),
      [(ip_registry_sh, stale_slot)],
    )
  run_setroot(in_d, root1, tx)
}

// ── SWEEP tests ───────────────────────────────────────────────────

fn sweep_tx(now_epoch: Int, lamp_in: Int, lamp_to_treasury: Int) -> Transaction {
  let pool_addr = util.script_address(ip_pool_sh)
  let pool_in =
    util.mk_input(util.mk_ref(0), util.mk_output(pool_addr, ip_pool_val(10_000_000, lamp_in), ip_datum([root0()], 0)))
  // LAMP về Treasury (Script(treasury_dest)).
  let tre_val = assets.from_lovelace(2_000_000) |> assets.add(ip_lamp_policy, ip_lamp_name, lamp_to_treasury)
  let tre_out = util.mk_output(util.script_address(ip_treasury), tre_val, leaf_a())
  Transaction {
    ..placeholder,
    inputs: [pool_in],
    outputs: [tre_out],
    validity_range: interval.entirely_after(now_epoch * ip_mspe),
  }
}


fn run_sweep(in_d: SrclDatum, tx: Transaction) -> Bool {
  srcl_pool.spend(
    ip_nft_policy, ip_lamp_policy, ip_lamp_name, ip_admin, ip_admin_threshold,
    ip_registry_sh, ip_campaign_id, ip_role, Some(in_d), Sweep, util.mk_ref(0), tx,
  )
}

test sweep_after_end() {
  // now=36 > end_epoch=35 → quét toàn bộ LAMP về Treasury.
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(36, 50_000, 50_000)
  run_sweep(in_d, tx)
}

test sweep_before_end_rejected() fail {
  // now=35 == end_epoch (chưa > end) → reject (sweep sớm).
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(35, 50_000, 50_000)
  run_sweep(in_d, tx)
}

test sweep_to_treasury_full() {
  // toàn bộ LAMP dư phải về Treasury (≥ lamp_in). 50_000 in → 50_000 Treasury.
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(40, 50_000, 50_000)
  run_sweep(in_d, tx)
}

test sweep_skims_lamp_rejected() fail {
  // sweep mà giữ lại LAMP (Treasury nhận < lamp_in) → reject.
  let in_d = ip_datum([root0()], 0)
  let tx = sweep_tx(40, 50_000, 10_000)
  run_sweep(in_d, tx)
}
