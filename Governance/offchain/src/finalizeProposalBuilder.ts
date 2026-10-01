// finalizeProposal — `governance.spend ▸ FinalizeProposal`: Open → Executed | Rejected.
//
// On-chain (`onchain/validators/governance.ak` nhánh `spend`, chốt S1–S9):
//   S1 status == Open · S2 đúng 1 input + 1 output tại script governance · S3 NFT (gov, proposal_id)
//   đi qua nguyên vẹn, là tên DUY NHẤT của policy trong input · S4 value + địa chỉ đầy đủ giữ
//   nguyên, không reference script · S5 không đúc/đốt · S6 e ≥ execute_after_epoch ·
//   S7 Tally (reference input) của đúng proposal, tại Script(tally_script_hash), phase Clamped ·
//   S8 bảng tham số tại td.weight_param_ref, D8, bft_floor ≥ 1 · S9 datum ra CHỈ đổi status, =
//   phán quyết `tally.ak ▸ pass`, và spend_spec_hash == "".
//
// Builder tính phán quyết bằng CÙNG biểu thức (`tallyMath.pass`, bản chép của `tally.ak ▸ pass`) —
// on-chain ép `status == verdict` chứ không phải "một trong hai", nên chọn sai là trượt.

import { Data, type LucidEvolution, type TxSignBuilder, type UTxO } from "@lucid-evolution/lucid";

import { inlineDatumOf, isAtScript, qtyOf, readTally, readWeightParam, slotConfigOf, tokensOf } from "./chainRead.js";
import type { GovernanceConfig } from "./config.js";
import { decodeProposalResult, governanceSpendRedeemerToCbor, proposalResultToCbor } from "./datum.js";
import { boundedEpochWindow, type SlotConfig } from "./epochWindow.js";
import { uniqueRefs, useScripts } from "./scriptUse.js";
import { pass } from "./tallyMath.js";
import type { ProposalResult, ProposalStatus } from "./types.js";

export interface FinalizeProposalParams {
  lucid: LucidEvolution;
  config: GovernanceConfig;
  proposalUtxo: UTxO;
  /** Tally ĐÃ Clamped của proposal (reference input). */
  tallyUtxo: UTxO;
  weightParamUtxo: UTxO;
  nowMs: number;
  slotConfig?: SlotConfig;
}

export interface FinalizeProposalResult {
  tx: TxSignBuilder;
  epoch: bigint;
  verdict: Extract<ProposalStatus, "Executed" | "Rejected">;
  proposalDatumOut: ProposalResult;
}

export async function buildFinalizeProposalTx(p: FinalizeProposalParams): Promise<FinalizeProposalResult> {
  const cfg = p.config;
  const u = p.proposalUtxo;
  if (!isAtScript(u.address, cfg.governancePolicyId)) {
    throw new Error(`GOV-FINP-001: proposal UTxO không nằm tại Script(governance ${cfg.governancePolicyId})`);
  }
  const pr = decodeProposalResult(Data.from(inlineDatumOf(u, "proposal UTxO")));
  if (pr.status !== "Open") throw new Error(`GOV-FINP-002: proposal đang '${pr.status}', FinalizeProposal chỉ đi từ Open (S1)`);
  if (qtyOf(u, cfg.governancePolicyId, pr.proposal_id) !== 1n || tokensOf(u, cfg.governancePolicyId).size !== 1) {
    throw new Error(`GOV-FINP-004: proposal UTxO phải mang đúng 1 token (governance, ${pr.proposal_id}) và không tên nào khác (S3)`);
  }
  if (pr.spend_spec_hash !== "") {
    throw new Error(
      "GOV-FINP-005: spend_spec_hash ≠ \"\" — S9 ép datum ra vừa giữ nguyên vừa bằng \"\" ⇒ không giao dịch nào " +
      "ghi được kết quả cho proposal này ([SELF-DUP-CHOICE] mức 3)",
    );
  }
  const td = readTally(p.tallyUtxo, cfg.tallyPolicyId, pr.proposal_id, cfg.tallyScriptHash);
  if (td.phase !== "Clamped") {
    throw new Error(`GOV-FINP-003: Tally của proposal ${pr.proposal_id} đang '${td.phase}', chưa Clamped — chạy finalizeTally trước (S7, GAME-1)`);
  }
  const { loMs, hiMs, epoch } = boundedEpochWindow(p.nowMs, cfg.msPerEpoch, cfg.windowOriginMs, slotConfigOf(p.lucid, p.slotConfig));
  if (epoch < pr.execute_after_epoch) {
    throw new Error(`GOV-FINP-006: epoch ${epoch} < execute_after_epoch ${pr.execute_after_epoch} (S6)`);
  }
  const wp = readWeightParam(p.weightParamUtxo, cfg.weightParamPolicyId, td.weight_param_ref);
  if (wp.bft_floor < 1n) throw new Error(`GOV-FINP-007: bft_floor ${wp.bft_floor} < 1 (S8)`);

  const verdict = pass(td, wp) ? "Executed" : "Rejected";
  const proposalDatumOut: ProposalResult = { ...pr, status: verdict };

  const { txb, refs } = useScripts(p.lucid.newTx(), cfg, [{ kind: "governance", role: "spend" }]);
  const tx = await txb
    .collectFrom([u], governanceSpendRedeemerToCbor({ kind: "FinalizeProposal" }))
    .readFrom(uniqueRefs([p.tallyUtxo, p.weightParamUtxo], refs))
    .pay.ToAddressWithData(u.address, { kind: "inline", value: proposalResultToCbor(proposalDatumOut) }, { ...u.assets })
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();
  return { tx, epoch, verdict, proposalDatumOut };
}
