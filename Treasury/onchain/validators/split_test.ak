// Tests thuần cho lib split (điều tiết cung-cầu — CONTRACT §3.1).
// Phủ: chia 20/80 đúng, remainder dồn recipient ĐẦU, Σ parts == total (bảo toàn),
// total < min_oil reject, Σ weight ≠ 10000 reject, biên min_oil 359/360, ≥2 recipient,
// hash 28 byte, weight âm/vượt trần reject.

use magiclamp/treasury/split.{
  Recipient, SplitParam, all_hashes_sized, all_weights_nonneg, floor_part,
  min_oil_ok, param_valid, split_amounts, sum_ints, weights_sum,
}

// ── Hằng số: custody hash 28 byte (script blake2b-224) ──
const mlamp_hash: ByteArray =
  #"11111111111111111111111111111111111111111111111111111111"

const app_hash: ByteArray =
  #"22222222222222222222222222222222222222222222222222222222"

const node_hash: ByteArray =
  #"33333333333333333333333333333333333333333333333333333333"

// MVP: 20% MagicLamp / 80% App, min_oil = 360.
fn mvp_recipients() -> List<Recipient> {
  [
    Recipient { custody_hash: mlamp_hash, weight_bps: 2000 },
    Recipient { custody_hash: app_hash, weight_bps: 8000 },
  ]
}

fn mvp_param() -> SplitParam {
  SplitParam { recipients: mvp_recipients(), min_oil: 360 }
}

// ── floor_part ──

test t_floor_part_basic() {
  floor_part(1000, 2000) == 200 && floor_part(1000, 8000) == 800
}

test t_floor_part_truncates() {
  // 1001 × 2000 / 10000 = 200200/10000 = 20.02 → 20
  floor_part(1001, 2000) == 200
}

// ── split 20/80 chia chẵn ──

test t_split_20_80_exact() {
  let parts = split_amounts(1000, mvp_recipients())
  parts == [200, 800]
}

// ── Σ parts == total (S1) khi chia chẵn ──

test t_split_sum_eq_total_exact() {
  sum_ints(split_amounts(1000, mvp_recipients())) == 1000
}

// ── remainder dồn recipient ĐẦU (S2) khi chia lẻ ──
// total = 1001: floor = [200, 800] → Σ = 1000, remainder = 1 → [201, 800].

test t_split_remainder_to_first() {
  let parts = split_amounts(1001, mvp_recipients())
  parts == [201, 800]
}

// ── Σ parts == total tuyệt đối ngay cả khi chia lẻ (KHÔNG rơi oil) ──

test t_split_sum_eq_total_odd() {
  sum_ints(split_amounts(1001, mvp_recipients())) == 1001
}

// remainder lớn nhất: 3 recipient, total tạo dư 2 → vẫn dồn đầu, Σ giữ.
fn three_recipients() -> List<Recipient> {
  [
    Recipient { custody_hash: mlamp_hash, weight_bps: 3333 },
    Recipient { custody_hash: app_hash, weight_bps: 3333 },
    Recipient { custody_hash: node_hash, weight_bps: 3334 },
  ]
}

test t_split_three_remainder_to_first() {
  // total = 100: floor = [33, 33, 33] Σ=99 remainder=1 → [34, 33, 33]
  let parts = split_amounts(100, three_recipients())
  parts == [34, 33, 33] && sum_ints(parts) == 100
}

test t_split_three_remainder_two() {
  // total = 10: floor = [3, 3, 3] Σ=9 remainder=1 → dồn đầu [4,3,3]. Σ=10.
  // total = 5: floor = [1,1,1] Σ=3 remainder=2 → [3,1,1]. Σ=5.
  let p = split_amounts(5, three_recipients())
  p == [3, 1, 1] && sum_ints(p) == 5
}

// ── Σ parts == total cho dải total rộng (property-style, vài điểm) ──

test t_split_sum_preserved_many() {
  let rs = mvp_recipients()
  sum_ints(split_amounts(360, rs)) == 360 && sum_ints(split_amounts(361, rs)) == 361 && sum_ints(
    split_amounts(9999, rs),
  ) == 9999 && sum_ints(split_amounts(1, rs)) == 1
}

// total = 1 (cực tiểu): floor = [0, 0] remainder = 1 → [1, 0]. Protocol (đầu) nhận hết.
test t_split_total_one_to_first() {
  split_amounts(1, mvp_recipients()) == [1, 0]
}

// ── min_oil biên (S3): 359 fail, 360 pass ──

test t_min_oil_359_fail() {
  !min_oil_ok(359, 360)
}

test t_min_oil_360_pass() {
  min_oil_ok(360, 360)
}

test t_min_oil_361_pass() {
  min_oil_ok(361, 360)
}

// ── param_valid ──

test t_param_valid_mvp() {
  param_valid(mvp_param())
}

// Σ weight ≠ 10000 reject (S4).
test t_param_weight_sum_wrong_reject() {
  let bad =
    SplitParam {
      recipients: [
        Recipient { custody_hash: mlamp_hash, weight_bps: 2000 },
        Recipient { custody_hash: app_hash, weight_bps: 7000 },
      ],
      // Σ = 9000 ≠ 10000
      min_oil: 360,
    }
  !param_valid(bad)
}

// < 2 recipient reject.
test t_param_single_recipient_reject() {
  let bad =
    SplitParam {
      recipients: [Recipient { custody_hash: mlamp_hash, weight_bps: 10000 }],
      min_oil: 360,
    }
  !param_valid(bad)
}

// min_oil âm reject.
test t_param_negative_min_oil_reject() {
  let bad = SplitParam { recipients: mvp_recipients(), min_oil: -1 }
  !param_valid(bad)
}

// weight âm reject.
test t_param_negative_weight_reject() {
  let bad =
    SplitParam {
      recipients: [
        Recipient { custody_hash: mlamp_hash, weight_bps: -2000 },
        Recipient { custody_hash: app_hash, weight_bps: 12000 },
      ],
      min_oil: 360,
    }
  !param_valid(bad)
}

// hash ≠ 28 byte reject (chống nhồi hash rác).
test t_param_bad_hash_len_reject() {
  let bad =
    SplitParam {
      recipients: [
        Recipient { custody_hash: #"c0c0", weight_bps: 2000 },
        Recipient { custody_hash: app_hash, weight_bps: 8000 },
      ],
      min_oil: 360,
    }
  !param_valid(bad)
}

// ── GUARD total < 0 (parity onchain↔offchain) ──
// Aiken `/` là FLOOR division (về -∞), khác JS BigInt trunc-toward-zero. Để hai
// impl khớp byte, split_amounts ép total ≥ 0: total < 0 → []. Các test dưới khoá
// hành vi đó + ghi nhận giá trị floor số âm thực tế của Aiken.

// Khoá bản chất: Aiken floor_part số âm = floor (về -∞), KHÔNG trunc.
// -101 × 2000 / 10000 = -202000/10000 = -20.2 → floor = -21 (JS trunc cho -20).
test t_floor_part_negative_is_floor() {
  floor_part(-101, 2000) == -21 && floor_part(-101, 8000) == -81
}

// Guard: total < 0 → [] (không vào miền floor≠trunc).
test t_split_negative_total_empty() {
  split_amounts(-101, mvp_recipients()) == [] && split_amounts(
    -1,
    three_recipients(),
  ) == []
}

// Biên total = 0 vẫn chia hợp lệ (≥ 0 ⇒ qua guard): [0, 0], Σ = 0.
test t_split_zero_total_ok() {
  let p = split_amounts(0, mvp_recipients())
  p == [0, 0] && sum_ints(p) == 0
}

// ── helper bất biến ──

test t_weights_sum() {
  weights_sum(mvp_recipients()) == 10000
}

test t_all_weights_nonneg_true() {
  all_weights_nonneg(mvp_recipients())
}

test t_all_hashes_sized_true() {
  all_hashes_sized(mvp_recipients())
}
