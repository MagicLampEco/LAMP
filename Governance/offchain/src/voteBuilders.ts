// Builder phía cử tri: castVote · retractVote · reclaimVote · burnNullifier.
//
// Nguồn on-chain:
//   `onchain/validators/nullifier.ak` ▸ MintNullifier (4 cổng) / BurnNullifier (đường (a) + (b))
//   `onchain/validators/vote.ak` ▸ RetractVote (R1–R5) / ReclaimVote (C1–C5)
//   `onchain/lib/magiclamp/governance/anchor_view.ak` ▸ person_owner_signed_ref (cổng WHO)
//
// Phiếu = MỘT UTxO tại `vote_script_hash` mang ĐÚNG MỘT token nullifier + `VoteDatum` inline.
// Không nhánh nào của `vote` gác việc TẠO phiếu; `nullifier.MintNullifier` là cổng WHO. Nên mọi
// điều kiện làm phiếu ĐẾM ĐƯỢC ở `tally.SumBatch` sau này (tên nullifier, c1/c2/c4 = 0, c3 có
// nguồn) phải được builder ép NGAY lúc bỏ phiếu — nếu không, cử tri đúc ra một phiếu hợp lệ về
// mặt đúc nhưng không bao giờ được cộng.

import { Data, toUnit, type LucidEvolution, type TxSignBuilder, type UTxO } from "@lucid-evolution/lucid";

import { decodeAnchorView, requiredSigners } from "./anchorView.js";
import {
  inlineDatumOf, isAtScript, networkOf, qtyOf, readTally, scriptAddress, slotConfigOf, tokensOf,
} from "./chainRead.js";
import type { GovernanceConfig } from "./config.js";
import { decodeVoteDatum, nullifierRedeemerToCbor, voteDatumToCbor, voteRedeemerToCbor } from "./datum.js";
import { boundedEpochWindow, type SlotConfig } from "./epochWindow.js";
import { nullifierName } from "./names.js";
import { uniqueRefs, useScripts } from "./scriptUse.js";
import type { TallyDatum, VoteChoice, VoteDatum } from "./types.js";

// ── đọc chung ──

/** Phiếu hợp lệ về HÌNH DẠNG — mirror vote.ak (V1) + tally.ak (T1). */
export function readVote(u: UTxO, cfg: GovernanceConfig): VoteDatum {
  if (!isAtScript(u.address, cfg.voteScriptHash)) {
    throw new Error(`GOV-VOTE-020: UTxO ${u.txHash}#${u.outputIndex} không nằm tại vote script ${cfg.voteScriptHash}`);
  }
  const vd = decodeVoteDatum(Data.from(inlineDatumOf(u, "Vote UTxO")));
  if (vd.nullifier !== nullifierName(vd.did_commit, vd.proposal_id)) {
    throw new Error(`GOV-VOTE-021: VoteDatum.nullifier ≠ H(did_commit ‖ proposal_id) — phiếu không bao giờ được cộng (V1/T1)`);
  }
  if (qtyOf(u, cfg.nullifierPolicyId, vd.nullifier) !== 1n || tokensOf(u, cfg.nullifierPolicyId).size !== 1) {
    throw new Error(`GOV-VOTE-022: Vote UTxO phải mang ĐÚNG 1 token nullifier ${vd.nullifier} và không tên nullifier nào khác (V1)`);
  }
  return vd;
}

/** Anchor TAAD của `didCommit` — mirror anchor_view.ak ▸ find_anchor_view + A-PERSON. */
function readAnchorSigners(u: UTxO, cfg: GovernanceConfig, didCommit: string, deviceSigner?: string): [string, string] {
  if (!isAtScript(u.address, cfg.taadPolicyId)) {
    throw new Error(`GOV-ANCHOR-020: anchor không nằm tại Script(taad_policy ${cfg.taadPolicyId})`);
  }
  if (qtyOf(u, cfg.taadPolicyId, didCommit) !== 1n) {
    throw new Error(`GOV-ANCHOR-021: anchor không mang đúng 1 token (taad_policy, ${didCommit})`);
  }
  return requiredSigners(decodeAnchorView(inlineDatumOf(u, "anchor TAAD")), deviceSigner);
}

/**
 * Nguồn c* lúc bỏ phiếu — mirror PHẦN KIỂM ĐƯỢC của `tally.ak ▸ c_sources_ok`:
 *   c1 = c2 = c4 = 0 (`[C1-C2-C4-SOURCE]`); `c3_policy == ""` ⇒ c3 = 0; ngược lại c3 ≥ 0.
 * Phần còn lại (c3 ≤ giá trị chứng thực, c3 ≤ cap bảng k3) cần reference input C3 + bảng tham
 * số, và được kiểm lại ở `buildSumBatchTx`.
 */
function assertCSources(cfg: GovernanceConfig, c: { c1: bigint; c2: bigint; c3: bigint; c4: bigint }): void {
  if (c.c1 !== 0n || c.c2 !== 0n || c.c4 !== 0n) {
    throw new Error(
      `GOV-VOTE-004: c1/c2/c4 phải = 0 (chưa có policy nguồn — tally.c_sources_ok ép == 0), nhận ${c.c1}/${c.c2}/${c.c4}. ` +
      `Phiếu khai khác 0 đúc được nhưng KHÔNG BAO GIỜ được cộng.`,
    );
  }
  if (cfg.c3PolicyId === "" && c.c3 !== 0n) {
    throw new Error(`GOV-VOTE-005: pha chưa bật C3 (c3_policy = "") ⇒ c3_capped phải = 0, nhận ${c.c3}`);
  }
  if (c.c3 < 0n) throw new Error(`GOV-VOTE-006: c3_capped phải ≥ 0, nhận ${c.c3}`);
}

// ── castVote ──

export interface CastVoteParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  /** Tally UTxO của proposal (reference input — nullifier đọc cửa sổ phiếu từ đây). */
  tallyUtxo: UTxO;
  /** Anchor TAAD của DID (reference input). */
  anchorUtxo: UTxO;
  /** hex 32 byte — tên token anchor. */
  didCommit: string;
  choice: VoteChoice;
  /** Mặc định 0. c1/c2/c4 ≠ 0 ⇒ ném (xem assertCSources). */
  c3Capped?: bigint;
  c1Capped?: bigint;
  c2Capped?: bigint;
  c4Capped?: bigint;
  /** Khoá thiết bị ký: `device_pkh` (mặc định) hoặc một `aux_device_pkhs`. */
  deviceSigner?: string;
  nowMs: number;
  slotConfig?: SlotConfig;
  voteLovelace?: bigint;
}

export interface CastVoteResult {
  tx: TxSignBuilder;
  voteDatum: VoteDatum;
  voteAddress: string;
  epoch: bigint;
  signers: [string, string];
}

export async function buildCastVoteTx(p: CastVoteParams): Promise<CastVoteResult> {
  const cfg = p.config;
  const network = networkOf(p.lucid);
  const td: TallyDatum = readTally(p.tallyUtxo, cfg.tallyPolicyId, null, null);
  if (td.phase !== "Summing") {
    throw new Error(`GOV-VOTE-001: Tally của proposal ${td.proposal_id} đã ${td.phase} — không còn nhận phiếu`);
  }
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, slotConfigOf(p.lucid, p.slotConfig));
  // cổng 3 của MintNullifier: vote_open ≤ e < vote_close.
  if (epoch < td.vote_open_epoch || epoch >= td.vote_close_epoch) {
    throw new Error(
      `GOV-VOTE-002: epoch ${epoch} ngoài cửa sổ bỏ phiếu [${td.vote_open_epoch}, ${td.vote_close_epoch}) (R-WINDOW-DISJOINT)`,
    );
  }
  const c = { c1: p.c1Capped ?? 0n, c2: p.c2Capped ?? 0n, c3: p.c3Capped ?? 0n, c4: p.c4Capped ?? 0n };
  assertCSources(cfg, c);
  const signers = readAnchorSigners(p.anchorUtxo, cfg, p.didCommit, p.deviceSigner);

  const nullifier = nullifierName(p.didCommit, td.proposal_id);
  const voteDatum: VoteDatum = {
    proposal_id: td.proposal_id, did_commit: p.didCommit, nullifier, choice: p.choice,
    c1_capped: c.c1, c2_capped: c.c2, c3_capped: c.c3, c4_capped: c.c4,
  };
  const nUnit = toUnit(cfg.nullifierPolicyId, nullifier);
  const voteAddress = scriptAddress(network, cfg.voteScriptHash);

  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [{ kind: "nullifier", role: "mint" }]);
  const tx = await txb
    .readFrom(uniqueRefs([p.tallyUtxo, p.anchorUtxo], refs))
    .mintAssets({ [nUnit]: 1n }, nullifierRedeemerToCbor({ kind: "MintNullifier", did_commit: p.didCommit, proposal_id: td.proposal_id }))
    .pay.ToAddressWithData(voteAddress, { kind: "inline", value: voteDatumToCbor(voteDatum) },
      { lovelace: p.voteLovelace ?? 2_000_000n, [nUnit]: 1n })
    .addSignerKey(signers[0])
    .addSignerKey(signers[1])
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();

  return { tx, voteDatum, voteAddress, epoch, signers };
}

// ── retractVote ──

export interface RetractVoteParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  voteUtxo: UTxO;
  tallyUtxo: UTxO;
  anchorUtxo: UTxO;
  newChoice: VoteChoice;
  deviceSigner?: string;
  nowMs: number;
  slotConfig?: SlotConfig;
}

export async function buildRetractVoteTx(p: RetractVoteParams): Promise<{ tx: TxSignBuilder; voteDatum: VoteDatum; epoch: bigint }> {
  const cfg = p.config;
  const vd = readVote(p.voteUtxo, cfg);
  const td = readTally(p.tallyUtxo, cfg.tallyPolicyId, vd.proposal_id, null);
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, slotConfigOf(p.lucid, p.slotConfig));
  if (epoch >= td.vote_close_epoch) {
    throw new Error(`GOV-VOTE-010: epoch ${epoch} ≥ vote_close ${td.vote_close_epoch} — hết cửa sổ rút phiếu (R2)`);
  }
  if (p.newChoice === vd.choice) throw new Error(`GOV-VOTE-011: lựa chọn mới trùng lựa chọn cũ '${vd.choice}' — on-chain đòi đổi thật (R5)`);
  const signers = readAnchorSigners(p.anchorUtxo, cfg, vd.did_commit, p.deviceSigner);
  const next: VoteDatum = { ...vd, choice: p.newChoice };

  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [{ kind: "vote", role: "spend" }]);
  const tx = await txb
    .collectFrom([p.voteUtxo], voteRedeemerToCbor({ kind: "RetractVote" }))
    .readFrom(uniqueRefs([p.tallyUtxo, p.anchorUtxo], refs))
    // R4: value TUYỆT ĐỐI + địa chỉ đầy đủ giữ nguyên.
    .pay.ToAddressWithData(p.voteUtxo.address, { kind: "inline", value: voteDatumToCbor(next) }, { ...p.voteUtxo.assets })
    .addSignerKey(signers[0])
    .addSignerKey(signers[1])
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();
  return { tx, voteDatum: next, epoch };
}

// ── reclaimVote ──

export interface ReclaimVoteParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  voteUtxo: UTxO;
  /** Tally của proposal — REFERENCE input (sau Finalize nó không tiêu được nữa). */
  tallyUtxo: UTxO;
  anchorUtxo: UTxO;
  deviceSigner?: string;
  nowMs: number;
  slotConfig?: SlotConfig;
}

export async function buildReclaimVoteTx(p: ReclaimVoteParams): Promise<{ tx: TxSignBuilder; epoch: bigint }> {
  const cfg = p.config;
  const vd = readVote(p.voteUtxo, cfg);
  const td = readTally(p.tallyUtxo, cfg.tallyPolicyId, vd.proposal_id, null);
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, slotConfigOf(p.lucid, p.slotConfig));
  const open = td.vote_close_epoch + cfg.tallyWindowEpochs;
  if (epoch < open) {
    throw new Error(`GOV-VOTE-030: epoch ${epoch} < vote_close + tally_window = ${open} — chưa được thu hồi phiếu (C2, nullifier (b))`);
  }
  const signers = readAnchorSigners(p.anchorUtxo, cfg, vd.did_commit, p.deviceSigner);
  const nUnit = toUnit(cfg.nullifierPolicyId, vd.nullifier);

  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [
    { kind: "vote", role: "spend" }, { kind: "nullifier", role: "mint" },
  ]);
  const tx = await txb
    .collectFrom([p.voteUtxo], voteRedeemerToCbor({ kind: "ReclaimVote" }))
    .readFrom(uniqueRefs([p.tallyUtxo, p.anchorUtxo], refs))
    // C4 + nullifier đường (b): đốt −1, Tally đọc qua reference input.
    .mintAssets({ [nUnit]: -1n }, nullifierRedeemerToCbor({
      kind: "BurnNullifier",
      proposal_id: vd.proposal_id,
      did_commits: [vd.did_commit],
    }))
    .addSignerKey(signers[0])
    .addSignerKey(signers[1])
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();
  return { tx, epoch };
}

// ── burnNullifier (đường (b), token nullifier nằm NGOÀI vote script) ──

export interface BurnNullifierParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  /**
   * Tally dùng làm mốc thời gian (reference input). Nó phải là Tally CỦA CHÍNH
   * proposal có nullifier bị đốt — on-chain (chốt B2) đọc căn cứ theo `proposal_id`
   * trong redeemer, nên một tally của proposal khác không còn dùng được làm mốc.
   */
  tallyUtxo: UTxO;
  /**
   * `did_commit` (hex 32 byte) của các chủ phiếu có nullifier bị đốt. Tên token
   * được SINH từ đây (`H(did ‖ proposal_id)`), không nhận tên thô: on-chain dựng
   * lại đúng tập đó rồi so bằng đẳng thức (chốt B1), nên một tên gõ tay mà lệch thì
   * giao dịch bị bác chứ không đốt sai.
   */
  didCommits: string[];
  /** UTxO đang giữ các token đó (ví người gọi). */
  holderUtxos: UTxO[];
  nowMs: number;
  slotConfig?: SlotConfig;
}

export async function buildBurnNullifierTx(p: BurnNullifierParams): Promise<{ tx: TxSignBuilder; epoch: bigint }> {
  const cfg = p.config;
  if (!Array.isArray(p.didCommits) || p.didCommits.length === 0) {
    throw new Error("GOV-BURN-001: phải có ≥ 1 did_commit để đốt");
  }
  if (new Set(p.didCommits).size !== p.didCommits.length) {
    throw new Error("GOV-BURN-002: did_commit trùng — on-chain dựng tập tên bằng cộng dồn nên bản trùng thành −2 và đẳng thức B1 bác");
  }
  const td = readTally(p.tallyUtxo, cfg.tallyPolicyId, null, null);
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, slotConfigOf(p.lucid, p.slotConfig));
  const open = td.vote_close_epoch + cfg.tallyWindowEpochs;
  if (epoch < open) {
    throw new Error(`GOV-BURN-003: epoch ${epoch} < vote_close + tally_window = ${open} — đường (b) chưa mở`);
  }
  const burn: Record<string, bigint> = {};
  for (const d of p.didCommits) {
    const n = nullifierName(d, td.proposal_id);
    const held = p.holderUtxos.reduce((s, u) => s + qtyOf(u, cfg.nullifierPolicyId, n), 0n);
    if (held < 1n) throw new Error(`GOV-BURN-004: không UTxO nào trong holderUtxos giữ token nullifier ${n} (did ${d})`);
    burn[toUnit(cfg.nullifierPolicyId, n)] = -1n;
  }
  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [{ kind: "nullifier", role: "mint" }]);
  const tx = await txb
    .collectFrom(p.holderUtxos)
    .readFrom(uniqueRefs([p.tallyUtxo], refs))
    .mintAssets(burn, nullifierRedeemerToCbor({
      kind: "BurnNullifier",
      proposal_id: td.proposal_id,
      did_commits: p.didCommits,
    }))
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();
  return { tx, epoch };
}
