// Vitest cho nhánh RELEASE offchain (Model A). Mirror release_test.ak + ÉP byte-perfect
// với on-chain (CBOR + spend_spec_hash trích từ aiken cbor.serialise + aiken
// spend_spec_hash — fixture dưới, đã đối chiếu qua probe aiken trực tiếp).
//
// F10: spend_spec_hash NAY = blake2b(0x02 ‖ blake2b(instance_id) ‖ blake2b(cbor(draws))).
// instance_id của các fixture = "abcd" (= custodyDatum.instance_id).
//
// Fixtures BYTE-PERFECT (CBOR draws + HASH với instance_id="abcd"):
//   draws_single = [draw(ops, 300, alice)]
//     CBOR  9FD8799F01421A3B444C414D5019012CD8799FD8799F43A11CE0FFD87A80FFFFFF
//     HASH  CE5080F356F6FC29AD1B31A0CE5BD348DDA86E309E4E11BA99B5CD7C9E83337B
//   draws_multi  = [draw(ops,300,alice), draw(community,500,bob)]
//     CBOR  9FD8799F01421A3B444C414D5019012CD8799FD8799F43A11CE0FFD87A80FFFFD8799F02421A3B444C414D501901F4D8799FD8799F42B0B0FFD87A80FFFFFF
//     HASH  920E780A3765D8BAA3C107B8D5F9F445CE0467443937F15AC2E8A99C3D71A266
// (blake2b(instance_id="abcd") = 9606E52F00C679E548B5155AF5026F5AF4130D7A15C990A791FFF8D652C464F5)

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
const INSTANCE_ID = "abcd";                 // F10: instance_id của fixture (= custodyDatum)
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
    const p = proposal(spendSpecHash(INSTANCE_ID, drawsSingle));
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

  it("HASH draws_single khớp release.spend_spec_hash on-chain (F10, instance_id=abcd)", () => {
    expect(spendSpecHash(INSTANCE_ID, drawsSingle).toLowerCase()).toBe(
      "ce5080f356f6fc29ad1b31a0ce5bd348dda86e309e4e11ba99b5cd7c9e83337b",
    );
  });

  it("CBOR draws_multi khớp aiken cbor.serialise", () => {
    expect(drawsCbor(drawsMulti).toLowerCase()).toBe(
      "9fd8799f01421a3b444c414d5019012cd8799fd8799f43a11ce0ffd87a80ffff" +
      "d8799f02421a3b444c414d501901f4d8799fd8799f42b0b0ffd87a80ffffff",
    );
  });

  it("HASH draws_multi khớp release.spend_spec_hash on-chain (F10, instance_id=abcd)", () => {
    expect(spendSpecHash(INSTANCE_ID, drawsMulti).toLowerCase()).toBe(
      "920e780a3765d8baa3c107b8d5f9f445ce0467443937f15ac2e8a99c3d71a266",
    );
  });

  it("hash đổi khi draw đổi (amount)", () => {
    const other = [drawLamp(BUCKET_OPS, 301n, ALICE)];
    expect(spendSpecHash(INSTANCE_ID, other)).not.toBe(spendSpecHash(INSTANCE_ID, drawsSingle));
  });

  it("hash đổi khi recipient đổi (to)", () => {
    const other = [drawLamp(BUCKET_OPS, 300n, BOB)];
    expect(spendSpecHash(INSTANCE_ID, other)).not.toBe(spendSpecHash(INSTANCE_ID, drawsSingle));
  });

  it("F10: hash đổi theo instance_id (CÙNG draws, khác instance_id → hash khác)", () => {
    // Chống replay chéo instance CÙNG governance_ref: proposal của instance A (spec_hash
    // theo "abcd") KHÔNG khớp khi tái dựng cho instance B ("dcba").
    const hashA = spendSpecHash("abcd", drawsSingle);
    const hashB = spendSpecHash("dcba", drawsSingle);
    expect(hashA).not.toBe(hashB);
    // determinism: cùng (instance_id, draws) → cùng hash.
    expect(spendSpecHash("abcd", drawsSingle)).toBe(hashA);
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
    // planLedgerOut canonical hoá → sinh dòng âm → ném LEDGER-NEG (over-draw chặn sớm).
    expect(() => planLedgerOut(lin, drawsSingle)).toThrow(/LEDGER-NEG/);
    // ledgerOk trực tiếp trên sổ âm cũng false (is_canonical fail + within_balance fail).
    const badOut = ledger([BUCKET_OPS, -100n]);
    expect(ledgerOk(lin, badOut, drawsSingle)).toBe(false);
  });

  it("reject xóa dòng in không cạn về 0 (drain sổ ngược)", () => {
    const lin = ledger([BUCKET_OPS, 1000n], [BUCKET_COMMUNITY, 800n]);
    const lout = ledger([BUCKET_OPS, 700n]);           // mất dòng community (vẫn còn 800)
    expect(ledgerOk(lin, lout, drawsSingle)).toBe(false);
  });

  it("PRUNE dòng cạn về 0 (in − draw == 0) — each_in_line_settled cho phép", () => {
    // bucket ops có ĐÚNG 300, rút 300 → dòng cạn về 0 → prune (vắng khỏi out) hợp lệ.
    const lin = ledger([BUCKET_OPS, 300n], [BUCKET_COMMUNITY, 800n]);
    const lout = planLedgerOut(lin, drawsSingle);      // ops bị prune, còn community 800
    expect(lout).toEqual(ledger([BUCKET_COMMUNITY, 800n]));
    expect(ledgerOk(lin, lout, drawsSingle)).toBe(true);
  });

  it("ledger_out CANONICAL: sort theo khóa + reject dòng 0/chưa sort", () => {
    // sổ out không sort (bucket 2 trước 1) → is_canonical fail → ledgerOk false.
    const lin = ledger([BUCKET_OPS, 1000n], [BUCKET_COMMUNITY, 800n]);
    const unsorted = ledger([BUCKET_COMMUNITY, 300n], [BUCKET_OPS, 700n]);
    expect(ledgerOk(lin, unsorted, drawsMulti)).toBe(false);
    // dòng 0 còn sót (chưa prune) → is_canonical fail.
    const withZero: LedgerEntry[] = [
      { bucket_id: BUCKET_OPS, policy: LAMP_POLICY, name: LAMP_NAME, amount: 0n },
    ];
    const linOps = ledger([BUCKET_OPS, 300n]);
    expect(ledgerOk(linOps, withZero, drawsSingle)).toBe(false);
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
    const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    const plan = planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 11n);
    expect(plan.specHash).toBe(spec);
    expect(plan.custodyAfter[LAMP_KEY]).toBe(4700n);
    expect(plan.newDatum.ledger).toEqual(ledger([BUCKET_OPS, 700n]));
    expect(plan.newDatum.epoch).toBe(11n);
    expect(plan.recipients).toHaveLength(1);
    expect(plan.recipients[0]!.value[LAMP_KEY]).toBe(300n);
  });

  it("F2: reject draws rỗng (planRelease draws=[]) → C-REL-013", () => {
    // proposal rỗng chỉ nhồi consumed_proposals (phình datum) mà không chi gì.
    // Mirror custody.ak `expect draws != []`. specHash của [] khớp proposal tương ứng
    // nhưng vẫn PHẢI reject sớm bởi guard draws.length === 0.
    const specEmpty = spendSpecHash(INSTANCE_ID, []);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(specEmpty), [], CUST_SH, 5n, 11n),
    ).toThrow(/RELEASE-013/);
  });

  it("reject chưa Executed (status=Tallied) → C-REL-2", () => {
    const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec, "Tallied"), drawsSingle, CUST_SH, 5n),
    ).toThrow(/RELEASE-002/);
  });

  it("reject spend_spec_hash lệch (draws ≠ duyệt) → C-REL-3", () => {
    const approvedSpec = spendSpecHash(INSTANCE_ID, drawsSingle);     // proposal duyệt draw 300
    const actual = [drawLamp(BUCKET_OPS, 500n, ALICE)];  // caller rút 500
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(approvedSpec), actual, CUST_SH, 5n),
    ).toThrow(/RELEASE-003/);
  });

  it("reject trước time-lock (epoch < execute_after) → C-REL-8", () => {
    const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 3n),
    ).toThrow(/RELEASE-008/);
  });

  it("reject over-draw bucket → C-REL-6", () => {
    const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
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
    const spec = spendSpecHash(INSTANCE_ID, bad);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), bad, CUST_SH, 5n),
    ).toThrow(/RELEASE-007a/);
  });

  it("reject epoch lùi → RELEASE-009", () => {
    const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
    const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 9n),
    ).toThrow(/RELEASE-009/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 7. HARDENING v1 — NFT authenticity (C-NFT) + governance_ref (#1A) + epoch neo
// ════════════════════════════════════════════════════════════════════════
const SEED_POLICY = "11ee".repeat(14);            // PolicyId NFT authenticity
const GOV_REF = "9999";                            // = custodyDatum.governance_ref
const nftKey = assetKey(SEED_POLICY, "abcd");      // instance_id = "abcd"

describe("planRelease guards: NFT authenticity (C-NFT)", () => {
  const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
  const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));

  it("happy: cust_in MANG NFT (seed_policy, instance_id) qty 1 → plan đúng", () => {
    const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n, [nftKey]: 1n };
    const plan = planRelease(
      datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 11n,
      { seedPolicy: SEED_POLICY },
    );
    // NFT bảo toàn vào custody output (Σout=Σin, draw không đụng NFT).
    expect(plan.custodyAfter[nftKey]).toBe(1n);
    expect(plan.custodyAfter[LAMP_KEY]).toBe(4700n);
  });

  it("reject: cust_in THIẾU NFT → RELEASE-NFT", () => {
    const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n }; // không NFT
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 11n, { seedPolicy: SEED_POLICY }),
    ).toThrow(/RELEASE-NFT/);
  });

  it("reject: NFT qty ≠ 1 (qty 2) → RELEASE-NFT", () => {
    const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n, [nftKey]: 2n };
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 11n, { seedPolicy: SEED_POLICY }),
    ).toThrow(/RELEASE-NFT/);
  });
});

describe("planRelease guards: proposal Ở ĐÚNG governance_ref (#1A)", () => {
  const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
  const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));
  const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n };

  it("happy: proposal script hash == governance_ref → plan đúng", () => {
    const plan = planRelease(
      datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 11n,
      { proposalScriptHash: GOV_REF },
    );
    expect(plan.newDatum.ledger).toEqual(ledger([BUCKET_OPS, 700n]));
  });

  it("reject: proposal script hash ≠ governance_ref → RELEASE-001 (fail-fast)", () => {
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, 5n, 11n, { proposalScriptHash: "deadbeef" }),
    ).toThrow(/RELEASE-001/);
  });
});

describe("epoch neo từ validity (C-EPOCH) — out.epoch = ⌊validFromMs/msPerEpoch⌋", () => {
  const spec = spendSpecHash(INSTANCE_ID, drawsSingle);
  const datum = custodyDatum(ledger([BUCKET_OPS, 1000n]));        // datum.epoch = 10
  const valueIn = { [ADA_KEY]: 5_000_000n, [LAMP_KEY]: 5000n };

  it("epoch out suy từ currentEpoch (builder dùng ⌊validFromMs/msPerEpoch⌋)", () => {
    const MS_PER_EPOCH = 432_000_000n;             // 5 ngày (Cardano epoch)
    const validFromMs = 12n * MS_PER_EPOCH + 123_456n;  // epoch 12
    const currentEpoch = validFromMs / MS_PER_EPOCH;     // ⌊⌋ = 12 (= builder)
    expect(currentEpoch).toBe(12n);
    // builder gọi planRelease(..., currentEpoch, currentEpoch) → out.epoch == 12.
    const plan = planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, currentEpoch, currentEpoch);
    expect(plan.newDatum.epoch).toBe(12n);
    expect(plan.newDatum.epoch >= datum.epoch).toBe(true);  // ≥ in.epoch (10)
  });

  it("reject nếu epoch neo < in.epoch (chống lùi)", () => {
    const MS_PER_EPOCH = 432_000_000n;
    const validFromMs = 3n * MS_PER_EPOCH;          // epoch 3 < datum.epoch 10
    const currentEpoch = validFromMs / MS_PER_EPOCH;     // = 3
    // time-lock execute_after=4 > 3 → RELEASE-008 chặn trước (epoch quá sớm).
    expect(() =>
      planRelease(datum, valueIn, proposal(spec), drawsSingle, CUST_SH, currentEpoch, currentEpoch),
    ).toThrow(/RELEASE-008|RELEASE-009/);
  });
});
