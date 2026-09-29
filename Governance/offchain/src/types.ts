// Governance v2 — kiểu off-chain, BẢN CHIẾU của kiểu Aiken.
//
// Nguồn (đọc 2026-09-29, commit 46a3a36 nhánh gov-v2):
//   datum        : `onchain/lib/magiclamp/governance/types.ak` ▸ ProposalStatus, ProposalResult,
//                  VoteChoice, ProposalDatum, WeightParam, VoteDatum, TopEntry, TallyPhase, TallyDatum
//   Knot         : `onchain/lib/magiclamp/governance/power.ak` ▸ Knot
//   redeemer     : `onchain/validators/governance.ak` ▸ GovernanceRedeemer, GovernanceSpendRedeemer
//                  `onchain/validators/vote.ak` ▸ VoteRedeemer
//                  `onchain/validators/tally.ak` ▸ TallyRedeemer
//                  `onchain/validators/nullifier.ak` ▸ NullifierRedeemer
//                  `onchain/validators/tally_nft.ak` ▸ TallyNftRedeemer
//                  `onchain/validators/weight_param_nft.ak` ▸ WeightParamNftRedeemer
//   MPF Proof    : `aiken-lang/merkle-patricia-forestry` 2.1.0 ▸ Proof, ProofStep, Neighbor
//
// Chỉ số Constr = thứ tự khai báo trong Aiken; đã đối chiếu với `onchain/plutus.json`
// (`definitions`) — ca kiểm `tests/codec.test.ts` đọc thẳng blueprint để so.
// Tên trường giữ snake_case ĐÚNG như Aiken để đối chiếu từng dòng.

/** `cardano/transaction.OutputReference` = Constr 0 [transaction_id, output_index]. */
export interface OutputRef {
  /** hex, 32 byte. */
  transaction_id: string;
  output_index: bigint;
}

/** Constr 0=Open 1=Tallied 2=Executed 3=Rejected (types.ak ▸ ProposalStatus, khoá D10). */
export type ProposalStatus = "Open" | "Tallied" | "Executed" | "Rejected";
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ["Open", "Tallied", "Executed", "Rejected"];

/** Constr 0=Yes 1=No 2=Abstain (types.ak ▸ VoteChoice). */
export type VoteChoice = "Yes" | "No" | "Abstain";
export const VOTE_CHOICES: readonly VoteChoice[] = ["Yes", "No", "Abstain"];

/** Constr 0=Summing 1=Clamped (types.ak ▸ TallyPhase). */
export type TallyPhase = "Summing" | "Clamped";
export const TALLY_PHASES: readonly TallyPhase[] = ["Summing", "Clamped"];

/**
 * Datum của UTxO proposal tại địa chỉ `governance` — ĐÚNG 5 trường ở mọi trạng thái
 * (`SPEC.md` §v2.8 `R-RESULT-SHAPE`). types.ak ▸ ProposalResult.
 */
export interface ProposalResult {
  /** hex 32 byte = `H(seed)` = tên token proposal VÀ token tally. */
  proposal_id: string;
  status: ProposalStatus;
  /** hex; v2 Pha 1/2 bị ép `""` ở cả Open lẫn FinalizeProposal (`[SELF-DUP-CHOICE]` mức 3). */
  spend_spec_hash: string;
  execute_after_epoch: bigint;
  released_cumulative: bigint;
}

/**
 * Datum nội bộ 12 trường (types.ak ▸ ProposalDatum). Validator v2 KHÔNG đọc/ghi kiểu này
 * (governance dùng ProposalResult); giữ codec vì kiểu còn trong blueprint (validator v1
 * `proposal.ak` chưa xoá) — dùng nó cho proposal v2 là SAI.
 */
export interface ProposalDatum {
  proposal_id: string;
  status: ProposalStatus;
  vote_open_epoch: bigint;
  vote_close_epoch: bigint;
  snapshot_epoch: bigint;
  weight_param_ref: OutputRef;
  spend_spec_hash: string;
  released_cumulative: bigint;
  execute_after_epoch: bigint;
  yes_power: bigint;
  no_power: bigint;
  voter_count: bigint;
}

/** power.ak ▸ Knot = Constr 0 [c, pow]. */
export interface Knot {
  c: bigint;
  pow: bigint;
}

/** types.ak ▸ WeightParam — 9 trường. */
export interface WeightParam {
  k1: Knot[];
  k2: Knot[];
  k3: Knot[];
  k4: Knot[];
  bft_floor: bigint;
  quorum_vp_threshold: bigint;
  quorum_voter_threshold: bigint;
  theta_num: bigint;
  theta_den: bigint;
}

/** types.ak ▸ VoteDatum — 8 trường. */
export interface VoteDatum {
  /** hex 32 byte. */
  proposal_id: string;
  /** hex 32 byte — tên token anchor TAAD của DID. */
  did_commit: string;
  /** hex 32 byte = blake2b_256(did_commit ‖ proposal_id) (names.ak ▸ nullifier_name). */
  nullifier: string;
  choice: VoteChoice;
  c1_capped: bigint;
  c2_capped: bigint;
  c3_capped: bigint;
  c4_capped: bigint;
}

/** types.ak ▸ TopEntry = Constr 0 [vp_raw, choice]. */
export interface TopEntry {
  vp_raw: bigint;
  choice: VoteChoice;
}

/** types.ak ▸ TallyDatum — 15 trường; ba trường v2 nối CUỐI (chỉ số 12, 13, 14). */
export interface TallyDatum {
  proposal_id: string;
  phase: TallyPhase;
  weight_param_ref: OutputRef;
  yes_power_raw: bigint;
  no_power_raw: bigint;
  abstain_power_raw: bigint;
  voters_acc: bigint;
  yes_voters_acc: bigint;
  top_did_vp: TopEntry[];
  yes_power_eff: bigint;
  no_power_eff: bigint;
  abstain_power_eff: bigint;
  vote_open_epoch: bigint;
  vote_close_epoch: bigint;
  /** hex 32 byte — gốc MPF sổ DID đã đếm (khoá = did_commit, giá trị = nullifier). */
  voted_root: string;
}

// ── Bằng chứng MPF (aiken-lang/merkle-patricia-forestry 2.1.0) ──
//   Proof = List<ProofStep>
//   Branch = Constr 0 [skip, neighbors(128 B)] · Fork = Constr 1 [skip, Neighbor]
//   Leaf = Constr 2 [skip, key(32 B), value(32 B)] · Neighbor = Constr 0 [nibble, prefix, root(32 B)]

export interface MpfNeighbor {
  nibble: bigint;
  prefix: string;
  root: string;
}

export type MpfProofStep =
  | { kind: "Branch"; skip: bigint; neighbors: string }
  | { kind: "Fork"; skip: bigint; neighbor: MpfNeighbor }
  | { kind: "Leaf"; skip: bigint; key: string; value: string };

export type MpfProof = MpfProofStep[];

// ── Redeemer ──

/** governance.ak ▸ GovernanceRedeemer (nhánh `mint`). Constr 0 = OpenProposal. */
export interface OpenProposalRedeemer {
  kind: "OpenProposal";
  seed: OutputRef;
  vote_open_epoch: bigint;
  vote_close_epoch: bigint;
  weight_param_ref: OutputRef;
}
export type GovernanceMintRedeemer = OpenProposalRedeemer;

/** governance.ak ▸ GovernanceSpendRedeemer. Constr 0 = FinalizeProposal. */
export type GovernanceSpendRedeemer = { kind: "FinalizeProposal" };

/** vote.ak ▸ VoteRedeemer. 0=ConsumeForTally{book_proof} 1=RetractVote 2=ReclaimVote. */
export type VoteRedeemer =
  | { kind: "ConsumeForTally"; book_proof: MpfProof }
  | { kind: "RetractVote" }
  | { kind: "ReclaimVote" };

/** tally.ak ▸ TallyRedeemer. 0=SumBatch{insert_proofs} 1=Finalize. */
export type TallyRedeemer =
  | { kind: "SumBatch"; insert_proofs: MpfProof[] }
  | { kind: "Finalize" };

/**
 * nullifier.ak ▸ NullifierRedeemer.
 * 0=MintNullifier{did_commit, proposal_id}
 * 1=BurnNullifier{proposal_id, did_commits}
 *
 * `did_commits` KHÔNG phải dữ liệu được tin: policy tự dựng lại tập tên token từ nó
 * (`H(did ‖ proposal_id)`) rồi so bằng đẳng thức với `tx.mint`. Khai thiếu, khai thừa,
 * khai trùng, hay khai sai proposal đều bị bác on-chain (chốt B1).
 */
export type NullifierRedeemer =
  | { kind: "MintNullifier"; did_commit: string; proposal_id: string }
  | { kind: "BurnNullifier"; proposal_id: string; did_commits: string[] };

/** tally_nft.ak ▸ TallyNftRedeemer. Constr 0 = MintTally{seed}. */
export type TallyNftRedeemer = { kind: "MintTally"; seed: OutputRef };

/** weight_param_nft.ak ▸ WeightParamNftRedeemer. Constr 0 = MintWeightParam. */
export type WeightParamNftRedeemer = { kind: "MintWeightParam" };
