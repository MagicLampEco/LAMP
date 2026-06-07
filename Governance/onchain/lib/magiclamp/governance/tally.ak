// Logic thuần Tally + biểu thức pass canonical (D1) + clamp BFT (§8B/§9.5).
// Tách khỏi validator để test đơn vị + giữ validator mỏng (mirror release.ak).
//
// HAI PHA (§9.2): Summing cộng power THÔ + đếm DID + top-(F-1) heap; Clamped trừ
// phần vượt trần ΣVP/F. Biểu thức pass dùng power ĐÃ CLAMP (yes_power_eff,...).
//
// ┌─ pass(proposal) — MỘT biểu thức canonical (D1, §9.4) ───────────────────────┐
// │   W_base_eff = yes_power_eff + no_power_eff   (Abstain NGOÀI mẫu)            │
// │   total_vp_eff = yes_power_eff + no_power_eff + abstain_power_eff (quorum-VP)│
// │   pass = yes_voters_acc ≥ F                          (SÀN CỨNG nguyên lý 5) │
// │       && total_vp_eff   ≥ quorum_vp_threshold        (quorum theo VP)        │
// │       && voter_count    ≥ quorum_voter_threshold     (quorum theo người)     │
// │       && yes_power_eff * θ_den ≥ W_base_eff * θ_num  (nhân-chéo Int, dấu ≥)  │
// └─────────────────────────────────────────────────────────────────────────────┘

use aiken/collection/list
use cardano/transaction.{OutputReference}
use magiclamp/governance/power.{vp_raw}
use magiclamp/governance/types.{
  Abstain, Clamped, No, Summing, TallyDatum, TopEntry, VoteChoice, VoteDatum,
  WeightParam, Yes,
}

/// Tổng power DERIVE từ một LÔ phiếu thật (Finding 2). Mỗi VoteDatum → vp_raw qua bảng
/// knots của WeightParam → cộng vào đúng phe theo choice; đếm voter + voter THUẬN.
/// Trả về (Δyes_raw, Δno_raw, Δabstain_raw, Δvoters, Δyes_voters).
/// KHÔNG nhận delta tùy ý: power chỉ đến từ VoteDatum đã tiêu trong tx → không thể bơm
/// power "ảo" không có phiếu (audit Finding 2 — SumBatch trước chỉ kiểm monotone).
pub fn derive_batch(
  wp: WeightParam,
  votes: List<VoteDatum>,
) -> (Int, Int, Int, Int, Int) {
  list.foldl(
    votes,
    (0, 0, 0, 0, 0),
    fn(v, acc) {
      let (dy, dn, da, dv, dyv) = acc
      let p =
        vp_raw(
          wp.k1,
          v.c1_capped,
          wp.k2,
          v.c2_capped,
          wp.k3,
          v.c3_capped,
          wp.k4,
          v.c4_capped,
        )
      when v.choice is {
        Yes -> (dy + p, dn, da, dv + 1, dyv + 1)
        No -> (dy, dn + p, da, dv + 1, dyv)
        Abstain -> (dy, dn, da + p, dv + 1, dyv)
      }
    },
  )
}

// ════════════════════════════════════════════════════════════
// Heap top-(F-1) maintenance — ĐÓNG lỗ hổng soundness BFT-cap (D6)
// ════════════════════════════════════════════════════════════
//
// LÝ DO (first-principles): clamp BFT tại Finalize trừ phần vượt trần τ=ΣVP/F của MỖI
// DID cá voi (vp_raw > τ). apply_clamp CHỈ nhìn d.top_did_vp → nếu một cá voi KHÔNG có
// mặt trong heap, phần vượt của nó KHÔNG bị trừ → THOÁT trần (phá nguyên lý 5).
//
// SỐ cá voi tối đa = F−1: vì F·τ = ΣVP (chia nguyên τ=ΣVP/F ⇒ F·τ ≤ ΣVP), nếu có ≥ F
// DID đều vp_raw > τ thì Σ vp_raw > F·τ; nhưng F·τ có thể < ΣVP do làm tròn. Chặt hơn:
// mỗi cá voi đóng > τ ≥ ⌊ΣVP/F⌋; F cá voi đóng > F·⌊ΣVP/F⌋. Khi ΣVP chia hết F thì
// F·τ = ΣVP ⇒ > ΣVP mâu thuẫn ⇒ ≤ F−1 cá voi. Khi không chia hết, τ=⌊ΣVP/F⌋ và phần dư
// r<F: F cá voi cần Σ > F·τ = ΣVP−r; vẫn KHẢ DĨ về tổng, NHƯNG mỗi cá voi vp_raw ≥ τ+1
// ⇒ F·(τ+1) = ΣVP−r+F > ΣVP (vì F>r) — mâu thuẫn. ⇒ luôn ≤ F−1 cá voi. Heap kích thước
// F−1 ĐỦ giữ MỌI cá voi. (Giữ thừa các DID không-vượt-trần vô hại: apply_clamp bỏ qua
// entry có vp_raw ≤ τ.)
//
// BẤT BIẾN ĐÓNG (validator ép sau mỗi SumBatch):
//   d_out.top_did_vp == merge_top( d_in.top_did_vp ++ batch_entries(votes), F−1 )
// trong đó batch_entries DERIVE vp_raw từ MỖI Vote THẬT (cùng vp_raw mà derive_batch
// cộng) → (a) mọi cá voi đủ lớn BẮT BUỘC có mặt; (b) KHÔNG nhồi entry giả: mỗi entry
// output phải khớp canonical = kế thừa d_in hoặc ứng 1 vote thật trong lô.

/// Chèn một TopEntry vào danh sách ĐÃ sắp GIẢM theo vp_raw, giữ thứ tự giảm (insertion
/// sort thuần Int, ổn định: entry mới đứng SAU các entry bằng/lớn hơn nó → canonical).
pub fn insert_desc(sorted: List<TopEntry>, e: TopEntry) -> List<TopEntry> {
  when sorted is {
    [] -> [e]
    [head, ..tail] ->
      if e.vp_raw > head.vp_raw {
        [e, head, ..tail]
      } else {
        [head, ..insert_desc(tail, e)]
      }
  }
}

/// Cắt n phần tử ĐẦU (đã sắp giảm) — giữ ≤ n cá voi lớn nhất. n<0 ⇒ rỗng.
pub fn take_n(xs: List<TopEntry>, n: Int) -> List<TopEntry> {
  if n <= 0 {
    []
  } else {
    when xs is {
      [] -> []
      [head, ..tail] -> [head, ..take_n(tail, n - 1)]
    }
  }
}

/// DERIVE List<TopEntry> từ MỖI Vote THẬT trong lô: vp_raw (qua bảng knots — y hệt
/// derive_batch) + choice. Mỗi entry ứng đúng 1 vote thật bị tiêu trong tx (chống nhồi).
pub fn batch_entries(wp: WeightParam, votes: List<VoteDatum>) -> List<TopEntry> {
  list.map(
    votes,
    fn(v) {
      let p =
        vp_raw(
          wp.k1,
          v.c1_capped,
          wp.k2,
          v.c2_capped,
          wp.k3,
          v.c3_capped,
          wp.k4,
          v.c4_capped,
        )
      TopEntry { vp_raw: p, choice: v.choice }
    },
  )
}

/// Heap canonical: hợp nhất heap cũ + entry lô rồi cắt top `limit` (= F−1) theo vp_raw
/// giảm. Thuần Int, không float. Kết quả DUY NHẤT (deterministic) cho cùng đầu vào →
/// validator so bằng `==` ép d_out đúng.
pub fn merge_top(
  old_heap: List<TopEntry>,
  batch: List<TopEntry>,
  limit: Int,
) -> List<TopEntry> {
  // old_heap đã sắp giảm (bất biến từ vòng trước); chèn lần lượt từng entry lô vào.
  let merged = list.foldl(batch, old_heap, fn(e, acc) { insert_desc(acc, e) })
  take_n(merged, limit)
}

/// Bất biến heap (D6) cho một SumBatch: d_out.top_did_vp PHẢI == canonical merge của
/// heap cũ + entry lô, cắt F−1. F = bft_floor (đọc từ WeightParam, Finding 1). Khi F≤1
/// (chỉ 0 cá voi khả dĩ) limit≤0 ⇒ heap rỗng — không cá voi nào vượt được trần ΣVP/F
/// với F=1 (τ=ΣVP, không ai vượt) nên rỗng là ĐÚNG.
pub fn top_heap_consistent(
  d_in: TallyDatum,
  d_out: TallyDatum,
  wp: WeightParam,
  votes: List<VoteDatum>,
) -> Bool {
  d_out.top_did_vp == merge_top(
    d_in.top_did_vp,
    batch_entries(wp, votes),
    wp.bft_floor - 1,
  )
}

/// Kiểm d_out == d_in + derived(batch) ở các trường tích lũy (Finding 2). Pha giữ Summing,
/// proposal_id + weight_param_ref giữ nguyên. delta = đúng tổng phiếu. Heap top-(F-1)
/// cập nhật RIÊNG qua top_heap_consistent (validator ép cả hai) — ĐÓNG soundness BFT-cap.
pub fn sum_batch_consistent(
  d_in: TallyDatum,
  d_out: TallyDatum,
  wp: WeightParam,
  votes: List<VoteDatum>,
) -> Bool {
  let (dy, dn, da, dv, dyv) = derive_batch(wp, votes)
  and {
    d_out.proposal_id == d_in.proposal_id,
    d_out.weight_param_ref == d_in.weight_param_ref,
    // power_raw mỗi phe = cũ + DERIVE (không nhận delta tùy ý — Finding 2).
    d_out.yes_power_raw == d_in.yes_power_raw + dy,
    d_out.no_power_raw == d_in.no_power_raw + dn,
    d_out.abstain_power_raw == d_in.abstain_power_raw + da,
    // đếm DID = cũ + số phiếu thật trong lô.
    d_out.voters_acc == d_in.voters_acc + dv,
    d_out.yes_voters_acc == d_in.yes_voters_acc + dyv,
  }
}

/// ΣVP thô (tổng VP-tham-gia) — mẫu số cho trần clamp τ = ΣVP/F (§8B.1 (11)).
/// Dùng VP THÔ (trước clamp) làm mẫu số, KHÔNG VP_eff (tránh điểm cố định — §8B.1).
pub fn sigma_vp_raw(d: TallyDatum) -> Int {
  d.yes_power_raw + d.no_power_raw + d.abstain_power_raw
}

/// Trần một-DID khi tally: τ = ΣVP / F (chia nguyên, làm tròn xuống — thiên AN TOÀN,
/// trần thấp hơn). F = bft_floor (đọc từ UTxO tham số). F ≥ 1 (validator ép trước).
pub fn cap_per_did(d: TallyDatum, bft_floor: Int) -> Int {
  sigma_vp_raw(d) / bft_floor
}

/// Tổng phần VƯỢT TRẦN của một phe (theo choice) trong top heap:
///   Σ_{i ∈ over, choice=X} (vp_raw_i − τ),  chỉ tính các DID thực vượt (vp_raw > τ).
/// |over| ≤ F−1 (chứng minh §9.5.3) → heap top-(F-1) chứa trọn tập over.
fn excess_of_choice(top: List<TopEntry>, cap: Int, want: VoteChoice) -> Int {
  list.foldl(
    top,
    0,
    fn(e, acc) {
      if e.choice == want && e.vp_raw > cap {
        acc + e.vp_raw - cap
      } else {
        acc
      }
    },
  )
}

/// Áp clamp BFT (pha Clamped, §9.5.3): power_eff phe X = power_raw phe X − Σ excess(X).
/// Trả về (yes_eff, no_eff, abstain_eff). cap = ΣVP/F. Nếu F khiến cap=0 (ΣVP<F),
/// clamp về 0 cho mọi DID vượt — nhưng thực tế ΣVP<F hiếm khi qua được sàn cứng.
pub fn apply_clamp(d: TallyDatum, bft_floor: Int) -> (Int, Int, Int) {
  let cap = cap_per_did(d, bft_floor)
  let yes_eff = d.yes_power_raw - excess_of_choice(d.top_did_vp, cap, Yes)
  let no_eff = d.no_power_raw - excess_of_choice(d.top_did_vp, cap, No)
  let abstain_eff =
    d.abstain_power_raw - excess_of_choice(d.top_did_vp, cap, Abstain)
  (yes_eff, no_eff, abstain_eff)
}

/// Kiểm pha Clamped của TallyDatum nhất quán với pha Summing + clamp (§9.5.3):
/// yes_power_eff/no/abstain phải KHỚP apply_clamp(Summing-data). Validator ép khi
/// chuyển Summing→Clamped. Ngăn off-chain mớm power_eff bịa.
pub fn clamp_consistent(d: TallyDatum, bft_floor: Int) -> Bool {
  let (ye, ne, ae) = apply_clamp(d, bft_floor)
  d.yes_power_eff == ye && d.no_power_eff == ne && d.abstain_power_eff == ae
}

/// Mẫu số ngưỡng (D1): chỉ THUẬN + CHỐNG (Abstain NGOÀI mẫu).
pub fn w_base_eff(d: TallyDatum) -> Int {
  d.yes_power_eff + d.no_power_eff
}

/// Tổng VP_eff gồm Abstain — CHỈ cho quorum-VP (D1).
pub fn total_vp_eff(d: TallyDatum) -> Int {
  d.yes_power_eff + d.no_power_eff + d.abstain_power_eff
}

/// Biểu thức pass(proposal) DUY NHẤT (canonical, D1 §9.4). Power dùng là ĐÃ CLAMP
/// (pha Clamped). KÈM sàn cứng số DID thuận ≥ F.
///   - yes_voters_acc ≥ bft_floor                 (SÀN CỨNG nguyên lý 5)
///   - total_vp_eff   ≥ quorum_vp_threshold        (quorum theo VP)
///   - voter_count    ≥ quorum_voter_threshold     (quorum theo người)
///   - yes_power_eff * θ_den ≥ W_base_eff * θ_num  (nhân-chéo Int, dấu ≥)
pub fn pass(
  d: TallyDatum,
  bft_floor: Int,
  quorum_vp_threshold: Int,
  quorum_voter_threshold: Int,
  theta_num: Int,
  theta_den: Int,
) -> Bool {
  let base = w_base_eff(d)
  and {
    d.yes_voters_acc >= bft_floor,
    total_vp_eff(d) >= quorum_vp_threshold,
    d.voters_acc >= quorum_voter_threshold,
    d.yes_power_eff * theta_den >= base * theta_num,
  }
}

// ════════════════════════════════════════════════════════════
// Tests — clamp + pass (biên + negative)
// ════════════════════════════════════════════════════════════

/// Dựng TallyDatum pha Clamped tối giản (power_eff điền tay cho test pass).
fn td_clamped(
  yes_eff: Int,
  no_eff: Int,
  abstain_eff: Int,
  yes_voters: Int,
  voters: Int,
) -> TallyDatum {
  TallyDatum {
    proposal_id: #"de",
    phase: Clamped,
    weight_param_ref: OutputReference { transaction_id: #"00", output_index: 0 },
    yes_power_raw: yes_eff,
    no_power_raw: no_eff,
    abstain_power_raw: abstain_eff,
    voters_acc: voters,
    yes_voters_acc: yes_voters,
    top_did_vp: [],
    yes_power_eff: yes_eff,
    no_power_eff: no_eff,
    abstain_power_eff: abstain_eff,
  }
}

test pass_happy_two_thirds() {
  // yes=200 no=100 → base=300; 200·3 ≥ 300·2 (600≥600) PASS. 21 DID thuận đủ sàn.
  let d = td_clamped(200, 100, 0, 21, 30)
  pass(d, 21, 0, 0, 2, 3)
}

test pass_boundary_exact_two_thirds() {
  // BIÊN: yes·θ_den == base·θ_num đúng → dấu ≥ PHẢI PASS (D1).
  // yes=2 no=1 base=3; 2·3=6 == 3·2=6 → PASS.
  let d = td_clamped(2, 1, 0, 21, 21)
  pass(d, 21, 0, 0, 2, 3)
}

test pass_just_below_two_thirds_fails() fail {
  // yes=199 no=101 base=300; 199·3=597 < 300·2=600 → FAIL.
  let d = td_clamped(199, 101, 0, 21, 30)
  // pass trả False; bọc expect để test fail.
  expect pass(d, 21, 0, 0, 2, 3)
  True
}

test pass_hard_floor_below_F_fails() fail {
  // Tỷ lệ ĐẠT (yes=300 no=0) nhưng yes_voters=20 < F=21 → SÀN CỨNG fail.
  let d = td_clamped(300, 0, 0, 20, 25)
  expect pass(d, 21, 0, 0, 2, 3)
  True
}

test pass_quorum_vp_below_fails() fail {
  // tỷ lệ + sàn cứng OK nhưng total_vp_eff=300 < quorum_vp=1000 → fail.
  let d = td_clamped(300, 0, 0, 21, 21)
  expect pass(d, 21, 1000, 0, 2, 3)
  True
}

test pass_abstain_outside_base() {
  // Abstain 9999 KHÔNG vào base: yes=2 no=1 base=3 (KHÔNG +abstain) → 6≥6 PASS.
  // total_vp_eff = 2+1+9999 góp quorum-VP (đặt quorum=0 cho test này).
  let d = td_clamped(2, 1, 9999, 21, 21)
  pass(d, 21, 0, 0, 2, 3)
}

/// Dựng TallyDatum pha Summing với top heap để test clamp.
fn td_summing(
  yes_raw: Int,
  no_raw: Int,
  abstain_raw: Int,
  top: List<TopEntry>,
) -> TallyDatum {
  TallyDatum {
    proposal_id: #"de",
    phase: Summing,
    weight_param_ref: OutputReference { transaction_id: #"00", output_index: 0 },
    yes_power_raw: yes_raw,
    no_power_raw: no_raw,
    abstain_power_raw: abstain_raw,
    voters_acc: 0,
    yes_voters_acc: 0,
    top_did_vp: top,
    yes_power_eff: 0,
    no_power_eff: 0,
    abstain_power_eff: 0,
  }
}

test clamp_caps_whale_did() {
  // ΣVP=1000, F=10 → τ=100. Một DID Yes vp_raw=400 vượt trần → trừ 300.
  // yes_raw=400+ (giả định phần còn 600 chia các DID nhỏ): đặt yes_raw=700 no=200 abstain=100.
  // ΣVP=1000, τ=100. Heap có 1 DID Yes vp_raw=400 → excess Yes=300.
  // yes_eff = 700−300 = 400.
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let d = td_summing(700, 200, 100, top)
  let (ye, ne, ae) = apply_clamp(d, 10)
  ye == 400 && ne == 200 && ae == 100
}

test clamp_no_excess_when_below_cap() {
  // DID vp_raw=50 < τ=100 → KHÔNG trừ (không vượt trần).
  let top = [TopEntry { vp_raw: 50, choice: Yes }]
  let d = td_summing(700, 200, 100, top)
  let (ye, _, _) = apply_clamp(d, 10)
  ye == 700
}

test clamp_consistent_check() {
  // clamp_consistent True khi power_eff điền đúng = apply_clamp.
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let base = td_summing(700, 200, 100, top)
  let d =
    TallyDatum {
      ..base,
      phase: Clamped,
      yes_power_eff: 400,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  clamp_consistent(d, 10)
}

test clamp_consistent_rejects_forged_eff() fail {
  // power_eff bịa (450 thay 400) → clamp_consistent False.
  let top = [TopEntry { vp_raw: 400, choice: Yes }]
  let base = td_summing(700, 200, 100, top)
  let d =
    TallyDatum {
      ..base,
      phase: Clamped,
      yes_power_eff: 450,
      no_power_eff: 200,
      abstain_power_eff: 100,
    }
  expect clamp_consistent(d, 10)
  True
}
