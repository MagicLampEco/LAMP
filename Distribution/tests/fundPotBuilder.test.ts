// fundPotBuilder — rót trọn phân bổ pot từ kho (`Distribution/FundPot.md` v1.0). KHÔNG submit
// (mock tx-builder). Pot dùng trong bài: Wakeme — ngân sách lấy từ sổ `pots.ts`, suất D =
// 1.001 tLAMP, datum inline `4100` (Wakeme xác nhận 2026-10-03). Mọi policy/hash khác là FAKE_*.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, keyHashToCredential, toUnit, Data,
} from "@lucid-evolution/lucid";
import type { UTxO, Validator } from "@lucid-evolution/lucid";

import {
  buildFundPotTx, splitPotOutputs, assertPotOutputAmounts, fundPotOutputFailures,
  type FundPotParams, type FundPotOutputShape,
} from "../offchain/src/fundPotBuilder.js";
import { treasuryDatumToCbor, TREASURY_REDEEMER } from "../offchain/src/datum.js";
import { TREASURY_NFT_ASSET_NAME } from "../offchain/src/constants.js";
import { potBudgetOildrop } from "../offchain/src/pots.js";

interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer: string }[];
  attach:      Validator[];
  mint:        unknown[];
  payData:     { address: string; datum: string; assets: Record<string, bigint> }[];
  signers:     string[];
}

function mockLucid(): { lucid: any; rec: Recorded } {
  const rec: Recorded = { collectFrom: [], attach: [], mint: [], payData: [], signers: [] };
  const txb: any = {
    collectFrom(utxos: UTxO[], redeemer: string) { rec.collectFrom.push({ utxos, redeemer }); return txb; },
    mintAssets(a: unknown) { rec.mint.push(a); return txb; },
    attach: { SpendingValidator(v: Validator) { rec.attach.push(v); return txb; } },
    pay: {
      ToAddressWithData(address: string, datum: { kind: string; value: string }, assets: Record<string, bigint>) {
        rec.payData.push({ address, datum: datum.value, assets }); return txb;
      },
    },
    addSignerKey(k: string) { rec.signers.push(k); return txb; },
    async complete() { return { __mockTx: true }; },
  };
  return { lucid: { newTx() { return txb; } }, rec };
}

const NETWORK = "Preprod" as const;
const FAKE_TREASURY: Validator = { type: "PlutusV3", script: "49480100002221200102" };
const TRE_HASH = validatorToScriptHash(FAKE_TREASURY);
const TRE_ADDR = credentialToAddress(NETWORK, scriptHashToCredential(TRE_HASH));
const FAKE_LAMP_POLICY = "aa".repeat(28);
const LAMP_UNIT = toUnit(FAKE_LAMP_POLICY, "744c414d50");
const FAKE_TREASURY_POLICY = "bb".repeat(28);
const TREASURY_UNIT = toUnit(FAKE_TREASURY_POLICY, TREASURY_NFT_ASSET_NAME);
const FAKE_CH = "cc".repeat(28);
const CLAIM_HASH = "ee".repeat(28);
const POT_HASH = "dd".repeat(28);
const POT_ADDR = credentialToAddress(NETWORK, scriptHashToCredential(POT_HASH));
const WALLET_ADDR = credentialToAddress(NETWORK, keyHashToCredential("ab".repeat(28)));
const WAKEME_DATUM = "4100";

const BUDGET = potBudgetOildrop("wakeme");          // 1.001.000.000 tLAMP
const D = 1_001_000_000n;                            // 1.001 tLAMP
const POOL = 2n * BUDGET;
const DEBT = 500_000_000_000_000n;

function treDatum(outstanding: bigint, totalRedeemed = 7n): string {
  return treasuryDatumToCbor({ committee_hash: FAKE_CH, outstanding_entitlement: outstanding, total_redeemed: totalRedeemed });
}

function carrier(over: Partial<UTxO> = {}, extra: Record<string, bigint> = {}): UTxO {
  return {
    txHash: "11".repeat(32), outputIndex: 0, address: TRE_ADDR,
    assets: { lovelace: 5_000_000n, [LAMP_UNIT]: POOL, [TREASURY_UNIT]: 1n, ...extra },
    datum: treDatum(DEBT), datumHash: undefined, scriptRef: undefined,
    ...over,
  } as UTxO;
}

function params(lucid: any, over: Partial<FundPotParams> = {}): FundPotParams {
  return {
    lucid, treasuryUtxo: carrier(), treasuryScript: FAKE_TREASURY,
    committeeSigners: [FAKE_CH], committeeThreshold: 1,
    lampPolicyId: FAKE_LAMP_POLICY, treasuryNftPolicy: FAKE_TREASURY_POLICY,
    claimAccountHash: CLAIM_HASH, potId: "wakeme",
    pot: { address: POT_ADDR, scriptHash: POT_HASH, datumCbor: WAKEME_DATUM },
    amountOildrop: BUDGET, potShareOildrop: D,
    outputAmounts: splitPotOutputs(BUDGET, D, 3),
    ...over,
  };
}

describe("splitPotOutputs / assertPotOutputAmounts", () => {
  it("K = 3: tổng đúng, mỗi phần là bội của D, chênh nhau tối đa một suất", () => {
    const xs = splitPotOutputs(BUDGET, D, 3);
    expect(xs).toHaveLength(3);
    expect(xs.reduce((s, x) => s + x, 0n)).toBe(BUDGET);
    for (const x of xs) expect(x % D).toBe(0n);
    expect(xs).toEqual([333_334n * D, 333_333n * D, 333_333n * D]);
  });
  it("lượng rót không phải bội của D ⇒ ném", () => {
    expect(() => splitPotOutputs(BUDGET + 1n, D, 3)).toThrow(/FPB-003/);
  });
  it("output lệch bội D (tổng vẫn đúng) ⇒ ném", () => {
    expect(() => assertPotOutputAmounts([333_334n * D + 1n, 333_333n * D - 1n, 333_333n * D], BUDGET, D))
      .toThrow(/FPB-003.*không phải bội/);
  });
  it("output < D ⇒ ném", () => {
    expect(() => assertPotOutputAmounts([D - 1n, BUDGET - D + 1n], BUDGET, D)).toThrow(/FPB-003/);
  });
  it("tổng ≠ amount ⇒ ném", () => {
    expect(() => assertPotOutputAmounts([D, D], 3n * D, D)).toThrow(/FPB-002/);
  });
  it("K = 0 ⇒ ném", () => {
    expect(() => splitPotOutputs(BUDGET, D, 0)).toThrow(/FPB-002/);
  });
});

describe("buildFundPotTx — ca dương K = 3 (Wakeme)", () => {
  it("1 input carrier với FundPot = Constr 3; carrier ra y nguyên trừ LAMP; 3 output pot datum 4100", async () => {
    const { lucid, rec } = mockLucid();
    const r = await buildFundPotTx(params(lucid));
    expect(rec.collectFrom).toHaveLength(1);
    expect(rec.collectFrom[0]!.utxos).toHaveLength(1);
    const red = Data.from(rec.collectFrom[0]!.redeemer) as any;
    expect(red.index).toBe(TREASURY_REDEEMER.FundPot);
    expect(red.index).toBe(3);
    expect(rec.mint).toHaveLength(0);
    expect(rec.payData).toHaveLength(4);
    const [c, ...pots] = rec.payData;
    expect(c!.address).toBe(TRE_ADDR);
    expect(c!.datum).toBe(treDatum(DEBT));
    expect(c!.assets).toEqual({ lovelace: 5_000_000n, [LAMP_UNIT]: POOL - BUDGET, [TREASURY_UNIT]: 1n });
    for (const p of pots) {
      expect(p.address).toBe(POT_ADDR);
      expect(p.datum).toBe(WAKEME_DATUM);
      expect(p.assets[LAMP_UNIT]! % D).toBe(0n);
      expect(Object.keys(p.assets).sort()).toEqual([LAMP_UNIT, "lovelace"].sort());
    }
    expect(pots.reduce((s, p) => s + p.assets[LAMP_UNIT]!, 0n)).toBe(BUDGET);
    expect(rec.signers).toEqual([FAKE_CH]);
    expect(r.funded).toBe(BUDGET);
    expect(r.lampAfter).toBe(POOL - BUDGET);
  });
});

describe("buildFundPotTx — ca âm", () => {
  const run = (over: Partial<FundPotParams>) => buildFundPotTx(params(mockLucid().lucid, over));

  it("FPB-001 lượng rót ≠ ngân sách pot trong sổ", async () => {
    await expect(run({ amountOildrop: BUDGET - D, outputAmounts: splitPotOutputs(BUDGET - D, D, 3) })).rejects.toThrow(/FPB-001/);
  });
  it("FPB-001 lượt mồi một suất ⇒ qua; phần còn lại sau mồi ⇒ qua", async () => {
    const boot = await run({ bootstrap: true, amountOildrop: D, outputAmounts: [D] });
    expect(boot.funded).toBe(D);
    const rest = await run({ fundedBeforeOildrop: D, amountOildrop: BUDGET - D, outputAmounts: splitPotOutputs(BUDGET - D, D, 3) });
    expect(rest.funded).toBe(BUDGET - D);
  });
  it("FPB-001 lượt mồi hai suất ⇒ ném", async () => {
    await expect(run({ bootstrap: true, amountOildrop: 2n * D, outputAmounts: [2n * D] })).rejects.toThrow(/FPB-001.*mồi/);
  });
  it("FPB-001 lượt mồi khi pot đã rót trước ⇒ ném", async () => {
    await expect(run({ bootstrap: true, fundedBeforeOildrop: D, amountOildrop: D, outputAmounts: [D] })).rejects.toThrow(/FPB-001.*mồi/);
  });
  it("FPB-001 sau mồi mà rót trọn ngân sách (đếm hai lần suất mồi) ⇒ ném", async () => {
    await expect(run({ fundedBeforeOildrop: D })).rejects.toThrow(/FPB-001.*phần còn lại/);
  });
  it("FPB-001 đã rót trước ≥ ngân sách ⇒ ném", async () => {
    await expect(run({ fundedBeforeOildrop: BUDGET, amountOildrop: D, outputAmounts: [D] })).rejects.toThrow(/FPB-001.*đã rót trước/);
  });
  it("FPB-003 output lệch bội D", async () => {
    await expect(run({ outputAmounts: [333_334n * D + 1n, 333_333n * D - 1n, 333_333n * D] })).rejects.toThrow(/FPB-003/);
  });
  it("FPB-004 pot ở địa chỉ VK (FP-5a)", async () => {
    await expect(run({ pot: { address: WALLET_ADDR, scriptHash: POT_HASH, datumCbor: WAKEME_DATUM } })).rejects.toThrow(/FPB-004/);
  });
  it("FPB-004 hash khai lệch hash trong địa chỉ", async () => {
    await expect(run({ pot: { address: POT_ADDR, scriptHash: "d0".repeat(28), datumCbor: WAKEME_DATUM } })).rejects.toThrow(/FPB-004/);
  });
  it("FPB-005 pot là claim_account (FP-5b)", async () => {
    const a = credentialToAddress(NETWORK, scriptHashToCredential(CLAIM_HASH));
    await expect(run({ pot: { address: a, scriptHash: CLAIM_HASH, datumCbor: WAKEME_DATUM } })).rejects.toThrow(/FPB-005.*claim_account/);
  });
  it("FPB-005 pot là chính kho (FP-5b)", async () => {
    await expect(run({ pot: { address: TRE_ADDR, scriptHash: TRE_HASH, datumCbor: WAKEME_DATUM } })).rejects.toThrow(/FPB-005.*kho/);
  });
  it("FPB-006 datum pot không giải mã được (FP-5c)", async () => {
    await expect(run({ pot: { address: POT_ADDR, scriptHash: POT_HASH, datumCbor: "ff" } })).rejects.toThrow(/FPB-006/);
  });
  it("FPB-007 carrier không mang TREASURY (FP-2)", async () => {
    const u = carrier();
    delete (u.assets as any)[TREASURY_UNIT];
    await expect(run({ treasuryUtxo: u })).rejects.toThrow(/FPB-007/);
  });
  it("FPB-007 carrier mang thêm TREASURY trùng tên policy khác (FP-2)", async () => {
    await expect(run({ treasuryUtxo: carrier({}, { [toUnit("99".repeat(28), TREASURY_NFT_ASSET_NAME)]: 1n }) }))
      .rejects.toThrow(/FPB-007.*2 đơn vị/);
  });
  it("FPB-008 nợ > pool sau rót (FP-6)", async () => {
    await expect(run({ treasuryUtxo: carrier({ datum: treDatum(POOL - BUDGET + 1n) }) })).rejects.toThrow(/FPB-008/);
  });
  it("FPB-008 biên: nợ == pool sau rót thì dựng được", async () => {
    await expect(run({ treasuryUtxo: carrier({ datum: treDatum(POOL - BUDGET) }) })).resolves.toBeDefined();
  });
  it("FPB-009 thiếu chữ ký (khoá trùng không tính hai lần) (FP-1)", async () => {
    await expect(run({ committeeSigners: [FAKE_CH, FAKE_CH.toUpperCase()], committeeThreshold: 2 })).rejects.toThrow(/FPB-009/);
  });
});

describe("fundPotOutputFailures — đọc lại giao dịch đã dựng (FPB-010)", () => {
  const amounts = splitPotOutputs(BUDGET, D, 3);
  const expectCtx = {
    treasuryAddress: TRE_ADDR, treasuryHash: TRE_HASH, claimAccountHash: CLAIM_HASH, lampUnit: LAMP_UNIT,
    carrierAssets: { lovelace: 5_000_000n, [LAMP_UNIT]: POOL - BUDGET, [TREASURY_UNIT]: 1n },
    carrierDatumCbor: treDatum(DEBT), carrierLovelaceIn: 5_000_000n,
    pot: { address: POT_ADDR, scriptHash: POT_HASH, datumCbor: WAKEME_DATUM },
    potShareOildrop: D, outputAmounts: amounts,
  };
  const good = (): FundPotOutputShape[] => [
    { address: TRE_ADDR, assets: { ...expectCtx.carrierAssets }, datum: treDatum(DEBT) },
    ...amounts.map((a) => ({ address: POT_ADDR, assets: { lovelace: 2_000_000n, [LAMP_UNIT]: a }, datum: WAKEME_DATUM })),
    { address: WALLET_ADDR, assets: { lovelace: 10_000_000n } },
  ];

  it("hình dạng đúng ⇒ rỗng", () => {
    expect(fundPotOutputFailures(good(), expectCtx)).toEqual([]);
  });
  it("tiền thối VK mang LAMP (ví trả phí bằng UTxO có LAMP) ⇒ FP-5a", () => {
    const o = good();
    o[4] = { address: WALLET_ADDR, assets: { lovelace: 10_000_000n, [LAMP_UNIT]: 5n } };
    expect(fundPotOutputFailures(o, expectCtx).join(" | ")).toMatch(/FP-5a/);
  });
  it("output pot không datum ⇒ FP-5c", () => {
    const o = good();
    o[1] = { ...o[1]!, datum: undefined };
    expect(fundPotOutputFailures(o, expectCtx).join(" | ")).toMatch(/FP-5c/);
  });
  it("datum carrier đổi ⇒ FP-3", () => {
    const o = good();
    o[0] = { ...o[0]!, datum: treDatum(DEBT, 8n) };
    expect(fundPotOutputFailures(o, expectCtx).join(" | ")).toMatch(/FP-3/);
  });
  it("output pot lệch bội D (tổng giữ nguyên) ⇒ báo", () => {
    const o = good();
    o[1] = { ...o[1]!, assets: { lovelace: 2_000_000n, [LAMP_UNIT]: amounts[0]! + 1n } };
    o[2] = { ...o[2]!, assets: { lovelace: 2_000_000n, [LAMP_UNIT]: amounts[1]! - 1n } };
    expect(fundPotOutputFailures(o, expectCtx).join(" | ")).toMatch(/bội/);
  });
});
