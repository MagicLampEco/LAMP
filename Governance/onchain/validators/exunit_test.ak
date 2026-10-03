// Phép đo `[SUMBATCH-EXUNIT]` (SPEC §v2.10) — ExUnit của MỘT giao dịch SumBatch k phiếu.
//
// Giao dịch dựng TRỌN: tiêu Tally (SumBatch) + k UTxO phiếu (ConsumeForTally) + 1 input phí, đốt
// k nullifier (BurnNullifier), reference input = (pha bật C3) k chứng thực tại
// `Script(c3_script_hash)` + 3 UTxO mang reference script + bảng tham số (đặt CUỐI danh sách —
// `read_weight_param` dùng `list.find`, đây là thứ tự đắt nhất), output = Tally ra + output thối.
// Ba validator chạy trên CÙNG một `Transaction`: `tally.spend` ×1, `vote.spend` ×k,
// `nullifier.mint` ×1. ExUnit của giao dịch = tổng các redeemer.
//
// ── Cách đọc số ──
// Mỗi ca in `[mem, cpu]` của CẢ thân ca, gồm cả phần dựng dữ liệu. Nên mỗi cấu hình có bốn ca:
//   `…_base`  — dựng kịch bản + `serialise_data` cả kịch bản (ép mọi trường được tính ra);
//   `…_tally` / `…_votes` / `…_nl` — ĐÚNG phần `_base` đó, rồi gọi validator.
// Chi phí của một script = (ca script) − (`_base` cùng cấu hình). `…_votes` gọi `vote.spend` cho cả
// k phiếu trong một ca (cộng dồn), cộng chi phí duyệt danh sách k phần tử — không đáng kể so với k
// lần `mpf.has`.
//
// Trước mỗi lần gọi, redeemer và datum được ÉP KIỂU LẠI từ `Data` (`expect r: T = data`) — đúng
// việc lớp bọc validator làm trên chuỗi. Không có bước đó thì phép đo bỏ sót phần kiểm hình dạng
// của k bằng chứng MPF trong redeemer.
//
// ── Giới hạn của phép đo (đọc trước khi dùng số) ──
//   • Gọi thẳng handler, không qua lớp bọc biên dịch thật. Đối chiếu với ExUnit THẬT do Emulator
//     tính trên giao dịch do SDK dựng (`Governance/tests/exunitBench.test.ts`, heap rỗng): số ở
//     đây CAO hơn Emulator khoảng 5% (k = 4, C3 tắt: 9 260 999 so với 8 786 076 mem), nên đọc
//     như cận trên gần — không phải cận dưới.
//   • `[VP-ZERO-FACTOR]`: c1 = c2 = c4 = 0 bị validator ép ⇒ `interp` của ba bảng đó dừng ngay ở mốc
//     đầu. Phần tăng khi mở nguồn C1/C2/C4 đo ở MỨC THƯ VIỆN (khối `lib_…` cuối tệp) và cộng vào
//     để ra cận trên — không chạy được ở mức validator vì validator bác c ≠ 0.
//   • Heap `top_did_vp` ĐẦY (bft_floor − 1 mục) và mọi VP bằng nhau ⇒ `insert_desc` đi hết danh
//     sách với mỗi phiếu: ca đắt nhất của heap.
//   • Bảng knots 8 mốc mỗi bảng. Số mốc là một tham số của phép đo: bảng dài hơn làm `d8_ok` (đọc
//     lại ở mỗi lượt) và `interp` đắt lên.

use aiken/builtin
use aiken/collection/list
use aiken/interval
use aiken/merkle_patricia_forestry as mpf
use aiken/merkle_patricia_forestry.{Proof}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use exunit_fixtures as fx
use governance
use magiclamp/governance/names.{nullifier_name, proposal_id_of}
use magiclamp/governance/power.{Knot, scale}
use magiclamp/governance/tally as tally_lib
use magiclamp/governance/types.{
  Open, ProposalResult, Summing, TallyDatum, TopEntry, VoteDatum, WeightParam,
  Yes,
}
use magiclamp/governance/weight_guard
use nullifier
use tally
use vote

// ── Tham số apply (hash 28 byte thật cỡ) ──

const tally_policy: PolicyId =
  #"7a117a117a117a117a117a117a117a117a117a117a117a117a117a11"

const vote_sh: ByteArray =
  #"c0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0de"

const nl_policy: PolicyId =
  #"77777777777777777777777777777777777777777777777777777777"

const wp_policy: PolicyId =
  #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const c3_policy_on: PolicyId =
  #"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3"

const c3_sh: ByteArray =
  #"c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5"

const tally_sh: ByteArray =
  #"7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a"

const taad_policy: PolicyId =
  #"7aad7aad7aad7aad7aad7aad7aad7aad7aad7aad7aad7aad7aad7aad"

const fee_pkh: ByteArray =
  #"fee0fee0fee0fee0fee0fee0fee0fee0fee0fee0fee0fee0fee0fee0"

const ref_pkh: ByteArray =
  #"4ef04ef04ef04ef04ef04ef04ef04ef04ef04ef04ef04ef04ef04ef0"

/// 5 ngày — epoch mainnet.
const ms_ep: Int = 432_000_000

const window: Int = 3

const open_e: Int = 100

const close_e: Int = 102

/// Giá trị C3 khai + chứng thực khi pha bật C3: sát cap bảng (4096) ⇒ `interp` đi hết 7 đoạn.
const c3_val: Int = 4000

// ── Bảng tham số: 8 mốc mỗi bảng, hợp khuôn G0 + D8 (w_1 = w_3 = 1, w_2 = w_4 = 0.5) ──

fn lin8() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 1, pow: 1 * scale },
    Knot { c: 4, pow: 4 * scale },
    Knot { c: 16, pow: 16 * scale },
    Knot { c: 64, pow: 64 * scale },
    Knot { c: 256, pow: 256 * scale },
    Knot { c: 1024, pow: 1024 * scale },
    Knot { c: 4096, pow: 4096 * scale },
  ]
}

fn sqrt8() -> List<Knot> {
  [
    Knot { c: 0, pow: 0 },
    Knot { c: 1, pow: 1 * scale },
    Knot { c: 4, pow: 2 * scale },
    Knot { c: 16, pow: 4 * scale },
    Knot { c: 64, pow: 8 * scale },
    Knot { c: 256, pow: 16 * scale },
    Knot { c: 1024, pow: 32 * scale },
    Knot { c: 4096, pow: 64 * scale },
  ]
}

fn wp_of(bft: Int) -> WeightParam {
  WeightParam {
    k1: lin8(),
    k2: sqrt8(),
    k3: lin8(),
    k4: sqrt8(),
    bft_floor: bft,
    quorum_vp_threshold: 1,
    quorum_voter_threshold: 21,
    theta_num: 2,
    theta_den: 3,
  }
}

fn wp_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0",
    output_index: 0,
  }
}

fn script_addr(h: ByteArray) -> Address {
  Address { payment_credential: Script(h), stake_credential: None }
}

fn vk_addr(h: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(h), stake_credential: None }
}

fn out(addr: Address, value: Value, d: Data) -> Output {
  Output { address: addr, value, datum: InlineDatum(d), reference_script: None }
}

fn tally_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a",
    output_index: 0,
  }
}

// ── Kịch bản ──

type Book {
  S0
  S10k
}

type Scn {
  tx: Transaction,
  d_in: TallyDatum,
  votes: List<VoteDatum>,
  vote_refs: List<OutputReference>,
  tally_red: tally.TallyRedeemer,
  vote_reds: List<vote.VoteRedeemer>,
  nl_red: nullifier.NullifierRedeemer,
  c3_policy: PolicyId,
}

fn book_root_in(b: Book) -> ByteArray {
  when b is {
    S0 -> fx.s0_root_in
    S10k -> fx.s10k_root_in
  }
}

fn book_root_after(b: Book, k: Int) -> ByteArray {
  let roots =
    when b is {
      S0 -> fx.s0_roots_after()
      S10k -> fx.s10k_roots_after()
    }
  expect Some(r) = list.at(roots, k - 1)
  r
}

fn book_insert(b: Book, k: Int) -> List<Proof> {
  list.take(
    when b is {
      S0 -> fx.s0_insert_proofs()
      S10k -> fx.s10k_insert_proofs()
    },
    k,
  )
}

fn book_mem(b: Book, k: Int) -> List<Proof> {
  when b is {
    S0 ->
      if k == 1 {
        fx.s0_mem_k1()
      } else if k == 2 {
        fx.s0_mem_k2()
      } else if k == 3 {
        fx.s0_mem_k3()
      } else if k == 4 {
        fx.s0_mem_k4()
      } else if k == 5 {
        fx.s0_mem_k5()
      } else if k == 6 {
        fx.s0_mem_k6()
      } else if k == 7 {
        fx.s0_mem_k7()
      } else if k == 8 {
        fx.s0_mem_k8()
      } else if k == 9 {
        fx.s0_mem_k9()
      } else if k == 10 {
        fx.s0_mem_k10()
      } else if k == 20 {
        fx.s0_mem_k20()
      } else if k == 40 {
        fx.s0_mem_k40()
      } else {
        fail @"k không có bằng chứng thành viên"
      }
    S10k ->
      if k == 1 {
        fx.s10k_mem_k1()
      } else if k == 2 {
        fx.s10k_mem_k2()
      } else if k == 3 {
        fx.s10k_mem_k3()
      } else if k == 4 {
        fx.s10k_mem_k4()
      } else if k == 5 {
        fx.s10k_mem_k5()
      } else if k == 6 {
        fx.s10k_mem_k6()
      } else if k == 7 {
        fx.s10k_mem_k7()
      } else if k == 8 {
        fx.s10k_mem_k8()
      } else if k == 9 {
        fx.s10k_mem_k9()
      } else if k == 10 {
        fx.s10k_mem_k10()
      } else if k == 20 {
        fx.s10k_mem_k20()
      } else if k == 40 {
        fx.s10k_mem_k40()
      } else {
        fail @"k không có bằng chứng thành viên"
      }
  }
}

fn heap_zero(n: Int) -> List<TopEntry> {
  if n <= 0 {
    []
  } else {
    [TopEntry { vp_raw: 0, choice: Yes }, ..heap_zero(n - 1)]
  }
}

/// Heap ĐẦY (bft − 1 mục): lượt gom thứ hai trở đi của một proposal đủ đông.
fn scn(b: Book, k: Int, c3_on: Bool, bft: Int) -> Scn {
  scn_h(b, k, c3_on, bft, bft - 1)
}

/// `heap_n` = số mục `top_did_vp` có sẵn trước lô (0 = lô đầu tiên của proposal).
fn scn_h(b: Book, k: Int, c3_on: Bool, bft: Int, heap_n: Int) -> Scn {
  let wp = wp_of(bft)
  let c3_policy =
    if c3_on {
      c3_policy_on
    } else {
      #""
    }
  let dids = list.take(fx.batch_dids(), k)
  let votes =
    list.map(
      dids,
      fn(d) {
        VoteDatum {
          proposal_id: fx.prop,
          did_commit: d,
          nullifier: nullifier_name(d, fx.prop),
          choice: Yes,
          c1_capped: 0,
          c2_capped: 0,
          c3_capped: if c3_on {
            c3_val
          } else {
            0
          },
          c4_capped: 0,
        }
      },
    )
  let vote_refs =
    list.map(
      dids,
      fn(d) { OutputReference { transaction_id: d, output_index: 1 } },
    )
  let vote_inputs =
    list.map2(
      votes,
      vote_refs,
      fn(v, r) {
        Input {
          output_reference: r,
          output: out(
            script_addr(vote_sh),
            assets.from_lovelace(1_500_000)
              |> assets.add(nl_policy, v.nullifier, 1),
            v,
          ),
        }
      },
    )
  let d_in =
    TallyDatum {
      proposal_id: fx.prop,
      phase: Summing,
      weight_param_ref: wp_ref(),
      yes_power_raw: 0,
      no_power_raw: 0,
      abstain_power_raw: 0,
      voters_acc: 10_000,
      yes_voters_acc: 10_000,
      top_did_vp: heap_zero(heap_n),
      yes_power_eff: 0,
      no_power_eff: 0,
      abstain_power_eff: 0,
      vote_open_epoch: open_e,
      vote_close_epoch: close_e,
      voted_root: book_root_in(b),
    }
  let (dy, dn, da, dv, dyv) = tally_lib.derive_batch(wp, votes)
  let d_out =
    TallyDatum {
      ..d_in,
      yes_power_raw: d_in.yes_power_raw + dy,
      no_power_raw: d_in.no_power_raw + dn,
      abstain_power_raw: d_in.abstain_power_raw + da,
      voters_acc: d_in.voters_acc + dv,
      yes_voters_acc: d_in.yes_voters_acc + dyv,
      top_did_vp: tally_lib.merge_top(
        d_in.top_did_vp,
        tally_lib.batch_entries(wp, votes),
        bft - 1,
      ),
      voted_root: book_root_after(b, k),
    }
  let tally_value =
    assets.from_lovelace(3_000_000) |> assets.add(tally_policy, fx.prop, 1)
  let tally_in =
    Input {
      output_reference: tally_ref(),
      output: out(script_addr(tally_sh), tally_value, d_in),
    }
  let fee_in =
    Input {
      output_reference: OutputReference {
        transaction_id: #"fefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefe",
        output_index: 0,
      },
      output: Output {
        address: vk_addr(fee_pkh),
        value: assets.from_lovelace(20_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let script_ref_in =
    fn(ix: Int, h: ByteArray) {
      Input {
        output_reference: OutputReference {
          transaction_id: #"4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e",
          output_index: ix,
        },
        output: Output {
          address: vk_addr(ref_pkh),
          value: assets.from_lovelace(40_000_000),
          datum: NoDatum,
          reference_script: Some(h),
        },
      }
    }
  let c3_refs =
    if c3_on {
      list.map(
        dids,
        fn(d) {
          Input {
            output_reference: OutputReference {
              transaction_id: d,
              output_index: 2,
            },
            output: out(
              script_addr(c3_sh),
              assets.from_lovelace(1_500_000)
                |> assets.add(c3_policy_on, d, 1),
              c3_val,
            ),
          }
        },
      )
    } else {
      []
    }
  let wp_in =
    Input {
      output_reference: wp_ref(),
      output: out(
        script_addr(wp_policy),
        assets.from_lovelace(5_000_000) |> assets.add(wp_policy, #"5031", 1),
        wp,
      ),
    }
  let mint =
    list.foldl(
      votes,
      assets.zero,
      fn(v, acc) { assets.add(acc, nl_policy, v.nullifier, -1) },
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [tally_in, ..list.concat(vote_inputs, [fee_in])],
      reference_inputs: list.concat(
        c3_refs,
        [
          script_ref_in(0, tally_sh),
          script_ref_in(1, vote_sh),
          script_ref_in(2, nl_policy),
          wp_in,
        ],
      ),
      outputs: [
        out(script_addr(tally_sh), tally_value, d_out),
        Output {
          address: vk_addr(fee_pkh),
          value: assets.from_lovelace(18_000_000),
          datum: NoDatum,
          reference_script: None,
        },
      ],
      mint,
      validity_range: interval.between(
        close_e * ms_ep + 1_000,
        close_e * ms_ep + 600_000,
      ),
    }
  Scn {
    tx,
    d_in,
    votes,
    vote_refs,
    tally_red: tally.SumBatch { insert_proofs: book_insert(b, k) },
    vote_reds: list.map(
      book_mem(b, k),
      fn(p) { vote.ConsumeForTally { book_proof: p } },
    ),
    nl_red: nullifier.BurnNullifier { proposal_id: fx.prop, did_commits: dids },
    c3_policy,
  }
}

/// Ép MỌI trường của kịch bản được tính ra (UPLC nghiêm ngặt + `serialise_data` đi hết cây).
fn force(s: Scn) -> Bool {
  let d: Data = s
  builtin.length_of_bytearray(builtin.serialise_data(d)) > 0
}

fn run_tally(s: Scn) -> Bool {
  let rd: Data = s.tally_red
  expect r: tally.TallyRedeemer = rd
  let dd: Data = Some(s.d_in)
  expect d: Option<TallyDatum> = dd
  tally.tally.spend(
    tally_policy,
    vote_sh,
    nl_policy,
    wp_policy,
    s.c3_policy,
    c3_sh,
    window,
    ms_ep,
    0,
    [],
    d,
    r,
    tally_ref(),
    s.tx,
  )
}

fn run_votes(s: Scn) -> Bool {
  list.all(
    list.zip(s.votes, list.zip(s.vote_refs, s.vote_reds)),
    fn(t) {
      let (v, (oref, red)) = t
      let rd: Data = red
      expect r: vote.VoteRedeemer = rd
      let dd: Data = Some(v)
      expect d: Option<VoteDatum> = dd
      vote.vote.spend(
        tally_policy,
        nl_policy,
        taad_policy,
        ms_ep,
        window,
        0,
        d,
        r,
        oref,
        s.tx,
      )
    },
  )
}

fn run_nl(s: Scn) -> Bool {
  let rd: Data = s.nl_red
  expect r: nullifier.NullifierRedeemer = rd
  nullifier.nullifier.mint(
    tally_policy,
    taad_policy,
    ms_ep,
    window,
    0,
    r,
    nl_policy,
    s.tx,
  )
}

// ════════════════════════════════════════════════════════════
// Ma trận đo: k ∈ {1, 5, 10, 20, 40} × sổ {s0, s10k} × C3 {tắt, bật}; bft_floor = 21
// (`bft_floor_min` của pha Launch — heap 20 mục). Tên: e<k>_<sổ>_<c3>_<phần>.
// ════════════════════════════════════════════════════════════

const bft: Int = 21

// ── s0, C3 tắt ──

test e01_s0_off_base() {
  force(scn(S0, 1, False, bft))
}

test e01_s0_off_tally() {
  let s = scn(S0, 1, False, bft)
  force(s) && run_tally(s)
}

test e01_s0_off_votes() {
  let s = scn(S0, 1, False, bft)
  force(s) && run_votes(s)
}

test e01_s0_off_nl() {
  let s = scn(S0, 1, False, bft)
  force(s) && run_nl(s)
}

test e05_s0_off_base() {
  force(scn(S0, 5, False, bft))
}

test e05_s0_off_tally() {
  let s = scn(S0, 5, False, bft)
  force(s) && run_tally(s)
}

test e05_s0_off_votes() {
  let s = scn(S0, 5, False, bft)
  force(s) && run_votes(s)
}

test e05_s0_off_nl() {
  let s = scn(S0, 5, False, bft)
  force(s) && run_nl(s)
}

test e10_s0_off_base() {
  force(scn(S0, 10, False, bft))
}

test e10_s0_off_tally() {
  let s = scn(S0, 10, False, bft)
  force(s) && run_tally(s)
}

test e10_s0_off_votes() {
  let s = scn(S0, 10, False, bft)
  force(s) && run_votes(s)
}

test e10_s0_off_nl() {
  let s = scn(S0, 10, False, bft)
  force(s) && run_nl(s)
}

test e20_s0_off_base() {
  force(scn(S0, 20, False, bft))
}

test e20_s0_off_tally() {
  let s = scn(S0, 20, False, bft)
  force(s) && run_tally(s)
}

test e20_s0_off_votes() {
  let s = scn(S0, 20, False, bft)
  force(s) && run_votes(s)
}

test e20_s0_off_nl() {
  let s = scn(S0, 20, False, bft)
  force(s) && run_nl(s)
}

test e40_s0_off_base() {
  force(scn(S0, 40, False, bft))
}

test e40_s0_off_tally() {
  let s = scn(S0, 40, False, bft)
  force(s) && run_tally(s)
}

test e40_s0_off_votes() {
  let s = scn(S0, 40, False, bft)
  force(s) && run_votes(s)
}

test e40_s0_off_nl() {
  let s = scn(S0, 40, False, bft)
  force(s) && run_nl(s)
}

// ── s0, C3 bật ──

test e01_s0_on_base() {
  force(scn(S0, 1, True, bft))
}

test e01_s0_on_tally() {
  let s = scn(S0, 1, True, bft)
  force(s) && run_tally(s)
}

test e01_s0_on_votes() {
  let s = scn(S0, 1, True, bft)
  force(s) && run_votes(s)
}

test e01_s0_on_nl() {
  let s = scn(S0, 1, True, bft)
  force(s) && run_nl(s)
}

test e05_s0_on_base() {
  force(scn(S0, 5, True, bft))
}

test e05_s0_on_tally() {
  let s = scn(S0, 5, True, bft)
  force(s) && run_tally(s)
}

test e05_s0_on_votes() {
  let s = scn(S0, 5, True, bft)
  force(s) && run_votes(s)
}

test e05_s0_on_nl() {
  let s = scn(S0, 5, True, bft)
  force(s) && run_nl(s)
}

test e10_s0_on_base() {
  force(scn(S0, 10, True, bft))
}

test e10_s0_on_tally() {
  let s = scn(S0, 10, True, bft)
  force(s) && run_tally(s)
}

test e10_s0_on_votes() {
  let s = scn(S0, 10, True, bft)
  force(s) && run_votes(s)
}

test e10_s0_on_nl() {
  let s = scn(S0, 10, True, bft)
  force(s) && run_nl(s)
}

test e20_s0_on_base() {
  force(scn(S0, 20, True, bft))
}

test e20_s0_on_tally() {
  let s = scn(S0, 20, True, bft)
  force(s) && run_tally(s)
}

test e20_s0_on_votes() {
  let s = scn(S0, 20, True, bft)
  force(s) && run_votes(s)
}

test e20_s0_on_nl() {
  let s = scn(S0, 20, True, bft)
  force(s) && run_nl(s)
}

test e40_s0_on_base() {
  force(scn(S0, 40, True, bft))
}

test e40_s0_on_tally() {
  let s = scn(S0, 40, True, bft)
  force(s) && run_tally(s)
}

test e40_s0_on_votes() {
  let s = scn(S0, 40, True, bft)
  force(s) && run_votes(s)
}

test e40_s0_on_nl() {
  let s = scn(S0, 40, True, bft)
  force(s) && run_nl(s)
}

// ── s10k, C3 tắt ──

test e01_s10k_off_base() {
  force(scn(S10k, 1, False, bft))
}

test e01_s10k_off_tally() {
  let s = scn(S10k, 1, False, bft)
  force(s) && run_tally(s)
}

test e01_s10k_off_votes() {
  let s = scn(S10k, 1, False, bft)
  force(s) && run_votes(s)
}

test e01_s10k_off_nl() {
  let s = scn(S10k, 1, False, bft)
  force(s) && run_nl(s)
}

test e05_s10k_off_base() {
  force(scn(S10k, 5, False, bft))
}

test e05_s10k_off_tally() {
  let s = scn(S10k, 5, False, bft)
  force(s) && run_tally(s)
}

test e05_s10k_off_votes() {
  let s = scn(S10k, 5, False, bft)
  force(s) && run_votes(s)
}

test e05_s10k_off_nl() {
  let s = scn(S10k, 5, False, bft)
  force(s) && run_nl(s)
}

test e10_s10k_off_base() {
  force(scn(S10k, 10, False, bft))
}

test e10_s10k_off_tally() {
  let s = scn(S10k, 10, False, bft)
  force(s) && run_tally(s)
}

test e10_s10k_off_votes() {
  let s = scn(S10k, 10, False, bft)
  force(s) && run_votes(s)
}

test e10_s10k_off_nl() {
  let s = scn(S10k, 10, False, bft)
  force(s) && run_nl(s)
}

test e20_s10k_off_base() {
  force(scn(S10k, 20, False, bft))
}

test e20_s10k_off_tally() {
  let s = scn(S10k, 20, False, bft)
  force(s) && run_tally(s)
}

test e20_s10k_off_votes() {
  let s = scn(S10k, 20, False, bft)
  force(s) && run_votes(s)
}

test e20_s10k_off_nl() {
  let s = scn(S10k, 20, False, bft)
  force(s) && run_nl(s)
}

test e40_s10k_off_base() {
  force(scn(S10k, 40, False, bft))
}

test e40_s10k_off_tally() {
  let s = scn(S10k, 40, False, bft)
  force(s) && run_tally(s)
}

test e40_s10k_off_votes() {
  let s = scn(S10k, 40, False, bft)
  force(s) && run_votes(s)
}

test e40_s10k_off_nl() {
  let s = scn(S10k, 40, False, bft)
  force(s) && run_nl(s)
}

// ── s10k, C3 bật ──

test e01_s10k_on_base() {
  force(scn(S10k, 1, True, bft))
}

test e01_s10k_on_tally() {
  let s = scn(S10k, 1, True, bft)
  force(s) && run_tally(s)
}

test e01_s10k_on_votes() {
  let s = scn(S10k, 1, True, bft)
  force(s) && run_votes(s)
}

test e01_s10k_on_nl() {
  let s = scn(S10k, 1, True, bft)
  force(s) && run_nl(s)
}

test e05_s10k_on_base() {
  force(scn(S10k, 5, True, bft))
}

test e05_s10k_on_tally() {
  let s = scn(S10k, 5, True, bft)
  force(s) && run_tally(s)
}

test e05_s10k_on_votes() {
  let s = scn(S10k, 5, True, bft)
  force(s) && run_votes(s)
}

test e05_s10k_on_nl() {
  let s = scn(S10k, 5, True, bft)
  force(s) && run_nl(s)
}

test e10_s10k_on_base() {
  force(scn(S10k, 10, True, bft))
}

test e10_s10k_on_tally() {
  let s = scn(S10k, 10, True, bft)
  force(s) && run_tally(s)
}

test e10_s10k_on_votes() {
  let s = scn(S10k, 10, True, bft)
  force(s) && run_votes(s)
}

test e10_s10k_on_nl() {
  let s = scn(S10k, 10, True, bft)
  force(s) && run_nl(s)
}

test e20_s10k_on_base() {
  force(scn(S10k, 20, True, bft))
}

test e20_s10k_on_tally() {
  let s = scn(S10k, 20, True, bft)
  force(s) && run_tally(s)
}

test e20_s10k_on_votes() {
  let s = scn(S10k, 20, True, bft)
  force(s) && run_votes(s)
}

test e20_s10k_on_nl() {
  let s = scn(S10k, 20, True, bft)
  force(s) && run_nl(s)
}

test e40_s10k_on_base() {
  force(scn(S10k, 40, True, bft))
}

test e40_s10k_on_tally() {
  let s = scn(S10k, 40, True, bft)
  force(s) && run_tally(s)
}

test e40_s10k_on_votes() {
  let s = scn(S10k, 40, True, bft)
  force(s) && run_votes(s)
}

test e40_s10k_on_nl() {
  let s = scn(S10k, 40, True, bft)
  force(s) && run_nl(s)
}

// ── Biến thể heap lớn nhất: bft_floor = 64 (`bft_floor_max`) ⇒ heap 63 mục; s10k, C3 bật ──

test e10_s10k_on_bft64_base() {
  force(scn(S10k, 10, True, 64))
}

test e10_s10k_on_bft64_tally() {
  let s = scn(S10k, 10, True, 64)
  force(s) && run_tally(s)
}

// ════════════════════════════════════════════════════════════
// MỨC THƯ VIỆN — phần tăng khi VP ≠ 0 (cận trên khi mở nguồn C1/C2/C4)
//
// Hai phần của `tally.SumBatch` phụ thuộc giá trị c*: `sum_batch_consistent` (qua `derive_batch`)
// và `top_heap_consistent` (qua `batch_entries` + `merge_top`). Đo đúng hai lời gọi đó trên:
//   `vp0`  — phiếu như ở mức validator (c1 = c2 = c4 = 0, c3 = 4000), heap 20 mục VP 0;
//   `vpx`  — c1..c4 đều ≠ 0 sát cap (interp đi hết bảng, nhân số lớn), VP đôi một khác nhau, heap 20
//            mục VP rất lớn ⇒ phiếu mới chèn ở CUỐI heap (ca đắt nhất).
// Cận trên của `tally` = (tally đo ở mức validator, C3 bật) + (lib_vpx − lib_vp0) cùng k.
// ════════════════════════════════════════════════════════════

type LibIn {
  votes: List<VoteDatum>,
  heap: List<TopEntry>,
}

fn lib_in(k: Int, nonzero: Bool) -> LibIn {
  let dids = list.take(fx.batch_dids(), k)
  let votes =
    list.indexed_map(
      dids,
      fn(i, d) {
        VoteDatum {
          proposal_id: fx.prop,
          did_commit: d,
          nullifier: d,
          choice: Yes,
          c1_capped: if nonzero {
            4000 - i
          } else {
            0
          },
          c2_capped: if nonzero {
            3990 - i
          } else {
            0
          },
          c3_capped: c3_val,
          c4_capped: if nonzero {
            3980 - i
          } else {
            0
          },
        }
      },
    )
  let heap =
    if nonzero {
      list.map(
        list.range(1, 20),
        fn(i) {
          TopEntry {
            vp_raw: 1_000_000_000_000_000_000_000_000_000_000 - i,
            choice: Yes,
          }
        },
      )
    } else {
      heap_zero(20)
    }
  LibIn { votes, heap }
}

fn lib_force(x: LibIn) -> Bool {
  let d: Data = x
  builtin.length_of_bytearray(builtin.serialise_data(d)) > 0
}

fn lib_run(x: LibIn) -> Bool {
  let wp = wp_of(21)
  // Y HỆT hình dạng validator từ 2026-09-29: quy đổi lô ĐÚNG MỘT LẦN rồi dùng cho
  // cả hai bất biến. Bản trước gọi `derive_batch` và `batch_entries` rời nhau, nên
  // nó đo `vp_raw` HAI LẦN mỗi phiếu — đúng với validator lúc đó, và gấp đôi so với
  // validator bây giờ.
  let entries = tally_lib.batch_entries(wp, x.votes)
  let (dy, _, _, dv, _) = tally_lib.derive_entries(entries)
  let merged = tally_lib.merge_top(x.heap, entries, 20)
  dy >= 0 && dv >= 0 && list.length(merged) == 20
}

/// Bảng đo phải là bảng validator THẬT nhận — nếu không, số đo nói về một bảng không ai dùng được.
test lib_bang_8_moc_hop_khuon_d8() {
  let wp = wp_of(21)
  and {
    weight_guard.d8_ok(wp.k1, wp.k2, wp.k3, wp.k4),
    power.cap_of(wp.k3) >= c3_val,
  }
}

/// Đầu vào `vpx` phải phân biệt được với `vp0`: VP > 0 và đôi một khác nhau.
test lib_vpx_thuc_su_khac_khong() {
  let wp = wp_of(21)
  let es = tally_lib.batch_entries(wp, lib_in(5, True).votes)
  let es0 = tally_lib.batch_entries(wp, lib_in(5, False).votes)
  let vps = list.map(es, fn(e) { e.vp_raw })
  and {
    list.all(es, fn(e) { e.vp_raw > 0 }),
    list.all(es0, fn(e) { e.vp_raw == 0 }),
    list.unique(vps) == vps,
  }
}

test lib_k01_vp0_base() {
  lib_force(lib_in(1, False))
}

test lib_k01_vp0_run() {
  let x = lib_in(1, False)
  lib_force(x) && lib_run(x)
}

test lib_k01_vpx_base() {
  lib_force(lib_in(1, True))
}

test lib_k01_vpx_run() {
  let x = lib_in(1, True)
  lib_force(x) && lib_run(x)
}

test lib_k05_vp0_base() {
  lib_force(lib_in(5, False))
}

test lib_k05_vp0_run() {
  let x = lib_in(5, False)
  lib_force(x) && lib_run(x)
}

test lib_k05_vpx_base() {
  lib_force(lib_in(5, True))
}

test lib_k05_vpx_run() {
  let x = lib_in(5, True)
  lib_force(x) && lib_run(x)
}

test lib_k10_vp0_base() {
  lib_force(lib_in(10, False))
}

test lib_k10_vp0_run() {
  let x = lib_in(10, False)
  lib_force(x) && lib_run(x)
}

test lib_k10_vpx_base() {
  lib_force(lib_in(10, True))
}

test lib_k10_vpx_run() {
  let x = lib_in(10, True)
  lib_force(x) && lib_run(x)
}

test lib_k20_vp0_base() {
  lib_force(lib_in(20, False))
}

test lib_k20_vp0_run() {
  let x = lib_in(20, False)
  lib_force(x) && lib_run(x)
}

test lib_k20_vpx_base() {
  lib_force(lib_in(20, True))
}

test lib_k20_vpx_run() {
  let x = lib_in(20, True)
  lib_force(x) && lib_run(x)
}

test lib_k40_vp0_base() {
  lib_force(lib_in(40, False))
}

test lib_k40_vp0_run() {
  let x = lib_in(40, False)
  lib_force(x) && lib_run(x)
}

test lib_k40_vpx_base() {
  lib_force(lib_in(40, True))
}

test lib_k40_vpx_run() {
  let x = lib_in(40, True)
  lib_force(x) && lib_run(x)
}

// ════════════════════════════════════════════════════════════
// Bổ sung k ∈ {2, 3, 4} (heap đầy) để chốt k tối đa, và biến thể heap RỖNG (lô đầu của
// proposal, `h0`) k ∈ {1..5} để đối chiếu với ExUnit Emulator của `exunitBench.test.ts`.
// ════════════════════════════════════════════════════════════

test e02_s0_off_base() {
  force(scn_h(S0, 2, False, bft, bft - 1))
}

test e02_s0_off_tally() {
  let s = scn_h(S0, 2, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e02_s0_off_votes() {
  let s = scn_h(S0, 2, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e02_s0_off_nl() {
  let s = scn_h(S0, 2, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e03_s0_off_base() {
  force(scn_h(S0, 3, False, bft, bft - 1))
}

test e03_s0_off_tally() {
  let s = scn_h(S0, 3, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e03_s0_off_votes() {
  let s = scn_h(S0, 3, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e03_s0_off_nl() {
  let s = scn_h(S0, 3, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e04_s0_off_base() {
  force(scn_h(S0, 4, False, bft, bft - 1))
}

test e04_s0_off_tally() {
  let s = scn_h(S0, 4, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e04_s0_off_votes() {
  let s = scn_h(S0, 4, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e04_s0_off_nl() {
  let s = scn_h(S0, 4, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e02_s0_on_base() {
  force(scn_h(S0, 2, True, bft, bft - 1))
}

test e02_s0_on_tally() {
  let s = scn_h(S0, 2, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e02_s0_on_votes() {
  let s = scn_h(S0, 2, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e02_s0_on_nl() {
  let s = scn_h(S0, 2, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e03_s0_on_base() {
  force(scn_h(S0, 3, True, bft, bft - 1))
}

test e03_s0_on_tally() {
  let s = scn_h(S0, 3, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e03_s0_on_votes() {
  let s = scn_h(S0, 3, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e03_s0_on_nl() {
  let s = scn_h(S0, 3, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e04_s0_on_base() {
  force(scn_h(S0, 4, True, bft, bft - 1))
}

test e04_s0_on_tally() {
  let s = scn_h(S0, 4, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e04_s0_on_votes() {
  let s = scn_h(S0, 4, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e04_s0_on_nl() {
  let s = scn_h(S0, 4, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e02_s10k_off_base() {
  force(scn_h(S10k, 2, False, bft, bft - 1))
}

test e02_s10k_off_tally() {
  let s = scn_h(S10k, 2, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e02_s10k_off_votes() {
  let s = scn_h(S10k, 2, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e02_s10k_off_nl() {
  let s = scn_h(S10k, 2, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e03_s10k_off_base() {
  force(scn_h(S10k, 3, False, bft, bft - 1))
}

test e03_s10k_off_tally() {
  let s = scn_h(S10k, 3, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e03_s10k_off_votes() {
  let s = scn_h(S10k, 3, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e03_s10k_off_nl() {
  let s = scn_h(S10k, 3, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e04_s10k_off_base() {
  force(scn_h(S10k, 4, False, bft, bft - 1))
}

test e04_s10k_off_tally() {
  let s = scn_h(S10k, 4, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e04_s10k_off_votes() {
  let s = scn_h(S10k, 4, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e04_s10k_off_nl() {
  let s = scn_h(S10k, 4, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e02_s10k_on_base() {
  force(scn_h(S10k, 2, True, bft, bft - 1))
}

test e02_s10k_on_tally() {
  let s = scn_h(S10k, 2, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e02_s10k_on_votes() {
  let s = scn_h(S10k, 2, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e02_s10k_on_nl() {
  let s = scn_h(S10k, 2, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e03_s10k_on_base() {
  force(scn_h(S10k, 3, True, bft, bft - 1))
}

test e03_s10k_on_tally() {
  let s = scn_h(S10k, 3, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e03_s10k_on_votes() {
  let s = scn_h(S10k, 3, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e03_s10k_on_nl() {
  let s = scn_h(S10k, 3, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e04_s10k_on_base() {
  force(scn_h(S10k, 4, True, bft, bft - 1))
}

test e04_s10k_on_tally() {
  let s = scn_h(S10k, 4, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e04_s10k_on_votes() {
  let s = scn_h(S10k, 4, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e04_s10k_on_nl() {
  let s = scn_h(S10k, 4, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test h0_e01_s0_off_base() {
  force(scn_h(S0, 1, False, bft, 0))
}

test h0_e01_s0_off_tally() {
  let s = scn_h(S0, 1, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e01_s0_off_votes() {
  let s = scn_h(S0, 1, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e01_s0_off_nl() {
  let s = scn_h(S0, 1, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e02_s0_off_base() {
  force(scn_h(S0, 2, False, bft, 0))
}

test h0_e02_s0_off_tally() {
  let s = scn_h(S0, 2, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e02_s0_off_votes() {
  let s = scn_h(S0, 2, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e02_s0_off_nl() {
  let s = scn_h(S0, 2, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e03_s0_off_base() {
  force(scn_h(S0, 3, False, bft, 0))
}

test h0_e03_s0_off_tally() {
  let s = scn_h(S0, 3, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e03_s0_off_votes() {
  let s = scn_h(S0, 3, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e03_s0_off_nl() {
  let s = scn_h(S0, 3, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e04_s0_off_base() {
  force(scn_h(S0, 4, False, bft, 0))
}

test h0_e04_s0_off_tally() {
  let s = scn_h(S0, 4, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e04_s0_off_votes() {
  let s = scn_h(S0, 4, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e04_s0_off_nl() {
  let s = scn_h(S0, 4, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e05_s0_off_base() {
  force(scn_h(S0, 5, False, bft, 0))
}

test h0_e05_s0_off_tally() {
  let s = scn_h(S0, 5, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e05_s0_off_votes() {
  let s = scn_h(S0, 5, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e05_s0_off_nl() {
  let s = scn_h(S0, 5, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e01_s0_on_base() {
  force(scn_h(S0, 1, True, bft, 0))
}

test h0_e01_s0_on_tally() {
  let s = scn_h(S0, 1, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e01_s0_on_votes() {
  let s = scn_h(S0, 1, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e01_s0_on_nl() {
  let s = scn_h(S0, 1, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e02_s0_on_base() {
  force(scn_h(S0, 2, True, bft, 0))
}

test h0_e02_s0_on_tally() {
  let s = scn_h(S0, 2, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e02_s0_on_votes() {
  let s = scn_h(S0, 2, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e02_s0_on_nl() {
  let s = scn_h(S0, 2, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e03_s0_on_base() {
  force(scn_h(S0, 3, True, bft, 0))
}

test h0_e03_s0_on_tally() {
  let s = scn_h(S0, 3, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e03_s0_on_votes() {
  let s = scn_h(S0, 3, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e03_s0_on_nl() {
  let s = scn_h(S0, 3, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e04_s0_on_base() {
  force(scn_h(S0, 4, True, bft, 0))
}

test h0_e04_s0_on_tally() {
  let s = scn_h(S0, 4, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e04_s0_on_votes() {
  let s = scn_h(S0, 4, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e04_s0_on_nl() {
  let s = scn_h(S0, 4, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e05_s0_on_base() {
  force(scn_h(S0, 5, True, bft, 0))
}

test h0_e05_s0_on_tally() {
  let s = scn_h(S0, 5, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e05_s0_on_votes() {
  let s = scn_h(S0, 5, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e05_s0_on_nl() {
  let s = scn_h(S0, 5, True, bft, 0)
  force(s) && run_nl(s)
}

// ========================================================
// Bổ sung 2026-09-29 — k ∈ {6..9} (heap đầy) và k ∈ {6..10} (heap RỖNG).
// Sau lượt tối ưu mem (bỏ D8 ở đường nóng · lát cắt TallyDatum · một lần quy đổi
// VP), trần lô rơi vào vùng này. Trần ExUnit phải là số ĐO ở LÂN CẬN trần, không
// phải nghiệm của một đường khớp trên vùng k nhỏ.
// ========================================================

test e06_s0_off_base() {
  force(scn_h(S0, 6, False, bft, bft - 1))
}

test e06_s0_off_tally() {
  let s = scn_h(S0, 6, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e06_s0_off_votes() {
  let s = scn_h(S0, 6, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e06_s0_off_nl() {
  let s = scn_h(S0, 6, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e07_s0_off_base() {
  force(scn_h(S0, 7, False, bft, bft - 1))
}

test e07_s0_off_tally() {
  let s = scn_h(S0, 7, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e07_s0_off_votes() {
  let s = scn_h(S0, 7, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e07_s0_off_nl() {
  let s = scn_h(S0, 7, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e08_s0_off_base() {
  force(scn_h(S0, 8, False, bft, bft - 1))
}

test e08_s0_off_tally() {
  let s = scn_h(S0, 8, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e08_s0_off_votes() {
  let s = scn_h(S0, 8, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e08_s0_off_nl() {
  let s = scn_h(S0, 8, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e09_s0_off_base() {
  force(scn_h(S0, 9, False, bft, bft - 1))
}

test e09_s0_off_tally() {
  let s = scn_h(S0, 9, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e09_s0_off_votes() {
  let s = scn_h(S0, 9, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e09_s0_off_nl() {
  let s = scn_h(S0, 9, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e06_s0_on_base() {
  force(scn_h(S0, 6, True, bft, bft - 1))
}

test e06_s0_on_tally() {
  let s = scn_h(S0, 6, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e06_s0_on_votes() {
  let s = scn_h(S0, 6, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e06_s0_on_nl() {
  let s = scn_h(S0, 6, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e07_s0_on_base() {
  force(scn_h(S0, 7, True, bft, bft - 1))
}

test e07_s0_on_tally() {
  let s = scn_h(S0, 7, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e07_s0_on_votes() {
  let s = scn_h(S0, 7, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e07_s0_on_nl() {
  let s = scn_h(S0, 7, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e08_s0_on_base() {
  force(scn_h(S0, 8, True, bft, bft - 1))
}

test e08_s0_on_tally() {
  let s = scn_h(S0, 8, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e08_s0_on_votes() {
  let s = scn_h(S0, 8, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e08_s0_on_nl() {
  let s = scn_h(S0, 8, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e09_s0_on_base() {
  force(scn_h(S0, 9, True, bft, bft - 1))
}

test e09_s0_on_tally() {
  let s = scn_h(S0, 9, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e09_s0_on_votes() {
  let s = scn_h(S0, 9, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e09_s0_on_nl() {
  let s = scn_h(S0, 9, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e06_s10k_off_base() {
  force(scn_h(S10k, 6, False, bft, bft - 1))
}

test e06_s10k_off_tally() {
  let s = scn_h(S10k, 6, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e06_s10k_off_votes() {
  let s = scn_h(S10k, 6, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e06_s10k_off_nl() {
  let s = scn_h(S10k, 6, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e07_s10k_off_base() {
  force(scn_h(S10k, 7, False, bft, bft - 1))
}

test e07_s10k_off_tally() {
  let s = scn_h(S10k, 7, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e07_s10k_off_votes() {
  let s = scn_h(S10k, 7, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e07_s10k_off_nl() {
  let s = scn_h(S10k, 7, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e08_s10k_off_base() {
  force(scn_h(S10k, 8, False, bft, bft - 1))
}

test e08_s10k_off_tally() {
  let s = scn_h(S10k, 8, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e08_s10k_off_votes() {
  let s = scn_h(S10k, 8, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e08_s10k_off_nl() {
  let s = scn_h(S10k, 8, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e09_s10k_off_base() {
  force(scn_h(S10k, 9, False, bft, bft - 1))
}

test e09_s10k_off_tally() {
  let s = scn_h(S10k, 9, False, bft, bft - 1)
  force(s) && run_tally(s)
}

test e09_s10k_off_votes() {
  let s = scn_h(S10k, 9, False, bft, bft - 1)
  force(s) && run_votes(s)
}

test e09_s10k_off_nl() {
  let s = scn_h(S10k, 9, False, bft, bft - 1)
  force(s) && run_nl(s)
}

test e06_s10k_on_base() {
  force(scn_h(S10k, 6, True, bft, bft - 1))
}

test e06_s10k_on_tally() {
  let s = scn_h(S10k, 6, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e06_s10k_on_votes() {
  let s = scn_h(S10k, 6, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e06_s10k_on_nl() {
  let s = scn_h(S10k, 6, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e07_s10k_on_base() {
  force(scn_h(S10k, 7, True, bft, bft - 1))
}

test e07_s10k_on_tally() {
  let s = scn_h(S10k, 7, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e07_s10k_on_votes() {
  let s = scn_h(S10k, 7, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e07_s10k_on_nl() {
  let s = scn_h(S10k, 7, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e08_s10k_on_base() {
  force(scn_h(S10k, 8, True, bft, bft - 1))
}

test e08_s10k_on_tally() {
  let s = scn_h(S10k, 8, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e08_s10k_on_votes() {
  let s = scn_h(S10k, 8, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e08_s10k_on_nl() {
  let s = scn_h(S10k, 8, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test e09_s10k_on_base() {
  force(scn_h(S10k, 9, True, bft, bft - 1))
}

test e09_s10k_on_tally() {
  let s = scn_h(S10k, 9, True, bft, bft - 1)
  force(s) && run_tally(s)
}

test e09_s10k_on_votes() {
  let s = scn_h(S10k, 9, True, bft, bft - 1)
  force(s) && run_votes(s)
}

test e09_s10k_on_nl() {
  let s = scn_h(S10k, 9, True, bft, bft - 1)
  force(s) && run_nl(s)
}

test h0_e06_s0_off_base() {
  force(scn_h(S0, 6, False, bft, 0))
}

test h0_e06_s0_off_tally() {
  let s = scn_h(S0, 6, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e06_s0_off_votes() {
  let s = scn_h(S0, 6, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e06_s0_off_nl() {
  let s = scn_h(S0, 6, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e07_s0_off_base() {
  force(scn_h(S0, 7, False, bft, 0))
}

test h0_e07_s0_off_tally() {
  let s = scn_h(S0, 7, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e07_s0_off_votes() {
  let s = scn_h(S0, 7, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e07_s0_off_nl() {
  let s = scn_h(S0, 7, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e08_s0_off_base() {
  force(scn_h(S0, 8, False, bft, 0))
}

test h0_e08_s0_off_tally() {
  let s = scn_h(S0, 8, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e08_s0_off_votes() {
  let s = scn_h(S0, 8, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e08_s0_off_nl() {
  let s = scn_h(S0, 8, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e09_s0_off_base() {
  force(scn_h(S0, 9, False, bft, 0))
}

test h0_e09_s0_off_tally() {
  let s = scn_h(S0, 9, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e09_s0_off_votes() {
  let s = scn_h(S0, 9, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e09_s0_off_nl() {
  let s = scn_h(S0, 9, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e10_s0_off_base() {
  force(scn_h(S0, 10, False, bft, 0))
}

test h0_e10_s0_off_tally() {
  let s = scn_h(S0, 10, False, bft, 0)
  force(s) && run_tally(s)
}

test h0_e10_s0_off_votes() {
  let s = scn_h(S0, 10, False, bft, 0)
  force(s) && run_votes(s)
}

test h0_e10_s0_off_nl() {
  let s = scn_h(S0, 10, False, bft, 0)
  force(s) && run_nl(s)
}

test h0_e06_s0_on_base() {
  force(scn_h(S0, 6, True, bft, 0))
}

test h0_e06_s0_on_tally() {
  let s = scn_h(S0, 6, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e06_s0_on_votes() {
  let s = scn_h(S0, 6, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e06_s0_on_nl() {
  let s = scn_h(S0, 6, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e07_s0_on_base() {
  force(scn_h(S0, 7, True, bft, 0))
}

test h0_e07_s0_on_tally() {
  let s = scn_h(S0, 7, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e07_s0_on_votes() {
  let s = scn_h(S0, 7, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e07_s0_on_nl() {
  let s = scn_h(S0, 7, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e08_s0_on_base() {
  force(scn_h(S0, 8, True, bft, 0))
}

test h0_e08_s0_on_tally() {
  let s = scn_h(S0, 8, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e08_s0_on_votes() {
  let s = scn_h(S0, 8, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e08_s0_on_nl() {
  let s = scn_h(S0, 8, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e09_s0_on_base() {
  force(scn_h(S0, 9, True, bft, 0))
}

test h0_e09_s0_on_tally() {
  let s = scn_h(S0, 9, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e09_s0_on_votes() {
  let s = scn_h(S0, 9, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e09_s0_on_nl() {
  let s = scn_h(S0, 9, True, bft, 0)
  force(s) && run_nl(s)
}

test h0_e10_s0_on_base() {
  force(scn_h(S0, 10, True, bft, 0))
}

test h0_e10_s0_on_tally() {
  let s = scn_h(S0, 10, True, bft, 0)
  force(s) && run_tally(s)
}

test h0_e10_s0_on_votes() {
  let s = scn_h(S0, 10, True, bft, 0)
  force(s) && run_votes(s)
}

test h0_e10_s0_on_nl() {
  let s = scn_h(S0, 10, True, bft, 0)
  force(s) && run_nl(s)
}

// ════════════════════════════════════════════════════════════
// `governance ▸ OpenProposal` — bảng knots 8 MỐC THẬT (cổng D8 chạy ở nhánh này)
//
// Vì sao phải đo riêng: lượt tối ưu 2026-09-29 gỡ cổng D8 khỏi đường nóng
// (`tally ▸ SumBatch` dùng `read_weight_param_skip_d8`), và một trong bốn chỗ giữ
// lại nghĩa vụ đó là `OpenProposal` — nhánh này gọi `weight_ref.read_weight_param`
// bản CÓ D8. `d8_ok` trên bảng 8 mốc là khoản lớn nhất của một lượt `SumBatch` cũ
// (3 645 089 mem), nên câu "Open đắt thêm vì D8" cần một con số chứ không phải một
// suy luận: Open chạy `d8_ok` ĐÚNG MỘT LẦN cho cả đời một proposal, còn `SumBatch`
// chạy nó mỗi lô.
//
// Giao dịch dựng trọn theo đúng khuôn của ma trận trên: tiêu hạt giống + 1 input phí,
// đúc `(gov_policy, H(seed))` + `(tally_policy, H(seed))`, reference input = 2 UTxO
// mang reference script + bảng tham số ĐẶT CUỐI (`read_weight_param` dùng `list.find`
// — đây là thứ tự đắt nhất), output = Proposal UTxO + Tally UTxO + output thối.
// Chi phí script = ca `_run` − ca `_base`, cùng quy ước với phần trên.
//
// Nhánh này KHÔNG có vòng lặp theo số phiếu: nó đọc MỘT bảng tham số và ghi HAI
// datum khởi tạo. Số bước chỉ phụ thuộc số mốc của bảng, nên một con số ở bảng 8 mốc
// là đủ — không cần ma trận theo k.
// ════════════════════════════════════════════════════════════

const gov_policy: PolicyId =
  #"90019001900190019001900190019001900190019001900190019001"

/// `_phase_tag` — apply-param không đi vào logic, giữ đúng cỡ thật.
const gov_tag: ByteArray = #"5031"

const delta_min: Int = 2

/// Thời hạn phục hồi DID (soft-pin theo mạng). Cửa sổ bỏ phiếu phải NGẮN HƠN
/// (`[DID-RECOVERY-TRUST]`), và `close_e − open_e = 2` ở tệp này thoả.
const recovery_epochs: Int = 15

fn open_seed() -> OutputReference {
  OutputReference {
    transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    output_index: 3,
  }
}

fn ref_script_in(ix: Int, h: ByteArray) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e",
      output_index: ix,
    },
    output: Output {
      address: vk_addr(ref_pkh),
      value: assets.from_lovelace(40_000_000),
      datum: NoDatum,
      reference_script: Some(h),
    },
  }
}

type OpenScn {
  tx: Transaction,
  red: governance.GovernanceRedeemer,
}

fn open_scn() -> OpenScn {
  let seed = open_seed()
  let prop = proposal_id_of(seed)
  let seed_in =
    Input {
      output_reference: seed,
      output: Output {
        address: vk_addr(fee_pkh),
        value: assets.from_lovelace(20_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let fee_in =
    Input {
      output_reference: OutputReference {
        transaction_id: #"fefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefe",
        output_index: 0,
      },
      output: Output {
        address: vk_addr(fee_pkh),
        value: assets.from_lovelace(20_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let wp_in =
    Input {
      output_reference: wp_ref(),
      output: out(
        script_addr(wp_policy),
        assets.from_lovelace(5_000_000) |> assets.add(wp_policy, gov_tag, 1),
        wp_of(bft),
      ),
    }
  let pr =
    ProposalResult {
      proposal_id: prop,
      status: Open,
      spend_spec_hash: #"",
      execute_after_epoch: close_e + delta_min,
      released_cumulative: 0,
    }
  let ts =
    TallyDatum {
      proposal_id: prop,
      phase: Summing,
      weight_param_ref: wp_ref(),
      yes_power_raw: 0,
      no_power_raw: 0,
      abstain_power_raw: 0,
      voters_acc: 0,
      yes_voters_acc: 0,
      top_did_vp: [],
      yes_power_eff: 0,
      no_power_eff: 0,
      abstain_power_eff: 0,
      vote_open_epoch: open_e,
      vote_close_epoch: close_e,
      voted_root: mpf.root(mpf.empty),
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [seed_in, fee_in],
      reference_inputs: [
        ref_script_in(0, gov_policy),
        ref_script_in(1, tally_sh),
        wp_in,
      ],
      outputs: [
        out(
          script_addr(gov_policy),
          assets.from_lovelace(2_000_000) |> assets.add(gov_policy, prop, 1),
          pr,
        ),
        out(
          script_addr(tally_sh),
          assets.from_lovelace(2_000_000) |> assets.add(tally_policy, prop, 1),
          ts,
        ),
        Output {
          address: vk_addr(fee_pkh),
          value: assets.from_lovelace(34_000_000),
          datum: NoDatum,
          reference_script: None,
        },
      ],
      mint: assets.zero
        |> assets.add(gov_policy, prop, 1)
        |> assets.add(tally_policy, prop, 1),
      validity_range: interval.between(
        open_e * ms_ep + 1_000,
        open_e * ms_ep + 600_000,
      ),
    }
  OpenScn {
    tx,
    red: governance.OpenProposal {
      seed,
      vote_open_epoch: open_e,
      vote_close_epoch: close_e,
      weight_param_ref: wp_ref(),
    },
  }
}

fn open_force(s: OpenScn) -> Bool {
  let d: Data = s
  builtin.length_of_bytearray(builtin.serialise_data(d)) > 0
}

fn open_run(s: OpenScn) -> Bool {
  let rd: Data = s.red
  expect r: governance.GovernanceRedeemer = rd
  governance.governance.mint(
    tally_policy,
    tally_sh,
    wp_policy,
    ms_ep,
    delta_min,
    recovery_epochs,
    gov_tag,
    0,
    r,
    gov_policy,
    s.tx,
  )
}

/// Bảng đo phải là bảng validator THẬT nhận, và phải đúng 8 mốc — không có vế này thì
/// con số dưới nói về một bảng khác bảng mà câu chuyện đang bàn.
test gov_open_bang_dung_8_moc() {
  let wp = wp_of(bft)
  and {
    list.length(wp.k1) == 8,
    list.length(wp.k2) == 8,
    list.length(wp.k3) == 8,
    list.length(wp.k4) == 8,
  }
}

// ── Khoản D8 đo RIÊNG, cùng bảng, cùng tệp ──
//
// Cặp `_d8_base` / `_d8_run` khác nhau ĐÚNG một lời gọi `weight_guard.d8_ok`. Có nó
// thì câu "phần lớn chi phí Open là cổng D8" là một phép TRỪ trong cùng một lần chạy,
// không phải một tỉ số ghép từ hai phép đo ở hai điều kiện khác nhau. `_d8_run` xanh
// cũng chính là phép khẳng định bảng này THOẢ D8.

test gov_open_d8_base() {
  let wp = wp_of(bft)
  let d: Data = wp
  builtin.length_of_bytearray(builtin.serialise_data(d)) > 0
}

test gov_open_d8_run() {
  let wp = wp_of(bft)
  let d: Data = wp
  builtin.length_of_bytearray(builtin.serialise_data(d)) > 0 && weight_guard.d8_ok(
    wp.k1,
    wp.k2,
    wp.k3,
    wp.k4,
  )
}

test gov_open_base() {
  open_force(open_scn())
}

test gov_open_run() {
  let s = open_scn()
  open_force(s) && open_run(s)
}
