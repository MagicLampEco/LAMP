// Lớp phủ UTxO cho chế độ nối chuỗi (`CHAIN_DEPTH` > 1) của `30_feeder_accounts.ts`.
//
// Ca đáng giữ nhất là "tiêu lại carrier cũ": đó đúng là lỗi "All inputs are spent" mà nối chuỗi
// sinh ra để tránh — lớp phủ phải từ chối dựng trên carrier đã tiêu TRƯỚC khi có gì lên mạng.
// Ca thứ hai là đối chiếu với Emulator của Lucid: hiệu ứng trích từ thân giao dịch thật phải ra
// ĐÚNG tập UTxO mà sổ cái ra sau khi block chứa cả chuỗi được đóng.
import { describe, it, expect } from "vitest";
import {
  Lucid, Emulator, generateEmulatorAccount, type UTxO,
} from "@lucid-evolution/lucid";

import {
  chainDepthFromEnv, CHAIN_DEPTH_MAX, makeView, applyTx, viewUtxosAt, viewUtxosAtWithUnit,
  viewCarrier, providerCaughtUp, spentByChain, chainWindowBlock, outRef, txEffects,
  type ChainView, type TxEffects,
} from "../scripts/_chainOverlay.js";
import { pickTreasury } from "../scripts/_distributionScripts.js";
import { epochWindow } from "../../Distribution/offchain/src/constants.js";
import { WINDOW_ORIGIN_MS_BY_NETWORK } from "../../Utils/src/index.js";

const H = (c: string) => c.repeat(64);
const WALLET = "addr_test1_wallet";
const TRE = "addr_test1_treasury";
const CLAIM = "addr_test1_claim";
const BEACON = "addr_test1_beacon";
const FEEDER = "addr_test1_feeder";   // KHÔNG theo dõi
const TRSY = "cc".repeat(28) + "54525359";
const ACC = "dd".repeat(28) + "01";
const LAMPU = "ee".repeat(28) + "744c414d50";

const u = (txHash: string, outputIndex: number, address: string, assets: Record<string, bigint>,
           datum: string | null = null): UTxO => ({ txHash, outputIndex, address, assets, datum });

/** Ảnh chụp kiểu chuỗi thật: ví 2 UTxO, kho 1 carrier, 1 tài khoản, 1 beacon. */
function genesisView(): ChainView {
  return makeView(new Map<string, UTxO[]>([
    [WALLET, [u(H("1"), 0, WALLET, { lovelace: 100_000_000n }), u(H("1"), 1, WALLET, { lovelace: 7_000_000n })]],
    [TRE,    [u(H("2"), 1, TRE, { lovelace: 6_000_000n, [TRSY]: 1n, [LAMPU]: 1_000n }, "d0")]],
    [CLAIM,  [u(H("3"), 0, CLAIM, { lovelace: 2_000_000n, [ACC]: 1n }, "a0")]],
    [BEACON, [u(H("4"), 4, BEACON, { lovelace: 2_000_000n }, "b0")]],
  ]));
}

/** Hiệu ứng một Redeem: tiêu {ví, carrier, tài khoản}, tạo {tài khoản, carrier, LAMP→feeder, thối}. */
function redeemEffects(txHash: string, walletIn: string, carrierIn: string, accountIn: string, n: number): TxEffects {
  return {
    txHash,
    spent: [walletIn, carrierIn, accountIn],
    created: [
      u(txHash, 0, CLAIM, { lovelace: 2_000_000n, [ACC]: 1n }, `a${n}`),
      u(txHash, 1, TRE, { lovelace: 6_000_000n, [TRSY]: 1n, [LAMPU]: 1_000n - BigInt(n) }, `d${n}`),
      u(txHash, 2, FEEDER, { lovelace: 1_200_000n, [LAMPU]: 1n }),
      u(txHash, 3, WALLET, { lovelace: 90_000_000n - BigInt(n) }),
    ],
  };
}

describe("chainDepthFromEnv", () => {
  it("trống/thiếu ⇒ 1 (hành vi cũ)", () => {
    expect(chainDepthFromEnv(undefined)).toBe(1);
    expect(chainDepthFromEnv("  ")).toBe(1);
  });
  it("trong dải ⇒ đúng số, kể cả hai biên", () => {
    expect(chainDepthFromEnv("1")).toBe(1);
    expect(chainDepthFromEnv("8")).toBe(8);
    expect(chainDepthFromEnv(String(CHAIN_DEPTH_MAX))).toBe(CHAIN_DEPTH_MAX);
  });
  it("ngoài dải ⇒ FEED-CHAIN-004", () => {
    expect(() => chainDepthFromEnv("0")).toThrow(/FEED-CHAIN-004/);
    expect(() => chainDepthFromEnv(String(CHAIN_DEPTH_MAX + 1))).toThrow(/FEED-CHAIN-004/);
  });
  it("không phải số nguyên ⇒ FEED-ENV-001", () => {
    for (const bad of ["x", "-1", "1.5", "8 tx"]) expect(() => chainDepthFromEnv(bad)).toThrow(/FEED-ENV-001/);
  });
});

describe("makeView", () => {
  it("ref trùng ⇒ ném", () => {
    const x = u(H("1"), 0, WALLET, { lovelace: 1n });
    expect(() => makeView(new Map([[WALLET, [x, x]]]))).toThrow(/FEED-CHAIN-002.*hai lần/);
  });
  it("UTxO nằm sai địa chỉ trong ảnh chụp ⇒ ném", () => {
    expect(() => makeView(new Map([[WALLET, [u(H("1"), 0, TRE, { lovelace: 1n })]]]))).toThrow(/FEED-CHAIN-002/);
  });
});

describe("applyTx — một Redeem", () => {
  const v0 = genesisView();
  const e1 = redeemEffects(H("a"), `${H("1")}#0`, `${H("2")}#1`, `${H("3")}#0`, 1);
  const v1 = applyTx(v0, e1);

  it("bỏ input đã tiêu, thêm output ở địa chỉ được theo dõi, bỏ qua output ra ngoài", () => {
    const refs = v1.utxos.map(outRef).sort();
    expect(refs).toEqual([
      `${H("1")}#1`, `${H("4")}#4`, `${H("a")}#0`, `${H("a")}#1`, `${H("a")}#3`,
    ].sort());
    expect(v1.utxos.some((x) => x.address === FEEDER)).toBe(false);
    expect(v1.applied).toEqual([H("a")]);
  });
  it("carrier mới mang datum mới; tài khoản mới mang datum mới", () => {
    expect(outRef(viewCarrier(v1, TRE, TRSY))).toBe(`${H("a")}#1`);
    expect(viewCarrier(v1, TRE, TRSY).datum).toBe("d1");
    expect(viewUtxosAtWithUnit(v1, CLAIM, ACC).map((x) => x.datum)).toEqual(["a1"]);
  });
  it("lớp phủ cũ KHÔNG đổi (bất biến)", () => {
    expect(outRef(viewCarrier(v0, TRE, TRSY))).toBe(`${H("2")}#1`);
    expect(v0.applied).toEqual([]);
  });
  it("pickTreasury (TRSY-001) chạy trên lớp phủ chọn đúng carrier mới", () => {
    expect(outRef(pickTreasury(viewUtxosAt(v1, TRE), TRSY))).toBe(`${H("a")}#1`);
  });
});

describe("applyTx — chuỗi ba Redeem", () => {
  it("mỗi giao dịch tiêu output của giao dịch trước; carrier cuối là của giao dịch cuối", () => {
    let v = genesisView();
    const hs = [H("a"), H("b"), H("c")];
    let walletIn = `${H("1")}#0`, carrierIn = `${H("2")}#1`, accountIn = `${H("3")}#0`;
    const effs: TxEffects[] = [];
    hs.forEach((h, k) => {
      const e = redeemEffects(h, walletIn, carrierIn, accountIn, k + 1);
      effs.push(e);
      v = applyTx(v, e);
      walletIn = `${h}#3`; carrierIn = `${h}#1`; accountIn = `${h}#0`;
    });
    expect(outRef(viewCarrier(v, TRE, TRSY))).toBe(`${H("c")}#1`);
    expect(viewCarrier(v, TRE, TRSY).datum).toBe("d3");
    expect(v.applied).toEqual(hs);
    expect(viewUtxosAt(v, WALLET).map(outRef).sort()).toEqual([`${H("1")}#1`, `${H("c")}#3`].sort());
    expect(spentByChain(effs)).toEqual([
      `${H("1")}#0`, `${H("2")}#1`, `${H("3")}#0`,
      `${H("a")}#3`, `${H("a")}#1`, `${H("a")}#0`,
      `${H("b")}#3`, `${H("b")}#1`, `${H("b")}#0`,
    ]);
  });
});

describe("applyTx — fail-closed", () => {
  const v0 = genesisView();
  const v1 = applyTx(v0, redeemEffects(H("a"), `${H("1")}#0`, `${H("2")}#1`, `${H("3")}#0`, 1));

  it("tiêu lại carrier ĐÃ TIÊU (ca 'All inputs are spent') ⇒ FEED-CHAIN-002 trước khi gửi", () => {
    const stale = redeemEffects(H("b"), `${H("a")}#3`, `${H("2")}#1`, `${H("a")}#0`, 2);
    expect(() => applyTx(v1, stale)).toThrow(/FEED-CHAIN-002.*2{64}#1.*không có/);
  });
  it("input ngoài địa chỉ theo dõi ⇒ ném", () => {
    expect(() => applyTx(v0, { txHash: H("b"), spent: [`${H("9")}#0`], created: [] })).toThrow(/FEED-CHAIN-002/);
  });
  it("input lặp trong một giao dịch ⇒ ném", () => {
    expect(() => applyTx(v0, { txHash: H("b"), spent: [`${H("1")}#0`, `${H("1")}#0`], created: [] }))
      .toThrow(/hai lần/);
  });
  it("không input nào ⇒ ném (hàm trích hiệu ứng hỏng)", () => {
    expect(() => applyTx(v0, { txHash: H("b"), spent: [], created: [] })).toThrow(/không tiêu input nào/);
  });
  it("output mang txHash khác ⇒ ném", () => {
    expect(() => applyTx(v0, {
      txHash: H("b"), spent: [`${H("1")}#0`], created: [u(H("c"), 0, WALLET, { lovelace: 1n })],
    })).toThrow(/txHash khác/);
  });
  it("cùng giao dịch chồng hai lần ⇒ ném", () => {
    expect(() => applyTx(v1, { txHash: H("a"), spent: [`${H("1")}#1`], created: [] })).toThrow(/đã chồng/);
  });
  it("hash không phải 32 byte hex ⇒ ném", () => {
    expect(() => applyTx(v0, { txHash: "zz", spent: [`${H("1")}#0`], created: [] })).toThrow(/32 byte/);
  });
});

describe("đọc lớp phủ", () => {
  const v = genesisView();
  it("địa chỉ không theo dõi ⇒ FEED-CHAIN-003, KHÔNG trả []", () => {
    expect(() => viewUtxosAt(v, FEEDER)).toThrow(/FEED-CHAIN-003/);
    expect(() => viewUtxosAtWithUnit(v, FEEDER, ACC)).toThrow(/FEED-CHAIN-003/);
  });
  it("địa chỉ theo dõi nhưng rỗng ⇒ [] (khác ca trên)", () => {
    const e = makeView(new Map<string, UTxO[]>([[CLAIM, []]]));
    expect(viewUtxosAt(e, CLAIM)).toEqual([]);
  });
  it("viewCarrier: 0 hoặc 2 carrier ⇒ FEED-CHAIN-005", () => {
    const none = makeView(new Map<string, UTxO[]>([[TRE, []]]));
    expect(() => viewCarrier(none, TRE, TRSY)).toThrow(/FEED-CHAIN-005.*thấy 0/);
    const two = makeView(new Map<string, UTxO[]>([[TRE, [
      u(H("2"), 0, TRE, { lovelace: 1n, [TRSY]: 1n }), u(H("2"), 1, TRE, { lovelace: 1n, [TRSY]: 1n }),
    ]]]));
    expect(() => viewCarrier(two, TRE, TRSY)).toThrow(/FEED-CHAIN-005.*thấy 2/);
  });
});

describe("providerCaughtUp", () => {
  const carrierNew = `${H("c")}#1`;
  const spent = [`${H("2")}#1`, `${H("a")}#1`];
  it("chỉ mục còn thấy carrier cũ ⇒ chưa", () => {
    const seen = [u(H("2"), 1, TRE, {}), u(H("c"), 1, TRE, {})];
    expect(providerCaughtUp(seen, [carrierNew], spent)).toBe(false);
  });
  it("chỉ mục chưa thấy carrier mới ⇒ chưa", () => {
    expect(providerCaughtUp([u(H("9"), 0, WALLET, {})], [carrierNew], spent)).toBe(false);
  });
  it("thấy carrier mới, không còn input đã tiêu ⇒ rồi", () => {
    expect(providerCaughtUp([u(H("c"), 1, TRE, {}), u(H("9"), 0, WALLET, {})], [carrierNew], spent)).toBe(true);
  });
});

describe("chainWindowBlock — MỘT cửa sổ cho cả chuỗi", () => {
  // Specs/Window/CONTRACT.md v1.0: cửa sổ = `(t − window_origin_ms) / ms_per_epoch`. Mốc cứng cũ
  // (cửa sổ 4146 / 4147) là nhãn của phép chia THÔ `t / ms_per_epoch`; cụm feeder chạy trên
  // Preprod nên nay đo theo GỐC PREPROD THẬT — cùng mốc t0, nhãn mới là 317 (và 318 là cửa sổ kế).
  const MS = 432_000_000n;
  const O = WINDOW_ORIGIN_MS_BY_NETWORK.Preprod!;
  const t0 = 1_791_072_120_000n;            // mốc thuộc cửa sổ 317 (cùng mốc bài DRY_RUN_AT_MS)
  const w = epochWindow(MS, O, t0);
  const M = 600_000n;
  const nextStart = O + 318n * MS;          // đầu cửa sổ 318
  it("mốc mở chuỗi ⇒ được dựng; cửa sổ là 317 (gốc Preprod), KHÔNG phải 4146 (chia thô)", () => {
    expect(w.epoch).toBe(317n);
    expect(t0 / MS).toBe(4146n);            // đối chứng: bản quên trừ gốc ra nhãn này
    expect(chainWindowBlock(w, MS, O, t0, M)).toBeNull();
  });
  it("đúng biên lề: now + M = hi ⇒ được; thêm 1 ms ⇒ không", () => {
    expect(chainWindowBlock(w, MS, O, w.hiMs - M, M)).toBeNull();
    expect(chainWindowBlock(w, MS, O, w.hiMs - M + 1n, M)).toMatch(/còn </);
  });
  it("đồng hồ sang cửa sổ kế ⇒ không dựng", () => {
    expect(chainWindowBlock(w, MS, O, nextStart, M)).toMatch(/sang cửa sổ 318/);
  });
  it("đồng hồ trước đầu dưới ⇒ không dựng", () => {
    expect(chainWindowBlock(w, MS, O, w.loMs - 1n, M)).toMatch(/trước đầu dưới/);
  });
  it("khoảng vắt qua biên cửa sổ ⇒ không dựng", () => {
    expect(chainWindowBlock({ ...w, hiMs: nextStart }, MS, O, t0, M)).toMatch(/vắt ra ngoài/);
    expect(chainWindowBlock({ ...w, loMs: w.hiMs + 1n }, MS, O, t0, M)).toMatch(/khoảng hiệu lực âm/);
  });
  it("mốc TRƯỚC gốc ⇒ không dựng (chia BigInt cắt về 0 sẽ cho nhãn 0 giả)", () => {
    // `(O − 1 − O) / MS` = 0 trong BigInt: không chặn riêng thì "cửa sổ 0" lọt qua phép so nhãn.
    expect(chainWindowBlock({ loMs: O - 10n, hiMs: O - 5n, epoch: 0n }, MS, O, O - 1n, M)).toMatch(/TRƯỚC gốc/);
    expect(chainWindowBlock(w, MS, O, O - 1n, M)).toMatch(/TRƯỚC gốc/);
  });
  it("gốc 0 không phân biệt được bản trừ gốc: cùng khoảng, hai gốc ⇒ hai kết luận", () => {
    // Với gốc 0 khoảng `w` (nhãn 317) bị coi là vắt ra ngoài cửa sổ 4146≠317; với gốc đúng thì được.
    expect(chainWindowBlock(w, MS, 0n, t0, M)).toMatch(/vắt ra ngoài/);
    expect(chainWindowBlock(w, MS, O, t0, M)).toBeNull();
  });
});

// ── Đối chiếu với Emulator: giao dịch thật, nối hai giao dịch trong cùng một block ───────────────
describe("txEffects + lớp phủ trên Emulator", () => {
  async function setup() {
    const me = generateEmulatorAccount({ lovelace: 1_000_000_000n });
    const other = generateEmulatorAccount({ lovelace: 3_000_000n });
    const emu = new Emulator([me, other]);
    const lucid = await Lucid(emu, "Custom");
    lucid.selectWallet.fromSeed(me.seedPhrase);
    const wallet = await lucid.wallet().address();
    const snap = new Map<string, UTxO[]>([
      [wallet, await lucid.wallet().getUtxos()],
      [other.address, await lucid.utxosAt(other.address)],
    ]);
    return { emu, lucid, wallet, other: other.address, v0: makeView(snap) };
  }

  it("hai giao dịch nối nhau vào cùng block; lớp phủ = sổ cái sau block", async () => {
    const { emu, lucid, wallet, other, v0 } = await setup();
    const tx1 = await lucid.newTx().pay.ToAddress(other, { lovelace: 5_000_000n }).complete();
    const e1 = txEffects(tx1);
    const v1 = applyTx(v0, e1);
    // Thứ tự như `Chain.send`: KÝ + GỬI trước, ghi đè ví bằng lớp phủ mới SAU (bài kế ghim vì sao).
    expect(await (await tx1.sign.withWallet().complete()).submit()).toBe(e1.txHash);
    lucid.overrideUTxOs(viewUtxosAt(v1, wallet));

    const tx2 = await lucid.newTx().pay.ToAddress(other, { lovelace: 7_000_000n }).complete();
    const e2 = txEffects(tx2);
    // tx2 tiêu thối của tx1 — tức output của một giao dịch CHƯA vào block.
    expect(e2.spent.some((r) => r.startsWith(`${e1.txHash}#`))).toBe(true);
    const v2 = applyTx(v1, e2);
    expect(await (await tx2.sign.withWallet().complete()).submit()).toBe(e2.txHash);
    lucid.overrideUTxOs(viewUtxosAt(v2, wallet));

    emu.awaitBlock(1);
    lucid.overrideUTxOs([]);
    for (const a of [wallet, other]) {
      const ledger = (await lucid.utxosAt(a)).map(outRef).sort();
      expect(viewUtxosAt(v2, a).map(outRef).sort()).toEqual(ledger);
    }
    const otherLovelace = (await lucid.utxosAt(other)).reduce((s, x) => s + (x.assets.lovelace ?? 0n), 0n);
    expect(otherLovelace).toBe(3_000_000n + 5_000_000n + 7_000_000n);
  });

  it("ghi đè ví bằng lớp phủ SAU giao dịch TRƯỚC khi ký nó ⇒ ví không ký (thiếu chữ ký)", async () => {
    // `signTx` của ví Lucid chọn khoá theo UTxO ví ĐANG thấy; lớp phủ sau giao dịch không còn input
    // của chính nó ⇒ ví không nhận ra input là của mình. Ghim thứ tự trong `Chain.send`.
    const { lucid, wallet, other, v0 } = await setup();
    const tx1 = await lucid.newTx().pay.ToAddress(other, { lovelace: 5_000_000n }).complete();
    lucid.overrideUTxOs(viewUtxosAt(applyTx(v0, txEffects(tx1)), wallet));
    const signed = await tx1.sign.withWallet().complete();
    await expect(signed.submit()).rejects.toThrow(/Missing vkey witness/);
  });

  it("đối chứng: dựng giao dịch thứ hai trên chỉ mục CŨ (không lớp phủ) ⇒ bị từ chối khi gửi", async () => {
    const { lucid, other } = await setup();
    const tx1 = await lucid.newTx().pay.ToAddress(other, { lovelace: 5_000_000n }).complete();
    await (await tx1.sign.withWallet().complete()).submit();
    // Không chồng tx1, không overrideUTxOs: ví đọc sổ cái — UTxO đã bị tx1 tiêu trong mempool.
    const tx2 = await lucid.newTx().pay.ToAddress(other, { lovelace: 7_000_000n }).complete();
    const signed = await tx2.sign.withWallet().complete();
    await expect(signed.submit()).rejects.toThrow(/already spent/);
  });
});
