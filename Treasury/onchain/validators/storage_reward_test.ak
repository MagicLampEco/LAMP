// Bài kiểm cho `storage_reward` (Treasury/storage-reward/CONTRACT.md v0.1 §5).
// Mỗi nhánh một ca dương; mỗi ca âm khác ca dương của nhánh đó ĐÚNG MỘT chỗ.
// Lá/gốc cây gõ CỨNG bằng hex tính ngoài (python hashlib.blake2b, digest 32) — không dựng bằng
// chính `leaf_hash`, để đột biến định dạng lá làm ca đỏ thay vì tự nhất quán.

use aiken/cbor
use aiken/collection/list
use aiken/crypto
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use magiclamp/treasury/storage_reward.{
  Active, BurnBatch, Claim, ClaimItem, Close, MintBatch, Open, PayoutAction,
  PostRoot, Round, Tombstone, batch_token_name, batch_value, empty_bitmap,
  leaf_hash, node_hash, batch_id_of, coins_per_utxo_byte, min_batch_lovelace,
} as sr
use magiclamp/treasury/types.{AssetKey, CustodyDatum, LedgerEntry}
use storage_reward

// ── Hằng ──
const own: ByteArray = #"52525252525252525252525252525252525252525252525252525252"

const carp_p: ByteArray = #"cacacacacacacacacacacacacacacacacacacacacacacacacacacaca"

const carp_n: ByteArray = "CARP"

const cust_h: ByteArray = #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const cseed: ByteArray = #"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"

const cinst: ByteArray = "SR-INST"

const bucket: Int = 7

const k1: ByteArray = #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const k2: ByteArray = #"a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2"

const k3: ByteArray = #"a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3"

const outsider: ByteArray =
  #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"

const ms: Int = 432_000_000

const e1: ByteArray = #"e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"

const e2: ByteArray = #"e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2"

const e3: ByteArray = #"e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3"

const st5a: ByteArray =
  #"5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a"

// Vector (vec2.py): policy = own, batch_id = bid = blake2b_256(0x77 ‖ u16(0)) (outref nguồn của
// `src_in`), epoch 100; lá 0 = (VK e1, không stake, 1000); lá 1 = (VK e2, stake VK 5a, 2500);
// lá 2 = (VK e4, không stake, 500). Cây: n01 = node(l0,l1); root = node(n01, l2).
// lscript = lá 2 nhưng payee Script e3; root_script = node(n01, lscript).
const bid: ByteArray =
  #"083cdb5877e2861cc9fbfa4cbdb6ffbe221c309b3633023ce4a6e25c2b09922d"

const l0: ByteArray =
  #"b2041a954820f9e7e05ee248d4f61cb8c167492035595b4e3417db6b706e20ac"

const l1: ByteArray =
  #"21a5097770cef49482429906025643558f247882273adc1ec2699811ce924dca"

const l2: ByteArray =
  #"23edc21c284d94fd2faf9577a9c51311bf18e13d2701180c2a69c725f8cb3053"

const n01: ByteArray =
  #"718bae551f47f787905688d2b175eb9c9ebbed585c3df09473cec0186d671e1a"

const root: ByteArray =
  #"367c75918807ae17d354fae61d1c139f868f58109ccebdd03fd29492464c55c7"

const lscript: ByteArray =
  #"fc9ded531c6ecfe5efa51ae3f0b9eaa704ade22b49d09fbe8f9a4e6ebca6f557"

const root_script: ByteArray =
  #"2f02cd0e81f3df3c608de8080cd5faaa7af42ca290a766e85215bafe38a93d8a"

const e4: ByteArray = #"e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4"

const batch_ada: Int = 5_000_000

// ── Địa chỉ + value ──
fn script_addr(h: ByteArray) -> Address {
  Address { payment_credential: Script(h), stake_credential: None }
}

fn vk_addr(h: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(h), stake_credential: None }
}

fn addr0() -> Address {
  vk_addr(e1)
}

fn addr1() -> Address {
  Address {
    payment_credential: VerificationKey(e2),
    stake_credential: Some(Inline(VerificationKey(st5a))),
  }
}

fn addr2() -> Address {
  vk_addr(e4)
}

fn addr_script() -> Address {
  script_addr(e3)
}

fn batch_addr() -> Address {
  script_addr(own)
}

fn bval(carp: Int) -> assets.Value {
  batch_value(batch_ada, carp_p, carp_n, carp, own, 1)
}

fn oref(i: Int) -> OutputReference {
  OutputReference { transaction_id: #"77", output_index: i }
}

fn out(a: Address, v: assets.Value, d: Data) -> Output {
  Output { address: a, value: v, datum: InlineDatum(d), reference_script: None }
}

fn out_nd(a: Address, v: assets.Value) -> Output {
  Output { address: a, value: v, datum: NoDatum, reference_script: None }
}

fn wallet_in() -> Input {
  Input {
    output_reference: oref(9),
    output: out_nd(vk_addr(outsider), assets.from_lovelace(50_000_000)),
  }
}

fn at_epoch(e: Int) -> interval.Interval {
  interval.after(e * ms + 1)
}

// ── Datum ──
fn fees() -> List<Int> {
  [10_000, 10_000, 10_000, 10_000, 10_000, 10_000]
}

fn fresh() -> Data {
  let d: Data =
    Active { batch_id: bid, start_epoch: 100, epoch_fees: fees(), share_bps: 5000, round: None }
  d
}

fn with_round(r: Round) -> Data {
  let d: Data =
    Active { batch_id: bid, start_epoch: 100, epoch_fees: fees(), share_bps: 5000, round: Some(r) }
  d
}

fn round0() -> Round {
  Round { epoch: 100, root, leaf_count: 3, paid: 0, claimed: #"00" }
}

fn tomb() -> Data {
  let d: Data = Tombstone { refund_to: outsider }
  d
}

// ── Custody ──
fn cdatum(ledger: List<LedgerEntry>, accepted: List<AssetKey>, buckets: List<Int>) -> Data {
  let d: Data = CustodyDatum {
    instance_id: cinst,
    accepted_assets: accepted,
    ledger,
    cut_bps: 0,
    governance_ref: #"",
    epoch: 0,
    consumed_proposals: [],
    buckets,
  }
  d
}

fn accepted() -> List<AssetKey> {
  [AssetKey { policy: #"", name: #"" }, AssetKey { policy: carp_p, name: carp_n }]
}

fn custody_out(d: Data) -> Output {
  out(
    script_addr(cust_h),
    assets.from_lovelace(5_000_000) |> assets.add(cseed, cinst, 1),
    d,
  )
}

fn custody_ref_ok() -> Input {
  Input {
    output_reference: oref(50),
    output: custody_out(cdatum([], accepted(), [3, bucket])),
  }
}

// ── Gọi handler ──
fn run_mint(r: sr.BatchMint, tx: Transaction) -> Bool {
  storage_reward.storage_reward.mint(
    carp_p,
    carp_n,
    [k1, k2, k3],
    2,
    cust_h,
    cseed,
    cinst,
    bucket,
    6,
    ms,
    0,
    r,
    own,
    tx,
  )
}

fn run_spend(d: Option<Data>, r: PayoutAction, tx: Transaction) -> Bool {
  storage_reward.storage_reward.spend(
    carp_p,
    carp_n,
    [k1, k2, k3],
    2,
    cust_h,
    cseed,
    cinst,
    bucket,
    6,
    ms,
    0,
    d,
    r,
    oref(0),
    tx,
  )
}

// ═════════════ OPEN (mint MintBatch + spend Open) ═════════════
fn src_in() -> Input {
  Input {
    output_reference: oref(0),
    output: out_nd(
      batch_addr(),
      assets.from_lovelace(batch_ada) |> assets.add(carp_p, carp_n, 30_000),
    ),
  }
}

fn open_tx_with(batch_out: Output, sigs: List<ByteArray>, refs: List<Input>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [src_in(), wallet_in()],
    reference_inputs: refs,
    outputs: [batch_out],
    mint: assets.from_asset(own, batch_token_name, 1),
    extra_signatories: sigs,
  }
}

fn open_tx() -> Transaction {
  open_tx_with(out(batch_addr(), bval(30_000), fresh()), [k1, k2], [custody_ref_ok()])
}

test open_ok() {
  run_mint(MintBatch, open_tx()) && run_spend(None, Open, open_tx())
}

test open_one_signature_rejected() fail {
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), fresh()), [k1, outsider], [custody_ref_ok()]))
}

test open_share_above_half_rejected() fail {
  // s = 5001 bps; Σcaps = 6·5001 = 30_006 > 30_000 cũng đỏ ⇒ hạ phí để chỉ SRP-SHARE-MAX bắt.
  let d: Data =
    Active {
      batch_id: bid, start_epoch: 100,
      epoch_fees: [5000, 5000, 5000, 5000, 5000, 5000],
      share_bps: 5001,
      round: None,
    }
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), d), [k1, k2], [custody_ref_ok()]))
}

test open_underfunded_rejected() fail {
  // Σcaps = 6·⌊10_002·0,5⌋ = 30_006 > 30_000.
  let d: Data =
    Active {
      batch_id: bid, start_epoch: 100,
      epoch_fees: [10_002, 10_002, 10_002, 10_002, 10_002, 10_002],
      share_bps: 5000,
      round: None,
    }
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), d), [k1, k2], [custody_ref_ok()]))
}

test open_carp_skimmed_rejected() fail {
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(29_999), fresh()), [k1, k2], [custody_ref_ok()]))
}

test open_round_preset_rejected() fail {
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), with_round(round0())), [k1, k2], [custody_ref_ok()]))
}

test open_wrong_fee_count_rejected() fail {
  let d: Data =
    Active { batch_id: bid, start_epoch: 100, epoch_fees: [10_000, 10_000, 10_000, 10_000, 10_000], share_bps: 5000, round: None }
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), d), [k1, k2], [custody_ref_ok()]))
}

test open_custody_without_carp_rejected() fail {
  let refs =
    [
      Input {
        output_reference: oref(50),
        output: custody_out(cdatum([], [AssetKey { policy: #"", name: #"" }], [3, bucket])),
      },
    ]
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), fresh()), [k1, k2], refs))
}

test open_custody_without_bucket_rejected() fail {
  let refs =
    [Input { output_reference: oref(50), output: custody_out(cdatum([], accepted(), [3])) }]
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), fresh()), [k1, k2], refs))
}

test open_junk_token_rejected() fail {
  let v = bval(30_000) |> assets.add(outsider, "JUNK", 1)
  run_mint(MintBatch, open_tx_with(out(batch_addr(), v, fresh()), [k1, k2], [custody_ref_ok()]))
}

test open_mint_two_rejected() fail {
  let tx =
    Transaction { ..open_tx(), mint: assets.from_asset(own, batch_token_name, 2) }
  run_mint(MintBatch, tx)
}

test open_spend_without_mint_rejected() fail {
  run_spend(None, Open, Transaction { ..open_tx(), mint: assets.zero })
}

// ═════════════ POSTROOT ═════════════
fn batch_in(d: Data, carp: Int) -> Input {
  Input { output_reference: oref(0), output: out(batch_addr(), bval(carp), d) }
}

fn post_tx(in_d: Data, out_d: Data, cur: Int, sigs: List<ByteArray>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [batch_in(in_d, 30_000), wallet_in()],
    outputs: [out(batch_addr(), bval(30_000), out_d)],
    extra_signatories: sigs,
    validity_range: at_epoch(cur),
  }
}

fn post_r() -> PayoutAction {
  PostRoot { epoch: 100, root, leaf_count: 3 }
}

test post_root_ok() {
  run_spend(Some(fresh()), post_r(), post_tx(fresh(), with_round(round0()), 101, [k1, k3]))
}

test post_root_one_signature_rejected() fail {
  run_spend(Some(fresh()), post_r(), post_tx(fresh(), with_round(round0()), 101, [k1]))
}

test post_root_epoch_not_finished_rejected() fail {
  run_spend(Some(fresh()), post_r(), post_tx(fresh(), with_round(round0()), 100, [k1, k2]))
}

test post_root_repost_same_epoch_rejected() fail {
  // Đăng lại epoch 100 lên một vòng đã trả 3500 ⇒ xoá bitmap + paid = nhân đôi trần.
  let spent = Round { ..round0(), paid: 3500, claimed: #"c0" }
  run_spend(Some(with_round(spent)), post_r(), post_tx(with_round(spent), with_round(round0()), 101, [k1, k2]))
}

test post_root_after_batch_rejected() fail {
  // epoch 106 = start + 6 ⇒ ngoài đợt.
  let r = Round { ..round0(), epoch: 106 }
  run_spend(Some(fresh()), PostRoot { epoch: 106, root, leaf_count: 3 }, post_tx(fresh(), with_round(r), 107, [k1, k2]))
}

test post_root_dirty_bitmap_rejected() fail {
  // Hội đồng đăng gốc nhưng ghi bitmap sẵn bit — datum ra lệch dạng chuẩn.
  let r = Round { ..round0(), claimed: #"80" }
  run_spend(Some(fresh()), post_r(), post_tx(fresh(), with_round(r), 101, [k1, k2]))
}

test post_root_skim_rejected() fail {
  let tx =
    Transaction {
      ..post_tx(fresh(), with_round(round0()), 101, [k1, k2]),
      outputs: [out(batch_addr(), bval(29_000), with_round(round0()))],
    }
  run_spend(Some(fresh()), post_r(), tx)
}

test post_root_without_token_rejected() fail {
  // UTxO giả (không token) với datum `Active` bịa.
  let fake =
    Input {
      output_reference: oref(0),
      output: out(
        batch_addr(),
        assets.from_lovelace(batch_ada) |> assets.add(carp_p, carp_n, 30_000),
        fresh(),
      ),
    }
  let tx =
    Transaction {
      ..post_tx(fresh(), with_round(round0()), 101, [k1, k2]),
      inputs: [fake, wallet_in()],
    }
  run_spend(Some(fresh()), post_r(), tx)
}

// ═════════════ CLAIM ═════════════
fn claim01() -> PayoutAction {
  Claim {
    claims: [
      ClaimItem { index: 0, amount: 1000, proof: [l1, l2] },
      ClaimItem { index: 1, amount: 2500, proof: [l0, l2] },
    ],
  }
}

fn pay(a: Address, carp: Int) -> Output {
  out_nd(a, assets.from_lovelace(1_200_000) |> assets.add(carp_p, carp_n, carp))
}

fn claim_tx_with(in_r: Round, cont: Output, pays: List<Output>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [batch_in(with_round(in_r), 30_000), wallet_in()],
    outputs: [cont, ..pays],
    validity_range: at_epoch(101),
  }
}

fn claim_cont(paid: Int, bm: ByteArray, carp: Int) -> Output {
  out(batch_addr(), bval(carp), with_round(Round { ..round0(), paid: paid, claimed: bm }))
}

fn claim_tx() -> Transaction {
  claim_tx_with(round0(), claim_cont(3500, #"c0", 26_500), [pay(addr0(), 1000), pay(addr1(), 2500)])
}

test claim_ok() {
  run_spend(Some(with_round(round0())), claim01(), claim_tx())
}

test claim_third_leaf_ok() {
  let tx =
    claim_tx_with(round0(), claim_cont(500, #"20", 29_500), [pay(addr2(), 500)])
  run_spend(Some(with_round(round0())), Claim { claims: [ClaimItem { index: 2, amount: 500, proof: [n01] }] }, tx)
}

test claim_already_claimed_rejected() fail {
  let r = Round { ..round0(), paid: 1000, claimed: #"80" }
  let tx = claim_tx_with(r, claim_cont(2000, #"80", 29_000), [pay(addr0(), 1000)])
  run_spend(Some(with_round(r)), Claim { claims: [ClaimItem { index: 0, amount: 1000, proof: [l1, l2] }] }, tx)
}

test claim_duplicate_in_one_tx_rejected() fail {
  let c = ClaimItem { index: 0, amount: 1000, proof: [l1, l2] }
  let tx =
    claim_tx_with(round0(), claim_cont(2000, #"80", 28_000), [pay(addr0(), 1000), pay(addr0(), 1000)])
  run_spend(Some(with_round(round0())), Claim { claims: [c, c] }, tx)
}

// Bit KHÔNG phải bit cao nhất của byte: thiếu SRP-NO-DOUBLE thì `set_claimed` cộng 0x20 vào 0x20 ra 0x40
// (lặng lẽ bật bit lá 1) thay vì tràn byte — chỉ chốt `is_claimed` chặn được. Datum ra cố ý ghi đúng
// thứ bản thiếu chốt sẽ tính, để ca chỉ đỏ vì chốt này.
test claim_already_claimed_low_bit_rejected() fail {
  let r = Round { ..round0(), paid: 500, claimed: #"20" }
  let tx =
    claim_tx_with(r, out(batch_addr(), bval(29_500), with_round(Round { ..r, paid: 1000, claimed: #"40" })), [pay(addr2(), 500)])
  run_spend(Some(with_round(r)), Claim { claims: [ClaimItem { index: 2, amount: 500, proof: [n01] }] }, tx)
}

test claim_duplicate_low_bit_in_one_tx_rejected() fail {
  let c = ClaimItem { index: 2, amount: 500, proof: [n01] }
  let tx =
    claim_tx_with(round0(), out(batch_addr(), bval(29_000), with_round(Round { ..round0(), paid: 1000, claimed: #"40" })), [pay(addr2(), 500), pay(addr2(), 500)])
  run_spend(Some(with_round(round0())), Claim { claims: [c, c] }, tx)
}

test claim_over_cap_rejected() fail {
  // paid sẵn 2000 + 3500 = 5500 > cap 5000 (bitmap trống để chỉ SRP-CAP bắt).
  let r = Round { ..round0(), paid: 2000 }
  let tx = claim_tx_with(r, claim_cont(5500, #"c0", 26_500), [pay(addr0(), 1000), pay(addr1(), 2500)])
  run_spend(Some(with_round(r)), claim01(), Transaction { ..tx, outputs: [out(batch_addr(), bval(26_500), with_round(Round { ..r, paid: 5500, claimed: #"c0" })), pay(addr0(), 1000), pay(addr1(), 2500)] })
}

test claim_at_cap_exact_ok() {
  let r = Round { ..round0(), paid: 1500 }
  let tx =
    Transaction {
      ..claim_tx(),
      inputs: [batch_in(with_round(r), 30_000), wallet_in()],
      outputs: [
        out(batch_addr(), bval(26_500), with_round(Round { ..r, paid: 5000, claimed: #"c0" })),
        pay(addr0(), 1000),
        pay(addr1(), 2500),
      ],
    }
  run_spend(Some(with_round(r)), claim01(), tx)
}

test claim_underpaid_rejected() fail {
  let tx = claim_tx_with(round0(), claim_cont(3500, #"c0", 26_500), [pay(addr0(), 999), pay(addr1(), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

test claim_redirected_address_rejected() fail {
  // Lá 0 trả tới ví khác — lá dựng từ địa chỉ output nên bằng chứng không khớp gốc.
  let tx = claim_tx_with(round0(), claim_cont(3500, #"c0", 26_500), [pay(vk_addr(outsider), 1000), pay(addr1(), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

test claim_stake_stripped_rejected() fail {
  // Lá 1 có stake 5a; trả tới cùng payment nhưng bỏ stake ⇒ lá khác.
  let tx = claim_tx_with(round0(), claim_cont(3500, #"c0", 26_500), [pay(addr0(), 1000), pay(vk_addr(e2), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

test claim_inflated_amount_rejected() fail {
  let c = ClaimItem { index: 0, amount: 1001, proof: [l1, l2] }
  let tx = claim_tx_with(round0(), claim_cont(1001, #"80", 28_999), [pay(addr0(), 1001)])
  run_spend(Some(with_round(round0())), Claim { claims: [c] }, tx)
}

test claim_carp_skim_rejected() fail {
  let tx = claim_tx_with(round0(), claim_cont(3500, #"c0", 26_499), [pay(addr0(), 1000), pay(addr1(), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

test claim_ada_drained_rejected() fail {
  let cont =
    out(
      batch_addr(),
      batch_value(1_000_000, carp_p, carp_n, 26_500, own, 1),
      with_round(Round { ..round0(), paid: 3500, claimed: #"c0" }),
    )
  run_spend(Some(with_round(round0())), claim01(), claim_tx_with(round0(), cont, [pay(addr0(), 1000), pay(addr1(), 2500)]))
}

test claim_paid_not_recorded_rejected() fail {
  let tx = claim_tx_with(round0(), claim_cont(0, #"c0", 26_500), [pay(addr0(), 1000), pay(addr1(), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

test claim_bitmap_not_recorded_rejected() fail {
  let tx = claim_tx_with(round0(), claim_cont(3500, #"00", 26_500), [pay(addr0(), 1000), pay(addr1(), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

test claim_index_out_of_range_rejected() fail {
  // leaf_count = 2 ⇒ index 2 ngoài biên dù bằng chứng hợp lệ.
  let r = Round { ..round0(), leaf_count: 2 }
  let tx = claim_tx_with(r, out(batch_addr(), bval(29_500), with_round(Round { ..r, paid: 500, claimed: #"20" })), [pay(addr2(), 500)])
  run_spend(Some(with_round(r)), Claim { claims: [ClaimItem { index: 2, amount: 500, proof: [n01] }] }, tx)
}

test claim_without_token_rejected() fail {
  let fake =
    Input {
      output_reference: oref(0),
      output: out(
        batch_addr(),
        assets.from_lovelace(batch_ada) |> assets.add(carp_p, carp_n, 30_000),
        with_round(round0()),
      ),
    }
  run_spend(Some(with_round(round0())), claim01(), Transaction { ..claim_tx(), inputs: [fake, wallet_in()] })
}

test claim_two_batches_rejected() fail {
  let second = Input { output_reference: oref(1), output: out(batch_addr(), bval(30_000), with_round(round0())) }
  run_spend(Some(with_round(round0())), claim01(), Transaction { ..claim_tx(), inputs: [batch_in(with_round(round0()), 30_000), second, wallet_in()] })
}

test claim_wrong_epoch_leaf_rejected() fail {
  // Cùng gốc nhưng vòng đang ở epoch 101 ⇒ lá dựng với epoch 101 không khớp gốc của epoch 100.
  let r = Round { ..round0(), epoch: 101 }
  let tx = claim_tx_with(r, out(batch_addr(), bval(26_500), with_round(Round { ..r, paid: 3500, claimed: #"c0" })), [pay(addr0(), 1000), pay(addr1(), 2500)])
  run_spend(Some(with_round(r)), claim01(), tx)
}

// ═════════════ CLOSE ═════════════
fn ledger_after(ada: Int, carp: Int) -> List<LedgerEntry> {
  [
    LedgerEntry { bucket_id: bucket, policy: #"", name: #"", amount: ada },
    LedgerEntry { bucket_id: bucket, policy: carp_p, name: carp_n, amount: carp },
  ]
}

fn cust_in() -> Input {
  Input { output_reference: oref(5), output: custody_out(cdatum([], accepted(), [3, bucket])) }
}

fn tomb_out() -> Output {
  out(batch_addr(), assets.from_lovelace(1_500_000) |> assets.add(own, batch_token_name, 1), tomb())
}

fn close_tx_with(ledger: List<LedgerEntry>, cur: Int, sigs: List<ByteArray>, extra_out: List<Output>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [batch_in(with_round(round0()), 26_500), cust_in(), wallet_in()],
    outputs: [custody_out(cdatum(ledger, accepted(), [3, bucket])), ..extra_out],
    extra_signatories: sigs,
    validity_range: at_epoch(cur),
  }
}

fn close_tx() -> Transaction {
  close_tx_with(ledger_after(batch_ada, 26_500), 108, [], [tomb_out()])
}

test close_after_grace_permissionless_ok() {
  run_spend(Some(with_round(round0())), Close, close_tx())
}

test close_before_grace_without_committee_rejected() fail {
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_500), 107, [], [tomb_out()]))
}

test close_early_with_committee_ok() {
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_500), 101, [k2, k3], [tomb_out()]))
}

test close_carp_line_short_rejected() fail {
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_499), 108, [], [tomb_out()]))
}

test close_ada_line_missing_rejected() fail {
  let l = [LedgerEntry { bucket_id: bucket, policy: carp_p, name: carp_n, amount: 26_500 }]
  run_spend(Some(with_round(round0())), Close, close_tx_with(l, 108, [], [tomb_out()]))
}

test close_wrong_bucket_rejected() fail {
  let l =
    [
      LedgerEntry { bucket_id: 3, policy: #"", name: #"", amount: batch_ada },
      LedgerEntry { bucket_id: 3, policy: carp_p, name: carp_n, amount: 26_500 },
    ]
  run_spend(Some(with_round(round0())), Close, close_tx_with(l, 108, [], [tomb_out()]))
}

test close_foreign_script_input_rejected() fail {
  let foreign = Input { output_reference: oref(8), output: out_nd(script_addr(outsider), assets.from_lovelace(2_000_000)) }
  let tx = close_tx()
  run_spend(Some(with_round(round0())), Close, Transaction { ..tx, inputs: [foreign, ..tx.inputs] })
}

test close_token_escapes_rejected() fail {
  // Token rời script vào ví người đóng — không còn UTxO Tombstone.
  let escaped = out_nd(vk_addr(outsider), assets.from_lovelace(1_500_000) |> assets.add(own, batch_token_name, 1))
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_500), 108, [], [escaped]))
}

test close_tombstone_wrong_datum_rejected() fail {
  let bad = out(batch_addr(), assets.from_lovelace(1_500_000) |> assets.add(own, batch_token_name, 1), fresh())
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_500), 108, [], [bad]))
}

test close_tombstone_keeps_carp_rejected() fail {
  // Ghi sổ đủ nhưng Tombstone giữ thêm CARP (của người dựng) — value Tombstone phải chỉ là token + ADA.
  let bad = out(batch_addr(), assets.from_lovelace(1_500_000) |> assets.add(own, batch_token_name, 1) |> assets.add(carp_p, carp_n, 1), tomb())
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_500), 108, [], [bad]))
}

fn unopened_close_tx(sigs: List<ByteArray>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [src_in(), cust_in(), wallet_in()],
    outputs: [custody_out(cdatum(ledger_after(batch_ada, 30_000), accepted(), [3, bucket]))],
    extra_signatories: sigs,
    validity_range: at_epoch(101),
  }
}

test close_unopened_with_committee_ok() {
  run_spend(None, Close, unopened_close_tx([k1, k2]))
}

test close_unopened_without_committee_rejected() fail {
  run_spend(None, Close, unopened_close_tx([k1]))
}

// ═════════════ BURN ═════════════
fn burn_tx(d: Data) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      Input {
        output_reference: oref(0),
        output: out(batch_addr(), assets.from_lovelace(1_500_000) |> assets.add(own, batch_token_name, 1), d),
      },
      wallet_in(),
    ],
    outputs: [out_nd(vk_addr(outsider), assets.from_lovelace(1_500_000))],
    mint: assets.from_asset(own, batch_token_name, -1),
  }
}

test burn_tombstone_ok() {
  run_spend(Some(tomb()), sr.Burn, burn_tx(tomb())) && run_mint(BurnBatch, burn_tx(tomb()))
}

test burn_active_batch_rejected() fail {
  run_spend(Some(with_round(round0())), sr.Burn, burn_tx(with_round(round0())))
}

test burn_two_rejected() fail {
  run_mint(BurnBatch, Transaction { ..burn_tx(tomb()), mint: assets.from_asset(own, batch_token_name, -2) })
}

// ═════════════ Vector định dạng lá (gửi LampNet) ═════════════
test leaf_vector_vk_no_stake() {
  leaf_hash(own, bid, 100, 0, 1000, addr0()) == l0
}

test leaf_vector_vk_with_stake() {
  leaf_hash(own, bid, 100, 1, 2500, addr1()) == l1
}

test leaf_vector_vk_e4() {
  leaf_hash(own, bid, 100, 2, 500, addr2()) == l2
}

test leaf_vector_script_payee() {
  leaf_hash(own, bid, 100, 2, 500, addr_script()) == lscript && node_hash(n01, lscript) == root_script
}

test batch_id_vector() {
  batch_id_of(oref(0)) == bid
}

test node_vector_sorted() {
  node_hash(l0, l1) == n01 && node_hash(l1, l0) == n01 && node_hash(n01, l2) == root
}

test bitmap_empty_size() {
  empty_bitmap(1) == #"00" && empty_bitmap(8) == #"00" && empty_bitmap(9) == #"0000"
}

// ═════════════ Đo ExUnit nhánh nặng (không phải ca ghim) ═════════════
// Claim K lá, cây sâu 12 (16 lá thật + 8 tầng đệm ⇒ cùng một gốc), bitmap 512 byte (4096 lá).
// Chi phí = (ca `bench_claim_K`) − (ca `bench_fixture_K`, dựng cùng fixture, không gọi validator).
fn bench_addr(i: Int) -> Address {
  vk_addr(bytearray.from_int_big_endian(i + 1, 28))
}

fn bench_level_up(nodes: List<ByteArray>) -> List<ByteArray> {
  when nodes is {
    [a, b, ..rest] -> [node_hash(a, b), ..bench_level_up(rest)]
    _ -> []
  }
}

fn bench_sibling(level: List<ByteArray>, i: Int) -> ByteArray {
  let j =
    if i % 2 == 0 {
      i + 1
    } else {
      i - 1
    }
  expect Some(s) = list.at(level, j)
  s
}

fn bench_pads() -> List<ByteArray> {
  list.map(list.range(1, 8), fn(j) { crypto.blake2b_256(bytearray.from_int_big_endian(j, 1)) })
}

fn bench_tx(k: Int) -> (PayoutAction, Transaction, Data) {
  let l0s = list.map(list.range(0, 15), fn(i) { leaf_hash(own, bid, 100, i, 100, bench_addr(i)) })
  let l1s = bench_level_up(l0s)
  let l2s = bench_level_up(l1s)
  let l3s = bench_level_up(l2s)
  expect [a, b] = l3s
  let sub = node_hash(a, b)
  let pads = bench_pads()
  let broot = list.foldl(pads, sub, fn(p, acc) { node_hash(acc, p) })
  let idx = list.range(0, k - 1)
  let claims =
    list.map(
      idx,
      fn(i) {
        ClaimItem {
          index: i,
          amount: 100,
          proof: list.concat(
            [
              bench_sibling(l0s, i),
              bench_sibling(l1s, i / 2),
              bench_sibling(l2s, i / 4),
              bench_sibling(l3s, i / 8),
            ],
            pads,
          ),
        }
      },
    )
  let r =
    Round { epoch: 100, root: broot, leaf_count: 4096, paid: 0, claimed: empty_bitmap(4096) }
  let bm = list.foldl(idx, r.claimed, fn(i, acc) { sr.set_claimed(acc, i) })
  let cont = out(batch_addr(), bval(30_000 - 100 * k), with_round(Round { ..r, paid: 100 * k, claimed: bm }))
  let pays = list.map(idx, fn(i) { pay(bench_addr(i), 100) })
  let tx =
    Transaction {
      ..placeholder,
      inputs: [batch_in(with_round(r), 30_000), wallet_in()],
      outputs: [cont, ..pays],
      validity_range: at_epoch(101),
    }
  (Claim { claims }, tx, with_round(r))
}

test bench_claim_1() {
  let (rd, tx, d) = bench_tx(1)
  run_spend(Some(d), rd, tx)
}

test bench_fixture_1() {
  let (_rd, tx, d) = bench_tx(1)
  list.length(tx.outputs) == 2 && d != tomb()
}

test bench_claim_8() {
  let (rd, tx, d) = bench_tx(8)
  run_spend(Some(d), rd, tx)
}

test bench_fixture_8() {
  let (_rd, tx, d) = bench_tx(8)
  list.length(tx.outputs) == 9 && d != tomb()
}

test bench_claim_16() {
  let (rd, tx, d) = bench_tx(16)
  run_spend(Some(d), rd, tx)
}

test bench_fixture_16() {
  let (_rd, tx, d) = bench_tx(16)
  list.length(tx.outputs) == 17 && d != tomb()
}

// Close với sổ custody 18 dòng khác (đứng TRƯỚC dòng bucket 7) ⇒ sau trả về đúng trần 20 dòng.
fn bench_other_lines() -> List<LedgerEntry> {
  list.concat(
    list.map(list.range(1, 6), fn(bk) { LedgerEntry { bucket_id: bk, policy: #"", name: #"", amount: 1 } }),
    list.concat(
      list.map(list.range(1, 6), fn(bk) { LedgerEntry { bucket_id: bk, policy: carp_p, name: carp_n, amount: 1 } }),
      list.map(list.range(1, 6), fn(bk) { LedgerEntry { bucket_id: bk, policy: cseed, name: cinst, amount: 1 } }),
    ),
  )
}

fn bench_close_tx() -> Transaction {
  let cin = Input { output_reference: oref(5), output: custody_out(cdatum(bench_other_lines(), accepted(), [3, bucket])) }
  Transaction {
    ..placeholder,
    inputs: [batch_in(with_round(round0()), 26_500), cin, wallet_in()],
    outputs: [custody_out(cdatum(list.concat(bench_other_lines(), ledger_after(batch_ada, 26_500)), accepted(), [3, bucket])), tomb_out()],
    validity_range: at_epoch(108),
  }
}

test bench_close_20_lines() {
  run_spend(Some(with_round(round0())), Close, bench_close_tx())
}

test bench_close_fixture_20_lines() {
  list.length(bench_close_tx().outputs) == 2
}

// ═════════════ Vá audit 2026-10-08 ═════════════
fn custody_input() -> Input {
  Input { output_reference: oref(5), output: custody_out(cdatum([LedgerEntry { bucket_id: bucket, policy: carp_p, name: carp_n, amount: 50_000 }], accepted(), [3, bucket])) }
}

fn foreign_input() -> Input {
  Input { output_reference: oref(8), output: out_nd(script_addr(outsider), assets.from_lovelace(2_000_000)) }
}

// (1) PoC `poc_ds_claim_release_both_accept`: Claim + custody `Release` cùng tx; C-REL-7 của custody
// cộng output đợt-tiếp-tục vào người nhận ⇒ một output thoả cho hai nhánh. Chặn ở phía này: không
// input custody trong tx Claim. Đối chứng: `claim_ok` (cùng tx, không input custody) qua.
test claim_with_custody_input_rejected() fail {
  let tx = claim_tx()
  run_spend(Some(with_round(round0())), claim01(), Transaction { ..tx, inputs: [custody_input(), ..tx.inputs], outputs: list.concat(tx.outputs, [custody_out(cdatum([LedgerEntry { bucket_id: bucket, policy: carp_p, name: carp_n, amount: 30_000 }], accepted(), [3, bucket])), out_nd(vk_addr(outsider), assets.from_lovelace(2_000_000) |> assets.add(carp_p, carp_n, 20_000))]) })
}

test claim_with_foreign_script_input_rejected() fail {
  let tx = claim_tx()
  run_spend(Some(with_round(round0())), claim01(), Transaction { ..tx, inputs: [foreign_input(), ..tx.inputs] })
}

test post_root_with_custody_input_rejected() fail {
  let tx = post_tx(fresh(), with_round(round0()), 101, [k1, k3])
  run_spend(Some(fresh()), post_r(), Transaction { ..tx, inputs: [custody_input(), ..tx.inputs] })
}

test open_with_custody_input_rejected() fail {
  let tx = open_tx()
  run_mint(MintBatch, Transaction { ..tx, inputs: [custody_input(), ..tx.inputs] })
}

test open_with_foreign_script_input_rejected() fail {
  let tx = open_tx()
  run_mint(MintBatch, Transaction { ..tx, inputs: [foreign_input(), ..tx.inputs] })
}

// (2) PoC `poc_payee_garbage_datum_refscript_accepted`: payee Script ⇒ từ chối dù bằng chứng hợp lệ.
test claim_script_payee_rejected() fail {
  let r = Round { ..round0(), root: root_script }
  let tx = claim_tx_with(r, out(batch_addr(), bval(29_500), with_round(Round { ..r, paid: 500, claimed: #"20" })), [pay(addr_script(), 500)])
  run_spend(Some(with_round(r)), Claim { claims: [ClaimItem { index: 2, amount: 500, proof: [n01] }] }, tx)
}

test claim_payee_datum_rejected() fail {
  let junk: Data = #"deadbeef"
  let p = Output { ..pay(addr0(), 1000), datum: InlineDatum(junk) }
  let tx = claim_tx_with(round0(), claim_cont(3500, #"c0", 26_500), [p, pay(addr1(), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

test claim_payee_ref_script_rejected() fail {
  let p = Output { ..pay(addr0(), 1000), reference_script: Some(#"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff") }
  let tx = claim_tx_with(round0(), claim_cont(3500, #"c0", 26_500), [p, pay(addr1(), 2500)])
  run_spend(Some(with_round(round0())), claim01(), tx)
}

// (3) PostRoot nạp thêm ADA được; Open dưới mức ADA tối thiểu bị từ chối; hằng đủ cho datum lớn nhất.
test post_root_ada_topup_ok() {
  let tx = post_tx(fresh(), with_round(round0()), 101, [k1, k3])
  let v = bval(30_000) |> assets.add(#"", #"", 1_000_000)
  run_spend(Some(fresh()), post_r(), Transaction { ..tx, outputs: [out(batch_addr(), v, with_round(round0()))] })
}

test post_root_ada_drained_rejected() fail {
  let tx = post_tx(fresh(), with_round(round0()), 101, [k1, k3])
  let v = bval(30_000) |> assets.add(#"", #"", -1)
  run_spend(Some(fresh()), post_r(), Transaction { ..tx, outputs: [out(batch_addr(), v, with_round(round0()))] })
}

test open_below_min_ada_rejected() fail {
  let v = batch_value(min_batch_lovelace - 1, carp_p, carp_n, 30_000, own, 1)
  let src = Input { output_reference: oref(0), output: out_nd(batch_addr(), assets.from_lovelace(2_000_000) |> assets.add(carp_p, carp_n, 30_000)) }
  let tx = open_tx_with(out(batch_addr(), v, fresh()), [k1, k2], [custody_ref_ok()])
  run_mint(MintBatch, Transaction { ..tx, inputs: [src, wallet_in()] })
}

test open_topup_from_small_source_ok() {
  // Nguồn 2 ADA (output `Release` thường thấp), hội đồng nạp thêm tới 5 ADA lúc mở.
  let src = Input { output_reference: oref(0), output: out_nd(batch_addr(), assets.from_lovelace(2_000_000) |> assets.add(carp_p, carp_n, 30_000)) }
  run_mint(MintBatch, Transaction { ..open_tx(), inputs: [src, wallet_in()] })
}

test min_batch_lovelace_covers_largest_datum() {
  let big =
    with_round(Round { epoch: 999_999, root, leaf_count: 4096, paid: 1_000_000_000_000, claimed: empty_bitmap(4096) })
  let o = out(batch_addr(), batch_value(min_batch_lovelace, carp_p, carp_n, 1_000_000_000_000, own, 1), big)
  let size = bytearray.length(cbor.serialise(o))
  trace @"output_bytes": size
  ( 160 + size ) * coins_per_utxo_byte <= min_batch_lovelace
}

// (4) Lá mang định danh đợt: cùng (epoch, root) ở đợt khác (batch_id khác) ⇒ bằng chứng không khớp.
test claim_replayed_into_other_batch_rejected() fail {
  let other: Data =
    Active { batch_id: #"0000000000000000000000000000000000000000000000000000000000000000", start_epoch: 100, epoch_fees: fees(), share_bps: 5000, round: Some(round0()) }
  let cont: Data =
    Active { batch_id: #"0000000000000000000000000000000000000000000000000000000000000000", start_epoch: 100, epoch_fees: fees(), share_bps: 5000, round: Some(Round { ..round0(), paid: 3500, claimed: #"c0" }) }
  let tx = claim_tx()
  run_spend(Some(other), claim01(), Transaction { ..tx, inputs: [batch_in(other, 30_000), wallet_in()], outputs: [out(batch_addr(), bval(26_500), cont), pay(addr0(), 1000), pay(addr1(), 2500)] })
}

test open_wrong_batch_id_rejected() fail {
  let d: Data =
    Active { batch_id: batch_id_of(oref(1)), start_epoch: 100, epoch_fees: fees(), share_bps: 5000, round: None }
  run_mint(MintBatch, open_tx_with(out(batch_addr(), bval(30_000), d), [k1, k2], [custody_ref_ok()]))
}

// (5) PoC `poc_burn_stranger_takes_ada`: ADA Tombstone phải về `refund_to`.
test burn_refund_to_stranger_rejected() fail {
  let tx = burn_tx(tomb())
  run_spend(Some(tomb()), sr.Burn, Transaction { ..tx, outputs: [out_nd(vk_addr(k1), assets.from_lovelace(1_500_000))] })
}

test burn_refund_short_rejected() fail {
  let tx = burn_tx(tomb())
  run_spend(Some(tomb()), sr.Burn, Transaction { ..tx, outputs: [out_nd(vk_addr(outsider), assets.from_lovelace(1_499_999))] })
}

test close_tombstone_bad_refund_rejected() fail {
  let bad: Data = Tombstone { refund_to: #"0b0b" }
  let t = out(batch_addr(), assets.from_lovelace(1_500_000) |> assets.add(own, batch_token_name, 1), bad)
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_500), 108, [], [t]))
}

// (6) Nguồn Open có asset lạ ⇒ từ chối.
test open_src_junk_rejected() fail {
  let src = Input { output_reference: oref(0), output: out_nd(batch_addr(), assets.from_lovelace(batch_ada) |> assets.add(carp_p, carp_n, 30_000) |> assets.add(outsider, "JUNK", 1)) }
  run_mint(MintBatch, Transaction { ..open_tx(), inputs: [src, wallet_in()] })
}

// (7) Hạn đóng không chữ ký = start + 6 + 2.
test close_at_old_grace_rejected() fail {
  run_spend(Some(with_round(round0())), Close, close_tx_with(ledger_after(batch_ada, 26_500), 107, [], [tomb_out()]))
}

// ── Đột biến mục 3/6 (2026-10-08): ca âm phân biệt từng vế ──
// (3) PostRoot: token đợt phải ở lại output đợt (vế này riêng với vế CARP).
test post_root_token_escapes_rejected() fail {
  let tx = post_tx(fresh(), with_round(round0()), 101, [k1, k3])
  let v = assets.from_lovelace(batch_ada) |> assets.add(carp_p, carp_n, 30_000)
  let leak = out_nd(vk_addr(outsider), assets.from_lovelace(2_000_000) |> assets.add(own, batch_token_name, 1))
  run_spend(Some(fresh()), post_r(), Transaction { ..tx, outputs: [out(batch_addr(), v, with_round(round0())), leak] })
}

// (3) PostRoot: không được gắn thêm asset lạ vào output đợt (Claim sau đó ép value sạch ⇒ kẹt đợt).
test post_root_junk_added_rejected() fail {
  let tx = post_tx(fresh(), with_round(round0()), 101, [k1, k3])
  let v = bval(30_000) |> assets.add(outsider, "JUNK", 1)
  run_spend(Some(fresh()), post_r(), Transaction { ..tx, outputs: [out(batch_addr(), v, with_round(round0()))] })
}

// (3) Ghim GIÁ TRỊ hằng theo spec (5 ADA): `open_below_min_ada_rejected` dùng `min_batch_lovelace - 1`
// nên trượt theo hằng khi hằng bị hạ.
test open_ada_below_spec_floor_rejected() fail {
  let v = batch_value(4_999_999, carp_p, carp_n, 30_000, own, 1)
  let src = Input { output_reference: oref(0), output: out_nd(batch_addr(), assets.from_lovelace(2_000_000) |> assets.add(carp_p, carp_n, 30_000)) }
  let tx = open_tx_with(out(batch_addr(), v, fresh()), [k1, k2], [custody_ref_ok()])
  run_mint(MintBatch, Transaction { ..tx, inputs: [src, wallet_in()] })
}

// (6) Nguồn Open đã mang token đợt ⇒ handler mint tự từ chối (không dựa vào spend `Open`).
test open_src_holds_batch_token_rejected() fail {
  let src = Input { output_reference: oref(0), output: out_nd(batch_addr(), assets.from_lovelace(batch_ada) |> assets.add(carp_p, carp_n, 30_000) |> assets.add(own, batch_token_name, 1)) }
  let leak = out_nd(vk_addr(outsider), assets.from_lovelace(2_000_000) |> assets.add(own, batch_token_name, 1))
  run_mint(MintBatch, Transaction { ..open_tx(), inputs: [src, wallet_in()], outputs: [out(batch_addr(), bval(30_000), fresh()), leak] })
}
