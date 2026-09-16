// refillBuilder — gộp N UTxO kho về singleton. KHÔNG submit thật (mock tx-builder).
//
// Ca số 1 dựng ĐÚNG hình dạng đang kẹt trên Preprod (đo 2026-09-15 qua Koios,
// `addr_test1wqcnq8kkza7kw8409pt8ytywgeat4strz5sxt0g5wdl9a8q0r2v2g`): hai UTxO, một mang
// TRSY và 0 oildrop, một mang 10.000.000.000 oildrop và không TRSY. Nếu ca đó đỏ thì giao
// dịch cứu kho không dựng được.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit, Data,
} from "@lucid-evolution/lucid";
import type { UTxO, Validator } from "@lucid-evolution/lucid";

import { buildRefillTx } from "../offchain/src/refillBuilder.js";
import {
  treasuryDatumToCbor, decodeTreasuryDatum, TREASURY_REDEEMER,
} from "../offchain/src/datum.js";
import { TREASURY_NFT_ASSET_NAME } from "../offchain/src/constants.js";

// ── Mock Lucid tx-builder ──────────────────────────────────────────────
interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer: string }[];
  attach:      Validator[];
  mint:        { assets: Record<string, bigint>; redeemer: string }[];
  payData:     { address: string; datum: string; assets: Record<string, bigint> }[];
  payAddr:     { address: string; assets: Record<string, bigint> }[];
  signers:     string[];
}

function mockLucid(walletAddress: string): { lucid: any; rec: Recorded } {
  const rec: Recorded = {
    collectFrom: [], attach: [], mint: [], payData: [], payAddr: [], signers: [],
  };
  const txb: any = {
    collectFrom(utxos: UTxO[], redeemer: string) { rec.collectFrom.push({ utxos, redeemer }); return txb; },
    mintAssets(assets: Record<string, bigint>, redeemer: string) { rec.mint.push({ assets, redeemer }); return txb; },
    attach: { SpendingValidator(v: Validator) { rec.attach.push(v); return txb; } },
    readFrom() { return txb; },
    pay: {
      ToAddressWithData(address: string, datum: { kind: string; value: string }, assets: Record<string, bigint>) {
        rec.payData.push({ address, datum: datum.value, assets }); return txb;
      },
      ToAddress(address: string, assets: Record<string, bigint>) {
        rec.payAddr.push({ address, assets }); return txb;
      },
    },
    addSignerKey(k: string) { rec.signers.push(k); return txb; },
    validFrom() { return txb; },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = {
    newTx() { return txb; },
    wallet() { return { address: async () => walletAddress }; },
  };
  return { lucid, rec };
}

const NETWORK = "Preprod" as const;
const FAKE_TREASURY: Validator = { type: "PlutusV3", script: "49480100002221200102" };
const TRE_ADDR = credentialToAddress(
  NETWORK, scriptHashToCredential(validatorToScriptHash(FAKE_TREASURY)),
);

const LAMP_POLICY = "8169b76cdaba83cf7c9ae32ebd2bb3a58aa215c7dc0b62c8f5e268dd";
const LAMP_UNIT   = toUnit(LAMP_POLICY, "744c414d50");
const TRSY_POLICY = "09adb8c1f9b40befea28bddfd944625c7771a0a1f2e178d03953ff95";
const TRSY_UNIT   = toUnit(TRSY_POLICY, TREASURY_NFT_ASSET_NAME);

/** pkh ví vận hành Preprod — committee 1-of-1 (`_canonical_v2.ts:315-316`). */
const CH = "603249abe9bc29ea474777fc4cfc2f220a784a53e201b9b9afac5ff5";

function treDatum(outstanding: bigint, ch = CH): string {
  return treasuryDatumToCbor({ committee_hash: ch, outstanding_entitlement: outstanding });
}

/** UTxO ở địa chỉ kho. `datum: null` = hình dạng A-DEST hạ cánh. */
function utxo(opts: {
  ix: number; lovelace?: bigint; lamp?: bigint; trsy?: bigint;
  datum?: string | null; datumHash?: string; address?: string;
}): UTxO {
  const assets: Record<string, bigint> = { lovelace: opts.lovelace ?? 2_000_000n };
  if (opts.lamp) assets[LAMP_UNIT] = opts.lamp;
  if (opts.trsy) assets[TRSY_UNIT] = opts.trsy;
  const u: any = {
    txHash: "44".repeat(32), outputIndex: opts.ix,
    address: opts.address ?? TRE_ADDR,
    assets,
  };
  if (opts.datum !== null) u.datum = opts.datum ?? treDatum(0n);
  if (opts.datumHash) u.datumHash = opts.datumHash;
  return u as UTxO;
}

function baseParams(lucid: any, utxos: UTxO[], over: Record<string, unknown> = {}) {
  return {
    lucid,
    treasuryUtxos: utxos,
    treasuryScript: FAKE_TREASURY,
    committeeSigners: [CH],
    committeeThreshold: 1,
    lampPolicyId: LAMP_POLICY,
    treasuryNftPolicy: TRSY_POLICY,
    ...over,
  } as any;
}

// ── Ca gốc: đúng hình dạng Preprod đang kẹt ────────────────────────────
describe("buildRefillTx — gộp hai UTxO đúng hình dạng Preprod", () => {
  const carrier = () => utxo({ ix: 2, trsy: 1n, datum: treDatum(0n) });          // TRSY, 0 LAMP
  const pool    = () => utxo({ ix: 1, lamp: 10_000_000_000n, datum: treDatum(0n) }); // LAMP, không TRSY

  it("dựng đúng 1 output, gộp đủ value, redeemer Refill = Constr 2", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const r = await buildRefillTx(baseParams(lucid, [carrier(), pool()]));

    expect(rec.collectFrom).toHaveLength(1);
    expect(rec.collectFrom[0]!.utxos).toHaveLength(2);
    const red = Data.from(rec.collectFrom[0]!.redeemer) as any;
    expect(red.index).toBe(TREASURY_REDEEMER.Refill);
    expect(red.fields).toHaveLength(0);

    // `treasury.ak:198` — ĐÚNG 1 output ở script, và không trả gì ra ví.
    expect(rec.payData).toHaveLength(1);
    expect(rec.payAddr).toHaveLength(0);
    expect(rec.payData[0]!.address).toBe(TRE_ADDR);

    // `treasury.ak:232` — value ra = Σ value vào (deposited = 0).
    expect(rec.payData[0]!.assets).toEqual({
      lovelace: 4_000_000n, [TRSY_UNIT]: 1n, [LAMP_UNIT]: 10_000_000_000n,
    });

    // `treasury.ak:195` — Refill không đụng mint.
    expect(rec.mint).toHaveLength(0);

    // `:221` + `:224` — committee_hash bảo toàn, sổ cái = Σ vào = 0.
    const d = decodeTreasuryDatum(Data.from(rec.payData[0]!.datum));
    expect(d.committee_hash).toBe(CH);
    expect(d.outstanding_entitlement).toBe(0n);

    // `:192` — có chữ ký committee.
    expect(rec.signers).toEqual([CH]);
    expect(r.merged).toBe(2);
    expect(r.lampBefore).toBe(10_000_000_000n);
    expect(r.lampAfter).toBe(10_000_000_000n);
    expect(r.deposited).toBe(0n);
    // RFL-010 (script layer) đối chiếu số này với giao dịch ĐÃ DỰNG — phải đúng Σ lovelace vào.
    expect(r.outputLovelace).toBe(4_000_000n);
  });

  it("gộp được cả UTxO KHÔNG datum (hình dạng A-DEST hạ cánh)", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const adest = utxo({ ix: 7, lamp: 500n, datum: null });
    await buildRefillTx(baseParams(lucid, [carrier(), adest]));
    expect(rec.payData[0]!.assets[LAMP_UNIT]).toBe(500n);
    // sổ cái chỉ cộng input CÓ datum ⇒ vẫn 0, không phải undefined.
    expect(decodeTreasuryDatum(Data.from(rec.payData[0]!.datum)).outstanding_entitlement).toBe(0n);
  });

  it("nạp thêm LAMP: pool ra = pool vào + deposited", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const r = await buildRefillTx(
      baseParams(lucid, [carrier(), pool()], { depositOildrop: 250n }),
    );
    expect(r.deposited).toBe(250n);
    expect(r.lampAfter).toBe(10_000_000_250n);
    expect(rec.payData[0]!.assets[LAMP_UNIT]).toBe(10_000_000_250n);
  });

  it("sổ cái ra = TỔNG sổ cái vào, không phải sổ cái của input đầu", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    await buildRefillTx(baseParams(lucid, [
      utxo({ ix: 2, trsy: 1n, lamp: 900n, datum: treDatum(300n) }),
      utxo({ ix: 1, lamp: 100n, datum: treDatum(40n) }),
    ]));
    expect(decodeTreasuryDatum(Data.from(rec.payData[0]!.datum)).outstanding_entitlement)
      .toBe(340n);
  });
});

// ── Các cổng chặn sớm ──────────────────────────────────────────────────
describe("buildRefillTx — cổng chặn trước khi mất collateral", () => {
  const carrier = () => utxo({ ix: 2, trsy: 1n, datum: treDatum(0n) });

  it("RFL-001: tập input rỗng", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(baseParams(lucid, []))).rejects.toThrow(/RFL-001/);
  });

  // Input của một tx Cardano là một TẬP HỢP: nêu trùng thì `mergedAssets` cộng hai lần trong
  // khi chuỗi chỉ tiêu một lần ⇒ `treasury.ak:232` fail, mất collateral.
  it("RFL-011: cùng một UTxO được nêu hai lần trong tập gộp", async () => {
    const { lucid } = mockLucid("addr_op");
    const c = carrier();
    await expect(buildRefillTx(baseParams(lucid, [c, c]))).rejects.toThrow(/RFL-011/);
  });

  it("RFL-011 so khoá KHÔNG phân biệt hoa/thường của txHash", async () => {
    const { lucid } = mockLucid("addr_op");
    const a = utxo({ ix: 2, trsy: 1n, datum: treDatum(0n) });
    const b = { ...a, txHash: a.txHash.toUpperCase() } as UTxO;
    await expect(buildRefillTx(baseParams(lucid, [a, b]))).rejects.toThrow(/RFL-011/);
  });

  it("RFL-002: hai input khác địa chỉ (enterprise vs base cùng script hash)", async () => {
    const { lucid } = mockLucid("addr_op");
    const other = utxo({ ix: 1, lamp: 5n, address: TRE_ADDR + "x" });
    await expect(buildRefillTx(baseParams(lucid, [carrier(), other])))
      .rejects.toThrow(/RFL-002/);
  });

  it("RFL-003: không input nào mang datum", async () => {
    const { lucid } = mockLucid("addr_op");
    const a = utxo({ ix: 1, trsy: 1n, datum: null });
    const b = utxo({ ix: 2, lamp: 5n, datum: null });
    await expect(buildRefillTx(baseParams(lucid, [a, b]))).rejects.toThrow(/RFL-003/);
  });

  it("RFL-004: hai input khai committee_hash khác nhau", async () => {
    const { lucid } = mockLucid("addr_op");
    const other = utxo({ ix: 1, lamp: 5n, datum: treDatum(0n, "cd".repeat(28)) });
    await expect(buildRefillTx(baseParams(lucid, [carrier(), other])))
      .rejects.toThrow(/RFL-004/);
  });

  it("RFL-005: tập gộp KHÔNG mang TRSY ⇒ kho gộp xong không redeem được", async () => {
    const { lucid } = mockLucid("addr_op");
    const a = utxo({ ix: 1, lamp: 10n, datum: treDatum(0n) });
    const b = utxo({ ix: 2, lamp: 20n, datum: treDatum(0n) });
    await expect(buildRefillTx(baseParams(lucid, [a, b]))).rejects.toThrow(/RFL-005/);
  });

  it("RFL-005: hai TRSY ⇒ đang trộn hai kho", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(baseParams(lucid, [carrier(), utxo({ ix: 3, trsy: 1n })])))
      .rejects.toThrow(/RFL-005/);
  });

  // Người lạ đặt một UTxO mang inline datum KHÔNG PHẢI TreasuryDatum ở địa chỉ kho (khác hẳn
  // datum-hash của RFL-006 — đây có datum, chỉ là sai hình dạng). Không bọc thì lỗi ném ra là
  // `DATUM-001` trần trụi, không nói UTxO nào và không nói phải làm gì.
  it("RFL-012: input mang inline datum không giải mã được thành TreasuryDatum", async () => {
    const { lucid } = mockLucid("addr_op");
    const rac = utxo({ ix: 9, lamp: 5n, datum: Data.to(42n) }); // Int trần, không phải Constr
    await expect(buildRefillTx(baseParams(lucid, [carrier(), rac])))
      .rejects.toThrow(/RFL-012/);
  });

  it("RFL-006: input mang datum-hash — fold_ledger fail, không tx nào gộp được", async () => {
    const { lucid } = mockLucid("addr_op");
    const dh = utxo({ ix: 1, lamp: 5n, datum: null, datumHash: "ff".repeat(32) });
    await expect(buildRefillTx(baseParams(lucid, [carrier(), dh])))
      .rejects.toThrow(/RFL-006/);
  });

  it("RFL-007: depositOildrop âm — Refill không phải cửa rút", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(baseParams(lucid, [carrier()], { depositOildrop: -1n })))
      .rejects.toThrow(/RFL-007/);
  });

  it("RFL-008: thiếu người ký so với ngưỡng", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(
      baseParams(lucid, [carrier()], { committeeSigners: [CH], committeeThreshold: 2 }),
    )).rejects.toThrow(/RFL-008/);
  });

  // `util.ak:96,105` đếm thành viên committee PHÂN BIỆT có mặt trong signatories, không đếm độ
  // dài mảng. Hai khoá TRÙNG NHAU không được tính là hai người — nếu đếm PHẦN TỬ thì ca này qua
  // ở ngưỡng 2 trong khi chuỗi chỉ thấy 1 người ký ⇒ `treasury.ak:192` từ chối, mất collateral.
  it("RFL-008: đếm NGƯỜI phân biệt, không đếm phần tử — khoá lặp lại không được tính hai lần", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(
      baseParams(lucid, [carrier()], { committeeSigners: [CH, CH], committeeThreshold: 2 }),
    )).rejects.toThrow(/RFL-008/);
  });

  it("RFL-009: Σ sổ cái nợ > pool ra", async () => {
    const { lucid } = mockLucid("addr_op");
    const a = utxo({ ix: 2, trsy: 1n, lamp: 10n, datum: treDatum(1_000n) });
    await expect(buildRefillTx(baseParams(lucid, [a]))).rejects.toThrow(/RFL-009/);
  });

  it("RFL-009 tắt khi nạp đủ — cùng input, chỉ khác depositOildrop", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const a = utxo({ ix: 2, trsy: 1n, lamp: 10n, datum: treDatum(1_000n) });
    await buildRefillTx(baseParams(lucid, [a], { depositOildrop: 990n }));
    expect(rec.payData[0]!.assets[LAMP_UNIT]).toBe(1_000n);
  });
});
