// Phần tính toán thuần của `scripts/04_e2e.ts` (Issue #77) — KHÔNG mạng, KHÔNG ví.
//
// Runner e2e không chạy được trong bộ kiểm (nó cần Blockfrost + ví), nên những quyết định
// của nó được tách ra `scripts/e2ePlan.ts` và kiểm ở đây. Mỗi nhóm ca dưới đây nối kết quả
// của hàm kế hoạch THẲNG vào builder thật (tx-builder giả), vì lỗi của #77 không nằm ở
// builder — builder đã từ chối đúng — mà nằm ở hình dạng tham số runner đưa vào.

import { describe, it, expect } from "vitest";
import { credentialToAddress, scriptHashToCredential, validatorToScriptHash, toUnit } from "@lucid-evolution/lucid";
import type { UTxO, Validator } from "@lucid-evolution/lucid";

import { buildClaimTx } from "../offchain/src/claimBuilder.js";
import { buildPostBeaconTx } from "../offchain/src/beaconBuilder.js";
import { claimAccountDatumToCbor, beaconDatumToCbor, treasuryDatumToCbor } from "../offchain/src/datum.js";
import { TREASURY_NFT_ASSET_NAME, epochWindow } from "../offchain/src/constants.js";
import type { ClaimAccountDatum } from "../offchain/src/types.js";
import {
  windowNow, grantTimeParams, redeemTimeParams,
  planGrant, planBeacon, planRedeem, accountDatumMismatches,
} from "../scripts/e2ePlan.js";
import { lampOildrop } from "./helpers.js";

const MSPE = 432_000_000n;
const NETWORK = "Preview" as const;
const OWNER = "aabbccddeeff00112233445566778899aabbccddeeff001122334455";
const COMMITTEE = ["11".repeat(28), "22".repeat(28), "33".repeat(28)];
const FAKE_CLAIM:    Validator = { type: "PlutusV3", script: "49480100002221200101" };
const FAKE_TREASURY: Validator = { type: "PlutusV3", script: "49480100002221200102" };
const FAKE_BEACON:   Validator = { type: "PlutusV3", script: "49480100002221200103" };
const FAKE_ACC_NFT:  Validator = { type: "PlutusV3", script: "49480100002221200104" };
const TRSY_POLICY = "ab".repeat(28);
const TRSY_UNIT = toUnit(TRSY_POLICY, TREASURY_NFT_ASSET_NAME);
const BEACON_POLICY = "cd".repeat(28);
const BEACON_UNIT = toUnit(BEACON_POLICY, "44524f50");
const D = lampOildrop(100n);

const addr = (v: Validator) =>
  credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));

function mockLucid() {
  const rec = { validFrom: [] as number[], validTo: [] as number[] };
  const txb: any = {
    collectFrom: () => txb, mintAssets: () => txb, readFrom: () => txb,
    attach: { SpendingValidator: () => txb, MintingPolicy: () => txb },
    pay: { ToAddressWithData: () => txb, ToAddress: () => txb },
    addSignerKey: () => txb,
    validFrom(ms: number) { rec.validFrom.push(ms); return txb; },
    validTo(ms: number) { rec.validTo.push(ms); return txb; },
    async complete() { return { __mockTx: true }; },
  };
  return { lucid: { newTx: () => txb, wallet: () => ({ address: async () => "addr_wallet" }) } as any, rec };
}

function treasury(outstanding: bigint) {
  const utxo: UTxO = {
    txHash: "33".repeat(32), outputIndex: 0, address: addr(FAKE_TREASURY),
    assets: { lovelace: 5_000_000n, [TRSY_UNIT]: 1n },
    datum: treasuryDatumToCbor({ committee_hash: "ee".repeat(28), outstanding_entitlement: outstanding }),
  };
  return { utxo, script: FAKE_TREASURY, nftPolicy: TRSY_POLICY };
}

function account(over: Partial<ClaimAccountDatum> = {}): ClaimAccountDatum {
  return {
    owner: OWNER, entitlement: lampOildrop(250n), redeemed: 0n,
    start_epoch: 100n, drops_per_epoch: 1n, ...over,
  };
}

function accountUtxo(d: ClaimAccountDatum): UTxO {
  return {
    txHash: "11".repeat(32), outputIndex: 0, address: addr(FAKE_CLAIM),
    assets: { lovelace: 2_000_000n }, datum: claimAccountDatumToCbor(d),
  };
}

// ── Điểm 2: cửa sổ lấy từ epochWindow, lăn qua giữa các bước thì NÉM ──────────
describe("windowNow — một lượt chạy, một cửa sổ", () => {
  it("cùng cửa sổ: trả đúng epochWindow", () => {
    const now = 100n * MSPE + MSPE / 2n;
    expect(windowNow(MSPE, 100n, now)).toEqual(epochWindow(MSPE, now));
  });

  it("ms cuối cùng của cửa sổ vẫn qua; ms kế tiếp NÉM WINDOW-001", () => {
    expect(windowNow(MSPE, 100n, 101n * MSPE - 1n).epoch).toBe(100n);
    expect(() => windowNow(MSPE, 100n, 101n * MSPE)).toThrow(/WINDOW-001/);
  });
});

// ── Điểm 1: grant truyền CẢ HAI đầu — nối thẳng vào buildClaimTx ──────────────
describe("grantTimeParams — builder nhận được, tx mang cặp lo/hi cùng cửa sổ", () => {
  // Giữa cửa sổ: lo = now − 60 s ≠ biên cửa sổ, nên phân biệt được với `epoch · mspe` cũ.
  const w = epochWindow(MSPE, 100n * MSPE + MSPE / 2n);

  it("CREATE: không ném CREATE-002, start_epoch = cửa sổ, validTo = hi", async () => {
    const { lucid, rec } = mockLucid();
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: lampOildrop(250n),
      accountNft: { script: FAKE_ACC_NFT }, treasury: treasury(0n), committeeKeyHashes: COMMITTEE,
      ...grantTimeParams(w),
    });
    expect(rec.validFrom).toEqual([Number(w.loMs)]);
    expect(rec.validTo).toEqual([Number(w.hiMs)]);
    expect(res.newDatum.start_epoch).toBe(w.epoch);
  });

  it("UPDATE: cùng luật (CREATE-002 nay áp cả UPDATE)", async () => {
    const { lucid, rec } = mockLucid();
    const prev = account({ start_epoch: 100n });
    await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: lampOildrop(250n),
      claimAccountUtxo: accountUtxo(prev), treasury: treasury(prev.entitlement), committeeKeyHashes: COMMITTEE,
      ...grantTimeParams(w),
    });
    expect(rec.validTo).toEqual([Number(w.hiMs)]);
  });

  it("redeemTimeParams: đầu dưới nằm TRONG cửa sổ (≥ biên), không phải epoch·mspe cố định", () => {
    const r = redeemTimeParams(w);
    expect(r.currentEpoch).toBe(w.epoch);
    expect(r.validFromMs).toBe(w.loMs);
  });
});

// ── Điểm 4: beacon mang msPerEpoch + currentDropValue ────────────────────────
describe("planBeacon — nhãn = cửa sổ, D cũ đọc từ datum trên chuỗi", () => {
  function beaconUtxo(epoch: bigint, dropValue: bigint): UTxO {
    return {
      txHash: "cd".repeat(32), outputIndex: 0, address: addr(FAKE_BEACON),
      assets: { lovelace: 2_000_000n, [BEACON_UNIT]: 1n },
      datum: beaconDatumToCbor({ epoch, kind: "DropParam", drop_value: dropValue }),
    };
  }

  it("cửa sổ chưa post: kế hoạch post, builder đặt lo/hi (msPerEpoch đã truyền)", async () => {
    const w = epochWindow(MSPE);
    const onChain = { epoch: w.epoch - 1n, kind: "DropParam" as const, drop_value: D };
    const plan = planBeacon({ onChain, window: w, dropValue: D, msPerEpoch: MSPE });
    expect(plan.action).toBe("post");
    if (plan.action !== "post") return;
    expect(plan.params.currentDropValue).toBe(D);
    const { lucid, rec } = mockLucid();
    await buildPostBeaconTx({
      lucid, beaconUtxo: beaconUtxo(onChain.epoch, D), beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: BEACON_POLICY, committeeKeyHashes: COMMITTEE, ...plan.params,
    });
    expect(rec.validTo).toHaveLength(1);
  });

  // Ca phủ định: lỗi luật C-BCN-5 phải ĐI RA, không bị kế hoạch nuốt hay né.
  it("D lệch > 10% so với D trên chuỗi: builder ném BEACON-005", async () => {
    const w = epochWindow(MSPE);
    const onChain = { epoch: w.epoch - 1n, kind: "DropParam" as const, drop_value: D };
    const plan = planBeacon({ onChain, window: w, dropValue: lampOildrop(120n), msPerEpoch: MSPE });
    if (plan.action !== "post") throw new Error("kỳ vọng post");
    const { lucid } = mockLucid();
    await expect(buildPostBeaconTx({
      lucid, beaconUtxo: beaconUtxo(onChain.epoch, D), beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: BEACON_POLICY, committeeKeyHashes: COMMITTEE, ...plan.params,
    })).rejects.toThrow(/BEACON-005/);
  });

  it("cửa sổ này đã post: bỏ qua (C-BCN-2/3 chỉ cho một lượt mỗi cửa sổ)", () => {
    const w = epochWindow(MSPE, 100n * MSPE + 1n);
    const plan = planBeacon({
      onChain: { epoch: 100n, kind: "DropParam", drop_value: D }, window: w, dropValue: D, msPerEpoch: MSPE,
    });
    expect(plan.action).toBe("skip");
  });

  it("nhãn trên chuỗi ở TƯƠNG LAI: ném E2E-BCN-001, không bỏ qua im lặng", () => {
    const w = epochWindow(MSPE, 100n * MSPE + 1n);
    expect(() => planBeacon({
      onChain: { epoch: 101n, kind: "DropParam", drop_value: D }, window: w, dropValue: D, msPerEpoch: MSPE,
    })).toThrow(/E2E-BCN-001/);
  });
});

// ── Cấp thêm = REBASE: kế hoạch grant + datum kỳ vọng ────────────────────────
describe("planGrant — CREATE / TOPUP rebase / bỏ qua khi còn phần rút được", () => {
  it("chưa có tài khoản: CREATE, datum kỳ vọng = builder", async () => {
    const w = epochWindow(MSPE, 100n * MSPE + 5_000n);
    const plan = planGrant({ account: null, ownerPkh: OWNER.toUpperCase(), amount: lampOildrop(250n), dropValue: D, windowEpoch: w.epoch });
    expect(plan.action).toBe("create");
    if (plan.action === "skip") return;
    const { lucid } = mockLucid();
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: lampOildrop(250n),
      accountNft: { script: FAKE_ACC_NFT }, treasury: treasury(0n), committeeKeyHashes: COMMITTEE,
      ...grantTimeParams(w),
    });
    expect(accountDatumMismatches(plan.expected, res.newDatum)).toEqual([]);
  });

  it("tài khoản mở trong CHÍNH cửa sổ này (chưa vest gì): TOPUP, E' = E − redeemed + amount", async () => {
    const w = epochWindow(MSPE, 100n * MSPE + 5_000n);
    const prev = account({ start_epoch: 100n });
    const plan = planGrant({ account: prev, ownerPkh: OWNER, amount: lampOildrop(250n), dropValue: D, windowEpoch: w.epoch });
    expect(plan.action).toBe("topup");
    if (plan.action !== "topup") return;
    expect(plan.expected).toEqual({ ...prev, entitlement: lampOildrop(500n), redeemed: 0n, start_epoch: 100n });
    const { lucid } = mockLucid();
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: lampOildrop(250n),
      claimAccountUtxo: accountUtxo(prev), treasury: treasury(prev.entitlement), committeeKeyHashes: COMMITTEE,
      ...grantTimeParams(w),
    });
    expect(accountDatumMismatches(plan.expected, res.newDatum)).toEqual([]);
  });

  it("đã rút hết (E == redeemed) ở cửa sổ cũ: TOPUP mở lô mới từ cửa sổ này", () => {
    const prev = account({ start_epoch: 90n, redeemed: lampOildrop(250n) });
    const plan = planGrant({ account: prev, ownerPkh: OWNER, amount: lampOildrop(250n), dropValue: D, windowEpoch: 100n });
    expect(plan.action).toBe("topup");
    if (plan.action !== "topup") return;
    expect(plan.expected).toEqual({ ...prev, entitlement: lampOildrop(250n), redeemed: 0n, start_epoch: 100n });
  });

  // Ca đo được rebase xoá tiến độ: tài khoản đã vest 100 LAMP chưa rút. Cấp thêm lúc này thì
  // 100 LAMP đó phải vest lại, và runner cũ (luôn cấp) làm bước redeem cùng lượt KHÔNG BAO GIỜ
  // rút được gì — mỗi lượt chạy lại dời mốc về cửa sổ hiện tại.
  it("còn phần rút được: BỎ QUA grant, báo đúng số đang chờ rút", () => {
    const prev = account({ start_epoch: 99n });
    const plan = planGrant({ account: prev, ownerPkh: OWNER, amount: lampOildrop(250n), dropValue: D, windowEpoch: 100n });
    expect(plan).toEqual({ action: "skip", pending: D });
  });

  it("mốc tài khoản ở TƯƠNG LAI hoặc owner lệch: ném, không đoán", () => {
    expect(() => planGrant({ account: account({ start_epoch: 101n }), ownerPkh: OWNER, amount: 1n, dropValue: D, windowEpoch: 100n }))
      .toThrow(/E2E-GRANT-001/);
    expect(() => planGrant({ account: account(), ownerPkh: "00".repeat(28), amount: 1n, dropValue: D, windowEpoch: 100n }))
      .toThrow(/E2E-GRANT-002/);
  });
});

// ── Redeem: số kỳ vọng tính trên datum TRƯỚC, không giả định redeemed = 0 ──────
describe("planRedeem — redeemed' = redeemed + amount", () => {
  it("tài khoản đã rút một phần: kỳ vọng cộng dồn, KHÔNG phải = amount", () => {
    const prev = account({ entitlement: lampOildrop(1000n), start_epoch: 97n, redeemed: D });
    const plan = planRedeem(prev, D, 100n);
    expect(plan).toEqual({ action: "redeem", amount: 2n * D, expected: { ...prev, redeemed: 3n * D } });
  });

  it("cùng cửa sổ với mốc: chờ, và nói cửa sổ nào rút được", () => {
    expect(planRedeem(account({ start_epoch: 100n }), D, 100n)).toEqual({ action: "wait", fromEpoch: 101n });
  });

  it("đã vest trọn và rút trọn: exhausted, không phải wait", () => {
    const prev = account({ start_epoch: 0n, redeemed: lampOildrop(250n) });
    expect(planRedeem(prev, D, 100n)).toEqual({ action: "exhausted" });
  });
});

describe("accountDatumMismatches", () => {
  it("owner so không phân biệt hoa/thường và tiền tố 0x", () => {
    expect(accountDatumMismatches(account(), account({ owner: "0x" + OWNER.toUpperCase() }))).toEqual([]);
  });
  it("liệt kê đúng trường lệch", () => {
    const got = accountDatumMismatches(account(), account({ redeemed: 1n, start_epoch: 7n }));
    expect(got.map((s) => s.split(":")[0])).toEqual(["redeemed", "start_epoch"]);
  });
});
