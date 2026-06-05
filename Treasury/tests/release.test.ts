// Vitest cho nhánh RELEASE offchain (Model A). Mirror release_test.ak + ÉP byte-perfect
// với on-chain (CBOR + spend_spec_hash trích từ aiken cbor.serialise — fixture dưới).
//
// Fixtures BYTE-PERFECT (trích từ probe aiken cbor.serialise(draws) + spend_spec_hash):
//   draws_single = [draw(ops, 300, alice)]
//     CBOR  9FD8799F01421A3B444C414D5019012CD8799FD8799F43A11CE0FFD87A80FFFFFF
//     HASH  5A72173EF4FBD2B32EFCB10D355684F2EC67B76BB6F9BFA76247CDCAA1FD19AF
//   draws_multi  = [draw(ops,300,alice), draw(community,500,bob)]
//     CBOR  9FD8799F01421A3B444C414D5019012CD8799FD8799F43A11CE0FFD87A80FFFFD8799F02421A3B444C414D501901F4D8799FD8799F42B0B0FFD87A80FFFFFF
//     HASH  8ABE0B44FA210E945C48EB3AFE6108670E1BDFE4834AF4087C01FFA2C8EE4749

import { describe, expect, it } from "vitest";
import { Data } from "@lucid-evolution/lucid";

import type {
  Address, CustodyDatum, LedgerEntry, ProposalResult, ReleaseDraw,
} from "../offchain/src/types.js";
import {
  decodeAddress, decodeCustodyRedeemer, decodeProposalResult, decodeReleaseDraw,
  encodeAddress, encodeProposalResult, encodeReleaseDraw, custodyRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  applyDraws, drawsCbor, ledgerOk, planLedgerOut, planRecipientOutputs,
  recipientsOk, spendSpecHash, valueOk,
} from "../offchain/src/release.js";
import { assetKey } from "../offchain/src/collect.js";
import { planRelease } from "../offchain/src/releaseBuilder.js";

// ── Hằng số mirror release_test.ak ──
const LAMP_POLICY = "1a3b";
const LAMP_NAME = "4c414d50";
const ALICE = "a11ce0";
const BOB = "b0b0";
const CUST_SH = "c0c0c0c0";
const BUCKET_OPS = 1n;
const BUCKET_COMMUNITY = 2n;

const LAMP_KEY = assetKey(LAMP_POLICY, LAMP_NAME);
const ADA_KEY = assetKey("", "");

/** ví thường (vk_address, không stake) — mirror util.vk_address. */
function vkAddr(pkh: string): Address {
  return { payment_credential: { kind: "VerificationKey", hash: pkh }, stake_credential: null };
}

function scriptAddr(h: string): Address {
  return { payment_credential: { kind: "Script", hash: h }, stake_credential: null };
}

function drawLamp(bucket: bigint, amount: bigint, to: string): ReleaseDraw {
  return { bucket_id: bucket, policy: LAMP_POLICY, name: LAMP_NAME, amount, to: vkAddr(to) };
}

const drawsSingle: ReleaseDraw[] = [drawLamp(BUCKET_OPS, 300n, ALICE)];
const drawsMulti: ReleaseDraw[] = [
  drawLamp(BUCKET_OPS, 300n, ALICE),
  drawLamp(BUCKET_COMMUNITY, 500n, BOB),
];

function ledger(...entries: [bigint, bigint][]): LedgerEntry[] {
  return entries.map(([bucket, amount]) => ({
    bucket_id: bucket, policy: LAMP_POLICY, name: LAMP_NAME, amount,
  }));
}

function custodyDatum(led: LedgerEntry[]): CustodyDatum {
  return {
    instance_id: "abcd",
    accepted_assets: [
      { policy: "", name: "" },
      { policy: LAMP_POLICY, name: LAMP_NAME },
    ],
    ledger: led,
    cut_bps: 1000n,
    governance_ref: "9999",
    epoch: 10n,
    consumed_proposals: [],
  };
}

function proposal(specHash: string, status: ProposalResult["status"] = "Executed"): ProposalResult {
  return {
    proposal_id: "0001",
    status,
    spend_spec_hash: specHash,
    execute_after_epoch: 4n,
    released_cumulative: 0n,
  };
}

// ════════════════════════════════════════════════════════════════════════
// 1. CODEC round-trip
// ════════════════════════════════════════════════════════════════════════
describe("codec round-trip", () => {
  it("Address (vk, no stake) round-trips", () => {
    const a = vkAddr(ALICE);
    expect(decodeAddress(encodeAddress(a))).toEqual(a);
  });

  it("Address (script + inline stake) round-trips", () => {
    const a: Address = {
      payment_credential: { kind: "Script", hash: CUST_SH },
      stake_credential: { kind: "Inline", credential: { kind: "VerificationKey", hash: "5742" } },
    };
    expect(decodeAddress(encodeAddress(a))).toEqual(a);
  });

  it("ReleaseDraw round-trips", () => {
    for (const d of drawsMulti) {
      expect(decodeReleaseDraw(encodeReleaseDraw(d))).toEqual(d);
    }
  });

  it("ProposalResult round-trips (qua CBOR)", () => {
    const p = proposal(spendSpecHash(drawsSingle));
    const cbor = Data.to(encodeProposalResult(p));
    expect(decodeProposalResult(Data.from(cbor))).toEqual(p);
  });

  it("ProposalResult mọi status round-trip", () => {
    for (const status of ["Open", "Tallied", "Executed", "Rejected"] as const) {
      const p = proposal("ab".repeat(32), status);
      expect(decodeProposalResult(encodeProposalResult(p))).toEqual(p);
    }
  });

  it("Release redeemer (proposal_ref + draws) round-trips qua CBOR", () => {
    const cbor = custodyRedeemerToCbor({
      kind: "Release",
      proposal_ref: { transaction_id: "00", output_index: 7n },
      draws: drawsMulti,
    });
    const r = decodeCustodyRedeemer(Data.from(cbor));
    expect(r.kind).toBe("Release");
    if (r.kind !== "Release") throw new Error("unreachable");
    expect(r.proposal_ref).toEqual({ transaction_id: "00", output_index: 7n });
    expect(r.draws).toEqual(drawsMulti);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. spend_spec_hash CANONICAL — byte-perfect với aiken cbor.serialise
// ════════════════════════════════════════════════════════════════════════
describe("spend_spec_hash canonical (byte-perfect on-chain)", () => {
  it("CBOR draws_single khớp aiken cbor.serialise", () => {
    expect(drawsCbor(drawsSingle).toLowerCase()).toBe(
      "9fd8799f01421a3b444c414d5019012cd8799fd8799f43a11ce0ffd87a80ffffff",
    );
  });

  it("HASH draws_single khớp release.spend_spec_hash on-chain", () => {
    expect(spendSpecHash(drawsSingle).toLowerCase()).toBe(
      "5a72173ef4fbd2b32efcb10d355684f2ec67b76bb6f9bfa76247cdcaa1fd19af",
    );
  });

  it("CBOR draws_multi khớp aiken cbor.serialise", () => {
    expect(drawsCbor(drawsMulti).toLowerCase()).toBe(
      "9fd8799f01421a3b444c414d5019012cd8799fd8799f43a11ce0ffd87a80ffff" +
      "d8799f02421a3b444c414d501901f4d8799fd8799f42b0b0ffd87a80ffffff",
    );
  });

  it("HASH draws_multi khớp release.spend_spec_hash on-chain", () => {
    expect(spendSpecHash(drawsMulti).toLowerCase()).toBe(
      "8abe0b44fa210e945c48eb3afe6108670e1bdfe4834af4087c01ffa2c8ee4749",
    );
  });

  it("hash đổi khi draw đổi (amount)", () => {
    const other = [drawLamp(BUCKET_OPS, 301n, ALICE)];
    expect(spendSpecHash(other)).not.toBe(spendSpecHash(drawsSingle));
  });

  it("hash đổi khi recipient đổi (to)", () => {
    const other = [drawLamp(BUCKET_OPS, 300n, BOB)];
    expect(spendSpecHash(other)).not.toBe(spendSpecHash(drawsSingle));
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. VALUE-PRESERVATION Σ_out = Σ_in (C-REL-5)
// ════════════════════════════════════════════════════════════════════════
describe("value-preservation Σout=Σin (C-REL-5)", () => {
  it("custody_out == custody_in ⊖ Σdraw (single)", () => {
    const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n };
    const after = applyDraws(valueIn, drawsSingle);
    expect(after[LAMP_KEY]).toBe(4700n);
    expect(after[ADA_KEY]).toBe(5_000_000n);          // ADA không đụng
    expect(valueOk(valueIn, after, drawsSingle)).toBe(true);
  });

  it("Σ recipients == Σ draw (no value mất đi)", () => {
    const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n };
    const after = applyDraws(valueIn, drawsMulti);
    const recips = planRecipientOutputs(drawsMulti);
    let sumOut = 0n;
    for (const r of recips) sumOut += r.value[LAMP_KEY] ?? 0n;
    const drained = (valueIn[LAMP_KEY] ?? 0n) - (after[LAMP_KEY] ?? 0n);
    expect(sumOut).toBe(drained);                     // Σ tới recipients == Σ rút khỏi custody
    expect(sumOut).toBe(800n);
  });

  it("reject value giữ lén (custody ra ÍT hơn Σdraw)", () => {
    const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n };
    const tampered = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 4900n }; // chỉ −100 thay vì −300
    expect(valueOk(valueIn, tampered, drawsSingle)).toBe(false);
  });

  it("reject drain ADA lén (LAMP đúng nhưng ADA giảm)", () => {
    const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n };
    const drained = { [ADA_KEY]: 2_000_000n, [LAMP_KEY]: 4700n };  // ADA bị rút lén
    expect(valueOk(valueIn, drained, drawsSingle)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. LEDGER incremental (C-REL-6) + over-draw
// ════════════════════════════════════════════════════════════════════════
describe("ledger incremental + over-draw (C-REL-6)", () => {
  it("ledger_out giảm đúng bucket (single)", () => {
    const lin = ledger([BUCKET_OPS, 1000n]);
    const lout = planLedgerOut(lin, drawsSingle);
    expect(lout).toEqual(ledger([BUCKET_OPS, 700n]));
    expect(ledgerOk(lin, lout, drawsSingle)).toBe(true);
  });

  it("ledger_out giảm đúng nhiều bucket (multi)", () => {
    const lin = ledger([BUCKET_OPS, 1000n], [BUCKET_COMMUNITY, 800n]);
    const lout = planLedgerOut(lin, drawsMulti);
    expect(lout).toEqual(ledger([BUCKET_OPS, 700n], [BUCKET_COMMUNITY, 300n]));
    expect(ledgerOk(lin, lout, drawsMulti)).toBe(true);
  });

  it("reject over-draw (rút > số dư bucket)", () => {
    const lin = ledger([BUCKET_OPS, 200n]);            // chỉ 200, rút 300
    const lout = planLedgerOut(lin, drawsSingle);      // = -100
    expect(ledgerOk(lin, lout, drawsSingle)).toBe(false);
  });

  it("reject xóa dòng in (drain sổ ngược)", () => {
    const lin = ledger([BUCKET_OPS, 1000n], [BUCKET_COMMUNITY, 800n]);
    const lout = ledger([BUCKET_OPS, 700n]);           // mất dòng community
    expect(ledgerOk(lin, lout, drawsSingle)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 5. RECIPIENTS tổng-khớp + double-satisfaction (C-REL-7)
// ════════════════════════════════════════════════════════════════════════
describe("recipients tổng-khớp (C-REL-7)", () => {
  it("planRecipientOutputs gộp 2 draw cùng (to,asset) thành 1 output", () => {
    const draws = [drawLamp(BUCKET_OPS, 300n, ALICE), drawLamp(BUCKET_OPS, 300n, ALICE)];
    const recips = planRecipientOutputs(draws);
    expect(recips).toHaveLength(1);
    expect(recips[0]!.value[LAMP_KEY]).toBe(600n);     // Σ = 600
    expect(recipientsOk(recips, draws, CUST_SH)).toBe(true);
  });

  it("reject double-sat: 2 draw 600 nhưng output chỉ 300 tới alice", () => {
    const draws = [drawLamp(BUCKET_OPS, 300n, ALICE), drawLamp(BUCKET_OPS, 300n, ALICE)];
    const tampered = [{ to: vkAddr(ALICE), value: { [LAMP_KEY]: 300n } }]; // thiếu 300
    expect(recipientsOk(tampered, draws, CUST_SH)).toBe(false);
  });

  it("reject thiếu output recipient (gửi nhầm bob)", () => {
    const wrong = [{ to: vkAddr(BOB), value: { [LAMP_KEY]: 300n } }];
    expect(recipientsOk(wrong, drawsSingle, CUST_SH)).toBe(false);
  });

  it("reject to == custody (rút vòng về kho)", () => {
    const bad = [{
      bucket_id: BUCKET_OPS, policy: LAMP_POLICY, name: LAMP_NAME, amount: 300n,
      to: scriptAddr(CUST_SH),
    }];
    const recips = planRecipientOutputs(bad);
    expect(recipientsOk(recips, bad, CUST_SH)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 6. planRelease — cổng Governance đầy đủ (gate + value + ledger + recipients)
// ════════════════════════════════════════════════════════════════════════
describe("planRelease gate đầy đủ", () => {
  const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n };

  it("happy path: Executed + hash khớp + epoch ≥ execute_after → plan đúng", () => {
    const spec = spendSpecHash(drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    const plan = planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 11n);
    expect(plan.specHash).toBe(spec);
    expect(plan.custodyAfter[LAMP_KEY]).toBe(4700n);
    expect(plan.newDatum.ledger).toEqual(ledger([BUCKET_OPS, 700n]));
    expect(plan.newDatum.epoch).toBe(11n);
    expect(plan.recipients).toHaveLength(1);
    expect(plan.recipients[0]!.value[LAMP_KEY]).toBe(300n);
  });

  it("reject chưa Executed (status=Tallied) → C-REL-2", () => {
    const spec = spendSpecHash(drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec, "Tallied"), drawsSingle, CUST_SH, 5n),
    ).toThrow(/RELEASE-002/);
  });

  it("reject spend_spec_hash lệch (draws ≠ duyệt) → C-REL-3", () => {
    const approvedSpec = spendSpecHash(drawsSingle);     // proposal duyệt draw 300
    const actual = [drawLamp(BUCKET_OPS, 500n, ALICE)];  // caller rút 500
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(approvedSpec), actual, CUST_SH, 5n),
    ).toThrow(/RELEASE-003/);
  });

  it("reject trước time-lock (epoch < execute_after) → C-REL-8", () => {
    const spec = spendSpecHash(drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 3n),
    ).toThrow(/RELEASE-008/);
  });

  it("reject over-draw bucket → C-REL-6", () => {
    const spec = spendSpecHash(drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 200n]));  // chỉ 200
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n),
    ).toThrow(/RELEASE-006/);
  });

  it("reject to == custody → C-REL-7a", () => {
    const bad = [{
      bucket_id: BUCKET_OPS, policy: LAMP_POLICY, name: LAMP_NAME, amount: 300n,
      to: scriptAddr(CUST_SH),
    }];
    const spec = spendSpecHash(bad);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), bad, CUST_SH, 5n),
    ).toThrow(/RELEASE-007a/);
  });

  it("reject epoch lùi → RELEASE-009", () => {
    const spec = spendSpecHash(drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 9n),
    ).toThrow(/RELEASE-009/);
  });
});
