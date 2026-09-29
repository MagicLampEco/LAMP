// Governance v2 — codec Plutus Data ↔ TS cho mọi datum/redeemer (Lucid Evolution).
//
// PHẢI khớp byte-perfect kiểu Aiken (xem đầu `types.ts` cho danh sách nguồn). Bảng Constr:
//
//   OutputReference      = Constr 0 [transaction_id, output_index]
//   ProposalStatus       0=Open 1=Tallied 2=Executed 3=Rejected
//   ProposalResult       = Constr 0 [proposal_id, status, spend_spec_hash, execute_after_epoch,
//                                    released_cumulative]
//   ProposalDatum        = Constr 0 [12 trường, thứ tự types.ak]
//   Knot                 = Constr 0 [c, pow]
//   WeightParam          = Constr 0 [k1, k2, k3, k4, bft_floor, quorum_vp_threshold,
//                                    quorum_voter_threshold, theta_num, theta_den]
//   VoteChoice           0=Yes 1=No 2=Abstain
//   VoteDatum            = Constr 0 [proposal_id, did_commit, nullifier, choice, c1..c4]
//   TopEntry             = Constr 0 [vp_raw, choice]
//   TallyPhase           0=Summing 1=Clamped
//   TallyDatum           = Constr 0 [15 trường, thứ tự types.ak]
//   GovernanceRedeemer   0=OpenProposal{seed, vote_open_epoch, vote_close_epoch, weight_param_ref}
//   GovernanceSpendRed.  0=FinalizeProposal
//   VoteRedeemer         0=ConsumeForTally{book_proof} 1=RetractVote 2=ReclaimVote
//   TallyRedeemer        0=SumBatch{insert_proofs} 1=Finalize
//   NullifierRedeemer    0=MintNullifier{did_commit, proposal_id} 1=BurnNullifier{proposal_id, did_commits}
//   TallyNftRedeemer     0=MintTally{seed}
//   WeightParamNftRed.   0=MintWeightParam
//
// ĐỘ DÀI BYTE ép ở CẢ HAI chiều (mã hoá và giải mã), đều fail-closed:
//   · proposal_id, did_commit, nullifier = 32 byte. On-chain không ép độ dài trong datum, nhưng
//     `names.ak` ▸ nullifier_name ghép `did_commit ‖ proposal_id` KHÔNG dấu phân cách và chỉ
//     không nhập nhằng khi cả hai cố định 32 byte (ca `nl_name_ghep_khong_nhap_nhang_...`).
//     SDK từ chối dựng hay đọc phiếu vi phạm điều kiện đó.
//   · voted_root = 32 byte (`mpf.from_root` on-chain đòi 32 byte).
//   · transaction_id = 32 byte.
//
// Giải mã hình dạng lạ ⇒ ném `GOV-DATUM-...`, không trả giá trị đệm.

import { Constr, Data } from "@lucid-evolution/lucid";

import {
  PROPOSAL_STATUSES, TALLY_PHASES, VOTE_CHOICES,
  type GovernanceMintRedeemer, type GovernanceSpendRedeemer, type Knot, type MpfProof,
  type MpfProofStep, type NullifierRedeemer, type OutputRef, type ProposalDatum,
  type ProposalResult, type ProposalStatus, type TallyDatum, type TallyNftRedeemer,
  type TallyPhase, type TallyRedeemer, type TopEntry, type VoteChoice, type VoteDatum,
  type VoteRedeemer, type WeightParam, type WeightParamNftRedeemer,
} from "./types.js";

// ── hằng độ dài ──
export const HASH32_BYTES = 32;
const MPF_BRANCH_NEIGHBORS_BYTES = 128;

// ── trợ giúp đọc/ghi Data ──

function asConstr(d: Data, ctx: string): Constr<Data> {
  if (d instanceof Constr) return d;
  throw new Error(`GOV-DATUM-000: ${ctx} phải là Constr, nhận ${describe(d)}`);
}

function asInt(d: Data, ctx: string): bigint {
  if (typeof d !== "bigint") throw new Error(`GOV-DATUM-001: ${ctx} phải là Int, nhận ${describe(d)}`);
  return d;
}

function asBytes(d: Data, ctx: string): string {
  if (typeof d !== "string") throw new Error(`GOV-DATUM-002: ${ctx} phải là ByteArray, nhận ${describe(d)}`);
  return d;
}

function asList(d: Data, ctx: string): Data[] {
  if (!Array.isArray(d)) throw new Error(`GOV-DATUM-003: ${ctx} phải là List, nhận ${describe(d)}`);
  return d;
}

function describe(d: unknown): string {
  if (d instanceof Constr) return `Constr ${d.index}`;
  if (Array.isArray(d)) return "List";
  if (d instanceof Map) return "Map";
  return typeof d;
}

function fieldsOf(d: Data, ctx: string, index: number, n: number): Data[] {
  const c = asConstr(d, ctx);
  if (c.index !== index) throw new Error(`GOV-DATUM-004: ${ctx} phải là Constr ${index}, nhận Constr ${c.index}`);
  if (c.fields.length !== n) throw new Error(`GOV-DATUM-005: ${ctx} phải có ${n} trường, nhận ${c.fields.length}`);
  return c.fields;
}

function field(fs: Data[], i: number): Data {
  const v = fs[i];
  if (v === undefined) throw new Error(`GOV-DATUM-006: thiếu trường thứ ${i}`);
  return v;
}

/** Hex thường độ dài chẵn; `n` khác null ⇒ đúng `n` byte. */
export function assertHex(hex: unknown, n: number | null, ctx: string): string {
  if (typeof hex !== "string" || !/^([0-9a-f]{2})*$/.test(hex)) {
    throw new Error(`GOV-DATUM-010: ${ctx} phải là hex thường độ dài chẵn, nhận '${String(hex)}'`);
  }
  if (n !== null && hex.length !== 2 * n) {
    throw new Error(`GOV-DATUM-011: ${ctx} phải đúng ${n} byte, nhận ${hex.length / 2}`);
  }
  return hex;
}

function assertInt(v: unknown, ctx: string): bigint {
  if (typeof v !== "bigint") throw new Error(`GOV-DATUM-012: ${ctx} phải là bigint, nhận ${typeof v}`);
  return v;
}

function assertNat(v: unknown, ctx: string): bigint {
  const x = assertInt(v, ctx);
  if (x < 0n) throw new Error(`GOV-DATUM-013: ${ctx} phải ≥ 0, nhận ${x}`);
  return x;
}

function enumIndex<T extends string>(all: readonly T[], v: T, ctx: string): number {
  const i = all.indexOf(v);
  if (i < 0) throw new Error(`GOV-DATUM-014: ${ctx} giá trị lạ '${String(v)}' (hợp lệ: ${all.join("|")})`);
  return i;
}

function enumOf<T extends string>(all: readonly T[], d: Data, ctx: string): T {
  const c = asConstr(d, ctx);
  const v = all[c.index];
  if (v === undefined) throw new Error(`GOV-DATUM-015: ${ctx} Constr ${c.index} ngoài miền 0..${all.length - 1}`);
  if (c.fields.length !== 0) throw new Error(`GOV-DATUM-016: ${ctx} là enum không trường, nhận ${c.fields.length} trường`);
  return v;
}

// ── OutputReference ──

export function encodeOutputRef(r: OutputRef): Constr<Data> {
  return new Constr(0, [
    assertHex(r.transaction_id, HASH32_BYTES, "OutputReference.transaction_id"),
    assertNat(r.output_index, "OutputReference.output_index"),
  ]);
}

export function decodeOutputRef(d: Data): OutputRef {
  const f = fieldsOf(d, "OutputReference", 0, 2);
  return {
    transaction_id: assertHex(asBytes(field(f, 0), "transaction_id"), HASH32_BYTES, "OutputReference.transaction_id"),
    output_index: assertNat(asInt(field(f, 1), "output_index"), "OutputReference.output_index"),
  };
}

// ── enum ──

export const encodeProposalStatus = (s: ProposalStatus): Constr<Data> =>
  new Constr(enumIndex(PROPOSAL_STATUSES, s, "ProposalStatus"), []);
export const decodeProposalStatus = (d: Data): ProposalStatus => enumOf(PROPOSAL_STATUSES, d, "ProposalStatus");
export const encodeVoteChoice = (c: VoteChoice): Constr<Data> =>
  new Constr(enumIndex(VOTE_CHOICES, c, "VoteChoice"), []);
export const decodeVoteChoice = (d: Data): VoteChoice => enumOf(VOTE_CHOICES, d, "VoteChoice");
export const encodeTallyPhase = (p: TallyPhase): Constr<Data> =>
  new Constr(enumIndex(TALLY_PHASES, p, "TallyPhase"), []);
export const decodeTallyPhase = (d: Data): TallyPhase => enumOf(TALLY_PHASES, d, "TallyPhase");

// ── ProposalResult ──

export function encodeProposalResult(p: ProposalResult): Constr<Data> {
  return new Constr(0, [
    assertHex(p.proposal_id, HASH32_BYTES, "ProposalResult.proposal_id"),
    encodeProposalStatus(p.status),
    assertHex(p.spend_spec_hash, null, "ProposalResult.spend_spec_hash"),
    assertInt(p.execute_after_epoch, "ProposalResult.execute_after_epoch"),
    assertInt(p.released_cumulative, "ProposalResult.released_cumulative"),
  ]);
}

export function decodeProposalResult(d: Data): ProposalResult {
  const f = fieldsOf(d, "ProposalResult", 0, 5);
  return {
    proposal_id: assertHex(asBytes(field(f, 0), "proposal_id"), HASH32_BYTES, "ProposalResult.proposal_id"),
    status: decodeProposalStatus(field(f, 1)),
    spend_spec_hash: assertHex(asBytes(field(f, 2), "spend_spec_hash"), null, "ProposalResult.spend_spec_hash"),
    execute_after_epoch: asInt(field(f, 3), "execute_after_epoch"),
    released_cumulative: asInt(field(f, 4), "released_cumulative"),
  };
}

// ── ProposalDatum (12 trường — KHÔNG dùng cho proposal v2, xem types.ts) ──

export function encodeProposalDatum(p: ProposalDatum): Constr<Data> {
  return new Constr(0, [
    assertHex(p.proposal_id, null, "ProposalDatum.proposal_id"),
    encodeProposalStatus(p.status),
    assertInt(p.vote_open_epoch, "ProposalDatum.vote_open_epoch"),
    assertInt(p.vote_close_epoch, "ProposalDatum.vote_close_epoch"),
    assertInt(p.snapshot_epoch, "ProposalDatum.snapshot_epoch"),
    encodeOutputRef(p.weight_param_ref),
    assertHex(p.spend_spec_hash, null, "ProposalDatum.spend_spec_hash"),
    assertInt(p.released_cumulative, "ProposalDatum.released_cumulative"),
    assertInt(p.execute_after_epoch, "ProposalDatum.execute_after_epoch"),
    assertInt(p.yes_power, "ProposalDatum.yes_power"),
    assertInt(p.no_power, "ProposalDatum.no_power"),
    assertInt(p.voter_count, "ProposalDatum.voter_count"),
  ]);
}

export function decodeProposalDatum(d: Data): ProposalDatum {
  const f = fieldsOf(d, "ProposalDatum", 0, 12);
  return {
    proposal_id: assertHex(asBytes(field(f, 0), "proposal_id"), null, "ProposalDatum.proposal_id"),
    status: decodeProposalStatus(field(f, 1)),
    vote_open_epoch: asInt(field(f, 2), "vote_open_epoch"),
    vote_close_epoch: asInt(field(f, 3), "vote_close_epoch"),
    snapshot_epoch: asInt(field(f, 4), "snapshot_epoch"),
    weight_param_ref: decodeOutputRef(field(f, 5)),
    spend_spec_hash: assertHex(asBytes(field(f, 6), "spend_spec_hash"), null, "ProposalDatum.spend_spec_hash"),
    released_cumulative: asInt(field(f, 7), "released_cumulative"),
    execute_after_epoch: asInt(field(f, 8), "execute_after_epoch"),
    yes_power: asInt(field(f, 9), "yes_power"),
    no_power: asInt(field(f, 10), "no_power"),
    voter_count: asInt(field(f, 11), "voter_count"),
  };
}

// ── Knot + WeightParam ──

export function encodeKnot(k: Knot): Constr<Data> {
  return new Constr(0, [assertInt(k.c, "Knot.c"), assertInt(k.pow, "Knot.pow")]);
}

export function decodeKnot(d: Data): Knot {
  const f = fieldsOf(d, "Knot", 0, 2);
  return { c: asInt(field(f, 0), "Knot.c"), pow: asInt(field(f, 1), "Knot.pow") };
}

function encodeKnots(ks: Knot[], ctx: string): Data[] {
  if (!Array.isArray(ks)) throw new Error(`GOV-DATUM-020: ${ctx} phải là mảng Knot`);
  return ks.map(encodeKnot);
}

export function encodeWeightParam(w: WeightParam): Constr<Data> {
  return new Constr(0, [
    encodeKnots(w.k1, "WeightParam.k1"),
    encodeKnots(w.k2, "WeightParam.k2"),
    encodeKnots(w.k3, "WeightParam.k3"),
    encodeKnots(w.k4, "WeightParam.k4"),
    assertInt(w.bft_floor, "WeightParam.bft_floor"),
    assertInt(w.quorum_vp_threshold, "WeightParam.quorum_vp_threshold"),
    assertInt(w.quorum_voter_threshold, "WeightParam.quorum_voter_threshold"),
    assertInt(w.theta_num, "WeightParam.theta_num"),
    assertInt(w.theta_den, "WeightParam.theta_den"),
  ]);
}

export function decodeWeightParam(d: Data): WeightParam {
  const f = fieldsOf(d, "WeightParam", 0, 9);
  const knots = (i: number, ctx: string) => asList(field(f, i), ctx).map(decodeKnot);
  return {
    k1: knots(0, "WeightParam.k1"),
    k2: knots(1, "WeightParam.k2"),
    k3: knots(2, "WeightParam.k3"),
    k4: knots(3, "WeightParam.k4"),
    bft_floor: asInt(field(f, 4), "bft_floor"),
    quorum_vp_threshold: asInt(field(f, 5), "quorum_vp_threshold"),
    quorum_voter_threshold: asInt(field(f, 6), "quorum_voter_threshold"),
    theta_num: asInt(field(f, 7), "theta_num"),
    theta_den: asInt(field(f, 8), "theta_den"),
  };
}

// ── VoteDatum ──

export function encodeVoteDatum(v: VoteDatum): Constr<Data> {
  return new Constr(0, [
    assertHex(v.proposal_id, HASH32_BYTES, "VoteDatum.proposal_id"),
    assertHex(v.did_commit, HASH32_BYTES, "VoteDatum.did_commit"),
    assertHex(v.nullifier, HASH32_BYTES, "VoteDatum.nullifier"),
    encodeVoteChoice(v.choice),
    assertInt(v.c1_capped, "VoteDatum.c1_capped"),
    assertInt(v.c2_capped, "VoteDatum.c2_capped"),
    assertInt(v.c3_capped, "VoteDatum.c3_capped"),
    assertInt(v.c4_capped, "VoteDatum.c4_capped"),
  ]);
}

export function decodeVoteDatum(d: Data): VoteDatum {
  const f = fieldsOf(d, "VoteDatum", 0, 8);
  return {
    proposal_id: assertHex(asBytes(field(f, 0), "proposal_id"), HASH32_BYTES, "VoteDatum.proposal_id"),
    did_commit: assertHex(asBytes(field(f, 1), "did_commit"), HASH32_BYTES, "VoteDatum.did_commit"),
    nullifier: assertHex(asBytes(field(f, 2), "nullifier"), HASH32_BYTES, "VoteDatum.nullifier"),
    choice: decodeVoteChoice(field(f, 3)),
    c1_capped: asInt(field(f, 4), "c1_capped"),
    c2_capped: asInt(field(f, 5), "c2_capped"),
    c3_capped: asInt(field(f, 6), "c3_capped"),
    c4_capped: asInt(field(f, 7), "c4_capped"),
  };
}

// ── TopEntry + TallyDatum ──

export function encodeTopEntry(t: TopEntry): Constr<Data> {
  return new Constr(0, [assertInt(t.vp_raw, "TopEntry.vp_raw"), encodeVoteChoice(t.choice)]);
}

export function decodeTopEntry(d: Data): TopEntry {
  const f = fieldsOf(d, "TopEntry", 0, 2);
  return { vp_raw: asInt(field(f, 0), "TopEntry.vp_raw"), choice: decodeVoteChoice(field(f, 1)) };
}

export function encodeTallyDatum(t: TallyDatum): Constr<Data> {
  if (!Array.isArray(t.top_did_vp)) throw new Error("GOV-DATUM-030: TallyDatum.top_did_vp phải là mảng TopEntry");
  return new Constr(0, [
    assertHex(t.proposal_id, HASH32_BYTES, "TallyDatum.proposal_id"),
    encodeTallyPhase(t.phase),
    encodeOutputRef(t.weight_param_ref),
    assertInt(t.yes_power_raw, "TallyDatum.yes_power_raw"),
    assertInt(t.no_power_raw, "TallyDatum.no_power_raw"),
    assertInt(t.abstain_power_raw, "TallyDatum.abstain_power_raw"),
    assertInt(t.voters_acc, "TallyDatum.voters_acc"),
    assertInt(t.yes_voters_acc, "TallyDatum.yes_voters_acc"),
    t.top_did_vp.map(encodeTopEntry),
    assertInt(t.yes_power_eff, "TallyDatum.yes_power_eff"),
    assertInt(t.no_power_eff, "TallyDatum.no_power_eff"),
    assertInt(t.abstain_power_eff, "TallyDatum.abstain_power_eff"),
    assertInt(t.vote_open_epoch, "TallyDatum.vote_open_epoch"),
    assertInt(t.vote_close_epoch, "TallyDatum.vote_close_epoch"),
    assertHex(t.voted_root, HASH32_BYTES, "TallyDatum.voted_root"),
  ]);
}

export function decodeTallyDatum(d: Data): TallyDatum {
  const f = fieldsOf(d, "TallyDatum", 0, 15);
  return {
    proposal_id: assertHex(asBytes(field(f, 0), "proposal_id"), HASH32_BYTES, "TallyDatum.proposal_id"),
    phase: decodeTallyPhase(field(f, 1)),
    weight_param_ref: decodeOutputRef(field(f, 2)),
    yes_power_raw: asInt(field(f, 3), "yes_power_raw"),
    no_power_raw: asInt(field(f, 4), "no_power_raw"),
    abstain_power_raw: asInt(field(f, 5), "abstain_power_raw"),
    voters_acc: asInt(field(f, 6), "voters_acc"),
    yes_voters_acc: asInt(field(f, 7), "yes_voters_acc"),
    top_did_vp: asList(field(f, 8), "top_did_vp").map(decodeTopEntry),
    yes_power_eff: asInt(field(f, 9), "yes_power_eff"),
    no_power_eff: asInt(field(f, 10), "no_power_eff"),
    abstain_power_eff: asInt(field(f, 11), "abstain_power_eff"),
    vote_open_epoch: asInt(field(f, 12), "vote_open_epoch"),
    vote_close_epoch: asInt(field(f, 13), "vote_close_epoch"),
    voted_root: assertHex(asBytes(field(f, 14), "voted_root"), HASH32_BYTES, "TallyDatum.voted_root"),
  };
}

// ── MPF Proof ──

export function encodeMpfProofStep(step: MpfProofStep): Constr<Data> {
  switch (step.kind) {
    case "Branch":
      return new Constr(0, [
        assertNat(step.skip, "Branch.skip"),
        assertHex(step.neighbors, MPF_BRANCH_NEIGHBORS_BYTES, "Branch.neighbors"),
      ]);
    case "Fork":
      return new Constr(1, [
        assertNat(step.skip, "Fork.skip"),
        new Constr(0, [
          assertNat(step.neighbor.nibble, "Fork.neighbor.nibble"),
          assertHex(step.neighbor.prefix, null, "Fork.neighbor.prefix"),
          assertHex(step.neighbor.root, HASH32_BYTES, "Fork.neighbor.root"),
        ]),
      ]);
    case "Leaf":
      return new Constr(2, [
        assertNat(step.skip, "Leaf.skip"),
        assertHex(step.key, HASH32_BYTES, "Leaf.key"),
        assertHex(step.value, HASH32_BYTES, "Leaf.value"),
      ]);
    default: {
      const never: never = step;
      throw new Error(`GOV-DATUM-040: ProofStep loại lạ ${JSON.stringify(never)}`);
    }
  }
}

export function decodeMpfProofStep(d: Data): MpfProofStep {
  const c = asConstr(d, "ProofStep");
  if (c.index < 0 || c.index > 2) throw new Error(`GOV-DATUM-041: ProofStep phải là Constr 0..2, nhận ${c.index}`);
  const want = c.index === 2 ? 3 : 2;
  if (c.fields.length !== want) {
    throw new Error(`GOV-DATUM-042: ProofStep Constr ${c.index} phải có ${want} trường, nhận ${c.fields.length}`);
  }
  const skip = assertNat(asInt(field(c.fields, 0), "ProofStep.skip"), "ProofStep.skip");
  if (c.index === 0) {
    return {
      kind: "Branch", skip,
      neighbors: assertHex(asBytes(field(c.fields, 1), "Branch.neighbors"), MPF_BRANCH_NEIGHBORS_BYTES, "Branch.neighbors"),
    };
  }
  if (c.index === 1) {
    const n = fieldsOf(field(c.fields, 1), "Neighbor", 0, 3);
    return {
      kind: "Fork", skip,
      neighbor: {
        nibble: assertNat(asInt(field(n, 0), "Neighbor.nibble"), "Neighbor.nibble"),
        prefix: assertHex(asBytes(field(n, 1), "Neighbor.prefix"), null, "Neighbor.prefix"),
        root: assertHex(asBytes(field(n, 2), "Neighbor.root"), HASH32_BYTES, "Neighbor.root"),
      },
    };
  }
  return {
    kind: "Leaf", skip,
    key: assertHex(asBytes(field(c.fields, 1), "Leaf.key"), HASH32_BYTES, "Leaf.key"),
    value: assertHex(asBytes(field(c.fields, 2), "Leaf.value"), HASH32_BYTES, "Leaf.value"),
  };
}

/** Proof = List<ProofStep>. Danh sách rỗng hợp lệ (chèn vào sổ rỗng). */
export function encodeMpfProof(proof: MpfProof): Data[] {
  if (!Array.isArray(proof)) throw new Error("GOV-DATUM-043: MPF proof phải là mảng ProofStep");
  return proof.map(encodeMpfProofStep);
}

export function decodeMpfProof(d: Data): MpfProof {
  return asList(d, "Proof").map(decodeMpfProofStep);
}

// ── Redeemer ──

export function encodeGovernanceMintRedeemer(r: GovernanceMintRedeemer): Constr<Data> {
  if (r.kind !== "OpenProposal") throw new Error(`GOV-DATUM-050: GovernanceRedeemer loại lạ '${String((r as { kind: unknown }).kind)}'`);
  return new Constr(0, [
    encodeOutputRef(r.seed),
    assertInt(r.vote_open_epoch, "OpenProposal.vote_open_epoch"),
    assertInt(r.vote_close_epoch, "OpenProposal.vote_close_epoch"),
    encodeOutputRef(r.weight_param_ref),
  ]);
}

export function decodeGovernanceMintRedeemer(d: Data): GovernanceMintRedeemer {
  const f = fieldsOf(d, "GovernanceRedeemer.OpenProposal", 0, 4);
  return {
    kind: "OpenProposal",
    seed: decodeOutputRef(field(f, 0)),
    vote_open_epoch: asInt(field(f, 1), "vote_open_epoch"),
    vote_close_epoch: asInt(field(f, 2), "vote_close_epoch"),
    weight_param_ref: decodeOutputRef(field(f, 3)),
  };
}

export function encodeGovernanceSpendRedeemer(r: GovernanceSpendRedeemer): Constr<Data> {
  if (r.kind !== "FinalizeProposal") throw new Error(`GOV-DATUM-051: GovernanceSpendRedeemer loại lạ '${String((r as { kind: unknown }).kind)}'`);
  return new Constr(0, []);
}

export function decodeGovernanceSpendRedeemer(d: Data): GovernanceSpendRedeemer {
  fieldsOf(d, "GovernanceSpendRedeemer.FinalizeProposal", 0, 0);
  return { kind: "FinalizeProposal" };
}

export function encodeVoteRedeemer(r: VoteRedeemer): Constr<Data> {
  switch (r.kind) {
    case "ConsumeForTally": return new Constr(0, [encodeMpfProof(r.book_proof)]);
    case "RetractVote": return new Constr(1, []);
    case "ReclaimVote": return new Constr(2, []);
    default: {
      const never: never = r;
      throw new Error(`GOV-DATUM-052: VoteRedeemer loại lạ ${JSON.stringify(never)}`);
    }
  }
}

export function decodeVoteRedeemer(d: Data): VoteRedeemer {
  const c = asConstr(d, "VoteRedeemer");
  switch (c.index) {
    case 0: return { kind: "ConsumeForTally", book_proof: decodeMpfProof(field(fieldsOf(d, "ConsumeForTally", 0, 1), 0)) };
    case 1: fieldsOf(d, "RetractVote", 1, 0); return { kind: "RetractVote" };
    case 2: fieldsOf(d, "ReclaimVote", 2, 0); return { kind: "ReclaimVote" };
    default: throw new Error(`GOV-DATUM-053: VoteRedeemer Constr ${c.index} ngoài miền 0..2`);
  }
}

export function encodeTallyRedeemer(r: TallyRedeemer): Constr<Data> {
  switch (r.kind) {
    case "SumBatch": {
      if (!Array.isArray(r.insert_proofs)) throw new Error("GOV-DATUM-054: SumBatch.insert_proofs phải là mảng Proof");
      return new Constr(0, [r.insert_proofs.map(encodeMpfProof)]);
    }
    case "Finalize": return new Constr(1, []);
    default: {
      const never: never = r;
      throw new Error(`GOV-DATUM-055: TallyRedeemer loại lạ ${JSON.stringify(never)}`);
    }
  }
}

export function decodeTallyRedeemer(d: Data): TallyRedeemer {
  const c = asConstr(d, "TallyRedeemer");
  switch (c.index) {
    case 0: {
      const proofs = asList(field(fieldsOf(d, "SumBatch", 0, 1), 0), "SumBatch.insert_proofs");
      return { kind: "SumBatch", insert_proofs: proofs.map(decodeMpfProof) };
    }
    case 1: fieldsOf(d, "Finalize", 1, 0); return { kind: "Finalize" };
    default: throw new Error(`GOV-DATUM-056: TallyRedeemer Constr ${c.index} ngoài miền 0..1`);
  }
}

export function encodeNullifierRedeemer(r: NullifierRedeemer): Constr<Data> {
  switch (r.kind) {
    case "MintNullifier":
      return new Constr(0, [
        assertHex(r.did_commit, HASH32_BYTES, "MintNullifier.did_commit"),
        assertHex(r.proposal_id, HASH32_BYTES, "MintNullifier.proposal_id"),
      ]);
    case "BurnNullifier":
      if (r.did_commits.length === 0)
        throw new Error("GOV-DATUM-060: BurnNullifier.did_commits rỗng — policy dựng tập tên rỗng và đẳng thức B1 sẽ bác");
      return new Constr(1, [
        assertHex(r.proposal_id, HASH32_BYTES, "BurnNullifier.proposal_id"),
        r.did_commits.map((d, i) => assertHex(d, HASH32_BYTES, `BurnNullifier.did_commits[${i}]`)),
      ]);
    default: {
      const never: never = r;
      throw new Error(`GOV-DATUM-057: NullifierRedeemer loại lạ ${JSON.stringify(never)}`);
    }
  }
}

export function decodeNullifierRedeemer(d: Data): NullifierRedeemer {
  const c = asConstr(d, "NullifierRedeemer");
  switch (c.index) {
    case 0: {
      const f = fieldsOf(d, "MintNullifier", 0, 2);
      return {
        kind: "MintNullifier",
        did_commit: assertHex(asBytes(field(f, 0), "did_commit"), HASH32_BYTES, "MintNullifier.did_commit"),
        proposal_id: assertHex(asBytes(field(f, 1), "proposal_id"), HASH32_BYTES, "MintNullifier.proposal_id"),
      };
    }
    case 1: {
      const f = fieldsOf(d, "BurnNullifier", 1, 2);
      const dids = asList(field(f, 1), "BurnNullifier.did_commits");
      return {
        kind: "BurnNullifier",
        proposal_id: assertHex(asBytes(field(f, 0), "proposal_id"), HASH32_BYTES, "BurnNullifier.proposal_id"),
        did_commits: dids.map((x, i) =>
          assertHex(asBytes(x, `did_commits[${i}]`), HASH32_BYTES, `BurnNullifier.did_commits[${i}]`)),
      };
    }
    default: throw new Error(`GOV-DATUM-058: NullifierRedeemer Constr ${c.index} ngoài miền 0..1`);
  }
}

export function encodeTallyNftRedeemer(r: TallyNftRedeemer): Constr<Data> {
  if (r.kind !== "MintTally") throw new Error(`GOV-DATUM-059: TallyNftRedeemer loại lạ '${String((r as { kind: unknown }).kind)}'`);
  return new Constr(0, [encodeOutputRef(r.seed)]);
}

export function decodeTallyNftRedeemer(d: Data): TallyNftRedeemer {
  return { kind: "MintTally", seed: decodeOutputRef(field(fieldsOf(d, "TallyNftRedeemer.MintTally", 0, 1), 0)) };
}

export function encodeWeightParamNftRedeemer(r: WeightParamNftRedeemer): Constr<Data> {
  if (r.kind !== "MintWeightParam") throw new Error(`GOV-DATUM-060: WeightParamNftRedeemer loại lạ '${String((r as { kind: unknown }).kind)}'`);
  return new Constr(0, []);
}

export function decodeWeightParamNftRedeemer(d: Data): WeightParamNftRedeemer {
  fieldsOf(d, "WeightParamNftRedeemer.MintWeightParam", 0, 0);
  return { kind: "MintWeightParam" };
}

// ── CBOR hex (lớp mỏng quanh Data.to/Data.from) ──

export const toCbor = (d: Data): string => Data.to(d);
export const fromCbor = (hex: string): Data => {
  assertHex(hex, null, "CBOR");
  return Data.from(hex);
};

export const proposalResultToCbor = (p: ProposalResult) => toCbor(encodeProposalResult(p));
export const proposalResultFromCbor = (h: string) => decodeProposalResult(fromCbor(h));
export const proposalDatumToCbor = (p: ProposalDatum) => toCbor(encodeProposalDatum(p));
export const proposalDatumFromCbor = (h: string) => decodeProposalDatum(fromCbor(h));
export const weightParamToCbor = (w: WeightParam) => toCbor(encodeWeightParam(w));
export const weightParamFromCbor = (h: string) => decodeWeightParam(fromCbor(h));
export const voteDatumToCbor = (v: VoteDatum) => toCbor(encodeVoteDatum(v));
export const voteDatumFromCbor = (h: string) => decodeVoteDatum(fromCbor(h));
export const tallyDatumToCbor = (t: TallyDatum) => toCbor(encodeTallyDatum(t));
export const tallyDatumFromCbor = (h: string) => decodeTallyDatum(fromCbor(h));
export const governanceMintRedeemerToCbor = (r: GovernanceMintRedeemer) => toCbor(encodeGovernanceMintRedeemer(r));
export const governanceMintRedeemerFromCbor = (h: string) => decodeGovernanceMintRedeemer(fromCbor(h));
export const governanceSpendRedeemerToCbor = (r: GovernanceSpendRedeemer) => toCbor(encodeGovernanceSpendRedeemer(r));
export const governanceSpendRedeemerFromCbor = (h: string) => decodeGovernanceSpendRedeemer(fromCbor(h));
export const voteRedeemerToCbor = (r: VoteRedeemer) => toCbor(encodeVoteRedeemer(r));
export const voteRedeemerFromCbor = (h: string) => decodeVoteRedeemer(fromCbor(h));
export const tallyRedeemerToCbor = (r: TallyRedeemer) => toCbor(encodeTallyRedeemer(r));
export const tallyRedeemerFromCbor = (h: string) => decodeTallyRedeemer(fromCbor(h));
export const nullifierRedeemerToCbor = (r: NullifierRedeemer) => toCbor(encodeNullifierRedeemer(r));
export const nullifierRedeemerFromCbor = (h: string) => decodeNullifierRedeemer(fromCbor(h));
export const tallyNftRedeemerToCbor = (r: TallyNftRedeemer) => toCbor(encodeTallyNftRedeemer(r));
export const tallyNftRedeemerFromCbor = (h: string) => decodeTallyNftRedeemer(fromCbor(h));
export const weightParamNftRedeemerToCbor = (r: WeightParamNftRedeemer) => toCbor(encodeWeightParamNftRedeemer(r));
export const weightParamNftRedeemerFromCbor = (h: string) => decodeWeightParamNftRedeemer(fromCbor(h));
export const outputRefToCbor = (r: OutputRef) => toCbor(encodeOutputRef(r));
