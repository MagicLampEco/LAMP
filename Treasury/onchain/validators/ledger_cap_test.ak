// Bài kiểm cho C-LINES — trần SỐ DÒNG sổ (`ledger.max_ledger_lines`).
//
// Trần nằm trong `ledger.is_canonical`, tức MỘT biểu thức phục vụ NĂM đường ghi sổ:
//   Collect · Release · MigrateIn · StakeRewardIn · custody_seed ▸ S-LEDGER-0.
// Mỗi đường có một cặp bài: sổ ra ĐÚNG BẰNG trần (phải qua) và sổ ra TRẦN+1 (phải bị
// từ chối). Cặp nào cũng chỉ đổi SỐ DÒNG, mọi vế khác của nhánh giữ nguyên hình dạng
// của bài dương — nên bài âm không thể đỏ vì một cổng khác.
//
// Bài quan trọng nhất là `cap_collect_new_line_pushes_over_fail`: nó dựng đúng ĐÒN
// TẤN CÔNG (một `Collect` hợp lệ về mọi mặt, ghi vào một (category, asset) MỚI, đẩy sổ
// từ trần lên trần+1), không phải một sổ dài dựng sẵn.

use aiken/collection/list
use aiken/interval
use cardano/address.{VerificationKey}
use cardano/assets
use cardano/transaction.{Transaction, placeholder}
use custody
use custody_seed.{SeedGenesis}
use magiclamp/treasury/ledger
use magiclamp/treasury/migrate
use magiclamp/treasury/release
use magiclamp/treasury/stake_reward
use magiclamp/treasury/types.{
  AssetKey, Collect, CollectItem, CustodyDatum, Executed, LedgerEntry, MigrateIn,
  ProposalResult, Release, ReleaseDraw, StakeRewardIn,
}
use magiclamp/treasury/util

// ── Hằng số (soi gương collect_test / release_test / custody_seed_test) ──
const cust_sh: ByteArray = #"c0c0c0c0"

const seed_policy: assets.PolicyId = #"5eed"

const prop_policy: assets.PolicyId = #"9a9a"

const instance_id: ByteArray = #"abcd"

const prop_id: ByteArray = #"0001"

const gov_sh: ByteArray =
  #"99999999999999999999999999999999999999999999999999999999"

const ms_per_epoch: Int = 432_000_000

const lamp_policy: ByteArray = #"1a3b"

const lamp_name: ByteArray = #"4c414d50"

const cut_bps_10: Int = 1000

const alice: ByteArray = #"a11ce0"

/// Trần + 1 — viết bằng hằng, không gõ số, để bài âm không lệch khi trần đổi.
const over_cap: Int = ledger.max_ledger_lines + 1

fn accepted() -> List<AssetKey> {
  [
    AssetKey { policy: #"", name: #"" },
    AssetKey { policy: lamp_policy, name: lamp_name },
  ]
}

fn datum(ledger_lines: List<LedgerEntry>) -> CustodyDatum {
  CustodyDatum {
    instance_id: instance_id,
    accepted_assets: accepted(),
    ledger: ledger_lines,
    cut_bps: cut_bps_10,
    governance_ref: gov_sh,
    epoch: 3,
    consumed_proposals: [],
    // Khai ĐỦ mọi bucket mà `lines(n, _)` dùng (1..n) CỘNG bucket n+1 — bucket mà bài
    // `cap_collect_new_line_pushes_over_fail` ghi vào. Thiếu n+1 thì bài ấy đỏ ở
    // C-COL-CAT chứ không ở C-COL-LINES: đúng màu, đúng tên, canh nhầm chốt.
    buckets: list.range(1, ledger.max_ledger_lines + 1),
  }
}

fn epoch_range(lower_ms: Int) -> interval.Interval {
  interval.between(lower_ms, lower_ms + ms_per_epoch - 1)
}

/// value kho = lovelace + LAMP + NFT authenticity.
fn cust_value(lovelace: Int, lamp: Int) -> assets.Value {
  assets.from_lovelace(lovelace)
    |> assets.add(lamp_policy, lamp_name, lamp)
    |> assets.add(seed_policy, instance_id, 1)
}

/// Sổ `n` dòng: bucket_id = 1..n, cùng asset LAMP, mỗi dòng 1000.
/// `bump` cộng vào dòng bucket 1 (dòng đích của item/draw).
/// bucket_id 1..n luôn < 1_000_000 nên không đụng bucket dành riêng, và strict-sorted
/// theo bucket_id tăng dần.
fn lines(n: Int, bump: Int) -> List<LedgerEntry> {
  list.map(
    list.range(1, n),
    fn(i) {
      LedgerEntry {
        bucket_id: i,
        policy: lamp_policy,
        name: lamp_name,
        amount: if i == 1 {
          1000 + bump
        } else {
          1000
        },
      }
    },
  )
}

// ══════════════════════════════════════════════════════════════════
// COLLECT — C-COL-LINES
// ══════════════════════════════════════════════════════════════════

fn collect_run(
  ledger_in : List<LedgerEntry>,
  ledger_out: List<LedgerEntry>,
  category  : Int,
) -> Bool {
  let cust_addr = util.script_address(cust_sh)
  let d_in = datum(ledger_in)
  let cust_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(cust_addr, cust_value(5_000_000, 5000), d_in),
    )
  let d_out = CustodyDatum { ..datum(ledger_out), epoch: 11 }
  // item amount 1000 × cut_bps 1000 / 10000 = cut 100 LAMP.
  let cust_out =
    util.mk_output(cust_addr, cust_value(5_000_000, 5100), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      outputs: [cust_out],
      mint: assets.zero,
      validity_range: epoch_range(11 * ms_per_epoch),
    }
  let items =
    [
      CollectItem {
        app_id: #"0001",
        policy: lamp_policy,
        name: lamp_name,
        amount: 1000,
        category: category,
      },
    ]
  custody.custody.spend(
    prop_policy,
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    Some(d_in),
    Collect { items },
    util.mk_ref(0),
    tx,
  )
}

/// Sổ ra ĐÚNG BẰNG trần → qua. Cut vào dòng đã có (bucket 1) ⇒ số dòng không đổi.
test cap_collect_at_cap_ok() {
  let n = ledger.max_ledger_lines
  collect_run(lines(n, 0), lines(n, 100), 1)
}

/// Sổ ra TRẦN+1 → bị từ chối. Đổi ĐÚNG một thứ so với bài trên: số dòng.
test cap_collect_over_cap_fail() fail {
  collect_run(lines(over_cap, 0), lines(over_cap, 100), 1)
}

/// ĐÒN TẤN CÔNG THẬT: sổ vào đúng bằng trần, `Collect` hợp lệ mọi mặt nhưng ghi vào một
/// (category, asset) MỚI ⇒ sổ ra trần+1 ⇒ phải bị từ chối. Không có vế này thì đường
/// bơm dòng rác mỗi lượt một dòng vẫn mở, và trần chỉ chặn được sổ dài dựng sẵn.
test cap_collect_new_line_pushes_over_fail() fail {
  let n = ledger.max_ledger_lines
  let ledger_in = lines(n, 0)
  // dòng mới ở bucket n+1 (sắp sau mọi dòng cũ ⇒ vẫn strict-sorted), amount = cut 100.
  let ledger_out =
    list.concat(
      ledger_in,
      [
        LedgerEntry {
          bucket_id: n + 1,
          policy: lamp_policy,
          name: lamp_name,
          amount: 100,
        },
      ],
    )
  collect_run(ledger_in, ledger_out, n + 1)
}

// ══════════════════════════════════════════════════════════════════
// RELEASE — C-REL-LINES
// ══════════════════════════════════════════════════════════════════

fn release_run(
  ledger_in : List<LedgerEntry>,
  ledger_out: List<LedgerEntry>,
) -> Bool {
  let draws =
    [
      ReleaseDraw {
        bucket_id: 1,
        policy: lamp_policy,
        name: lamp_name,
        amount: 300,
        to: util.vk_address(alice),
      },
    ]
  let spec = release.spend_spec_hash(instance_id, draws)
  let result =
    ProposalResult {
      proposal_id: prop_id,
      status: Executed,
      spend_spec_hash: spec,
      execute_after_epoch: 4,
      released_cumulative: 0,
    }
  let prop_val =
    assets.from_lovelace(2_000_000) |> assets.add(prop_policy, prop_id, 1)
  let prop_in =
    util.mk_input(
      util.mk_ref(7),
      util.mk_output(util.script_address(gov_sh), prop_val, result),
    )
  let cust_addr = util.script_address(cust_sh)
  let d_in = datum(ledger_in)
  let cust_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(cust_addr, cust_value(5_000_000, 5000), d_in),
    )
  let d_out =
    CustodyDatum {
      ..datum(ledger_out),
      epoch: 5,
      consumed_proposals: [prop_id],
    }
  let cust_out = util.mk_output(cust_addr, cust_value(5_000_000, 4700), d_out)
  let pay =
    util.mk_output_no_datum(
      util.vk_address(alice),
      assets.from_lovelace(2_000_000) |> assets.add(lamp_policy, lamp_name, 300),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      reference_inputs: [prop_in],
      outputs: [cust_out, pay],
      mint: assets.zero,
      validity_range: epoch_range(5 * ms_per_epoch),
    }
  custody.custody.spend(
    prop_policy,
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    Some(d_in),
    Release { proposal_ref: util.mk_ref(7), draws },
    util.mk_ref(0),
    tx,
  )
}

test cap_release_at_cap_ok() {
  let n = ledger.max_ledger_lines
  release_run(lines(n, 0), lines(n, -300))
}

test cap_release_over_cap_fail() fail {
  release_run(lines(over_cap, 0), lines(over_cap, -300))
}

// ══════════════════════════════════════════════════════════════════
// MIGRATE-IN — C-MIG-LINES
// ══════════════════════════════════════════════════════════════════
// `MigrateIn` CỘNG một dòng ở `reserve_inflow_bucket_id` ⇒ bài dương phải xuất phát từ
// trần − 1 dòng. Đây chính là ràng buộc mà trần mua được: đường nạp permissionless
// không đẩy được sổ qua trần.

fn migrate_run(ledger_in: List<LedgerEntry>) -> Bool {
  let delta = 4_000
  let ledger_out =
    list.concat(
      ledger_in,
      [
        LedgerEntry {
          bucket_id: migrate.reserve_inflow_bucket_id,
          policy: lamp_policy,
          name: lamp_name,
          amount: delta,
        },
      ],
    )
  let cust_addr = util.script_address(cust_sh)
  let d_in = datum(ledger_in)
  let cust_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(cust_addr, cust_value(5_000_000, 5000), d_in),
    )
  let d_out = CustodyDatum { ..datum(ledger_out), epoch: 11 }
  let cust_out =
    util.mk_output(cust_addr, cust_value(5_000_000, 5000 + delta), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      outputs: [cust_out],
      mint: assets.add(assets.zero, lamp_policy, lamp_name, delta),
      validity_range: epoch_range(11 * ms_per_epoch),
    }
  custody.custody.spend(
    prop_policy,
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    Some(d_in),
    MigrateIn { source: migrate.reserve_source_tag },
    util.mk_ref(0),
    tx,
  )
}

/// Sổ vào trần−1, nạp thêm 1 dòng ⇒ sổ ra ĐÚNG BẰNG trần → qua.
test cap_migrate_at_cap_ok() {
  migrate_run(lines(ledger.max_ledger_lines - 1, 0))
}

/// Sổ vào ĐÚNG BẰNG trần, nạp thêm 1 dòng ⇒ sổ ra trần+1 → bị từ chối.
test cap_migrate_over_cap_fail() fail {
  migrate_run(lines(ledger.max_ledger_lines, 0))
}

// ══════════════════════════════════════════════════════════════════
// STAKE-REWARD-IN — C-STK-LINES
// ══════════════════════════════════════════════════════════════════

fn stake_run(ledger_in: List<LedgerEntry>) -> Bool {
  let delta = 7_000_000
  let ledger_out =
    list.concat(
      ledger_in,
      [
        LedgerEntry {
          bucket_id: stake_reward.stake_reward_bucket_id,
          policy: stake_reward.reward_policy,
          name: stake_reward.reward_name,
          amount: delta,
        },
      ],
    )
  let stake_pkh: ByteArray = #"57a4e0"
  let cust_addr = util.script_address_staked(cust_sh, stake_pkh)
  let d_in = datum(ledger_in)
  let cust_in =
    util.mk_input(
      util.mk_ref(0),
      util.mk_output(cust_addr, cust_value(5_000_000, 5000), d_in),
    )
  let d_out = CustodyDatum { ..datum(ledger_out), epoch: 11 }
  let cust_out =
    util.mk_output(cust_addr, cust_value(5_000_000 + delta, 5000), d_out)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [cust_in],
      outputs: [cust_out],
      mint: assets.zero,
      withdrawals: [Pair(VerificationKey(stake_pkh), delta)],
      validity_range: epoch_range(11 * ms_per_epoch),
    }
  custody.custody.spend(
    prop_policy,
    seed_policy,
    ms_per_epoch,
    lamp_policy,
    lamp_name,
    Some(d_in),
    StakeRewardIn { amount: delta },
    util.mk_ref(0),
    tx,
  )
}

test cap_stake_at_cap_ok() {
  stake_run(lines(ledger.max_ledger_lines - 1, 0))
}

test cap_stake_over_cap_fail() fail {
  stake_run(lines(ledger.max_ledger_lines, 0))
}

// ══════════════════════════════════════════════════════════════════
// CUSTODY_SEED — S-LEDGER-LINES
// ══════════════════════════════════════════════════════════════════
// Seed là cửa DUY NHẤT đặt số dòng khởi điểm. Không chặn ở đây thì trần ở bốn nhánh
// trên vô nghĩa: gieo thẳng một sổ dài là khoá kho ngay từ giao dịch thứ hai.

const reserved_min_ada: Int = 2_000_000

fn seed_run(ledger_lines: List<LedgerEntry>) -> Bool {
  // value = Σ sổ ⊕ reserved_min_ada ⊕ NFT authenticity (S-SEED-0).
  let lamp_total =
    list.foldl(ledger_lines, 0, fn(e, acc) { acc + e.amount })
  let val =
    assets.from_lovelace(reserved_min_ada)
      |> assets.add(lamp_policy, lamp_name, lamp_total)
      |> assets.add(seed_policy, instance_id, 1)
  let d =
    CustodyDatum {
      ..datum(ledger_lines),
      // S-ACC-0: mọi dòng sổ ∈ accepted_assets (mọi dòng đều là LAMP).
      accepted_assets: [AssetKey { policy: lamp_policy, name: lamp_name }],
      epoch: 0,
    }
  let cust_out = util.mk_output(util.script_address(cust_sh), val, d)
  let gref = util.mk_ref(7)
  let gin =
    util.mk_input(
      gref,
      util.mk_output_no_datum(
        util.vk_address(#"a0"),
        assets.from_lovelace(5_000_000),
      ),
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [gin],
      outputs: [cust_out],
      mint: assets.add(assets.zero, seed_policy, instance_id, 1),
    }
  custody_seed.custody_seed.mint(
    gref,
    SeedGenesis { reserved_min_ada: reserved_min_ada },
    seed_policy,
    tx,
  )
}

test cap_seed_at_cap_ok() {
  seed_run(lines(ledger.max_ledger_lines, 0))
}

test cap_seed_over_cap_fail() fail {
  seed_run(lines(over_cap, 0))
}

// ══════════════════════════════════════════════════════════════════
// Biên của chính vị từ (đơn vị) — hai cực phân biệt được
// ══════════════════════════════════════════════════════════════════

test cap_within_line_cap_boundary() {
  ledger.within_line_cap(lines(ledger.max_ledger_lines, 0)) && !ledger.within_line_cap(
    lines(over_cap, 0),
  )
}

/// GHIM GIÁ TRỊ SỐ của trần. Nói thẳng nó chứng minh gì và KHÔNG chứng minh gì:
///   • KHÔNG chứng minh 20 là con số đúng — căn cứ duy nhất cho con số là khối số đo ở
///     `lib/magiclamp/treasury/ledger.ak` ▸ `max_ledger_lines`;
///   • CÓ ép ai đổi hằng phải đổi cả dòng này, tức phải mở khối số đo ra đọc.
/// Vì sao cần một bài riêng cho việc này: mọi bài khác trong tệp lấy trần+1 từ chính
/// hằng (`over_cap`), nên chúng ghim QUAN HỆ (biên đúng ở trần, từ chối ở trần+1) mà
/// KHÔNG ghim giá trị. Đã đo: nâng hằng lên 1000 không làm bài nào đỏ — nó làm bộ kiểm
/// treo, vì bài âm sinh sổ 1001 dòng trên các nhánh có chi phí bậc hai. Một bộ kiểm
/// treo không phải một tín hiệu đọc được, nên quan hệ một mình là chưa đủ.
test cap_constant_value_pinned() {
  ledger.max_ledger_lines == 20
}

/// `is_canonical` PHẢI từ chối một sổ trần+1 dù sổ ấy hoàn hảo về hình dạng
/// (strict-sorted, mọi dòng > 0) — tức trần là một vế ĐỘC LẬP, không suy được từ hai
/// vế kia.
test cap_is_canonical_rejects_over_cap() {
  let long = lines(over_cap, 0)
  ledger.strict_sorted(long) && ledger.all_positive(long) && !ledger.is_canonical(
    long,
  )
}
