// Cổng SDK khớp on-chain sau 3bdd644 + a55b33f:
//   · `tally` nhận thêm apply-param `c3_script_hash` (thứ tự + cặp C3);
//   · `attested_c3` chỉ đọc chứng thực tại `Script(c3_script_hash)`, đúng một ứng viên;
//   · `weight_guard.knots_wellformed` (G0) + `dominates` fail-closed khi miền chung rỗng;
//   · `book_root_after` — thứ tự `insert_proofs` phải trùng thứ tự input;
//   · `MintNullifier` ép did_commit/proposal_id 32 byte.
// Mỗi ca âm lật ĐÚNG MỘT vế; ca dương đi kèm để chứng minh đầu vào phân biệt được hai phía.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Data, credentialToAddress, type UTxO } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import { scriptAddress } from "../offchain/src/chainRead.js";
import { EXPECTED_PARAMS, applyGovernanceBlueprint, type GovernanceDeployParams } from "../offchain/src/config.js";
import { nullifierRedeemerToCbor } from "../offchain/src/datum.js";
import { nullifierNameRaw } from "../offchain/src/names.js";
import { attestedC3 } from "../offchain/src/tallyBuilders.js";
import { SCALE, d8Ok, d8Problem, dominates, knotsProblem, knotsWellformed } from "../offchain/src/tallyMath.js";
import type { Knot, WeightParam } from "../offchain/src/types.js";
import { VotedLedger, replayBatchInsert } from "../offchain/src/votedLedger.js";
import { assertWeightParamMintable } from "../offchain/src/weightParamBuilder.js";
import { DID, PID } from "./aikenVectors.js";

const blueprint = JSON.parse(readFileSync(resolve(__dirname, "../onchain/plutus.json"), "utf8"));

const H28 = (b: string) => b.repeat(28);
const baseParams = (c3PolicyId: string, c3ScriptHash: string): GovernanceDeployParams => ({
  phaseTag: "5031", taadPolicyId: H28("7a"), c3PolicyId, c3ScriptHash,
  msPerEpoch: 3_600_000n, windowOriginMs: 1_506_203_091_000n, // gốc Mainnet thật, không phải 0
  tallyWindowEpochs: 2n, deltaMinEpochs: 1n, recoveryTimelockEpochs: 10n,
  weightParam: { policyId: H28("a0") },
});

describe("config — tally 9 tham số (tham số cuối window_origin_ms), cặp C3", () => {
  it("EXPECTED_PARAMS.tally khớp nguyên văn parameters của blueprint", () => {
    const v = blueprint.validators.find((x: { title: string }) => x.title === "tally.tally.spend");
    expect(v.parameters.map((p: { title: string }) => p.title)).toEqual(EXPECTED_PARAMS.tally);
    expect(EXPECTED_PARAMS.tally).toEqual([
      "tally_policy", "vote_script_hash", "nullifier_policy", "weight_param_policy", "c3_policy", "c3_script_hash",
      "tally_window_epochs", "ms_per_epoch", "window_origin_ms",
    ]);
  });
  it("window_origin_ms là tham số CUỐI của nullifier/vote/tally/governance; blueprint khớp EXPECTED_PARAMS", () => {
    for (const [key, title] of [
      ["nullifier", "nullifier.nullifier.mint"], ["vote", "vote.vote.spend"],
      ["tally", "tally.tally.spend"], ["governance", "governance.governance.mint"],
    ] as const) {
      const v = blueprint.validators.find((x: { title: string }) => x.title === title);
      const names = v.parameters.map((p: { title: string }) => p.title);
      expect(names.at(-1), title).toBe("window_origin_ms");
      expect(names, title).toEqual(EXPECTED_PARAMS[key]);
    }
  });
  it("gốc cửa sổ đi vào hash của cả bốn script; thiếu/âm ⇒ GOV-APPLY-005", () => {
    const a = applyGovernanceBlueprint(blueprint, baseParams("", ""));
    const b = applyGovernanceBlueprint(blueprint, { ...baseParams("", ""), windowOriginMs: 1_654_041_600_000n });
    expect(b.nullifierPolicyId).not.toBe(a.nullifierPolicyId);
    expect(b.voteScriptHash).not.toBe(a.voteScriptHash);
    expect(b.tallyScriptHash).not.toBe(a.tallyScriptHash);
    expect(b.governancePolicyId).not.toBe(a.governancePolicyId);
    expect(a.windowOriginMs).toBe(1_506_203_091_000n);
    expect(() => applyGovernanceBlueprint(blueprint, { ...baseParams("", ""), windowOriginMs: undefined as never })).toThrow("GOV-APPLY-005");
    expect(() => applyGovernanceBlueprint(blueprint, { ...baseParams("", ""), windowOriginMs: -1n })).toThrow("GOV-APPLY-005");
  });
  it("cả hai rỗng (pha chưa bật C3) và cả hai là hash 28 byte đều apply được; hai hash tally khác nhau", () => {
    const off = applyGovernanceBlueprint(blueprint, baseParams("", ""));
    const on = applyGovernanceBlueprint(blueprint, baseParams(H28("c3"), H28("c5")));
    expect(off.c3ScriptHash).toBe("");
    expect(on.c3ScriptHash).toBe(H28("c5"));
    expect(on.tallyScriptHash).not.toBe(off.tallyScriptHash);
    // c3_script_hash thực sự đi vào hash tally (không phải bị bỏ qua khi apply):
    const on2 = applyGovernanceBlueprint(blueprint, baseParams(H28("c3"), H28("c6")));
    expect(on2.tallyScriptHash).not.toBe(on.tallyScriptHash);
    // …và KHÔNG đi vào hash vote/nullifier (hai script đứng trước tally trong chuỗi phụ thuộc).
    expect(on2.voteScriptHash).toBe(on.voteScriptHash);
    expect(on2.nullifierPolicyId).toBe(on.nullifierPolicyId);
  });
  it("lệch cặp ⇒ GOV-APPLY-004 (cả hai chiều)", () => {
    expect(() => applyGovernanceBlueprint(blueprint, baseParams(H28("c3"), ""))).toThrow("GOV-APPLY-004");
    expect(() => applyGovernanceBlueprint(blueprint, baseParams("", H28("c5")))).toThrow("GOV-APPLY-004");
  });
  it("c3ScriptHash không phải hash 28 byte ⇒ ném", () => {
    expect(() => applyGovernanceBlueprint(blueprint, baseParams(H28("c3"), "c5"))).toThrow("GOV-DATUM");
  });
});

// ── attested_c3 ──

const C3_POLICY = H28("c3");
const C3_SH = H28("c5");
const did = DID;

function utxo(ix: number, address: string, assets: Record<string, bigint>, datum?: string): UTxO {
  return { txHash: "ab".repeat(32), outputIndex: ix, address, assets: { lovelace: 2_000_000n, ...assets }, datum: datum ?? null };
}
const at = (hash: string) => scriptAddress("Preprod", hash);
const keyAddr = credentialToAddress("Preprod", { type: "Key", hash: H28("99") });
const tok = (d: string, q = 1n) => ({ [C3_POLICY + d]: q });

describe("attestedC3 — mirror tally.ak ▸ attested_c3", () => {
  it("một chứng thực tại Script(c3_script_hash), datum Int ⇒ trả giá trị", () => {
    expect(attestedC3([utxo(0, at(C3_SH), tok(did), Data.to(7n))], C3_POLICY, C3_SH, did)).toBe(7n);
  });
  it("token đúng tên nhưng ở ví thường ⇒ GOV-TALLY-016 (PoC 4: datum do người giữ token tự viết)", () => {
    expect(() => attestedC3([utxo(0, keyAddr, tok(did), Data.to(7n))], C3_POLICY, C3_SH, did)).toThrow("GOV-TALLY-016");
  });
  it("token đúng tên ở script KHÁC ⇒ GOV-TALLY-016", () => {
    expect(() => attestedC3([utxo(0, at(H28("dd")), tok(did), Data.to(7n))], C3_POLICY, C3_SH, did)).toThrow("GOV-TALLY-016");
  });
  it("một ở script đúng + một ở ví thường ⇒ vẫn đúng MỘT ứng viên, trả giá trị ở script", () => {
    const refs = [utxo(0, keyAddr, tok(did), Data.to(99n)), utxo(1, at(C3_SH), tok(did), Data.to(7n))];
    expect(attestedC3(refs, C3_POLICY, C3_SH, did)).toBe(7n);
  });
  it("hai ứng viên tại script đúng ⇒ GOV-TALLY-010", () => {
    const refs = [utxo(0, at(C3_SH), tok(did), Data.to(7n)), utxo(1, at(C3_SH), tok(did), Data.to(8n))];
    expect(() => attestedC3(refs, C3_POLICY, C3_SH, did)).toThrow("GOV-TALLY-010");
  });
  it("không có ứng viên nào ⇒ GOV-TALLY-010", () => {
    expect(() => attestedC3([], C3_POLICY, C3_SH, did)).toThrow("GOV-TALLY-010");
  });
  it("số lượng token 2 (không phải đúng 1) ⇒ không tính là ứng viên", () => {
    expect(() => attestedC3([utxo(0, at(C3_SH), tok(did, 2n), Data.to(7n))], C3_POLICY, C3_SH, did)).toThrow("GOV-TALLY-010");
  });
  it("datum không phải Int ⇒ GOV-TALLY-011; không datum ⇒ GOV-TALLY-011", () => {
    expect(() => attestedC3([utxo(0, at(C3_SH), tok(did), Data.to("aa"))], C3_POLICY, C3_SH, did)).toThrow("GOV-TALLY-011");
    expect(() => attestedC3([utxo(0, at(C3_SH), tok(did))], C3_POLICY, C3_SH, did)).toThrow("GOV-TALLY-011");
  });
});

// ── G0 knots_wellformed + dominates ──

const k = (c: bigint, pow: bigint): Knot => ({ c, pow });
const W1 = [k(0n, 0n), k(100n, 100n * SCALE)];
const W05 = [k(0n, 0n), k(25n, 5n * SCALE), k(100n, 10n * SCALE)];

describe("knotsWellformed — mirror weight_guard.ak ▸ knots_wellformed (mỗi ca lật một vế)", () => {
  it("bảng chuẩn hợp khuôn", () => {
    expect(knotsWellformed(W1)).toBe(true);
    expect(knotsWellformed(W05)).toBe(true);
  });
  const neg: [string, Knot[], RegExp][] = [
    ["length < 2 (rỗng)", [], /cần ≥ 2/],
    ["length < 2 (một mốc)", [k(0n, 0n)], /cần ≥ 2/],
    ["first.c ≠ 0", [k(1n, 0n), k(100n, 100n * SCALE)], /mốc đầu c/],
    ["first.pow ≠ 0 (pow(0) = SCALE — bảng PoC 4)", [k(0n, SCALE), k(100n, SCALE)], /mốc đầu pow/],
    ["first.pow âm", [k(0n, -1n), k(100n, 100n * SCALE)], /mốc đầu pow/],
    ["c trùng ở giữa (cap ≥ 1)", [k(0n, 0n), k(50n, 10n * SCALE), k(50n, 20n * SCALE), k(100n, 30n * SCALE)], /tăng nghiêm ngặt/],
    ["c trùng ở đầu (cap = 0 — bảng PoC 3)", [k(0n, 0n), k(0n, 7n * SCALE)], /tăng nghiêm ngặt/],
    ["c giảm", [k(0n, 0n), k(100n, 5n * SCALE), k(50n, 10n * SCALE)], /tăng nghiêm ngặt/],
    ["pow giảm", [k(0n, 0n), k(50n, 10n * SCALE), k(100n, 5n * SCALE)], /pow giảm/],
  ];
  for (const [name, t, re] of neg) {
    it(`bác: ${name}`, () => {
      expect(knotsWellformed(t)).toBe(false);
      expect(knotsProblem(t)).toMatch(re);
    });
  }
});

describe("dominates — miền chung rỗng ⇒ false (fail-closed)", () => {
  it("cap = 0 ⇒ false (trước đây đúng-rỗng trả true — PoC 3)", () => {
    const cap0 = [k(0n, 0n), k(0n, 7n * SCALE)];
    expect(dominates(cap0, W1)).toBe(false);
    expect(dominates(W1, cap0)).toBe(false);
  });
  it("đối chứng: miền chung khác rỗng thì so theo w như cũ", () => {
    expect(dominates(W1, W05)).toBe(true);
    expect(dominates(W05, W1)).toBe(false);
    expect(dominates(W1, W1)).toBe(true);
  });
});

const wpOf = (k1: Knot[], k2: Knot[], k3: Knot[], k4: Knot[]): WeightParam => ({
  k1, k2, k3, k4, bft_floor: 2n, quorum_vp_threshold: 1n, quorum_voter_threshold: 1n, theta_num: 2n, theta_den: 3n,
});
const bounds = { bftFloorMin: 1n, bftFloorMax: 64n, quorumVotersMin: 1n };

describe("d8Ok + assertWeightParamMintable — G0 đi trước G1–G3, một nguồn", () => {
  it("bảng hợp lệ qua cả hai cổng", () => {
    const wp = wpOf(W1, W05, W1, W05);
    expect(d8Ok(wp)).toBe(true);
    expect(() => assertWeightParamMintable(wp, bounds)).not.toThrow();
  });
  it("pow(0) = SCALE ở k4 ⇒ d8Ok false, builder GOV-WP-008 (sai khuôn), KHÔNG phải GOV-WP-007", () => {
    const bad = [k(0n, SCALE), k(100n, 2n * SCALE)];
    const wp = wpOf(W1, W1, W1, bad);
    expect(d8Ok(wp)).toBe(false);
    expect(d8Problem(wp)).toMatch(/^G0 k4/);
    expect(() => assertWeightParamMintable(wp, bounds)).toThrow("GOV-WP-008");
  });
  it("bảng hợp khuôn nhưng w_3 < w_4 ⇒ GOV-WP-007 (lý do D8, không phải khuôn)", () => {
    const wp = wpOf(W1, W05, W05, W1);
    expect(d8Problem(wp)).toMatch(/^G2/);
    expect(() => assertWeightParamMintable(wp, bounds)).toThrow("GOV-WP-007");
  });
  it("bảng k3 cap = 0 bị bác ở G0 trước khi tới dominates", () => {
    const wp = wpOf(W1, W1, [k(0n, 0n), k(0n, 7n * SCALE)], W1);
    expect(d8Problem(wp)).toMatch(/^G0 k3/);
  });
});

// ── book_root_after: thứ tự insert_proofs ──

describe("replayBatchInsert — mirror tally.ak ▸ book_root_after", () => {
  const prop = "cd".repeat(32);
  const dids = [1, 2, 3, 4, 5, 6].map((i) => i.toString(16).padStart(2, "0").repeat(32));
  const entries = dids.map((d) => ({ didCommit: d, nullifier: nullifierNameRaw(d, prop) }));

  it("lô 6 phiếu, insert_proofs theo ĐÚNG thứ tự input ⇒ qua, gốc = gốc kế hoạch", async () => {
    const l = await VotedLedger.empty();
    const plan = await l.planBatchInsert(entries);
    expect(replayBatchInsert(l.root, entries, plan.insertProofs)).toBe(plan.rootAfter);
  });
  it("cùng lô, insert_proofs ĐẢO thứ tự ⇒ GOV-LEDGER-007", async () => {
    const l = await VotedLedger.empty();
    const plan = await l.planBatchInsert(entries);
    expect(() => replayBatchInsert(l.root, entries, [...plan.insertProofs].reverse())).toThrow("GOV-LEDGER-007");
  });
  it("kế hoạch lập theo thứ tự đảo rồi đem ghép với thứ tự input ⇒ GOV-LEDGER-007", async () => {
    const l = await VotedLedger.empty();
    const planRev = await l.planBatchInsert([...entries].reverse());
    // Gốc cuối trùng nhau (MPF chính tắc theo tập lá) — nên chỉ so gốc cuối là KHÔNG đủ bắt lỗi này.
    const planFwd = await l.planBatchInsert(entries);
    expect(planRev.rootAfter).toBe(planFwd.rootAfter);
    expect(() => replayBatchInsert(l.root, entries, planRev.insertProofs)).toThrow("GOV-LEDGER-007");
  });
  it("sổ đã có lá: lô chèn sau vẫn phải đúng thứ tự", async () => {
    const l = await VotedLedger.fromEntries(entries.slice(0, 2));
    const batch = entries.slice(2);
    const plan = await l.planBatchInsert(batch);
    expect(replayBatchInsert(l.root, batch, plan.insertProofs)).toBe(plan.rootAfter);
    expect(() => replayBatchInsert(l.root, batch, [...plan.insertProofs].reverse())).toThrow("GOV-LEDGER-007");
  });
  it("số bằng chứng ≠ số phiếu ⇒ GOV-LEDGER-008", async () => {
    const l = await VotedLedger.empty();
    const plan = await l.planBatchInsert(entries);
    expect(() => replayBatchInsert(l.root, entries, plan.insertProofs.slice(1))).toThrow("GOV-LEDGER-008");
  });
});

describe("MintNullifier — did_commit / proposal_id đúng 32 byte (nullifier.ak cổng 32 byte)", () => {
  it("32 byte qua; 31 byte ở từng trường ⇒ ném", () => {
    expect(() => nullifierRedeemerToCbor({ kind: "MintNullifier", did_commit: DID, proposal_id: PID })).not.toThrow();
    expect(() => nullifierRedeemerToCbor({ kind: "MintNullifier", did_commit: DID.slice(2), proposal_id: PID })).toThrow("GOV-DATUM");
    expect(() => nullifierRedeemerToCbor({ kind: "MintNullifier", did_commit: DID, proposal_id: PID.slice(2) })).toThrow("GOV-DATUM");
  });
});
