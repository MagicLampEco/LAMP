// Builder phía Tally: sumBatch (`TallyRedeemer.SumBatch`) · finalizeTally (`TallyRedeemer.Finalize`).
//
// Tên thật trên chuỗi: nhánh chuyển Summing → Clamped tên là `Finalize` (`onchain/validators/
// tally.ak ▸ TallyRedeemer`), KHÔNG có redeemer nào tên "Clamp". Builder đặt tên
// `buildFinalizeTallyTx` để khỏi lẫn với `governance ▸ FinalizeProposal`.
//
// SumBatch — một giao dịch gồm:
//   · tiêu Tally (SumBatch{insert_proofs}) + k phiếu (vote ConsumeForTally{book_proof});
//   · đốt k nullifier (nullifier BurnNullifier đường (a): Tally bị tiêu cùng tx, e ≥ close);
//   · Tally ra: CÙNG địa chỉ + CÙNG value, datum = sumBatchNext(…) (tally.ak ▸ sum_batch_consistent,
//     top_heap_consistent, book_root_after, utxo_preserved).
// THỨ TỰ: `collect_votes` duyệt `tx.inputs` theo thứ tự ledger (txHash, index) ⇒ builder sắp phiếu
// theo đúng thứ tự đó TRƯỚC khi sinh bằng chứng chèn. Sai thứ tự = bằng chứng thứ i chứng minh
// cho sổ khác = trượt on-chain.
//
// Min-ADA của các UTxO phiếu KHÔNG bị ràng buộc đích bởi validator nào (vote.ConsumeForTally chỉ
// ép token bị đốt) — nó về ví người dựng lô như tiền thối. Đó là thiết kế on-chain hiện hành, không
// phải lựa chọn của builder.

import { Data, toUnit, type LucidEvolution, type TxSignBuilder, type UTxO } from "@lucid-evolution/lucid";

import { compareInputOrder, isAtScript, qtyOf, readTally, readWeightParam, slotConfigOf } from "./chainRead.js";
import type { GovernanceConfig } from "./config.js";
import { nullifierRedeemerToCbor, tallyDatumToCbor, tallyRedeemerToCbor, voteRedeemerToCbor } from "./datum.js";
import { boundedEpochWindow, type SlotConfig } from "./epochWindow.js";
import { uniqueRefs, useScripts } from "./scriptUse.js";
import { capOf, finalizeTallyNext, sumBatchNext } from "./tallyMath.js";
import type { TallyDatum, VoteDatum, WeightParam } from "./types.js";
import { readVote } from "./voteBuilders.js";
import { VotedLedger, type BatchInsertPlan, type VotedEntry } from "./votedLedger.js";

export type VotedLedgerSource = VotedLedger | readonly VotedEntry[];

async function resolveLedger(src: VotedLedgerSource, root: string): Promise<VotedLedger> {
  if (src instanceof VotedLedger) {
    src.assertRoot(root);
    return src;
  }
  if (Array.isArray(src)) return VotedLedger.rebuild(src, root);
  throw new Error("GOV-TALLY-000: votedLedger phải là VotedLedger hoặc mảng VotedEntry");
}

/** Giá trị C3 chứng thực — mirror tally.ak ▸ attested_c3 (đúng MỘT ref mang (c3_policy, did)). */
function attestedC3(refs: readonly UTxO[], c3Policy: string, did: string): bigint {
  const hits = refs.filter((u) => qtyOf(u, c3Policy, did) === 1n);
  if (hits.length !== 1) throw new Error(`GOV-TALLY-010: cần đúng 1 reference input chứng thực C3 cho did ${did}, thấy ${hits.length}`);
  const d = hits[0]!.datum ? Data.from(hits[0]!.datum) : undefined;
  if (typeof d !== "bigint") throw new Error(`GOV-TALLY-011: datum chứng thực C3 của did ${did} phải là Int inline`);
  return d;
}

/** Mirror tally.ak ▸ c_sources_ok cho một phiếu. */
function assertVoteSources(cfg: GovernanceConfig, wp: WeightParam, v: VoteDatum, c3Refs: readonly UTxO[]): void {
  if (v.c1_capped !== 0n || v.c2_capped !== 0n || v.c4_capped !== 0n) {
    throw new Error(`GOV-TALLY-012: phiếu của did ${v.did_commit} khai c1/c2/c4 ≠ 0 — c_sources_ok bác cả lô; loại phiếu này khỏi lô`);
  }
  if (cfg.c3PolicyId === "") {
    if (v.c3_capped !== 0n) throw new Error(`GOV-TALLY-013: pha chưa bật C3 mà phiếu của did ${v.did_commit} khai c3 = ${v.c3_capped}`);
    return;
  }
  if (v.c3_capped < 0n || v.c3_capped > capOf(wp.k3)) {
    throw new Error(`GOV-TALLY-014: c3 = ${v.c3_capped} ngoài [0, cap_3 = ${capOf(wp.k3)}] (did ${v.did_commit})`);
  }
  const att = attestedC3(c3Refs, cfg.c3PolicyId, v.did_commit);
  if (att < v.c3_capped) throw new Error(`GOV-TALLY-015: c3 khai ${v.c3_capped} > giá trị chứng thực ${att} (did ${v.did_commit})`);
}

function assertTallyUtxo(u: UTxO, cfg: GovernanceConfig): TallyDatum {
  const td = readTally(u, cfg.tallyPolicyId, null, cfg.tallyScriptHash);
  if (td.phase !== "Summing") throw new Error(`GOV-TALLY-001: Tally đang ${td.phase}, SumBatch/Finalize chỉ đi từ Summing`);
  return td;
}

// ── sumBatch ──

export interface SumBatchParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  tallyUtxo: UTxO;
  voteUtxos: UTxO[];
  weightParamUtxo: UTxO;
  /** Sổ hiện tại: đã dựng, hoặc danh sách lá (mọi phiếu đã gom ở các lô trước). */
  votedLedger: VotedLedgerSource;
  /** Reference input chứng thực C3 (bắt buộc khi pha bật C3). */
  c3AttestUtxos?: UTxO[];
  nowMs: number;
  slotConfig?: SlotConfig;
}

export interface SumBatchResult {
  tx: TxSignBuilder;
  epoch: bigint;
  tallyDatumOut: TallyDatum;
  /** Phiếu theo THỨ TỰ INPUT — cùng thứ tự với `plan.insertProofs`. */
  orderedVotes: VoteDatum[];
  plan: BatchInsertPlan;
}

export async function buildSumBatchTx(p: SumBatchParams): Promise<SumBatchResult> {
  const cfg = p.config;
  const td = assertTallyUtxo(p.tallyUtxo, cfg);
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, slotConfigOf(p.lucid, p.slotConfig));
  const closeAt = td.vote_close_epoch;
  const endAt = td.vote_close_epoch + cfg.tallyWindowEpochs;
  if (epoch < closeAt || epoch >= endAt) {
    throw new Error(`GOV-TALLY-002: epoch ${epoch} ngoài cửa sổ gom [${closeAt}, ${endAt}) (SumBatch)`);
  }
  const wp = readWeightParam(p.weightParamUtxo, cfg.weightParamPolicyId, td.weight_param_ref);
  if (!Array.isArray(p.voteUtxos) || p.voteUtxos.length === 0) {
    throw new Error("GOV-TALLY-003: lô phải có ≥ 1 phiếu (SumBatch chống lượt gộp rỗng)");
  }
  const ordered = [...p.voteUtxos].sort(compareInputOrder);
  for (let i = 1; i < ordered.length; i++) {
    if (compareInputOrder(ordered[i - 1]!, ordered[i]!) === 0) throw new Error("GOV-TALLY-004: một UTxO phiếu xuất hiện hai lần trong lô");
  }
  const c3Refs = p.c3AttestUtxos ?? [];
  const votes = ordered.map((u) => {
    const v = readVote(u, cfg);
    if (v.proposal_id !== td.proposal_id) {
      throw new Error(`GOV-TALLY-005: phiếu ${u.txHash}#${u.outputIndex} thuộc proposal ${v.proposal_id}, không phải ${td.proposal_id}`);
    }
    assertVoteSources(cfg, wp, v, c3Refs);
    return v;
  });

  const ledger = await resolveLedger(p.votedLedger, td.voted_root);            // GOV-LEDGER-001
  const plan = await ledger.planBatchInsert(votes.map((v) => ({ didCommit: v.did_commit, nullifier: v.nullifier })));
  const tallyDatumOut = sumBatchNext(td, wp, votes, plan.rootAfter);

  const burn: Record<string, bigint> = {};
  for (const v of votes) burn[toUnit(cfg.nullifierPolicyId, v.nullifier)] = -1n;

  const used = useScripts(p.lucid.newTx(), cfg, [
    { kind: "tally", role: "spend" }, { kind: "vote", role: "spend" }, { kind: "nullifier", role: "mint" },
  ]);
  let txb = used.txb
    .collectFrom([p.tallyUtxo], tallyRedeemerToCbor({ kind: "SumBatch", insert_proofs: plan.insertProofs }));
  ordered.forEach((u, i) => {
    txb = txb.collectFrom([u], voteRedeemerToCbor({ kind: "ConsumeForTally", book_proof: plan.membershipProofs[i]! }));
  });
  const tx = await txb
    .readFrom(uniqueRefs([p.weightParamUtxo], c3Refs, used.refs))
    .mintAssets(burn, nullifierRedeemerToCbor({
      kind: "BurnNullifier",
      proposal_id: td.proposal_id,
      did_commits: votes.map((v) => v.did_commit),
    }))
    .pay.ToAddressWithData(p.tallyUtxo.address, { kind: "inline", value: tallyDatumToCbor(tallyDatumOut) }, { ...p.tallyUtxo.assets })
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();

  return { tx, epoch, tallyDatumOut, orderedVotes: votes, plan };
}

// ── finalizeTally (TallyRedeemer.Finalize: Summing → Clamped) ──

export interface FinalizeTallyParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  tallyUtxo: UTxO;
  weightParamUtxo: UTxO;
  nowMs: number;
  slotConfig?: SlotConfig;
}

export async function buildFinalizeTallyTx(p: FinalizeTallyParams): Promise<{ tx: TxSignBuilder; epoch: bigint; tallyDatumOut: TallyDatum }> {
  const cfg = p.config;
  const td = assertTallyUtxo(p.tallyUtxo, cfg);
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, slotConfigOf(p.lucid, p.slotConfig));
  const endAt = td.vote_close_epoch + cfg.tallyWindowEpochs;
  if (epoch < endAt) {
    throw new Error(`GOV-TALLY-020: epoch ${epoch} < vote_close + tally_window = ${endAt} — cửa sổ gom chưa hết (F0)`);
  }
  const wp = readWeightParam(p.weightParamUtxo, cfg.weightParamPolicyId, td.weight_param_ref);
  if (wp.bft_floor < 1n) throw new Error(`GOV-TALLY-021: bft_floor ${wp.bft_floor} < 1`);
  const tallyDatumOut = finalizeTallyNext(td, wp);

  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [{ kind: "tally", role: "spend" }]);
  const tx = await txb
    .collectFrom([p.tallyUtxo], tallyRedeemerToCbor({ kind: "Finalize" }))
    .readFrom(uniqueRefs([p.weightParamUtxo], refs))
    .pay.ToAddressWithData(p.tallyUtxo.address, { kind: "inline", value: tallyDatumToCbor(tallyDatumOut) }, { ...p.tallyUtxo.assets })
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();
  return { tx, epoch, tallyDatumOut };
}

/** Tiện ích cho kiểm thử/indexer: phiếu có đang nằm ở vote script không. */
export function isVoteUtxo(u: UTxO, cfg: GovernanceConfig): boolean {
  return isAtScript(u.address, cfg.voteScriptHash);
}
