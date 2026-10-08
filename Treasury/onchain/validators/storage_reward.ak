// Validator trả thưởng lưu trữ LampNet (Treasury/storage-reward/CONTRACT.md v0.1).
//
// Mint + spend cùng một script: policy của token đợt == hash script này.
// Mã bất biến `SRP-*` khớp mục §5 của CONTRACT; mỗi mã có bài ghim trong `storage_reward_test.ak`.

use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Script, VerificationKey}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
use magiclamp/treasury/ledger
use magiclamp/treasury/pointer
use magiclamp/treasury/storage_reward.{
  Active, BatchMint, Burn, BurnBatch, Claim, ClaimItem, Close, MintBatch, Open, PayoutAction,
  PayoutDatum, PostRoot, Round, Tombstone,
} as sr
use magiclamp/treasury/types.{AssetKey, CustodyDatum}
use magiclamp/treasury/util

/// Tham số (nướng vào hash):
///   carp_policy/carp_name  — tài sản trả (CARP). Mainnet CHƯA có policy ⇒ là tham số.
///   committee/threshold    — hội đồng M-of-N mở đợt, đăng gốc, đóng sớm.
///   custody_hash           — payment script hash của `custody`.
///   custody_seed_policy    — policy NFT chứng thực custody; tên NFT = `custody_instance_id`.
///   reward_bucket          — bucket_id `storage_reward` trong sổ custody.
///   batch_epochs           — số epoch một đợt (quyết định 2026-10-08: 6).
///   ms_per_epoch/window_origin_ms — lưới epoch (Utils `MS_PER_EPOCH_BY_NETWORK`).
validator storage_reward(
  carp_policy: assets.PolicyId,
  carp_name: ByteArray,
  committee: List<ByteArray>,
  threshold: Int,
  custody_hash: ByteArray,
  custody_seed_policy: assets.PolicyId,
  custody_instance_id: ByteArray,
  reward_bucket: Int,
  batch_epochs: Int,
  ms_per_epoch: Int,
  window_origin_ms: Int,
) {
  mint(redeemer: BatchMint, policy_id: assets.PolicyId, tx: Transaction) {
    let minted = assets.tokens(tx.mint, policy_id) |> dict.to_pairs
    when redeemer is {
      MintBatch -> {
        // SRP-MINT-ONE: đúng 1 token, đúng tên.
        expect [Pair(name, 1)] = minted
        expect name == sr.batch_token_name
        // SRP-OPEN-AUTH: M-of-N.
        expect
          pointer.committee_approved(committee, threshold, tx.extra_signatories)
        // SRP-ONE-INPUT: đúng một input ở script này, và nó CHƯA mở (không token).
        expect [src] =
          list.filter(tx.inputs, fn(i) { util.is_at_script(i.output.address, policy_id) })
        expect assets.quantity_of(src.output.value, policy_id, name) == 0
        // SRP-OPEN-OUT: đúng một output ở script này, cùng địa chỉ đầy đủ, không ref script.
        expect [out] =
          list.filter(tx.outputs, fn(o) { util.is_at_script(o.address, policy_id) })
        expect out.address == src.output.address
        expect out.reference_script == None
        expect InlineDatum(d) = out.datum
        expect Active { start_epoch, epoch_fees, share_bps, round }: PayoutDatum = d
        let carp_in =
          assets.quantity_of(src.output.value, carp_policy, carp_name)
        and {
          // SRP-OPEN-FRESH: chưa vòng nào.
          round == None,
          start_epoch >= 0,
          // SRP-OPEN-SHAPE: đúng `batch_epochs` mức phí, không âm.
          list.length(epoch_fees) == batch_epochs,
          list.all(epoch_fees, fn(f) { f >= 0 }),
          // SRP-SHARE-MAX: 0 ≤ s ≤ 0,5.
          share_bps >= 0,
          share_bps <= sr.max_share_bps,
          // SRP-OPEN-KEEP: toàn bộ CARP của UTxO nạp vào đợt; ADA không giảm; value sạch.
          out.value == sr.batch_value(
            assets.lovelace_of(out.value),
            carp_policy,
            carp_name,
            carp_in,
            policy_id,
            1,
          ),
          assets.lovelace_of(out.value) >= assets.lovelace_of(src.output.value),
          // SRP-OPEN-FUNDED: Σ trần ≤ CARP nạp ⇒ mọi trần đều chi được.
          sr.total_caps(epoch_fees, share_bps) <= carp_in,
          // SRP-OPEN-CLOSABLE: custody đích nhận CARP + ADA vào bucket `storage_reward`.
          custody_closable(
            tx.reference_inputs,
            custody_hash,
            custody_seed_policy,
            custody_instance_id,
            reward_bucket,
            carp_policy,
            carp_name,
          ),
        }
      }
      BurnBatch -> {
        // SRP-BURN-ONE: chỉ đốt đúng 1; nhánh spend `Burn` của token đó quyết phần còn lại.
        expect [Pair(name, -1)] = minted
        name == sr.batch_token_name
      }
    }
  }

  spend(
    datum_opt: Option<Data>,
    redeemer: PayoutAction,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(own_in) =
      list.find(tx.inputs, fn(i) { i.output_reference == own_ref })
    let own_addr = own_in.output.address
    expect Script(own_hash) = own_addr.payment_credential
    // SRP-ONE-INPUT: mọi nhánh — đúng một input ở script này (chống thoả-kép giữa hai đợt).
    expect util.count_inputs_at_script(tx.inputs, own_hash) == 1
    let token_in =
      assets.quantity_of(own_in.output.value, own_hash, sr.batch_token_name)
    let own_mint = assets.tokens(tx.mint, own_hash) |> dict.to_pairs

    when redeemer is {
      Open -> and {
          token_in == 0,
          // mint handler `MintBatch` gánh mọi kiểm còn lại.
          own_mint == [Pair(sr.batch_token_name, 1)],
        }

      PostRoot { epoch, root, leaf_count } -> {
        // SRP-AUTH-TOKEN: chỉ UTxO có token mới có datum đáng tin.
        expect token_in == 1
        expect Some(raw) = datum_opt
        expect Active { start_epoch, epoch_fees, share_bps, round }: PayoutDatum =
          raw
        let cur = util.get_epoch(tx, ms_per_epoch, window_origin_ms)
        let out = continuing(tx.outputs, own_hash)
        let expected: Data =
          Active {
            start_epoch,
            epoch_fees,
            share_bps,
            round: Some(
              Round {
                epoch,
                root,
                leaf_count,
                paid: 0,
                claimed: sr.empty_bitmap(leaf_count),
              },
            ),
          }
        and {
          // SRP-ROOT-AUTH
          pointer.committee_approved(committee, threshold, tx.extra_signatories),
          // SRP-ROOT-RANGE
          epoch >= start_epoch,
          epoch < start_epoch + batch_epochs,
          // SRP-ROOT-MONOTONIC: không đăng lại epoch cũ (đăng lại = xoá bitmap + paid).
          when round is {
            None -> True
            Some(r) -> epoch > r.epoch
          },
          // SRP-ROOT-AFTER-EPOCH: epoch dịch vụ đã kết thúc.
          cur > epoch,
          bytearray.length(root) == 32,
          leaf_count >= 1,
          leaf_count <= sr.max_leaves,
          own_mint == [],
          // SRP-CONT: cùng địa chỉ, value NGUYÊN, datum đúng.
          out.address == own_addr,
          out.reference_script == None,
          out.value == own_in.output.value,
          out.datum == InlineDatum(expected),
        }
      }

      Claim { claims } -> {
        expect token_in == 1
        expect Some(raw) = datum_opt
        expect Active { start_epoch, epoch_fees, share_bps, round }: PayoutDatum =
          raw
        expect Some(r) = round
        expect claims != []
        // SRP-PAY-POSITION: output[0] = đợt tiếp tục; output[1..k] trả lần lượt claim 1..k.
        expect [out, ..pays] = tx.outputs
        let (bitmap, total) =
          settle(claims, pays, r, carp_policy, carp_name, r.claimed, 0)
        let in_value = own_in.output.value
        let carp_in = assets.quantity_of(in_value, carp_policy, carp_name)
        let expected: Data =
          Active {
            start_epoch,
            epoch_fees,
            share_bps,
            round: Some(Round { ..r, paid: r.paid + total, claimed: bitmap }),
          }
        and {
          // SRP-CAP-PER-EPOCH
          r.paid + total <= sr.cap_of(epoch_fees, start_epoch, r.epoch, share_bps),
          own_mint == [],
          // SRP-CONT
          util.is_at_script(out.address, own_hash),
          out.address == own_addr,
          out.reference_script == None,
          out.datum == InlineDatum(expected),
          // SRP-CLAIM-VALUE: CARP giảm ĐÚNG Σ trả; ADA không giảm; value sạch.
          out.value == sr.batch_value(
            assets.lovelace_of(out.value),
            carp_policy,
            carp_name,
            carp_in - total,
            own_hash,
            1,
          ),
          assets.lovelace_of(out.value) >= assets.lovelace_of(in_value),
        }
      }

      Close -> {
        let in_value = own_in.output.value
        let carp_amt = assets.quantity_of(in_value, carp_policy, carp_name)
        let ada_amt = assets.lovelace_of(in_value)
        // SRP-RETURN-INPUTS: ngoài đợt + custody, mọi input là ví khoá.
        expect
          list.all(
            tx.inputs,
            fn(i) {
              when i.output.address.payment_credential is {
                VerificationKey(_) -> True
                Script(h) -> h == own_hash || h == custody_hash
              }
            },
          )
        // SRP-RETURN-NOMINT
        expect own_mint == []
        // SRP-RETURN-LINE: dòng sổ (storage_reward, CARP) và (storage_reward, ADA) của custody
        // tăng ĐÚNG số đợt đang giữ.
        expect
          custody_line_delta(
            tx,
            custody_hash,
            custody_seed_policy,
            custody_instance_id,
            reward_bucket,
            carp_policy,
            carp_name,
          ) == carp_amt
        expect
          custody_line_delta(
            tx,
            custody_hash,
            custody_seed_policy,
            custody_instance_id,
            reward_bucket,
            #"",
            #"",
          ) == ada_amt
        let own_outs =
          list.filter(tx.outputs, fn(o) { util.is_at_script(o.address, own_hash) })
        if token_in == 1 {
          expect Some(raw) = datum_opt
          expect Active { start_epoch, .. }: PayoutDatum = raw
          let cur = util.get_epoch(tx, ms_per_epoch, window_origin_ms)
          // SRP-TOMBSTONE: token ở lại script, trong UTxO `Tombstone`, value = token + ADA.
          expect [tomb] = own_outs
          let tombstone: Data = Tombstone
          and {
            // SRP-CLOSE-AUTH
            or {
              cur >= start_epoch + batch_epochs + sr.close_grace_epochs,
              pointer.committee_approved(
                committee,
                threshold,
                tx.extra_signatories,
              ),
            },
            tomb.address == own_addr,
            tomb.reference_script == None,
            tomb.datum == InlineDatum(tombstone),
            assets.without_lovelace(tomb.value) == assets.from_asset(
              own_hash,
              sr.batch_token_name,
              1,
            ),
          }
        } else {
          and {
            // SRP-UNOPENED-AUTH
            pointer.committee_approved(committee, threshold, tx.extra_signatories),
            own_outs == [],
          }
        }
      }

      Burn -> {
        expect token_in == 1
        expect Some(raw) = datum_opt
        let tombstone: Data = Tombstone
        and {
          // SRP-BURN-TOMB
          raw == tombstone,
          own_mint == [Pair(sr.batch_token_name, -1)],
        }
      }
    }
  }

  else(_) {
    fail
  }
}

/// Output đợt tiếp tục: đúng một output ở script này.
fn continuing(outputs: List<Output>, own_hash: ByteArray) -> Output {
  expect [o] =
    list.filter(outputs, fn(o) { util.is_at_script(o.address, own_hash) })
  o
}

/// Trả từng claim theo vị trí. Trả về (bitmap mới, Σ amount).
fn settle(
  claims: List<ClaimItem>,
  pays: List<Output>,
  r: Round,
  carp_policy: ByteArray,
  carp_name: ByteArray,
  bitmap: ByteArray,
  total: Int,
) -> (ByteArray, Int) {
  when claims is {
    [] -> (bitmap, total)
    [c, ..rest] -> {
      expect [p, ..more] = pays
      // SRP-LEAF-BOUNDS
      expect c.amount > 0
      expect c.index >= 0
      expect c.index < r.leaf_count
      // SRP-NO-DOUBLE: bit chưa bật (kể cả claim trùng trong cùng tx).
      expect !sr.is_claimed(bitmap, c.index)
      // SRP-PROOF: lá dựng từ ĐỊA CHỈ output thật ⇒ không trả nhầm địa chỉ.
      expect
        sr.root_from(sr.leaf_hash(r.epoch, c.index, c.amount, p.address), c.proof) == r.root
      // SRP-PAY-EXACT
      expect assets.quantity_of(p.value, carp_policy, carp_name) == c.amount
      settle(
        rest,
        more,
        r,
        carp_policy,
        carp_name,
        sr.set_claimed(bitmap, c.index),
        total + c.amount,
      )
    }
  }
}

fn custody_utxo(
  outs: List<Output>,
  custody_hash: ByteArray,
  seed_policy: ByteArray,
  instance_id: ByteArray,
) -> CustodyDatum {
  expect [o] =
    list.filter(
      outs,
      fn(o) {
        util.is_at_script(o.address, custody_hash) && assets.quantity_of(
          o.value,
          seed_policy,
          instance_id,
        ) == 1
      },
    )
  expect InlineDatum(d) = o.datum
  expect cd: CustodyDatum = d
  cd
}

/// Δ dòng sổ (bucket, asset) của custody giữa input và output trong tx.
fn custody_line_delta(
  tx: Transaction,
  custody_hash: ByteArray,
  seed_policy: ByteArray,
  instance_id: ByteArray,
  bucket: Int,
  policy: ByteArray,
  name: ByteArray,
) -> Int {
  let cin =
    custody_utxo(
      list.map(tx.inputs, fn(i) { i.output }),
      custody_hash,
      seed_policy,
      instance_id,
    )
  let cout = custody_utxo(tx.outputs, custody_hash, seed_policy, instance_id)
  ledger.get(cout.ledger, bucket, policy, name) - ledger.get(
    cin.ledger,
    bucket,
    policy,
    name,
  )
}

/// SRP-OPEN-CLOSABLE: custody (reference input) nhận CARP + ADA và có bucket `storage_reward`.
/// `accepted_assets` và `buckets` là bất biến đời instance (custody ghim ở mọi nhánh) ⇒ đúng lúc
/// mở thì đúng tới lúc đóng.
fn custody_closable(
  refs: List<Input>,
  custody_hash: ByteArray,
  seed_policy: ByteArray,
  instance_id: ByteArray,
  bucket: Int,
  carp_policy: ByteArray,
  carp_name: ByteArray,
) -> Bool {
  let cd =
    custody_utxo(
      list.map(refs, fn(i) { i.output }),
      custody_hash,
      seed_policy,
      instance_id,
    )
  and {
    list.has(cd.accepted_assets, AssetKey { policy: carp_policy, name: carp_name }),
    list.has(cd.accepted_assets, AssetKey { policy: #"", name: #"" }),
    list.has(cd.buckets, bucket),
  }
}
