// Codec datum/redeemer v2: (1) CBOR khớp byte với Aiken `cbor.serialise` (giá trị neo ở
// `aikenVectors.ts`), (2) round-trip, (3) chỉ số Constr khớp blueprint `onchain/plutus.json`,
// (4) hình dạng lạ ⇒ ném `GOV-DATUM-...`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Constr, Data } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import {
  decodeTallyDatum, decodeVoteDatum, governanceMintRedeemerFromCbor, governanceMintRedeemerToCbor,
  governanceSpendRedeemerFromCbor, governanceSpendRedeemerToCbor, nullifierRedeemerFromCbor,
  nullifierRedeemerToCbor, outputRefToCbor, proposalDatumFromCbor, proposalDatumToCbor,
  proposalResultFromCbor, proposalResultToCbor, tallyDatumFromCbor, tallyDatumToCbor,
  tallyNftRedeemerFromCbor, tallyNftRedeemerToCbor, tallyRedeemerFromCbor, tallyRedeemerToCbor,
  voteDatumFromCbor, voteDatumToCbor, voteRedeemerFromCbor, voteRedeemerToCbor,
  weightParamFromCbor, weightParamNftRedeemerFromCbor, weightParamNftRedeemerToCbor,
  weightParamToCbor,
} from "../offchain/src/datum.js";
import { nullifierName, nullifierNameRaw as nullifierNameUnchecked } from "../offchain/src/names.js";
import { SCALE } from "../offchain/src/tallyMath.js";
import type {
  OutputRef, ProposalDatum, ProposalResult, TallyDatum, VoteDatum, WeightParam,
} from "../offchain/src/types.js";
import { VotedLedger } from "../offchain/src/votedLedger.js";
import { AIKEN, DID, MPF_FIXTURE_ROOTS, PID, TXID } from "./aikenVectors.js";

// `tests/` nằm ngoài package (không có "type": "module") nên tsc coi là CommonJS ⇒ dùng
// `__dirname` (vite-node cấp sẵn) thay cho `import.meta.url`.
const here = __dirname;

const wref: OutputRef = { transaction_id: TXID, output_index: 3n };
const seed0: OutputRef = { transaction_id: TXID, output_index: 0n };

const TD: TallyDatum = {
  proposal_id: PID, phase: "Clamped", weight_param_ref: wref,
  yes_power_raw: 1_000_000_000_000n, no_power_raw: 7n, abstain_power_raw: 0n,
  voters_acc: 5n, yes_voters_acc: 3n,
  top_did_vp: [
    { vp_raw: 123456789012345678901234567890n, choice: "Yes" },
    { vp_raw: 5n, choice: "No" },
  ],
  yes_power_eff: 900n, no_power_eff: 7n, abstain_power_eff: 0n,
  vote_open_epoch: 10n, vote_close_epoch: 20n, voted_root: MPF_FIXTURE_ROOTS.b[2],
};
const VD: VoteDatum = {
  proposal_id: PID, did_commit: DID, nullifier: nullifierName(DID, PID), choice: "Abstain",
  c1_capped: 0n, c2_capped: 0n, c3_capped: 42n, c4_capped: 0n,
};
const PR: ProposalResult = {
  proposal_id: PID, status: "Executed", spend_spec_hash: "", execute_after_epoch: 25n, released_cumulative: 0n,
};
const PD: ProposalDatum = {
  proposal_id: PID, status: "Tallied", vote_open_epoch: 10n, vote_close_epoch: 20n, snapshot_epoch: 10n,
  weight_param_ref: wref, spend_spec_hash: "0102", released_cumulative: 3n, execute_after_epoch: 22n,
  yes_power: 100n, no_power: 50n, voter_count: 9n,
};
const K1 = [{ c: 0n, pow: 0n }, { c: 100n, pow: 100n * SCALE }];
const K2 = [{ c: 0n, pow: 0n }, { c: 25n, pow: 5n * SCALE }, { c: 100n, pow: 10n * SCALE }];
const WP: WeightParam = {
  k1: K1, k2: K2, k3: K1, k4: K2, bft_floor: 21n, quorum_vp_threshold: 1n,
  quorum_voter_threshold: 21n, theta_num: 2n, theta_den: 3n,
};

async function fixtureProofsB() {
  // mpf_fixtures bộ `b`: proposal #"22", did #"11", #"12", giá trị = H(did ‖ #"22").
  const vals = ["11", "12"].map((d) => ({ didCommit: d, nullifier: nullifierNameUnchecked(d, "22") }));
  const plan = await (await VotedLedger.empty()).planBatchInsert(vals);
  return plan;
}

describe("CBOR khớp Aiken cbor.serialise (giá trị neo sinh từ ca Aiken tạm)", () => {
  it("TallyDatum 15 trường (có bignum > 2^64, heap 2 entry, Clamped)", () => {
    expect(tallyDatumToCbor(TD)).toBe(AIKEN.TALLY_DATUM);
  });
  it("VoteDatum (nullifier = H(did‖pid) tính phía TS khớp Aiken)", () => {
    expect(VD.nullifier).toBe(AIKEN.NULLIFIER_DID_PID);
    expect(voteDatumToCbor(VD)).toBe(AIKEN.VOTE_DATUM);
  });
  it("ProposalResult 5 trường", () => expect(proposalResultToCbor(PR)).toBe(AIKEN.PROPOSAL_RESULT));
  it("ProposalDatum 12 trường", () => expect(proposalDatumToCbor(PD)).toBe(AIKEN.PROPOSAL_DATUM));
  it("WeightParam", () => expect(weightParamToCbor(WP)).toBe(AIKEN.WEIGHT_PARAM));
  it("GovernanceRedeemer.OpenProposal", () => {
    expect(governanceMintRedeemerToCbor({
      kind: "OpenProposal", seed: seed0, vote_open_epoch: 10n, vote_close_epoch: 20n, weight_param_ref: wref,
    })).toBe(AIKEN.R_OPEN);
  });
  it("GovernanceSpendRedeemer.FinalizeProposal", () => {
    expect(governanceSpendRedeemerToCbor({ kind: "FinalizeProposal" })).toBe(AIKEN.R_FINALIZE_PROPOSAL);
  });
  it("VoteRedeemer ×3 — ConsumeForTally mang bằng chứng do VotedLedger sinh (= mem_b1_2)", async () => {
    const plan = await fixtureProofsB();
    expect(voteRedeemerToCbor({ kind: "ConsumeForTally", book_proof: plan.membershipProofs[0]! })).toBe(AIKEN.R_CONSUME);
    expect(voteRedeemerToCbor({ kind: "RetractVote" })).toBe(AIKEN.R_RETRACT);
    expect(voteRedeemerToCbor({ kind: "ReclaimVote" })).toBe(AIKEN.R_RECLAIM);
  });
  it("TallyRedeemer ×2 — SumBatch mang bằng chứng chèn do VotedLedger sinh (= [ins_b1, ins_b2])", async () => {
    const plan = await fixtureProofsB();
    expect(plan.rootAfter).toBe(MPF_FIXTURE_ROOTS.b[2]);
    expect(tallyRedeemerToCbor({ kind: "SumBatch", insert_proofs: plan.insertProofs })).toBe(AIKEN.R_SUMBATCH);
    expect(tallyRedeemerToCbor({ kind: "Finalize" })).toBe(AIKEN.R_TALLY_FINALIZE);
  });
  it("NullifierRedeemer ×2, TallyNftRedeemer, WeightParamNftRedeemer, OutputReference", () => {
    expect(nullifierRedeemerToCbor({ kind: "MintNullifier", did_commit: DID, proposal_id: PID })).toBe(AIKEN.R_MINT_NULLIFIER);
    expect(nullifierRedeemerToCbor({ kind: "BurnNullifier" })).toBe(AIKEN.R_BURN_NULLIFIER);
    expect(tallyNftRedeemerToCbor({ kind: "MintTally", seed: seed0 })).toBe(AIKEN.R_MINT_TALLY);
    expect(weightParamNftRedeemerToCbor({ kind: "MintWeightParam" })).toBe(AIKEN.R_MINT_WEIGHT_PARAM);
    expect(outputRefToCbor({ transaction_id: TXID, output_index: 7n })).toBe(AIKEN.SEED7_CBOR);
  });
});

describe("round-trip: giải mã CBOR Aiken ra đúng giá trị, mã hoá lại ra đúng byte", () => {
  it("datum", () => {
    expect(tallyDatumFromCbor(AIKEN.TALLY_DATUM)).toEqual(TD);
    expect(voteDatumFromCbor(AIKEN.VOTE_DATUM)).toEqual(VD);
    expect(proposalResultFromCbor(AIKEN.PROPOSAL_RESULT)).toEqual(PR);
    expect(proposalDatumFromCbor(AIKEN.PROPOSAL_DATUM)).toEqual(PD);
    expect(weightParamFromCbor(AIKEN.WEIGHT_PARAM)).toEqual(WP);
  });
  it("redeemer", () => {
    for (const [hex, from, to] of [
      [AIKEN.R_OPEN, governanceMintRedeemerFromCbor, governanceMintRedeemerToCbor],
      [AIKEN.R_FINALIZE_PROPOSAL, governanceSpendRedeemerFromCbor, governanceSpendRedeemerToCbor],
      [AIKEN.R_CONSUME, voteRedeemerFromCbor, voteRedeemerToCbor],
      [AIKEN.R_RETRACT, voteRedeemerFromCbor, voteRedeemerToCbor],
      [AIKEN.R_RECLAIM, voteRedeemerFromCbor, voteRedeemerToCbor],
      [AIKEN.R_SUMBATCH, tallyRedeemerFromCbor, tallyRedeemerToCbor],
      [AIKEN.R_TALLY_FINALIZE, tallyRedeemerFromCbor, tallyRedeemerToCbor],
      [AIKEN.R_MINT_NULLIFIER, nullifierRedeemerFromCbor, nullifierRedeemerToCbor],
      [AIKEN.R_BURN_NULLIFIER, nullifierRedeemerFromCbor, nullifierRedeemerToCbor],
      [AIKEN.R_MINT_TALLY, tallyNftRedeemerFromCbor, tallyNftRedeemerToCbor],
      [AIKEN.R_MINT_WEIGHT_PARAM, weightParamNftRedeemerFromCbor, weightParamNftRedeemerToCbor],
    ] as [string, (h: string) => any, (r: any) => string][]) {
      expect(to(from(hex))).toBe(hex);
    }
  });
});

describe("chỉ số Constr khớp blueprint onchain/plutus.json", () => {
  const bp = JSON.parse(readFileSync(resolve(here, "../onchain/plutus.json"), "utf8"));
  const defs = bp.definitions as Record<string, { anyOf?: { title: string; index: number; fields: { title: string }[] }[] }>;
  const ctors = (k: string) => {
    const d = defs[k];
    if (!d?.anyOf) throw new Error(`blueprint thiếu định nghĩa ${k}`);
    return d.anyOf.map((c) => `${c.index}:${c.title}(${c.fields.map((f) => f.title).join(",")})`);
  };
  it("enum + redeemer", () => {
    expect(ctors("magiclamp/governance/types/ProposalStatus")).toEqual(["0:Open()", "1:Tallied()", "2:Executed()", "3:Rejected()"]);
    expect(ctors("magiclamp/governance/types/VoteChoice")).toEqual(["0:Yes()", "1:No()", "2:Abstain()"]);
    expect(ctors("magiclamp/governance/types/TallyPhase")).toEqual(["0:Summing()", "1:Clamped()"]);
    expect(ctors("governance/GovernanceRedeemer")).toEqual(["0:OpenProposal(seed,vote_open_epoch,vote_close_epoch,weight_param_ref)"]);
    expect(ctors("governance/GovernanceSpendRedeemer")).toEqual(["0:FinalizeProposal()"]);
    expect(ctors("vote/VoteRedeemer")).toEqual(["0:ConsumeForTally(book_proof)", "1:RetractVote()", "2:ReclaimVote()"]);
    expect(ctors("tally/TallyRedeemer")).toEqual(["0:SumBatch(insert_proofs)", "1:Finalize()"]);
    expect(ctors("nullifier/NullifierRedeemer")).toEqual(["0:MintNullifier(did_commit,proposal_id)", "1:BurnNullifier()"]);
    expect(ctors("tally_nft/TallyNftRedeemer")).toEqual(["0:MintTally(seed)"]);
    expect(ctors("weight_param_nft/WeightParamNftRedeemer")).toEqual(["0:MintWeightParam()"]);
  });
  it("thứ tự trường datum", () => {
    expect(ctors("magiclamp/governance/types/TallyDatum")).toEqual([
      "0:TallyDatum(proposal_id,phase,weight_param_ref,yes_power_raw,no_power_raw,abstain_power_raw,voters_acc," +
      "yes_voters_acc,top_did_vp,yes_power_eff,no_power_eff,abstain_power_eff,vote_open_epoch,vote_close_epoch,voted_root)",
    ]);
    expect(ctors("magiclamp/governance/types/VoteDatum")).toEqual([
      "0:VoteDatum(proposal_id,did_commit,nullifier,choice,c1_capped,c2_capped,c3_capped,c4_capped)",
    ]);
    expect(ctors("magiclamp/governance/types/ProposalResult")).toEqual([
      "0:ProposalResult(proposal_id,status,spend_spec_hash,execute_after_epoch,released_cumulative)",
    ]);
  });
});

describe("hình dạng lạ ⇒ ném GOV-DATUM (không trả giá trị đệm)", () => {
  it("TallyDatum thiếu trường (bản 12 trường v1) bị từ chối", () => {
    const d = Data.from(AIKEN.TALLY_DATUM) as Constr<Data>;
    const v1 = new Constr(0, d.fields.slice(0, 12));
    expect(() => decodeTallyDatum(v1)).toThrow(/GOV-DATUM-005/);
  });
  it("VoteDatum choice ngoài miền", () => {
    const d = Data.from(AIKEN.VOTE_DATUM) as Constr<Data>;
    const bad = new Constr(0, [...d.fields.slice(0, 3), new Constr(3, []), ...d.fields.slice(4)]);
    expect(() => decodeVoteDatum(bad)).toThrow(/GOV-DATUM-015/);
  });
  it("did_commit không đúng 32 byte — cả mã hoá lẫn giải mã", () => {
    expect(() => voteDatumToCbor({ ...VD, did_commit: "11" })).toThrow(/GOV-DATUM-011/);
    const d = Data.from(AIKEN.VOTE_DATUM) as Constr<Data>;
    const bad = new Constr(0, [d.fields[0]!, "11", ...d.fields.slice(2)]);
    expect(() => decodeVoteDatum(bad)).toThrow(/GOV-DATUM-011/);
  });
  it("voted_root không đúng 32 byte", () => {
    expect(() => tallyDatumToCbor({ ...TD, voted_root: "00" })).toThrow(/GOV-DATUM-011/);
  });
  it("redeemer sai Constr", () => {
    expect(() => voteRedeemerFromCbor(Data.to(new Constr(3, [])))).toThrow(/GOV-DATUM-053/);
    expect(() => tallyRedeemerFromCbor(Data.to(new Constr(1, [1n])))).toThrow(/GOV-DATUM-005/);
    expect(() => governanceSpendRedeemerFromCbor(Data.to(new Constr(1, [])))).toThrow(/GOV-DATUM-004/);
  });
  it("Int ở chỗ ByteArray", () => {
    const d = Data.from(AIKEN.PROPOSAL_RESULT) as Constr<Data>;
    expect(() => proposalResultFromCbor(Data.to(new Constr(0, [5n, ...d.fields.slice(1)])))).toThrow(/GOV-DATUM-002/);
  });
});
