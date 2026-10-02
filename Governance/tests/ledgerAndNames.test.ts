// VotedLedger parity với `mpf_fixtures.ak` + tên tài sản (names.ak) + cửa sổ epoch + số học tally.

import type { UTxO } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import { compareInputOrder } from "../offchain/src/chainRead.js";
import { assertBoundedWindow, boundedEpochWindow, epochOf } from "../offchain/src/epochWindow.js";
import { nullifierName, nullifierNameRaw, proposalIdOf } from "../offchain/src/names.js";
import {
  SCALE, applyClamp, d8Ok, floorDiv, interp, mergeTop, pass, vpRaw,
} from "../offchain/src/tallyMath.js";
import type { TallyDatum, WeightParam } from "../offchain/src/types.js";
import { VOTED_ROOT_EMPTY, VotedLedger } from "../offchain/src/votedLedger.js";
import { AIKEN, DID, MPF_FIXTURE_ROOTS, MPF_FIXTURE_VALUES_A, PID, TXID } from "./aikenVectors.js";

describe("names.ak", () => {
  it("nullifier_name(#11, #22) — vector ghim trong names.ak ▸ nl_name_on_dinh", () => {
    expect(nullifierNameRaw("11", "22")).toBe("bb946cc46da7b64b2a76e743f2de7f1a2054fea3652b4670023024776b4878b7");
  });
  it("nullifierName 32 byte khớp Aiken; độ dài khác ⇒ ném", () => {
    expect(nullifierName(DID, PID)).toBe(AIKEN.NULLIFIER_DID_PID);
    expect(() => nullifierName("11", PID)).toThrow(/GOV-DATUM-011/);
  });
  it("proposal_id_of(seed) khớp Aiken (Data.to của Lucid = cbor.serialise)", () => {
    expect(proposalIdOf({ transaction_id: TXID, output_index: 7n })).toBe(AIKEN.PROPOSAL_ID_SEED7);
  });
});

describe("VotedLedger — parity gốc với mpf_fixtures.ak", () => {
  it("sổ rỗng = root_*0", async () => {
    expect((await VotedLedger.empty()).root).toBe(VOTED_ROOT_EMPTY);
    expect(VOTED_ROOT_EMPTY).toBe(MPF_FIXTURE_ROOTS.a[0]);
  });
  it("bộ a: 6 DID, prop #abcd — gốc sau từng lần chèn = root_a1..a6", async () => {
    const dids = ["11", "12", "13", "14", "15", "16"];
    const entries = dids.map((d) => ({ didCommit: d, nullifier: nullifierNameRaw(d, "abcd") }));
    entries.forEach((e, i) => expect(e.nullifier).toBe(MPF_FIXTURE_VALUES_A[i]));
    let l = await VotedLedger.empty();
    for (let i = 0; i < entries.length; i++) {
      const plan = await l.planBatchInsert([entries[i]!]);
      expect(plan.rootBefore).toBe(MPF_FIXTURE_ROOTS.a[i]);
      expect(plan.rootAfter).toBe(MPF_FIXTURE_ROOTS.a[i + 1]);
      l = plan.next;
    }
    // cả lô một lần cho cùng gốc cuối
    const whole = await (await VotedLedger.empty()).planBatchInsert(entries);
    expect(whole.rootAfter).toBe(MPF_FIXTURE_ROOTS.a[6]);
    expect(whole.insertProofs).toHaveLength(6);
    expect(whole.membershipProofs).toHaveLength(6);
  });
  it("bộ b: 2 DID, prop #22", async () => {
    const entries = ["11", "12"].map((d) => ({ didCommit: d, nullifier: nullifierNameRaw(d, "22") }));
    const l1 = await VotedLedger.fromEntries(entries.slice(0, 1));
    expect(l1.root).toBe(MPF_FIXTURE_ROOTS.b[1]);
    expect((await VotedLedger.fromEntries(entries)).root).toBe(MPF_FIXTURE_ROOTS.b[2]);
  });
  it("bộ c: sổ LỆCH (khoá #11 trỏ nullifier của #12) — gốc khác bộ b", async () => {
    const l = await VotedLedger.fromEntries([{ didCommit: "11", nullifier: nullifierNameRaw("12", "22") }]);
    expect(l.root).toBe(MPF_FIXTURE_ROOTS.c[1]);
    expect(l.root).not.toBe(MPF_FIXTURE_ROOTS.b[1]);
  });
  it("rebuild lệch datum ⇒ GOV-LEDGER-001", async () => {
    const entries = ["11"].map((d) => ({ didCommit: d, nullifier: nullifierNameRaw(d, "22") }));
    await expect(VotedLedger.rebuild(entries, MPF_FIXTURE_ROOTS.b[2])).rejects.toThrow(/GOV-LEDGER-001/);
  });
  it("DID đã có trong sổ, hoặc trùng trong lô ⇒ GOV-LEDGER-003", async () => {
    const e11 = { didCommit: "11", nullifier: nullifierNameRaw("11", "22") };
    const l = await VotedLedger.fromEntries([e11]);
    await expect(l.planBatchInsert([e11])).rejects.toThrow(/GOV-LEDGER-003/);
    // cùng did_commit, nullifier KHÁC (đúc đôi) — vẫn bị bác theo khoá
    await expect(l.planBatchInsert([{ didCommit: "11", nullifier: nullifierNameRaw("12", "22") }])).rejects.toThrow(/GOV-LEDGER-003/);
    const e12 = { didCommit: "12", nullifier: nullifierNameRaw("12", "22") };
    await expect((await VotedLedger.empty()).planBatchInsert([e12, e12])).rejects.toThrow(/GOV-LEDGER-003/);
  });
  it("lô rỗng ⇒ GOV-LEDGER-015; giá trị không 32 byte ⇒ GOV-LEDGER-011", async () => {
    const l = await VotedLedger.empty();
    await expect(l.planBatchInsert([])).rejects.toThrow(/GOV-LEDGER-015/);
    await expect(l.planBatchInsert([{ didCommit: "11", nullifier: "00" }])).rejects.toThrow(/GOV-LEDGER-011/);
  });
});

describe("epochWindow — get_epoch_bounded", () => {
  const MS = 86_400_000n;
  // Gốc Mainnet thật (Specs/Window/CONTRACT.md v1.0 §3): không chia hết MS (dư 78_291_000 ≠ 0),
  // nên bản quên trừ gốc cho nhãn lệch hàng nghìn cửa sổ chứ không lệch 0.
  const O = 1_506_203_091_000n;
  const ON = Number(O);
  const preview = { zeroTime: 1_666_656_000_000, zeroSlot: 0, slotLength: 1000 };
  it("hai biên cùng một epoch, căn slot, chứa now", () => {
    const now = ON + 20_000 * 86_400_000 + 12_345;
    const w = boundedEpochWindow(now, MS, O, preview);
    expect(w.epoch).toBe(20_000n);
    expect(epochOf(w.loMs, MS, O)).toBe(w.epoch);
    expect(epochOf(w.hiMs, MS, O)).toBe(w.epoch);
    expect(w.loMs).toBeLessThanOrEqual(now);
    expect((w.loMs - preview.zeroTime) % 1000).toBe(0);
    expect((w.hiMs - preview.zeroTime) % 1000).toBe(0);
  });
  it("sát cuối epoch (< 60 s) ⇒ GOV-WINDOW-001, không nới sang epoch sau", () => {
    const now = ON + 20_001 * 86_400_000 - 30_000;
    expect(() => boundedEpochWindow(now, MS, O, preview)).toThrow(/GOV-WINDOW-001/);
  });
  it("slot lệch pha với đầu epoch: lo không bị làm tròn xuống epoch trước", () => {
    const odd = { zeroTime: 1_000_000_000_500, zeroSlot: 0, slotLength: 1000 };
    const start = ON + 20_000 * 86_400_000;
    const w = boundedEpochWindow(start + 700, MS, O, odd); // slot chứa now bắt đầu ở start − 300
    expect(epochOf(w.loMs, MS, O)).toBe(20_000n);
    expect(() => boundedEpochWindow(start + 200, MS, O, odd)).toThrow(/GOV-WINDOW-002/);
  });
  it("khoảng do người gọi đưa vắt hai epoch ⇒ GOV-WINDOW-006", () => {
    const e = ON + 20_000 * 86_400_000;
    expect(() => assertBoundedWindow(e - 1000, e + 1000, MS, O)).toThrow(/GOV-WINDOW-006/);
    expect(assertBoundedWindow(e, e + 1000, MS, O)).toBe(20_000n);
  });
  it("biên cửa sổ rơi đúng gốc + k·MS, KHÔNG phải k·MS từ gốc Unix", () => {
    const start = ON + 20_000 * 86_400_000;
    expect(epochOf(start - 1, MS, O)).toBe(19_999n);
    expect(epochOf(start, MS, O)).toBe(20_000n);
    expect(epochOf(start + 86_400_000 - 1, MS, O)).toBe(20_000n);
    // lưới Unix cũ ra nhãn khác hẳn — bài này đỏ nếu `epochOf` quên trừ gốc:
    expect(BigInt(Math.floor(start / 86_400_000))).not.toBe(20_000n);
  });
  it("thiếu / sai gốc ⇒ GOV-WINDOW-007; mốc trước gốc ⇒ GOV-WINDOW-008", () => {
    expect(() => epochOf(ON + 1, MS, undefined as never)).toThrow(/GOV-WINDOW-007/);
    expect(() => epochOf(ON + 1, MS, -1n)).toThrow(/GOV-WINDOW-007/);
    expect(() => epochOf(ON - 1, MS, O)).toThrow(/GOV-WINDOW-008/);
    expect(() => boundedEpochWindow(5_000, MS, O, preview)).toThrow(/GOV-WINDOW-008/);
  });
});

describe("tallyMath — bản chép power.ak / tally.ak (đối chiếu các ca Aiken)", () => {
  const lin = [{ c: 0n, pow: 0n }, { c: 100n, pow: 100n * SCALE }];
  it("interp: các ca power.ak (0, 100, 50, 999, −5)", () => {
    expect(interp(lin, 0n)).toBe(0n);
    expect(interp(lin, 100n)).toBe(100n * SCALE);
    expect(interp(lin, 50n)).toBe(50n * SCALE);
    expect(interp(lin, 999n)).toBe(100n * SCALE);
    expect(interp(lin, -5n)).toBe(0n);
  });
  it("floorDiv làm tròn về −∞ như Aiken", () => {
    expect(floorDiv(-7n, 2n)).toBe(-4n);
    expect(floorDiv(7n, 2n)).toBe(3n);
  });
  it("d8Ok: w=(1, 0.5) qua; bảng hằng (w=0) trượt", () => {
    const w05 = [{ c: 0n, pow: 0n }, { c: 25n, pow: 5n * SCALE }, { c: 100n, pow: 10n * SCALE }];
    expect(d8Ok({ k1: lin, k2: w05, k3: lin, k4: w05 })).toBe(true);
    expect(d8Ok({ k1: w05, k2: lin, k3: lin, k4: w05 })).toBe(false);
    const flat = [{ c: 0n, pow: SCALE }, { c: 100n, pow: SCALE }];
    expect(d8Ok({ k1: lin, k2: lin, k3: flat, k4: flat })).toBe(false);
  });
  it("mergeTop ổn định + cắt F−1; clamp trừ phần vượt; pass đủ bốn vế", () => {
    const heap = mergeTop([], [
      { vp_raw: 5n, choice: "Yes" }, { vp_raw: 9n, choice: "No" }, { vp_raw: 5n, choice: "Abstain" },
    ], 2n);
    expect(heap).toEqual([{ vp_raw: 9n, choice: "No" }, { vp_raw: 5n, choice: "Yes" }]);
    const d: TallyDatum = {
      proposal_id: PID, phase: "Summing", weight_param_ref: { transaction_id: TXID, output_index: 0n },
      yes_power_raw: 60n, no_power_raw: 30n, abstain_power_raw: 10n, voters_acc: 5n, yes_voters_acc: 4n,
      top_did_vp: [{ vp_raw: 40n, choice: "Yes" }], yes_power_eff: 0n, no_power_eff: 0n, abstain_power_eff: 0n,
      vote_open_epoch: 1n, vote_close_epoch: 2n, voted_root: VOTED_ROOT_EMPTY,
    };
    // τ = 100 / 4 = 25 ⇒ yes_eff = 60 − (40 − 25) = 45
    expect(applyClamp(d, 4n)).toEqual({ yes_power_eff: 45n, no_power_eff: 30n, abstain_power_eff: 10n });
    const wp: WeightParam = {
      k1: lin, k2: lin, k3: lin, k4: lin, bft_floor: 4n, quorum_vp_threshold: 80n,
      quorum_voter_threshold: 5n, theta_num: 2n, theta_den: 3n,
    };
    const cl = { ...d, phase: "Clamped" as const, ...applyClamp(d, 4n) };
    expect(pass(cl, wp)).toBe(false); // 45·3 = 135 < (45+30)·2 = 150
    expect(pass({ ...cl, yes_power_eff: 60n }, wp)).toBe(true);
  });
  it("vpRaw = tích bốn pow / SCALE³", () => {
    const one = [{ c: 0n, pow: SCALE }, { c: 100n, pow: 100n * SCALE }];
    const wp = { k1: one, k2: one, k3: one, k4: one } as unknown as WeightParam;
    expect(vpRaw(wp, { c1_capped: 0n, c2_capped: 0n, c3_capped: 0n, c4_capped: 0n })).toBe(SCALE);
    expect(vpRaw(wp, { c1_capped: 100n, c2_capped: 0n, c3_capped: 0n, c4_capped: 0n })).toBe(100n * SCALE);
  });
});

describe("thứ tự input ledger (SumBatch ghép insert_proofs theo thứ tự này)", () => {
  it("compareInputOrder: txHash tăng dần theo chuỗi hex, rồi outputIndex", () => {
    const u = (h: string, i: number) => ({ txHash: h, outputIndex: i }) as UTxO;
    const xs = [u("bb".repeat(32), 0), u("aa".repeat(32), 2), u("aa".repeat(32), 1), u("0f".repeat(32), 9)];
    const got = [...xs].sort(compareInputOrder).map((x) => `${x.txHash.slice(0, 2)}#${x.outputIndex}`);
    expect(got).toEqual(["0f#9", "aa#1", "aa#2", "bb#0"]);
  });
});
