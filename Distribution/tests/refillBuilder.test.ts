// refillBuilder — gộp N UTxO kho về singleton. KHÔNG submit thật (mock tx-builder).
//
// Ca số 1 dựng ĐÚNG hình dạng đang kẹt trên Preprod (đo 2026-09-15 qua Koios): hai UTxO, một
// mang TRSY và 0 oildrop, một mang 10.000.000.000 oildrop và không TRSY. Nếu ca đó đỏ thì giao
// dịch cứu kho không dựng được. (Địa chỉ/policy id dùng trong bài này đều là FAKE_* dựng riêng
// cho bài kiểm — Issue #78: PR #75 đổi script hash `treasury`, địa chỉ kho thật gõ cứng trước
// đây từng làm bài xanh giả qua lần đổi đó dù không đối chiếu gì với chuỗi thật.)

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit, Data,
} from "@lucid-evolution/lucid";
import type { UTxO, Validator } from "@lucid-evolution/lucid";

import { buildRefillTx, bearsForeignTreasuryName } from "../offchain/src/refillBuilder.js";
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

// FAKE_LAMP_POLICY / FAKE_TRSY_POLICY / FAKE_CH — `buildRefillTx` nhận cả ba qua tham số
// (`lampPolicyId`, `treasuryNftPolicy`, `committeeSigners`) và chỉ so khớp NỘI BỘ giữa các
// fixture trong chính bài kiểm này; không đối chiếu với blueprint hay committee thật nào. Chỉ
// cần đúng HÌNH DẠNG (56 hex = 28 byte, như policy id / pkh thật). Trước đây ba hằng này gõ
// cứng giá trị THẬT của cụm Preprod cũ — trôi im lặng khi cụm đổi (Issue #78), dù không hằng
// nào ảnh hưởng tới việc bài kiểm đúng hay sai.
const FAKE_LAMP_POLICY = "aa".repeat(28);
const LAMP_UNIT         = toUnit(FAKE_LAMP_POLICY, "744c414d50");
const FAKE_TRSY_POLICY = "bb".repeat(28);
const TRSY_UNIT         = toUnit(FAKE_TRSY_POLICY, TREASURY_NFT_ASSET_NAME);

/** pkh giả cho committee 1-of-1 trong bài kiểm — chỉ cần đúng hình dạng 56 hex. */
const FAKE_CH = "cc".repeat(28);

function treDatum(outstanding: bigint, ch = FAKE_CH, totalRedeemed = 0n): string {
  return treasuryDatumToCbor({
    committee_hash: ch,
    outstanding_entitlement: outstanding,
    total_redeemed: totalRedeemed,
  });
}

/**
 * Policy GIẢ đúc tài sản TRÙNG TÊN "TRSY". `treasury.ak` ▸ `bears_treasury_nft` nhận carrier theo
 * TÊN, nên một UTxO mang nó ở địa chỉ kho là carrier thứ hai trong mắt chuỗi.
 */
const FAKE_OTHER_TRSY_POLICY = "dd".repeat(28);
const FOREIGN_TRSY_UNIT      = toUnit(FAKE_OTHER_TRSY_POLICY, TREASURY_NFT_ASSET_NAME);

/** UTxO ở địa chỉ kho. `datum: null` = hình dạng A-DEST hạ cánh. */
function utxo(opts: {
  ix: number; lovelace?: bigint; lamp?: bigint; trsy?: bigint;
  datum?: string | null; datumHash?: string; address?: string;
  extra?: Record<string, bigint>;
}): UTxO {
  const assets: Record<string, bigint> = { lovelace: opts.lovelace ?? 2_000_000n };
  if (opts.lamp) assets[LAMP_UNIT] = opts.lamp;
  if (opts.trsy) assets[TRSY_UNIT] = opts.trsy;
  Object.assign(assets, opts.extra ?? {});
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
    committeeSigners: [FAKE_CH],
    committeeThreshold: 1,
    lampPolicyId: FAKE_LAMP_POLICY,
    treasuryNftPolicy: FAKE_TRSY_POLICY,
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

    // `util.count_outputs_at_script == 1` — ĐÚNG 1 output ở script, và không trả gì ra ví.
    expect(rec.payData).toHaveLength(1);
    expect(rec.payAddr).toHaveLength(0);
    expect(rec.payData[0]!.address).toBe(TRE_ADDR);

    // `tre_out.value == value_in + deposited` — value ra = Σ value vào (deposited = 0).
    expect(rec.payData[0]!.assets).toEqual({
      lovelace: 4_000_000n, [TRSY_UNIT]: 1n, [LAMP_UNIT]: 10_000_000_000n,
    });

    // `assets.is_zero(tx.mint)` — Refill không đụng mint.
    expect(rec.mint).toHaveLength(0);

    // C-REF-PROV — sổ ra = sổ carrier.
    const d = decodeTreasuryDatum(Data.from(rec.payData[0]!.datum));
    expect(d.committee_hash).toBe(FAKE_CH);
    expect(d.outstanding_entitlement).toBe(0n);
    expect(d.total_redeemed).toBe(0n);

    // `util.committee_approved` — có chữ ký committee.
    expect(rec.signers).toEqual([FAKE_CH]);
    expect(r.merged).toBe(2);
    expect(r.excluded).toEqual([]);
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

  it("sổ ra = sổ CARRIER, không phải TỔNG, và không phải sổ của input đầu", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    // Input ĐẦU là UTxO không-carrier mang datum — nếu builder lấy "input đầu" hay "tổng" thì lệch.
    await buildRefillTx(baseParams(lucid, [
      utxo({ ix: 1, lamp: 100n, datum: treDatum(40n, FAKE_CH, 7n) }),
      utxo({ ix: 2, trsy: 1n, lamp: 900n, datum: treDatum(300n, FAKE_CH, 11n) }),
    ]));
    const d = decodeTreasuryDatum(Data.from(rec.payData[0]!.datum));
    expect(d.outstanding_entitlement).toBe(300n);
    expect(d.total_redeemed).toBe(11n);
    // value của input không-carrier VẪN được gộp — đó là việc Refill sinh ra để làm.
    expect(rec.payData[0]!.assets[LAMP_UNIT]).toBe(1_000n);
  });
});

// ── C-REF-PROV: người lạ đỗ UTxO ở địa chỉ kho KHÔNG chặn được Refill ──────
describe("buildRefillTx — UTxO lạ ở địa chỉ kho (griefing)", () => {
  const carrier = () =>
    utxo({ ix: 2, trsy: 1n, lamp: 1_000n, datum: treDatum(300n, FAKE_CH, 50n) });

  // Ca trọng tâm của RFL-BUILDER-SUM-01. Luật TỔNG cũ: sổ nợ ra = 300 + 10^20 > pool 1005 ⇒
  // builder ném RFL-009 (hoặc, nếu bỏ cổng, dựng tx mà chuỗi từ chối) ⇒ người lạ chặn Refill.
  it("UTxO lạ mang datum KHỐNG (nợ 10^20, đã-phát 10^24, committee_hash khác) ⇒ vẫn dựng, sổ ra = sổ carrier", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const khong = utxo({
      ix: 9, lamp: 5n,
      datum: treDatum(10n ** 20n, "cd".repeat(28), 10n ** 24n),
    });
    const r = await buildRefillTx(baseParams(lucid, [carrier(), khong]));
    expect(rec.collectFrom[0]!.utxos).toHaveLength(2);
    const d = decodeTreasuryDatum(Data.from(rec.payData[0]!.datum));
    expect(d.committee_hash).toBe(FAKE_CH);
    expect(d.outstanding_entitlement).toBe(300n);
    expect(d.total_redeemed).toBe(50n);
    expect(r.newTreasuryDatum).toEqual(d);
    expect(rec.payData[0]!.assets[LAMP_UNIT]).toBe(1_005n);
  });

  it("UTxO lạ mang số ÂM ở cả hai trường sổ ⇒ bỏ qua, không ném RFL-013/014", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const am = utxo({ ix: 9, datum: treDatum(-999_999n, FAKE_CH, -5n) });
    await buildRefillTx(baseParams(lucid, [carrier(), am]));
    const d = decodeTreasuryDatum(Data.from(rec.payData[0]!.datum));
    expect(d.outstanding_entitlement).toBe(300n);
    expect(d.total_redeemed).toBe(50n);
  });

  it("UTxO lạ mang inline datum RÁC (không phải TreasuryDatum) ⇒ bỏ qua, không ném RFL-012", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const rac = utxo({ ix: 9, lamp: 5n, datum: Data.to(42n) });
    await buildRefillTx(baseParams(lucid, [carrier(), rac]));
    expect(rec.collectFrom[0]!.utxos).toHaveLength(2);
  });

  it("UTxO lạ dùng DATUM-HASH ⇒ chuỗi bỏ qua datum, builder vẫn gộp (không ném RFL-006)", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const dh = utxo({ ix: 1, lamp: 5n, datum: null, datumHash: "ff".repeat(32) });
    await buildRefillTx(baseParams(lucid, [carrier(), dh]));
    expect(rec.collectFrom[0]!.utxos).toHaveLength(2);
  });

  // Chuỗi nhận carrier theo TÊN ⇒ gộp UTxO này là 2 carrier ⇒ `carrier_ledger` từ chối.
  it("UTxO mang 'TRSY' dưới policy GIẢ ⇒ KHÔNG bị collect, báo trong `excluded`, tx vẫn dựng", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const gia = utxo({
      ix: 5, lamp: 70n, datum: treDatum(10n ** 20n, FAKE_CH, 10n ** 24n),
      extra: { [FOREIGN_TRSY_UNIT]: 1n },
    });
    const r = await buildRefillTx(baseParams(lucid, [carrier(), gia]));
    const collected = rec.collectFrom[0]!.utxos;
    expect(collected).toHaveLength(1);
    expect(collected.some((u) => u.outputIndex === 5)).toBe(false);
    expect(rec.payData[0]!.assets[FOREIGN_TRSY_UNIT]).toBeUndefined();
    expect(rec.payData[0]!.assets[LAMP_UNIT]).toBe(1_000n);
    expect(r.merged).toBe(1);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]!.ref).toBe(`${"44".repeat(32)}#5`);
    expect(r.summary).toMatch(/KHÔNG gộp/);
  });

  it("UTxO mang 'TRSY' policy giả với qty ≠ 1 cũng bị loại", async () => {
    const { lucid, rec } = mockLucid("addr_op");
    const gia = utxo({ ix: 5, datum: null, extra: { [FOREIGN_TRSY_UNIT]: 3n } });
    const r = await buildRefillTx(baseParams(lucid, [carrier(), gia]));
    expect(rec.collectFrom[0]!.utxos).toHaveLength(1);
    expect(r.excluded).toHaveLength(1);
  });

  it("CHỈ có 'TRSY' policy giả, không carrier thật ⇒ RFL-003 (không nhận nhầm làm carrier)", async () => {
    const { lucid } = mockLucid("addr_op");
    const gia = utxo({ ix: 5, lamp: 70n, datum: treDatum(0n), extra: { [FOREIGN_TRSY_UNIT]: 1n } });
    await expect(buildRefillTx(baseParams(lucid, [gia]))).rejects.toThrow(/RFL-003/);
  });

  it("bearsForeignTreasuryName: TRSY thật ⇒ false, TRSY policy khác ⇒ true, tên khác ⇒ false", () => {
    expect(bearsForeignTreasuryName(carrier(), FAKE_TRSY_POLICY)).toBe(false);
    expect(bearsForeignTreasuryName(
      utxo({ ix: 1, extra: { [FOREIGN_TRSY_UNIT]: 1n } }), FAKE_TRSY_POLICY,
    )).toBe(true);
    expect(bearsForeignTreasuryName(
      utxo({ ix: 1, extra: { [toUnit(FAKE_OTHER_TRSY_POLICY, "54525358")]: 1n } }), FAKE_TRSY_POLICY,
    )).toBe(false);
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
  // khi chuỗi chỉ tiêu một lần ⇒ value ra ≠ Σ value vào, mất collateral.
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

  it("RFL-003: không input nào mang TRSY thật (kể cả khi mọi input đều có datum hợp lệ)", async () => {
    const { lucid } = mockLucid("addr_op");
    const a = utxo({ ix: 1, lamp: 10n, datum: treDatum(0n) });
    const b = utxo({ ix: 2, lamp: 20n, datum: treDatum(0n) });
    await expect(buildRefillTx(baseParams(lucid, [a, b]))).rejects.toThrow(/RFL-003/);
  });

  // One-shot policy nói ca này không thể có — nhưng state lỗi thì builder phải NÉM, không chọn đại.
  it("RFL-004: hai carrier TRSY thật ⇒ ném (carrier_ledger đòi đúng một)", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(baseParams(lucid, [
      carrier(), utxo({ ix: 3, trsy: 1n, datum: treDatum(0n) }),
    ]))).rejects.toThrow(/RFL-004/);
  });

  // Input mang TRSY thật với qty ≠ 1 không phải carrier (chuỗi đòi qty == 1) nhưng làm output
  // mang ≠ 1 TRSY ⇒ `claim_account` không đọc được kho.
  it("RFL-005: output sẽ mang ≠ 1 TRSY thật", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(baseParams(lucid, [carrier(), utxo({ ix: 3, trsy: 2n })])))
      .rejects.toThrow(/RFL-005/);
  });

  it("RFL-006: carrier dùng datum-hash — carrier_ledger đòi inline", async () => {
    const { lucid } = mockLucid("addr_op");
    const c = utxo({ ix: 2, trsy: 1n, datum: null, datumHash: "ff".repeat(32) });
    await expect(buildRefillTx(baseParams(lucid, [c]))).rejects.toThrow(/RFL-006/);
  });

  // Lucid ĐIỀN `datum` sau khi resolve preimage của datum-hash; chuỗi vẫn thấy DatumHash.
  it("RFL-006: carrier datum-hash dù `datum` đã được resolve — vẫn ném", async () => {
    const { lucid } = mockLucid("addr_op");
    const c = utxo({ ix: 2, trsy: 1n, datum: treDatum(0n), datumHash: "ff".repeat(32) });
    await expect(buildRefillTx(baseParams(lucid, [c]))).rejects.toThrow(/RFL-006/);
  });

  it("RFL-006: carrier không mang datum", async () => {
    const { lucid } = mockLucid("addr_op");
    const c = utxo({ ix: 2, trsy: 1n, datum: null });
    await expect(buildRefillTx(baseParams(lucid, [c]))).rejects.toThrow(/RFL-006/);
  });

  it("RFL-012: datum carrier không giải mã được thành TreasuryDatum", async () => {
    const { lucid } = mockLucid("addr_op");
    const c = utxo({ ix: 2, trsy: 1n, datum: Data.to(42n) });
    await expect(buildRefillTx(baseParams(lucid, [c]))).rejects.toThrow(/RFL-012/);
  });

  it("RFL-013: carrier khai outstanding_entitlement ÂM (C-REF-SIGN)", async () => {
    const { lucid } = mockLucid("addr_op");
    const c = utxo({ ix: 2, trsy: 1n, lamp: 10n, datum: treDatum(-1n) });
    await expect(buildRefillTx(baseParams(lucid, [c]))).rejects.toThrow(/RFL-013/);
  });

  it("RFL-013 không chặn biên = 0 — chỉ chặn ÂM, không chặn KHÔNG", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(baseParams(lucid, [carrier()]))).resolves.toBeDefined();
  });

  it("RFL-014: carrier khai total_redeemed ÂM (C-REF-SIGN)", async () => {
    const { lucid } = mockLucid("addr_op");
    const c = utxo({ ix: 2, trsy: 1n, lamp: 10n, datum: treDatum(0n, FAKE_CH, -1n) });
    await expect(buildRefillTx(baseParams(lucid, [c]))).rejects.toThrow(/RFL-014/);
  });

  it("RFL-007: depositOildrop âm — Refill không phải cửa rút", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(baseParams(lucid, [carrier()], { depositOildrop: -1n })))
      .rejects.toThrow(/RFL-007/);
  });

  it("RFL-008: thiếu người ký so với ngưỡng", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(
      baseParams(lucid, [carrier()], { committeeSigners: [FAKE_CH], committeeThreshold: 2 }),
    )).rejects.toThrow(/RFL-008/);
  });

  // `util.committee_approved` đếm thành viên committee PHÂN BIỆT có mặt trong signatories, không
  // đếm độ dài mảng. Hai khoá TRÙNG NHAU không được tính là hai người — nếu đếm PHẦN TỬ thì ca
  // này qua ở ngưỡng 2 trong khi chuỗi chỉ thấy 1 người ký ⇒ chuỗi từ chối, mất collateral.
  it("RFL-008: đếm NGƯỜI phân biệt, không đếm phần tử — khoá lặp lại không được tính hai lần", async () => {
    const { lucid } = mockLucid("addr_op");
    await expect(buildRefillTx(
      baseParams(lucid, [carrier()], { committeeSigners: [FAKE_CH, FAKE_CH], committeeThreshold: 2 }),
    )).rejects.toThrow(/RFL-008/);
  });

  it("RFL-009: sổ nợ carrier > pool ra", async () => {
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

  // LAMP của UTxO không-carrier ĐƯỢC tính vào pool ra (value gộp), dù datum của nó bị bỏ qua.
  it("RFL-009 tắt khi gộp thêm UTxO mang LAMP (không datum)", async () => {
    const { lucid } = mockLucid("addr_op");
    const a = utxo({ ix: 2, trsy: 1n, lamp: 10n, datum: treDatum(1_000n) });
    const loose = utxo({ ix: 3, lamp: 990n, datum: null });
    await expect(buildRefillTx(baseParams(lucid, [a, loose]))).resolves.toBeDefined();
  });
});
