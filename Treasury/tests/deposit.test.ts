import { describe, it, expect } from "vitest";
import { Constr, Data } from "@lucid-evolution/lucid";
import {
  type AssetMap, DEPOSIT_BPS, assetKey, depositItemsValid, itemCut,
} from "../offchain/src/collect.js";
import { planCollect } from "../offchain/src/collectBuilder.js";
import { planDeposit } from "../offchain/src/depositBuilder.js";
import {
  CUSTODY_REDEEMER, collectRedeemerToCbor, custodyRedeemerToCbor, decodeCustodyRedeemer,
  depositRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  MAX_LEDGER_LINES, RESERVE_INFLOW_BUCKET_ID, STAKE_REWARD_BUCKET_ID,
} from "../offchain/src/constants.js";
import type { CollectItem, CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

const LAMP_POLICY = "aabb".repeat(14);
const LAMP_NAME = "4c414d50";
const SEED = "5eed".repeat(14);
const INSTANCE = "01";
const lampK = assetKey(LAMP_POLICY, LAMP_NAME);
const adaK = assetKey("", "");
const nftK = assetKey(SEED, INSTANCE);

function baseDatum(over: Partial<CustodyDatum> = {}): CustodyDatum {
  return {
    instance_id: INSTANCE,
    accepted_assets: [
      { policy: "", name: "" },
      { policy: LAMP_POLICY, name: LAMP_NAME },
    ],
    ledger: [],
    // 10% — cố ý KHÁC 100% để phân biệt "ghi theo cut" với "ghi trọn".
    cut_bps: 1000n,
    governance_ref: "cafe",
    epoch: 5n,
    consumed_proposals: [],
    buckets: [0n, 1n, 2n],
    ...over,
  };
}

const lamp = (amount: bigint, category: bigint): CollectItem =>
  ({ app_id: "5c1c", policy: LAMP_POLICY, name: LAMP_NAME, amount, category });
const ada = (amount: bigint, category: bigint): CollectItem =>
  ({ app_id: "5c1c", policy: "", name: "", amount, category });
const line = (bucket_id: bigint, policy: string, name: string, amount: bigint): LedgerEntry =>
  ({ bucket_id, policy, name, amount });

const VALUE_IN: AssetMap = { [adaK]: 5_000_000n, [lampK]: 500n, [nftK]: 1n };

describe("DEPOSIT_BPS — nạp trọn, không làm tròn", () => {
  it("itemCut(amount, DEPOSIT_BPS) === amount", () => {
    for (const a of [1n, 7n, 9_999n, 123_456_789_012_345n]) expect(itemCut(a, DEPOSIT_BPS)).toBe(a);
  });
});

describe("planDeposit — ca dương", () => {
  it("LAMP 1000 vào sổ ĐỦ 1000 (Collect cùng lượng chỉ ghi 100)", () => {
    const d = baseDatum({ ledger: [line(1n, LAMP_POLICY, LAMP_NAME, 500n)] });
    const p = planDeposit(d, VALUE_IN, [lamp(1000n, 1n)], 6n, SEED);
    expect(p.newDatum.ledger).toEqual([line(1n, LAMP_POLICY, LAMP_NAME, 1500n)]);
    expect(p.custodyAfter[lampK]).toBe(1500n);
    expect(p.deposited).toEqual({ [lampK]: 1000n });

    const c = planCollect(d, VALUE_IN, [lamp(1000n, 1n)], 6n, SEED);
    expect(c.newDatum.ledger).toEqual([line(1n, LAMP_POLICY, LAMP_NAME, 600n)]);
  });

  it("ADA thưởng SRCL mở dòng mới; NFT + LAMP giữ nguyên", () => {
    const p = planDeposit(baseDatum(), VALUE_IN, [ada(7_000_000n, 2n)], 5n, SEED);
    expect(p.newDatum.ledger).toEqual([line(2n, "", "", 7_000_000n)]);
    expect(p.custodyAfter).toEqual({ [adaK]: 12_000_000n, [lampK]: 500n, [nftK]: 1n });
  });

  it("params instance bảo toàn, chỉ ledger + epoch đổi", () => {
    const d = baseDatum();
    const p = planDeposit(d, VALUE_IN, [lamp(3n, 0n)], 9n, SEED);
    expect({ ...p.newDatum, ledger: d.ledger, epoch: d.epoch }).toEqual(d);
    expect(p.newDatum.epoch).toBe(9n);
  });
});

describe("planDeposit — ca âm (mỗi ca đổi một điều)", () => {
  const d = baseDatum();
  const cases: Array<[string, () => unknown, RegExp]> = [
    ["amount 0", () => planDeposit(d, VALUE_IN, [lamp(0n, 1n)], 5n, SEED), /DEPOSIT-001/],
    ["amount âm", () => planDeposit(d, VALUE_IN, [lamp(-1n, 1n)], 5n, SEED), /DEPOSIT-001/],
    ["category chưa khai", () => planDeposit(d, VALUE_IN, [lamp(1n, 3n)], 5n, SEED), /DEPOSIT-001/],
    ["bucket Reserve", () =>
      planDeposit(d, VALUE_IN, [lamp(1n, RESERVE_INFLOW_BUCKET_ID)], 5n, SEED), /DEPOSIT-001/],
    ["bucket thưởng uỷ quyền", () =>
      planDeposit(d, VALUE_IN, [ada(1n, STAKE_REWARD_BUCKET_ID)], 5n, SEED), /DEPOSIT-001/],
    ["asset ngoài accepted", () => planDeposit(d, VALUE_IN,
      [{ app_id: "", policy: "cc".repeat(28), name: "", amount: 1n, category: 1n }], 5n, SEED),
      /DEPOSIT-001/],
    ["items rỗng", () => planDeposit(d, VALUE_IN, [], 5n, SEED), /DEPOSIT-011/],
    ["epoch lùi", () => planDeposit(d, VALUE_IN, [lamp(1n, 1n)], 4n, SEED), /DEPOSIT-002/],
    ["thiếu NFT", () => planDeposit(d, { [adaK]: 5_000_000n }, [lamp(1n, 1n)], 5n, SEED),
      /DEPOSIT-NFT/],
    ["seedPolicy sai dạng", () => planDeposit(d, VALUE_IN, [lamp(1n, 1n)], 5n, "5EED".repeat(14)),
      /DEPOSIT-SEED/],
  ];
  for (const [name, f, re] of cases) it(name, () => expect(f).toThrow(re));

  it("vượt trần số dòng sổ → DEPOSIT-003", () => {
    const buckets = Array.from({ length: Number(MAX_LEDGER_LINES) + 1 }, (_, i) => BigInt(i));
    const full = buckets.slice(0, Number(MAX_LEDGER_LINES))
      .map((b) => line(b, LAMP_POLICY, LAMP_NAME, 1n));
    const dd = baseDatum({ buckets, ledger: full });
    // Dòng đã có: vẫn nạp được.
    expect(() => planDeposit(dd, VALUE_IN, [lamp(1n, 0n)], 5n, SEED)).not.toThrow();
    // Dòng mới thứ MAX+1: từ chối.
    expect(() => planDeposit(dd, VALUE_IN, [lamp(1n, BigInt(MAX_LEDGER_LINES))], 5n, SEED))
      .toThrow(/DEPOSIT-003/);
  });
});

describe("depositItemsValid — chặt hơn allItemsValid đúng một vế", () => {
  it("amount 0: Collect nhận, Deposit từ chối", () => {
    const d = baseDatum();
    expect(depositItemsValid([lamp(0n, 1n)], d.accepted_assets, d.buckets)).toBe(false);
    expect(depositItemsValid([lamp(1n, 1n)], d.accepted_assets, d.buckets)).toBe(true);
  });
});

describe("Deposit redeemer = Constr 5", () => {
  const items = [lamp(1000n, 1n), ada(7n, 2n)];

  it("index 5, cùng thân với Collect (chỉ khác tag Constr)", () => {
    expect(CUSTODY_REDEEMER.Deposit).toBe(5);
    const dep = depositRedeemerToCbor(items);
    const col = collectRedeemerToCbor(items);
    // Constr 0 → tag 121 (d879); Constr 5 → tag 126 (d87e).
    expect(col.slice(0, 4)).toBe("d879");
    expect(dep.slice(0, 4)).toBe("d87e");
    expect(dep.slice(4)).toBe(col.slice(4));
    expect(custodyRedeemerToCbor({ kind: "Deposit", items })).toBe(dep);
  });

  it("round-trip qua decodeCustodyRedeemer", () => {
    const back = decodeCustodyRedeemer(Data.from(depositRedeemerToCbor(items)));
    expect(back).toEqual({ kind: "Deposit", items });
  });

  it("Deposit 2 trường → TDATUM-126", () => {
    expect(() => decodeCustodyRedeemer(new Constr(5, [[], []]))).toThrow(/TDATUM-126/);
  });
});
