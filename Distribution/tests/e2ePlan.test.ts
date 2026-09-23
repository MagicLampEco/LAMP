// Phần tính toán thuần của `scripts/04_e2e.ts` (Issue #77) — KHÔNG mạng, KHÔNG ví.
//
// Runner e2e không chạy được trong bộ kiểm (nó cần Blockfrost + ví), nên những quyết định
// của nó được tách ra `scripts/e2ePlan.ts` và kiểm ở đây. Mỗi nhóm ca dưới đây nối kết quả
// của hàm kế hoạch THẲNG vào builder thật (tx-builder giả), vì lỗi của #77 không nằm ở
// builder — builder đã từ chối đúng — mà nằm ở hình dạng tham số runner đưa vào.
//
// v3: kế hoạch không còn tính được từ `drop_value` một mình. Beacon cấp CHỈ SỐ CỘNG DỒN và
// κ; kho cấp `total_redeemed`. Nên mọi hàm kế hoạch nay nhận cả hai datum, và bài kiểm phải
// dựng cả hai — một fixture thiếu kho sẽ không còn biên dịch, đó là hình dạng đúng.

import { describe, it, expect } from "vitest";
import { credentialToAddress, scriptHashToCredential, validatorToScriptHash, toUnit } from "@lucid-evolution/lucid";
import type { UTxO, Validator } from "@lucid-evolution/lucid";

import { buildClaimTx } from "../offchain/src/claimBuilder.js";
import { buildPostBeaconTx } from "../offchain/src/beaconBuilder.js";
import { claimAccountDatumToCbor, beaconDatumToCbor, treasuryDatumToCbor } from "../offchain/src/datum.js";
import { TREASURY_NFT_ASSET_NAME, epochWindow } from "../offchain/src/constants.js";
import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "../offchain/src/types.js";
import { beaconIndexAt } from "../offchain/src/vested.js";
import {
  windowNow, grantTimeParams, redeemTimeParams,
  planGrant, planBeacon, planRedeem, accountDatumMismatches,
} from "../scripts/e2ePlan.js";
import { lampOildrop, TRIM_FLOOR } from "./helpers.js";

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

// E = 250.000 LAMP ⇒ √E = 500.000 CHẴN; rate_root = 100.000 ⇒ mỗi cửa sổ 50.000 LAMP,
// trọn sau 5 cửa sổ. Số chính phương là cố ý: kỳ vọng dưới đây kiểm được bằng tay.
const E          = lampOildrop(250_000n);
const RATE       = 100_000n;
const PER_WINDOW = lampOildrop(50_000n);

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

/** Beacon dán nhãn cửa sổ `epoch`, chỉ số tại đó = `index`. */
function bcnDatum(over: Partial<BeaconDatum> = {}): BeaconDatum {
  return {
    epoch: 100n, kind: "DropParam", index: 1_000_000n, rate_root: RATE,
    trim_num: 1n, trim_den: 1_000n, speed_policies: [],
    ...over,
  };
}

function beaconUtxo(d: BeaconDatum): UTxO {
  return {
    txHash: "cd".repeat(32), outputIndex: 0, address: addr(FAKE_BEACON),
    assets: { lovelace: 2_000_000n, [BEACON_UNIT]: 1n },
    datum: beaconDatumToCbor(d),
  };
}

/** Tham số `beacon` mà `buildClaimTx` v3 đòi (đổi HÌNH DẠNG giao dịch, không chỉ đổi số). */
function beaconParam(d: BeaconDatum) {
  return { utxo: beaconUtxo(d), datum: d };
}

function treDatum(outstanding: bigint, totalRedeemed = 0n): TreasuryDatum {
  return {
    committee_hash: "ee".repeat(28),
    outstanding_entitlement: outstanding,
    total_redeemed: totalRedeemed,
  };
}

function treasury(outstanding: bigint, totalRedeemed = 0n) {
  const utxo: UTxO = {
    txHash: "33".repeat(32), outputIndex: 0, address: addr(FAKE_TREASURY),
    assets: { lovelace: 5_000_000n, [TRSY_UNIT]: 1n },
    datum: treasuryDatumToCbor(treDatum(outstanding, totalRedeemed)),
  };
  return { utxo, script: FAKE_TREASURY, nftPolicy: TRSY_POLICY };
}

function account(over: Partial<ClaimAccountDatum> = {}): ClaimAccountDatum {
  return {
    owner: OWNER, entitlement: E, redeemed: 0n,
    start_epoch: 100n, drops_per_epoch: 1n,
    index_at_start: beaconIndexAt(bcnDatum(), 100n),
    ...over,
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
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: E,
      accountNft: { script: FAKE_ACC_NFT }, treasury: treasury(0n), committeeKeyHashes: COMMITTEE,
      beacon: beaconParam(bcnDatum()),
      ...grantTimeParams(w),
    });
    expect(rec.validFrom).toEqual([Number(w.loMs)]);
    expect(rec.validTo).toEqual([Number(w.hiMs)]);
    expect(res.newDatum.start_epoch).toBe(w.epoch);
  });

  it("CREATE ghim `index_at_start = A(cửa sổ này)` (C-CLAIM-8), không phải `index` của beacon", async () => {
    // Beacon dán nhãn cửa sổ 97, còn giao dịch chạy ở cửa sổ 100 ⇒ hai số KHÁC nhau. Một
    // fixture có beacon cùng cửa sổ thì hai bên trùng nhau ngẫu nhiên và ca này không kiểm gì.
    const b = bcnDatum({ epoch: 97n });
    const { lucid } = mockLucid();
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: E,
      accountNft: { script: FAKE_ACC_NFT }, treasury: treasury(0n), committeeKeyHashes: COMMITTEE,
      beacon: beaconParam(b),
      ...grantTimeParams(w),
    });
    expect(res.newDatum.index_at_start).toBe(beaconIndexAt(b, w.epoch));
    expect(res.newDatum.index_at_start).not.toBe(b.index);
  });

  it("UPDATE: cùng luật (CREATE-002 nay áp cả UPDATE)", async () => {
    const { lucid, rec } = mockLucid();
    const prev = account({ start_epoch: 100n });
    await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: E,
      claimAccountUtxo: accountUtxo(prev), treasury: treasury(prev.entitlement),
      committeeKeyHashes: COMMITTEE, beacon: beaconParam(bcnDatum()),
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

// ── Điểm 4: beacon mang msPerEpoch + beacon cũ ───────────────────────────────
describe("planBeacon — nhãn = cửa sổ, chỉ số mới SINH RA từ beacon cũ", () => {
  it("cửa sổ chưa post: kế hoạch post, builder đặt lo/hi (msPerEpoch đã truyền)", async () => {
    const w = epochWindow(MSPE);
    const onChain = bcnDatum({ epoch: w.epoch - 1n });
    const plan = planBeacon({ onChain, window: w, rateRoot: RATE, msPerEpoch: MSPE });
    expect(plan.action).toBe("post");
    if (plan.action !== "post") return;
    expect(plan.params.currentBeacon).toEqual(onChain);
    const { lucid, rec } = mockLucid();
    await buildPostBeaconTx({
      lucid, beaconUtxo: beaconUtxo(onChain), beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: BEACON_POLICY, committeeKeyHashes: COMMITTEE, ...plan.params,
    });
    expect(rec.validTo).toHaveLength(1);
  });

  it("C-BCN-6: `index` mới = index cũ + rate_root CŨ · số cửa sổ trôi qua", () => {
    // Quá khứ được định giá bằng tốc độ CŨ, kể cả khi lượt post này nâng tốc độ.
    const w = epochWindow(MSPE);
    const onChain = bcnDatum({ epoch: w.epoch - 3n, index: 42n, rate_root: 1_000n });
    const plan = planBeacon({ onChain, window: w, rateRoot: 1_100n, msPerEpoch: MSPE });
    if (plan.action !== "post") throw new Error("kỳ vọng post");
    expect(plan.params.newBeacon.index).toBe(42n + 1_000n * 3n);   // KHÔNG dùng 1.100
    expect(plan.params.newBeacon.rate_root).toBe(1_100n);
  });

  it("κ mặc định MANG THEO từ beacon cũ — lượt post thường không được đổi trần", () => {
    const w = epochWindow(MSPE);
    const onChain = bcnDatum({ epoch: w.epoch - 1n, trim_num: 3n, trim_den: 7n });
    const plan = planBeacon({ onChain, window: w, rateRoot: RATE, msPerEpoch: MSPE });
    if (plan.action !== "post") throw new Error("kỳ vọng post");
    expect(plan.params.newBeacon.trim_num).toBe(3n);
    expect(plan.params.newBeacon.trim_den).toBe(7n);
  });

  // Ca phủ định: lỗi luật C-BCN-5a phải ĐI RA, không bị kế hoạch nuốt hay né.
  it("rate_root lệch > 10% so với trên chuỗi: builder ném BEACON-005", async () => {
    const w = epochWindow(MSPE);
    const onChain = bcnDatum({ epoch: w.epoch - 1n });
    const plan = planBeacon({ onChain, window: w, rateRoot: RATE * 12n / 10n, msPerEpoch: MSPE });
    if (plan.action !== "post") throw new Error("kỳ vọng post");
    const { lucid } = mockLucid();
    await expect(buildPostBeaconTx({
      lucid, beaconUtxo: beaconUtxo(onChain), beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: BEACON_POLICY, committeeKeyHashes: COMMITTEE, ...plan.params,
    })).rejects.toThrow(/BEACON-005/);
  });

  it("rate_root HẠ: builder ném BEACON-008 (C-BCN-5' một chiều)", async () => {
    // Chiều này mới là chiều viết lại quá khứ, và nó KHÔNG bị ±10% bắt — `abs_diff` của v2
    // đối xứng nên nó cho phép hạ 10% mỗi lượt. Đây là ca ghim chỗ đó.
    const w = epochWindow(MSPE);
    const onChain = bcnDatum({ epoch: w.epoch - 1n });
    const plan = planBeacon({ onChain, window: w, rateRoot: RATE * 95n / 100n, msPerEpoch: MSPE });
    if (plan.action !== "post") throw new Error("kỳ vọng post");
    const { lucid } = mockLucid();
    await expect(buildPostBeaconTx({
      lucid, beaconUtxo: beaconUtxo(onChain), beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: BEACON_POLICY, committeeKeyHashes: COMMITTEE, ...plan.params,
    })).rejects.toThrow(/BEACON-008/);
  });

  it("cửa sổ này đã post: bỏ qua (C-BCN-2/3 chỉ cho một lượt mỗi cửa sổ)", () => {
    const w = epochWindow(MSPE, 100n * MSPE + 1n);
    const plan = planBeacon({ onChain: bcnDatum({ epoch: 100n }), window: w, rateRoot: RATE, msPerEpoch: MSPE });
    expect(plan.action).toBe("skip");
  });

  it("nhãn trên chuỗi ở TƯƠNG LAI: ném E2E-BCN-001, không bỏ qua im lặng", () => {
    const w = epochWindow(MSPE, 100n * MSPE + 1n);
    expect(() => planBeacon({
      onChain: bcnDatum({ epoch: 101n }), window: w, rateRoot: RATE, msPerEpoch: MSPE,
    })).toThrow(/E2E-BCN-001/);
  });
});

// ── Cấp thêm = REBASE: kế hoạch grant + datum kỳ vọng ────────────────────────
describe("planGrant — CREATE / TOPUP rebase / bỏ qua khi còn phần rút được", () => {
  const B = bcnDatum({ epoch: 97n });      // beacon cũ hơn cửa sổ ⇒ A(t) ≠ index

  it("chưa có tài khoản: CREATE, datum kỳ vọng = builder", async () => {
    const w = epochWindow(MSPE, 100n * MSPE + 5_000n);
    const plan = planGrant({
      account: null, ownerPkh: OWNER.toUpperCase(), amount: E,
      beacon: B, treasury: treDatum(0n), windowEpoch: w.epoch,
    });
    expect(plan.action).toBe("create");
    if (plan.action === "skip") return;
    const { lucid } = mockLucid();
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: E,
      accountNft: { script: FAKE_ACC_NFT }, treasury: treasury(0n), committeeKeyHashes: COMMITTEE,
      beacon: beaconParam(B),
      ...grantTimeParams(w),
    });
    // `accountDatumMismatches` nay so CẢ `index_at_start` — nếu kế hoạch và builder tính mốc
    // chỉ số ở hai chỗ khác nhau thì chính ca này đỏ.
    expect(accountDatumMismatches(plan.expected, res.newDatum)).toEqual([]);
  });

  // Ca chạy lại runner trong cùng cửa sổ: bản trước ra TOPUP ở đây và cấp chồng mỗi lần chạy.
  it("tài khoản mở trong CHÍNH cửa sổ này (chưa vest gì): BỎ QUA, không cấp chồng", () => {
    const prev = account({ index_at_start: beaconIndexAt(B, 100n) });
    const plan = planGrant({
      account: prev, ownerPkh: OWNER, amount: E,
      beacon: B, treasury: treDatum(E), windowEpoch: 100n,
    });
    expect(plan).toEqual({ action: "skip", pending: 0n });
  });

  it("đã rút hết phần đã vest mà lô chưa trọn: BỎ QUA, không rebase", () => {
    const prev = account({
      index_at_start: beaconIndexAt(B, 99n), redeemed: PER_WINDOW,
    });
    const plan = planGrant({
      account: prev, ownerPkh: OWNER, amount: E,
      beacon: B, treasury: treDatum(E), windowEpoch: 100n,
    });
    expect(plan).toEqual({ action: "skip", pending: 0n });
  });

  it("đã rút TRỌN (E == redeemed): TOPUP mở lô mới từ cửa sổ này, datum kỳ vọng = builder", async () => {
    const w = epochWindow(MSPE, 100n * MSPE + 5_000n);
    const prev = account({ index_at_start: beaconIndexAt(B, 90n), redeemed: E });
    const plan = planGrant({
      account: prev, ownerPkh: OWNER, amount: E,
      beacon: B, treasury: treDatum(0n), windowEpoch: w.epoch,
    });
    expect(plan.action).toBe("topup");
    if (plan.action !== "topup") return;
    expect(plan.expected).toEqual({
      ...prev, entitlement: E, redeemed: 0n, start_epoch: 100n,
      index_at_start: beaconIndexAt(B, 100n),     // mốc chỉ số cũng đặt lại (C-CLAIM-8)
    });
    const { lucid } = mockLucid();
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER, amount: E,
      claimAccountUtxo: accountUtxo(prev), treasury: treasury(prev.entitlement - prev.redeemed),
      committeeKeyHashes: COMMITTEE, beacon: beaconParam(B),
      ...grantTimeParams(w),
    });
    expect(accountDatumMismatches(plan.expected, res.newDatum)).toEqual([]);
  });

  it("còn phần rút được: BỎ QUA grant, và số đang chờ đã TRỪ trần một lượt", () => {
    // Tài khoản mở ở cửa sổ 99, xét ở 100 ⇒ vest 50.000 LAMP. Nhưng `total_redeemed = 0`
    // nên trần một lượt = SÀN = 1.000 LAMP. `pending` phải báo số RÚT ĐƯỢC LƯỢT NÀY, không
    // báo số đã vest — nếu không runner in ra một con số mà bước redeem không đạt tới.
    const prev = account({ index_at_start: beaconIndexAt(B, 99n) });
    const plan = planGrant({
      account: prev, ownerPkh: OWNER, amount: E,
      beacon: B, treasury: treDatum(E), windowEpoch: 100n,
    });
    expect(plan).toEqual({ action: "skip", pending: TRIM_FLOOR });
  });

  it("mốc tài khoản ở TƯƠNG LAI hoặc owner lệch: ném, không đoán", () => {
    expect(() => planGrant({
      account: account({ start_epoch: 101n }), ownerPkh: OWNER, amount: 1n,
      beacon: B, treasury: treDatum(E), windowEpoch: 100n,
    })).toThrow(/E2E-GRANT-001/);
    expect(() => planGrant({
      account: account(), ownerPkh: "00".repeat(28), amount: 1n,
      beacon: B, treasury: treDatum(E), windowEpoch: 100n,
    })).toThrow(/E2E-GRANT-002/);
  });
});

// ── Redeem: số kỳ vọng tính trên datum TRƯỚC, không giả định redeemed = 0 ──────
describe("planRedeem — redeemed' = redeemed + amount", () => {
  const B = bcnDatum({ epoch: 97n });
  const WIDE = bcnDatum({ epoch: 97n, trim_num: 1n, trim_den: 1n });   // trần rộng
  const RICH = treDatum(E, lampOildrop(10_000_000n));                  // trần rộng thật sự

  it("tài khoản đã rút một phần: kỳ vọng cộng dồn, KHÔNG phải = amount", () => {
    const prev = account({ index_at_start: beaconIndexAt(B, 97n), redeemed: PER_WINDOW });
    const plan = planRedeem(prev, WIDE, RICH, 100n);
    expect(plan).toEqual({
      action: "redeem", amount: 2n * PER_WINDOW, trimmed: 0n,
      expected: { ...prev, redeemed: 3n * PER_WINDOW },
    });
  });

  it("trần CHẠM: `amount` bị cắt, `trimmed` nói ra phần còn chờ — không im lặng", () => {
    const prev = account({ index_at_start: beaconIndexAt(B, 97n) });
    const plan = planRedeem(prev, B, treDatum(E, 0n), 100n);
    if (plan.action !== "redeem") throw new Error("kỳ vọng redeem");
    expect(plan.amount).toBe(TRIM_FLOOR);
    expect(plan.trimmed).toBe(3n * PER_WINDOW - TRIM_FLOOR);
    expect(plan.expected.redeemed).toBe(TRIM_FLOOR);
  });

  it("cùng cửa sổ với mốc chỉ số: chờ, và nói cửa sổ nào rút được", () => {
    const prev = account({ index_at_start: beaconIndexAt(B, 100n) });
    expect(planRedeem(prev, B, RICH, 100n)).toEqual({ action: "wait", fromEpoch: 101n });
  });

  it("đã rút hết phần đã vest: cửa sổ chờ tính từ CHỈ SỐ, không từ `start_epoch`", () => {
    // redeemed = 4·PER_WINDOW. Mốc ở cửa sổ 100, xét ở 102 ⇒ câu trả lời khác "cửa sổ kế",
    // nên một bản trả `windowEpoch + 1` sẽ đỏ ở đây và xanh ở ca trên.
    //
    // Đáp số là 105, KHÔNG phải 104 — và một cửa sổ chênh ở đây là một lượt chạy hỏng.
    // Tại cửa sổ 104 thì `A_span = 4·RATE` cho `vested = 4·PER_WINDOW` BẰNG ĐÚNG `redeemed`,
    // mà điều kiện rút là `vested > redeemed` (chặt), không phải `≥`. Nên `minSpanForProgress`
    // giải `dpe²·E·span² ≥ (redeemed+1)²` rồi mới làm tròn lên số cửa sổ. Bài kiểm này
    // TỪNG kỳ vọng 104, và chính hiện thực bác lại — ghi nguyên chỗ đó ra đây để lần sau
    // không ai "sửa" hiện thực cho khớp một kỳ vọng sai.
    const prev = account({
      index_at_start: beaconIndexAt(B, 100n), redeemed: 4n * PER_WINDOW,
    });
    expect(planRedeem(prev, B, RICH, 102n)).toEqual({ action: "wait", fromEpoch: 105n });
    // Đối chứng cho câu trên: ở 104 thật sự chưa rút được, ở 105 thì rút được.
    expect(planRedeem(prev, B, RICH, 104n).action).toBe("wait");
    expect(planRedeem(prev, B, RICH, 105n).action).toBe("redeem");
  });

  it("`rate_root = 0`: stalled, không in một cửa sổ bịa", () => {
    const flat = bcnDatum({ epoch: 97n, rate_root: 0n });
    const prev = account({ index_at_start: beaconIndexAt(flat, 100n) });
    expect(planRedeem(prev, flat, RICH, 105n)).toEqual({ action: "stalled" });
  });

  it("`drops_per_epoch = 0`: stalled — chỉ số chạy nhưng không mở khoá gì", () => {
    const prev = account({ index_at_start: beaconIndexAt(B, 100n), drops_per_epoch: 0n });
    expect(planRedeem(prev, B, RICH, 105n)).toEqual({ action: "stalled" });
  });

  it("đã vest trọn và rút trọn: exhausted, không phải wait", () => {
    const prev = account({ index_at_start: beaconIndexAt(B, 90n), redeemed: E });
    expect(planRedeem(prev, B, RICH, 100n)).toEqual({ action: "exhausted" });
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
  it("BẮT lệch `index_at_start` — trường quyết định trọn lịch mở khoá ở v3", () => {
    const got = accountDatumMismatches(account(), account({ index_at_start: 1n }));
    expect(got.map((s) => s.split(":")[0])).toEqual(["index_at_start"]);
  });
});
