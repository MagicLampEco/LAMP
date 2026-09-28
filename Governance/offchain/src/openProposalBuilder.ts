// openProposal — `governance.mint ▸ OpenProposal` + `tally_nft.mint ▸ MintTally` trong CÙNG giao dịch.
//
// On-chain (`onchain/validators/governance.ak` nhánh `mint`, chốt O1–O6):
//   O1 tiêu seed · O2 đúc đúng (gov, H(seed)) ×1 + (tally, H(seed)) ×1, không policy nào khác ·
//   O3 `vote_open ≥ e`, `close > open`, `close − open < recovery_timelock_epochs` ·
//   O4 proposal UTxO tại Script(gov), ProposalResult{Open, spend_spec_hash = "", released 0,
//      execute_after ≥ close + Δ_min} · O5 Tally UTxO tại Script(tally), TallyDatum ban đầu MỌI
//      trường · O6 `weight_param_ref` là reference input mang đúng 1 tên token weight_param_policy.
// `tally_nft.ak ▸ MintTally`: tiêu seed, đúng 1 tên token = H(seed) ×1.
//
// Builder kiểm THÊM một điều on-chain Open không kiểm: bảng WeightParam qua cổng D8
// (`weight_ref.read_weight_param`). Open không đọc datum bảng, nhưng MỌI lượt SumBatch/Finalize
// sau đó đọc — bảng hỏng thì Tally mở ra bị khoá cứng vĩnh viễn (min-ADA kẹt, R-NO-BURN).

import { toUnit, type LucidEvolution, type TxSignBuilder, type UTxO } from "@lucid-evolution/lucid";

import {
  governanceMintRedeemerToCbor, proposalResultToCbor, tallyDatumToCbor, tallyNftRedeemerToCbor,
} from "./datum.js";
import { boundedEpochWindow, type SlotConfig } from "./epochWindow.js";
import { networkOf, readWeightParam, scriptAddress, slotConfigOf, utxoRef } from "./chainRead.js";
import type { GovernanceConfig } from "./config.js";
import { proposalIdOf } from "./names.js";
import { uniqueRefs, useScripts } from "./scriptUse.js";
import type { ProposalResult, TallyDatum } from "./types.js";
import { VOTED_ROOT_EMPTY } from "./votedLedger.js";

export interface OpenProposalParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  /** UTxO hạt giống (ví người mở) — bị TIÊU; `proposal_id = H(seed)`. */
  seedUtxo: UTxO;
  /** UTxO bảng tham số (reference input) — ref của nó thành `weight_param_ref`. */
  weightParamUtxo: UTxO;
  voteOpenEpoch: bigint;
  voteCloseEpoch: bigint;
  /** Mặc định `voteCloseEpoch + deltaMinEpochs` (mức tối thiểu R-DELAY). */
  executeAfterEpoch?: bigint;
  nowMs: number;
  slotConfig?: SlotConfig;
  proposalLovelace?: bigint;
  tallyLovelace?: bigint;
}

export interface OpenProposalResult {
  tx: TxSignBuilder;
  proposalId: string;
  epoch: bigint;
  proposalDatum: ProposalResult;
  tallyDatum: TallyDatum;
  proposalAddress: string;
  tallyAddress: string;
}

export async function buildOpenProposalTx(p: OpenProposalParams): Promise<OpenProposalResult> {
  const cfg = p.config;
  const network = networkOf(p.lucid);
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, slotConfigOf(p.lucid, p.slotConfig));

  // O3 — cửa sổ bỏ phiếu.
  if (p.voteOpenEpoch < epoch) {
    throw new Error(`GOV-OPEN-001: vote_open_epoch ${p.voteOpenEpoch} < epoch giao dịch ${epoch} (O3)`);
  }
  if (p.voteCloseEpoch <= p.voteOpenEpoch) {
    throw new Error(`GOV-OPEN-002: vote_close_epoch ${p.voteCloseEpoch} phải > vote_open_epoch ${p.voteOpenEpoch} (O3)`);
  }
  if (p.voteCloseEpoch - p.voteOpenEpoch >= cfg.recoveryTimelockEpochs) {
    throw new Error(
      `GOV-OPEN-003: cửa sổ bỏ phiếu ${p.voteCloseEpoch - p.voteOpenEpoch} epoch phải < recovery_timelock_epochs ` +
      `${cfg.recoveryTimelockEpochs} (CAO-5, [DID-RECOVERY-TRUST])`,
    );
  }
  const minExec = p.voteCloseEpoch + cfg.deltaMinEpochs;
  const executeAfter = p.executeAfterEpoch ?? minExec;
  if (executeAfter < minExec) {
    throw new Error(`GOV-OPEN-004: execute_after_epoch ${executeAfter} < vote_close + Δ_min = ${minExec} (R-DELAY)`);
  }

  // O6 + D8 — bảng tham số.
  readWeightParam(p.weightParamUtxo, cfg.weightParamPolicyId, null);
  const weightParamRef = utxoRef(p.weightParamUtxo);

  // O1 — danh tính.
  const seed = utxoRef(p.seedUtxo);
  const proposalId = proposalIdOf(seed);

  const proposalDatum: ProposalResult = {
    proposal_id: proposalId,
    status: "Open",
    spend_spec_hash: "",
    execute_after_epoch: executeAfter,
    released_cumulative: 0n,
  };
  const tallyDatum: TallyDatum = {
    proposal_id: proposalId,
    phase: "Summing",
    weight_param_ref: weightParamRef,
    yes_power_raw: 0n, no_power_raw: 0n, abstain_power_raw: 0n,
    voters_acc: 0n, yes_voters_acc: 0n,
    top_did_vp: [],
    yes_power_eff: 0n, no_power_eff: 0n, abstain_power_eff: 0n,
    vote_open_epoch: p.voteOpenEpoch,
    vote_close_epoch: p.voteCloseEpoch,
    voted_root: VOTED_ROOT_EMPTY,
  };

  const govUnit = toUnit(cfg.governancePolicyId, proposalId);
  const tallyUnit = toUnit(cfg.tallyPolicyId, proposalId);
  const proposalAddress = scriptAddress(network, cfg.governancePolicyId);
  const tallyAddress = scriptAddress(network, cfg.tallyScriptHash);

  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [
    { kind: "governance", role: "mint" }, { kind: "tallyNft", role: "mint" },
  ]);
  const tx = await txb
    .collectFrom([p.seedUtxo])
    .readFrom(uniqueRefs([p.weightParamUtxo], refs))
    .mintAssets({ [govUnit]: 1n }, governanceMintRedeemerToCbor({
      kind: "OpenProposal", seed, vote_open_epoch: p.voteOpenEpoch, vote_close_epoch: p.voteCloseEpoch,
      weight_param_ref: weightParamRef,
    }))
    .mintAssets({ [tallyUnit]: 1n }, tallyNftRedeemerToCbor({ kind: "MintTally", seed }))
    .pay.ToAddressWithData(proposalAddress, { kind: "inline", value: proposalResultToCbor(proposalDatum) },
      { lovelace: p.proposalLovelace ?? 2_000_000n, [govUnit]: 1n })
    .pay.ToAddressWithData(tallyAddress, { kind: "inline", value: tallyDatumToCbor(tallyDatum) },
      { lovelace: p.tallyLovelace ?? 3_000_000n, [tallyUnit]: 1n })
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();

  return { tx, proposalId, epoch, proposalDatum, tallyDatum, proposalAddress, tallyAddress };
}
