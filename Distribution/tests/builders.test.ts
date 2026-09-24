// Builder logic tests — KHÔNG submit thật (không có Blockfrost/compiled validator).
// Mock tx-builder chain ghi lại các call → assert datum/redeemer/asset preservation
// + validation errors. CONTRACT v3 "Capped Drop" — chỉ số CỘNG DỒN.
//
// v3 đổi HÌNH DẠNG giao dịch, không chỉ đổi số: ba datum thêm/bỏ trường, `buildClaimTx`
// đòi beacon làm input tham chiếu ở CẢ HAI đường, redeemer `Redeem` mang `amount`, và
// trần một lượt rút đọc `treasury.total_redeemed`. Một fixture dựng theo v2 không còn
// biên dịch — đó là hình dạng đúng, không phải phiền toái.

import { describe, it, expect, vi, onTestFinished } from "vitest";
import { validatorToScriptHash, credentialToAddress, scriptHashToCredential, keyHashToCredential, mintingPolicyToId, toUnit, Data } from "@lucid-evolution/lucid";
import type { UTxO, Validator } from "@lucid-evolution/lucid";

import { buildClaimTx, assertClaimSolvency } from "../offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";
import { buildPostBeaconTx } from "../offchain/src/beaconBuilder.js";
import {
  claimAccountDatumToCbor, beaconDatumToCbor, treasuryDatumToCbor,
  decodeTreasuryDatum, TREASURY_REDEEMER, grantEntitlementRedeemerToCbor,
} from "../offchain/src/datum.js";
import { accountNftName, mintAccountRedeemerToCbor } from "../offchain/src/accountNft.js";
import {
  committeeThreshold, assertCommitteeShape, assertCommitteeSigners,
} from "../offchain/src/committee.js";
import {
  DROPS_PER_EPOCH_PINNED, TREASURY_NFT_ASSET_NAME, TRIM_FLOOR, WINDOW_TTL_MS,
  RATE_ROOT_MIN, RATE_ROOT_MAX, epochWindow,
} from "../offchain/src/constants.js";
import type { BeaconDatum } from "../offchain/src/types.js";
import { beaconIndexAt } from "../offchain/src/vested.js";
import { applyValidator } from "../scripts/blueprint.js";
import { lampOildrop } from "./helpers.js";

// ── Mock Lucid tx-builder ──────────────────────────────────────────────
interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer: string }[];
  attach:      Validator[];
  attachMint:  Validator[];
  mint:        { assets: Record<string, bigint>; redeemer: string }[];
  readFrom:    UTxO[][];
  payData:     { address: string; datum: string; assets: Record<string, bigint> }[];
  payAddr:     { address: string; assets: Record<string, bigint> }[];
  signers:     string[];
  validFrom:   number[];
  validTo:     number[];
}

function mockLucid(walletAddress: string): { lucid: any; rec: Recorded } {
  const rec: Recorded = {
    collectFrom: [], attach: [], attachMint: [], mint: [], readFrom: [],
    payData: [], payAddr: [], signers: [], validFrom: [], validTo: [],
  };
  const txb: any = {
    collectFrom(utxos: UTxO[], redeemer: string) { rec.collectFrom.push({ utxos, redeemer }); return txb; },
    mintAssets(assets: Record<string, bigint>, redeemer: string) {
      rec.mint.push({ assets, redeemer }); return txb;
    },
    attach: {
      SpendingValidator(v: Validator) { rec.attach.push(v); return txb; },
      MintingPolicy(v: Validator) { rec.attachMint.push(v); return txb; },
    },
    readFrom(utxos: UTxO[]) { rec.readFrom.push(utxos); return txb; },
    pay: {
      ToAddressWithData(address: string, datum: { kind: string; value: string }, assets: Record<string, bigint>) {
        rec.payData.push({ address, datum: datum.value, assets }); return txb;
      },
      ToAddress(address: string, assets: Record<string, bigint>) {
        rec.payAddr.push({ address, assets }); return txb;
      },
    },
    addSignerKey(k: string) { rec.signers.push(k); return txb; },
    validFrom(ms: number) { rec.validFrom.push(ms); return txb; },
    validTo(ms: number) { rec.validTo.push(ms); return txb; },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = {
    newTx() { return txb; },
    wallet() { return { address: async () => walletAddress }; },
  };
  return { lucid, rec };
}

// fake applied validators — chỉ cần CBOR hợp lệ để derive script hash/address.
const FAKE_CLAIM:    Validator = { type: "PlutusV3", script: "49480100002221200101" };
const FAKE_TREASURY: Validator = { type: "PlutusV3", script: "49480100002221200102" };
const FAKE_BEACON:   Validator = { type: "PlutusV3", script: "49480100002221200103" };
/** claim_account_nft đã apply (giả) — đường CREATE BẮT BUỘC có (C-ACC-1). */
const FAKE_ACC_NFT:  Validator = { type: "PlutusV3", script: "49480100002221200104" };
const accNft = { script: FAKE_ACC_NFT };

const NETWORK = "Preview" as const;
const OWNER   = "aabbccddeeff00112233445566778899aabbccddeeff001122334455";
const LAMP_POLICY = "ff".repeat(28);
const LAMP_UNIT   = toUnit(LAMP_POLICY, "744c414d50"); // tLAMP canonical

// E = 250.000 LAMP ⇒ √E = 500.000 CHẴN; rate_root = 100.000 ⇒ mỗi cửa sổ mở đúng
// 50.000 LAMP, trọn sau 5 cửa sổ. Số chính phương là CỐ Ý: `vested = min(E, isqrt(dpe²·E·
// A_span²))` chỉ rút gọn thành `√E · A_span` khi E chính phương, nên mọi kỳ vọng dưới đây
// kiểm được bằng tay — không phải chép lại output của chính hàm đang kiểm.
const E          = lampOildrop(250_000n);
const RATE       = 100_000n;
const PER_WINDOW = lampOildrop(50_000n);

// ── Beacon dùng chung cho các ca CLAIM ─────────────────────────────────
// `epoch: 3` KHÁC mọi cửa sổ mà các ca claim chạy trong (1, 5, 9) và `rate_root ≠ 0` —
// cả hai đều cố ý. Ở fixture phẳng (`epoch` trùng cửa sổ, hoặc `rate_root = 0`) thì
// `A(cửa sổ) == index` và một bản hiện thực quên hẳn số hạng `rate_root · (t − epoch)`
// vẫn xanh: hai cực không phân biệt được thì ca không kiểm gì.
const BEACON_POLICY = "cd".repeat(28);
const BEACON_UNIT   = toUnit(BEACON_POLICY, "44524f50"); // "DROP"

function bcnDatum(over: Partial<BeaconDatum> = {}): BeaconDatum {
  return {
    epoch: 3n, kind: "DropParam", index: 1_000_000n, rate_root: RATE,
    trim_num: 1n, trim_den: 1_000n, speed_policies: [],
    ...over,
  };
}

function bcnUtxo(d: BeaconDatum): UTxO {
  return {
    txHash: "cd".repeat(32), outputIndex: 0,
    address: credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(FAKE_BEACON))),
    assets: { lovelace: 2_000_000n, [BEACON_UNIT]: 1n },
    datum: beaconDatumToCbor(d),
  };
}

/** Tham số `beacon` mà `buildClaimTx` v3 đòi — BẮT BUỘC ở cả CREATE lẫn UPDATE. */
function bcnParam(d: BeaconDatum = bcnDatum()) {
  return { utxo: bcnUtxo(d), datum: d };
}

// committee 3 keys, threshold 2
const COMMITTEE = ["11".repeat(28), "22".repeat(28), "33".repeat(28)];

// Treasury authenticity NFT (TRSY) — treasury co-spend là BẮT BUỘC với mọi Claim
// (on-chain `find_treasury_in` đòi đúng 1 input mang TRSY), nên mọi ca buildClaimTx
// dưới đây đều phải cấp `treasury`.
const TRSY_POLICY = "ab".repeat(28);
const TRSY_UNIT   = toUnit(TRSY_POLICY, TREASURY_NFT_ASSET_NAME);

// `total_redeemed` mặc định KHÁC 0: nó là trường mới v3 và là mẫu số của phép cắt ngọn ở
// MỌI tài khoản khác, nên một đường Grant vô tình đặt lại nó về 0 sẽ siết trần rút của cả
// hệ xuống sàn. Để mặc định 0 thì "giữ nguyên" và "xoá trắng" cho cùng một con số.
const TRSY_TOTAL_REDEEMED = lampOildrop(2_000_000n);

function trsyUtxo(
  outstanding: bigint, lamp = lampOildrop(100_000n), totalRedeemed = TRSY_TOTAL_REDEEMED,
): UTxO {
  return {
    txHash: "33".repeat(32), outputIndex: 0,
    address: credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(FAKE_TREASURY))),
    assets: { lovelace: 5_000_000n, [TRSY_UNIT]: 1n, [LAMP_UNIT]: lamp },
    datum: treasuryDatumToCbor({
      committee_hash: "ee".repeat(28),
      outstanding_entitlement: outstanding,
      total_redeemed: totalRedeemed,
    }),
  };
}

function trsyParam(
  outstanding: bigint, lamp = lampOildrop(100_000n), totalRedeemed = TRSY_TOTAL_REDEEMED,
) {
  return {
    utxo: trsyUtxo(outstanding, lamp, totalRedeemed),
    script: FAKE_TREASURY, nftPolicy: TRSY_POLICY,
  };
}

function scriptAddr(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

// ── committeeThreshold ──────────────────────────────────────────────────
describe("committeeThreshold ⌈2N/3⌉", () => {
  it("matches Byzantine 2/3", () => {
    expect(committeeThreshold(3)).toBe(2);
    expect(committeeThreshold(4)).toBe(3);
    expect(committeeThreshold(5)).toBe(4);
    expect(committeeThreshold(7)).toBe(5);
    expect(committeeThreshold(1)).toBe(1);
  });
});

// ── Cận committee phải khớp `committee_approved` on-chain ───────────────
// Cả ba phép đếm dưới đây on-chain làm trên list ĐÃ khử trùng (util.ak:
// `list.count(list.unique(committee), …)`). Off-chain đếm theo MỤC thì nó cho qua
// đúng những bộ tham số mà on-chain từ chối — và committee/threshold là apply-param,
// nên "cho qua" nghĩa là bake ra script hash không ai mở được.
// Cổng APPLY-001 sống ở `scripts/blueprint.ts` — tách khỏi `config.ts` CHÍNH ĐỂ kiểm được
// mà không cần .env. Nhưng bảng số-tham-số chỉ có dữ liệu sau khi `rawValidator()` nạp
// plutus.json (artefact `aiken build`, gitignored), nên khi bảng RỖNG cổng phải fail-closed:
// im lặng cho qua ở đó chính là lỗ mà `Genesis/scripts/03_mint_more.ts` vừa bị vá — tự đọc
// blueprint, apply thẳng, `applyParamsToScript` trả policy id khác mà KHÔNG báo gì.
describe("APPLY-002 — cổng apply-param fail-closed khi chưa nạp blueprint", () => {
  it("từ chối apply thẳng compiledCode không đi qua rawValidator()", () => {
    expect(() => applyValidator("590a1b" + "00".repeat(8), [1n])).toThrow(/APPLY-002/);
  });
});

describe("assertCommitteeShape — cận bake vào script hash", () => {
  it("chặn keyhash trùng (on-chain đếm NGƯỜI, không đếm mục)", () => {
    expect(() => assertCommitteeShape(["c1", "c1", "c2"])).toThrow(/COMMITTEE-004/);
  });
  it("chặn committee > 16 — quá cap thì committee_approved trả False", () => {
    const seventeen = Array.from({ length: 17 }, (_, i) => `k${i}`);
    expect(() => assertCommitteeShape(seventeen)).toThrow(/COMMITTEE-005/);
    expect(() => assertCommitteeShape(seventeen.slice(0, 16))).not.toThrow();
  });
  it("chặn committee rỗng", () => {
    expect(() => assertCommitteeShape([])).toThrow(/COMMITTEE-001/);
  });
});

describe("assertCommitteeSigners — đếm NGƯỜI, không đếm mục", () => {
  it("signer trùng KHÔNG được tính hai lần", () => {
    // On-chain: list.count(uniq_committee, đã ký) = 1 < 2. Off-chain cũ đếm 2 mục
    // ⇒ cho qua ⇒ fail phase-2 ⇒ cháy collateral thay vì lỗi pre-flight.
    expect(() => assertCommitteeSigners(["c1", "c2", "c3"], ["c1", "c1"], 2))
      .toThrow(/COMMITTEE-002/);
  });
  it("hai người thật thì qua", () => {
    expect(assertCommitteeSigners(["c1", "c2", "c3"], ["c1", "c2"], 2)).toBe(2);
  });
  it("threshold mặc định lấy theo số NGƯỜI trong committee, không theo số mục", () => {
    // [c1,c1,c2] = 2 người ⇒ ⌈2·2/3⌉ = 2, không phải ⌈2·3/3⌉ = 2… dùng 4 mục/2 người
    // để hai cách đếm ra số khác nhau: 2 người → th=2; 4 mục → th=3.
    expect(assertCommitteeSigners(["c1", "c1", "c2", "c2"], ["c1", "c2"])).toBe(2);
  });
  it("signer ngoài committee vẫn bị chặn (COMMITTEE-003 giữ nguyên)", () => {
    expect(() => assertCommitteeSigners(["c1", "c2"], ["c1", "ff"], 1))
      .toThrow(/COMMITTEE-003/);
  });
});

// ── buildClaimTx ────────────────────────────────────────────────────────
describe("buildClaimTx — CREATE path", () => {
  it("pays initial datum {entitlement=amount, redeemed=0, start=current, dpe=1, a₀=A(cửa sổ)}", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
    });
    expect(res.mode).toBe("create");
    // CREATE: không spend ClaimAccount nào; treasury co-spend là input DUY NHẤT.
    expect(rec.collectFrom.filter(c => c.utxos[0]?.assets[TRSY_UNIT] !== 1n)).toHaveLength(0);
    expect(rec.payData.filter(x => x.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.payData[0]!.address).toBe(scriptAddr(FAKE_CLAIM));
    expect(rec.signers.length).toBeGreaterThanOrEqual(2);
    // v3: beacon là INPUT THAM CHIẾU bắt buộc — chỉ ĐỌC, không tiêu. Thiếu nó thì validator
    // ném ở bước đọc, trước mọi mệnh đề nghiệp vụ, nên đây là một chốt HÌNH DẠNG.
    expect(rec.readFrom).toEqual([[bcnUtxo(bcnDatum())]]);
    expect(res.newDatum).toEqual({
      owner: OWNER, entitlement: lampOildrop(250n),
      redeemed: 0n, start_epoch: 5n, drops_per_epoch: 1n,
      index_at_start: beaconIndexAt(bcnDatum(), 5n),    // C-CLAIM-8
    });
    // Mốc là CHỈ SỐ TẠI CỬA SỔ NÀY, không phải `index` của beacon: beacon dán nhãn cửa sổ 3
    // còn tx chạy ở cửa sổ 5. Một fixture beacon cùng cửa sổ thì hai số trùng nhau ngẫu
    // nhiên và dòng trên không phân biệt được bản đúng với bản chép thẳng `beacon.index`.
    expect(res.newDatum.index_at_start).not.toBe(bcnDatum().index);
    // Ghim thêm bằng SỐ TÍNH TAY, không qua `beaconIndexAt`: A(5) = 1.000.000 + 100.000·(5−3)
    // = 1.200.000. Dòng trên gọi cùng một hàm mà builder gọi, nên nó xanh kể cả khi chính
    // hàm ấy sai; dòng này thì không.
    expect(res.newDatum.index_at_start).toBe(1_200_000n);
    expect(rec.payData[0]!.datum).toBe(claimAccountDatumToCbor(res.newDatum));
  });

  // CLAIM-004 — bẫy một chiều: `??` không bắt 0n, nên `dropsPerEpoch: 0n` từng ghi thẳng
  // `drops_per_epoch = 0` vào datum. Khi đó `claim_account.ak:119` giết nhánh Redeem vĩnh
  // viễn, còn khoản nợ đã vào sổ kho và chỉ giảm qua ReleaseForRedeem (cần một lần redeem).
  it("CLAIM-004: từ chối dropsPerEpoch = 0 (bẫy nợ khống không redeem được)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
      dropsPerEpoch: 0n,
    })).rejects.toThrow(/CLAIM-004/);
  });

  // CLAIM-006 — v3 thay TRẦN bằng ĐẲNG THỨC (C-ACC-DPE): `drops_per_epoch` GHIM == 1.
  // Khác biệt đáng nói ra vì nó đảo chiều hại: trần cũ chặn giá trị LỚN, còn đường hại của
  // v3 là giá trị NHỎ ĐI — `drops_per_epoch` đứng NGOÀI tổng `A_span`, nên hạ nó viết lại
  // toàn bộ quá khứ chứ không chỉ chặn một lần rút. Phía dưới ghim thì không kiểm được ở
  // đây: số nguyên dương nhỏ hơn 1 không tồn tại, và `0n` rơi vào CLAIM-004 trước (ca riêng).
  it("CLAIM-006: dropsPerEpoch ≠ 1 bị chặn, đúng giá trị ghim thì qua", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const base = {
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
    };
    await expect(buildClaimTx({ ...base, dropsPerEpoch: DROPS_PER_EPOCH_PINNED + 1n }))
      .rejects.toThrow(/CLAIM-006/);
    // Cực đối: giá trị ghim truyền TƯỜNG MINH vẫn phải đi qua. Không có vế này thì một chốt
    // siết quá tay (từ chối mọi `dropsPerEpoch` khai ra) vẫn xanh.
    const ok = await buildClaimTx({
      ...base, lucid: mockLucid("addr_wallet").lucid, dropsPerEpoch: DROPS_PER_EPOCH_PINNED,
    });
    expect(ok.newDatum.drops_per_epoch).toBe(DROPS_PER_EPOCH_PINNED);
  });

  // ── Issue #72 lỗ 1 (C-ACC-2) — đường CREATE phải khai CẢ HAI đầu validity range ──
  // Trước bản vá, `validFromMs` một mình được ghi là "BẮT BUỘC live tx CREATE" ngay trong
  // `ClaimParams` — tức bên dựng đã tả đúng ràng buộc mà bên kiểm chưa từng có. Nay
  // `treasury.ak` C-ACC-2 ép cả hai đầu rơi cùng cửa sổ, vì đầu dưới đặt lùi bao xa cũng
  // hợp lệ với sổ cái nên nó không ghim nổi `start_epoch`.
  it("CREATE-002: từ chối CREATE có validFromMs mà THIẾU validToMs", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
      validFromMs: 5n * 432_000_000n,
    })).rejects.toThrow(/CREATE-002/);
  });

  it("CREATE-002: đủ cả hai đầu thì qua, và tx mang đúng cặp lo/hi", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const w = epochWindow(432_000_000n, 5n * 432_000_000n + 432_000_000n / 2n);
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: w.epoch,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
      validFromMs: w.loMs, validToMs: w.hiMs,
    });
    expect(res.mode).toBe("create");
    expect(rec.validFrom).toEqual([Number(w.loMs)]);
    expect(rec.validTo).toEqual([Number(w.hiMs)]);
    // start_epoch ghi vào datum PHẢI là cửa sổ mà cặp lo/hi rơi vào — đúng thứ C-ACC-2 so.
    expect(res.newDatum.start_epoch).toBe(w.epoch);
  });

  it("CLAIM-004: từ chối dropsPerEpoch âm", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
      dropsPerEpoch: -1n,
    })).rejects.toThrow(/CLAIM-004/);
  });

  // ĐÃ XOÁ — "dropsPerEpoch dương khác mặc định vẫn qua và vào datum" (`dropsPerEpoch: 7n`).
  // Ca đó chết theo v3: `drops_per_epoch` nay GHIM == 1 (C-ACC-DPE), nên "giá trị dương
  // khác mặc định" là một tập RỖNG — không còn hai cực để phân biệt. Vai trò cực-đối của
  // nó (canh CLAIM-004 khỏi siết quá tay) đã chuyển sang vế thứ hai của ca CLAIM-006 ngay
  // trên: `dropsPerEpoch: DROPS_PER_EPOCH_PINNED` truyền tường minh phải đi qua.

  // Chốt chỉ so DẤU cho `NaN` đi lọt: mọi phép so sánh với NaN trả false, nên `NaN <= 0n`
  // là false và `NaN` vào thẳng datum. Đây là bề mặt thật của một SDK mở — caller từ
  // JavaScript không kiểu không bị trình biên dịch chặn.
  it("CLAIM-004: từ chối dropsPerEpoch không phải bigint (NaN đi lọt chốt chỉ so dấu)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
      dropsPerEpoch: NaN as unknown as bigint,
    })).rejects.toThrow(/CLAIM-004/);
  });
});

describe("buildClaimTx — UPDATE path", () => {
  function claimUtxo(datum: any, extraAssets: Record<string, bigint> = {}): UTxO {
    return {
      txHash: "ab".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_CLAIM),
      assets: { lovelace: 2_000_000n, ...extraAssets },
      datum: claimAccountDatumToCbor(datum),
    };
  }

  // REBASE (C-CLAIM-4/5/6, 2026-09-17). `redeemed = 40` và `start_epoch = 3 ≠ currentEpoch 9`
  // CỐ Ý: để mặc định 0 / bằng cửa sổ thì bài này xanh cả khi builder quên trừ `redeemed` hoặc
  // quên dời mốc.
  it("rebases account: E = (E − redeemed) + amount, redeemed = 0, start = current; giữ owner+dpe+assets", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const prev = {
      owner: OWNER, entitlement: lampOildrop(100n), redeemed: lampOildrop(40n),
      start_epoch: 3n, drops_per_epoch: 1n, index_at_start: beaconIndexAt(bcnDatum(), 3n),
    };
    const DUST = toUnit("ab".repeat(28), "cafe");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(60n), currentEpoch: 9n,
      claimAccountUtxo: claimUtxo(prev, { [DUST]: 7n }),
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
    });
    expect(res.mode).toBe("update");
    expect(rec.collectFrom.filter(c => c.utxos[0]?.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.attach).toContain(FAKE_CLAIM);
    expect(res.newDatum).toEqual({
      owner: OWNER, entitlement: lampOildrop(120n),   // 100 − 40 + 60
      redeemed: 0n,                                   // rebase
      start_epoch: 9n,                                // = currentEpoch
      drops_per_epoch: 1n,                            // unchanged
      // C-CLAIM-8 áp cả UPDATE: mốc chỉ số DỜI theo, không mang sang mốc cũ. Đây là điểm
      // v3 dễ vá nửa vời nhất — ghim `start_epoch` mà quên `index_at_start` là vá đúng cái
      // cửa nhìn thấy được, trong khi `start_epoch` không còn đi vào phép tính vested nữa.
      index_at_start: beaconIndexAt(bcnDatum(), 9n),
    });
    // Mốc cũ (cửa sổ 3) và mốc mới (cửa sổ 9) phải KHÁC nhau — nếu không thì dòng trên xanh
    // cả khi builder giữ nguyên mốc cũ.
    expect(res.newDatum.index_at_start).not.toBe(prev.index_at_start);
    // Số tính tay: A(9) = 1.000.000 + 100.000·(9 − 3) = 1.600.000 (mốc cũ là 1.000.000).
    expect(res.newDatum.index_at_start).toBe(1_600_000n);
    expect(rec.payData[0]!.assets).toEqual({ lovelace: 2_000_000n, [DUST]: 7n });
  });

  it("CREATE-002 áp cả UPDATE: có validFromMs mà thiếu validToMs thì từ chối", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const prev = {
      owner: OWNER, entitlement: lampOildrop(100n), redeemed: 0n,
      start_epoch: 3n, drops_per_epoch: 1n, index_at_start: beaconIndexAt(bcnDatum(), 3n),
    };
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(60n), currentEpoch: 9n,
      claimAccountUtxo: claimUtxo(prev),
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
      validFromMs: 9n * 432_000_000n,
    })).rejects.toThrow(/CREATE-002: đường UPDATE/);
  });

  it("rejects amount ≤ 0", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: 0n, currentEpoch: 1n, committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
    })).rejects.toThrow(/amount must be > 0/);
  });

  // CLAIM-005 — cùng bẫy một chiều của CLAIM-004, khác lối vào: ở UPDATE thì `drops_per_epoch`
  // đọc từ datum cũ chứ không do caller đặt, nên chốt CREATE không với tới được.
  it("CLAIM-005: từ chối cấp thêm entitlement cho account đang mang drops_per_epoch = 0", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const prev = {
      owner: OWNER, entitlement: lampOildrop(100n), redeemed: 0n,
      start_epoch: 3n, drops_per_epoch: 0n, index_at_start: beaconIndexAt(bcnDatum(), 3n),
    };
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(60n), currentEpoch: 9n,
      claimAccountUtxo: claimUtxo(prev),
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
    })).rejects.toThrow(/CLAIM-005/);
  });

  // Ca này đo THỨ TỰ, không đo sự tồn tại của chốt: owner sai VÀ dpe = 0 cùng lúc thì phải
  // nghe CLAIM-005 trước. Phép kiểm tính toàn vẹn đặt sau một bộ lọc nghiệp vụ thì im lặng
  // đúng bằng lúc chưa có nó — và tệ hơn, vì đọc mã thấy có nên người đọc dừng tìm.
  it("CLAIM-005 đứng TRƯỚC bộ lọc owner — dpe = 0 + owner sai vẫn nghe CLAIM-005", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const prev = {
      owner: "00".repeat(28), entitlement: 1n, redeemed: 0n,
      start_epoch: 0n, drops_per_epoch: 0n, index_at_start: beaconIndexAt(bcnDatum(), 0n),
    };
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: 1n, currentEpoch: 1n,
      claimAccountUtxo: claimUtxo(prev),
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
    })).rejects.toThrow(/CLAIM-005/);
  });

  it("rejects owner mismatch on update", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const prev = {
      owner: "00".repeat(28), entitlement: 1n, redeemed: 0n,
      start_epoch: 0n, drops_per_epoch: 1n, index_at_start: beaconIndexAt(bcnDatum(), 0n),
    };
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: 1n, currentEpoch: 1n,
      claimAccountUtxo: claimUtxo(prev), committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
    })).rejects.toThrow(/ownerPkh mismatch/);
  });

  it("rejects below-threshold signers", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: 1n, currentEpoch: 1n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
      signerKeyHashes: [COMMITTEE[0]!],   // 1 < threshold 2
    })).rejects.toThrow(/need ≥ 2 signers/);
  });
});

// ── buildPostBeaconTx (DropParam) ──────────────────────────────────────
describe("buildPostBeaconTx — DropParam (chỉ số cộng dồn)", () => {
  const NFT_POLICY = "cd".repeat(28);
  const NFT_UNIT   = toUnit(NFT_POLICY, "44524f50"); // "DROP" default asset name

  /** Beacon ĐANG trên chuỗi. `rate_root` phải nằm trong [RATE_ROOT_MIN, RATE_ROOT_MAX]. */
  function onChain(over: Partial<BeaconDatum> = {}): BeaconDatum {
    return { ...bcnDatum({ epoch: 9n, index: 1_000_000n, rate_root: RATE }), ...over };
  }

  function beaconUtxo(d: BeaconDatum, assets: Record<string, bigint>): UTxO {
    return {
      txHash: "cd".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_BEACON),
      assets,
      datum: beaconDatumToCbor(d),
    };
  }

  /** Beacon HỢP LỆ cho cửa sổ `epoch` nối tiếp `cur` — C-BCN-6 tính bằng `rate_root` CŨ. */
  function nextBeacon(cur: BeaconDatum, epoch: bigint, over: Partial<BeaconDatum> = {}): BeaconDatum {
    return {
      ...cur, epoch,
      index: cur.index + cur.rate_root * (epoch - cur.epoch),
      ...over,
    };
  }

  it("posts beacon mới, bảo toàn NFT + assets, không mint", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const cur  = onChain();
    const want = nextBeacon(cur, 10n);
    const res = await buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: want,
      committeeKeyHashes: COMMITTEE,
    });
    expect(rec.collectFrom.filter(c => c.utxos[0]?.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.payData.filter(x => x.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.payData[0]!.assets).toEqual({ lovelace: 2_000_000n, [NFT_UNIT]: 1n });
    // So TRỌN datum qua CBOR: v3 có 7 trường, và `trim_num`/`trim_den`/`speed_policies`
    // không có phép kiểm nào ở builder — mất một trong ba lúc mã hoá thì chỉ dòng này bắt.
    expect(rec.payData[0]!.datum).toBe(beaconDatumToCbor(want));
    expect(rec.signers.length).toBeGreaterThanOrEqual(2);
    expect(res.newBeacon.epoch).toBe(10n);
    expect(res.newBeacon.index).toBe(cur.index + cur.rate_root);
    expect(res.newBeacon.rate_root).toBe(RATE);
  });

  // ── C-BCN-2 off-chain (BEACON-012/013) + mốc THẬT (BEACON-010/014) ────────────────
  // Bản trước decode datum cũ rồi `void prev;` dưới một chú thích nói "kiểm tra epoch đơn
  // điệu tăng". Không mệnh đề nào chạy. Giá của việc để nó đổ ở lúc NỘP thay vì lúc DỰNG
  // không phải một thông báo lỗi mà là một CỬA SỔ: C-BCN-3 đòi nhãn == cửa sổ đang chạy,
  // nên hỏng một lượt là mất lượt post của cả cửa sổ — Preprod dài 5 NGÀY.

  it("BEACON-012: nhãn epoch BẰNG nhãn trên chuỗi bị chặn (cửa sổ này đã post rồi)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, cur.epoch),   // index khớp C-BCN-6 (delta 0) — chỉ epoch sai
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-012/);
  });

  it("BEACON-012: nhãn epoch LÙI bị chặn", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, cur.epoch - 1n),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-012/);
  });

  // Ca ĐỐI XỨNG, không phải trang trí: thiếu nó thì một bản gõ nhầm `>=` cũng xanh hệt bản
  // đúng, mà `>=` cho post hai lượt trong một cửa sổ — đúng lỗ mà C-BCN-2 có mặt để bịt.
  it("epoch = trên chuỗi + 1 ĐI QUA — mệnh đề là >, không phải >=", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const cur  = onChain();
    const want = nextBeacon(cur, cur.epoch + 1n);
    await buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: want,
      committeeKeyHashes: COMMITTEE,
    });
    expect(rec.payData[0]!.datum).toBe(beaconDatumToCbor(want));
  });

  // `beaconNftAssetName` phải được ĐƯA TAY ở ca này, và lý do là một dữ kiện đo được chứ
  // không phải một mẹo viết test: tên NFT mặc định suy TỪ `kind`
  // (`DEFAULT_BEACON_ASSET_NAMES[newBeacon.kind]`), nên đổi `kind` cũng đổi tên đem đi tra,
  // và BEACON-003 ("UTxO không giữ NFT tên đó") đổ TRƯỚC. Tức trên đường mặc định, chốt
  // kind BỊ CHE — nó chỉ tới lượt khi tên NFT được ghim. Ghi ra thay vì để ca này im lặng
  // xanh nhờ một mệnh đề khác: đó đúng là "bài trượt xuống chốt kế tiếp rồi chết ở đó".
  it("BEACON-013: đổi kind bị chặn khi tên NFT được GHIM (mặc định thì BEACON-003 che mất)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconNftAssetName: "44524f50",
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { kind: "NotDropParam" as BeaconKind }),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-013/);
  });

  // Ca ĐẮT NHẤT trong nhóm. `currentBeacon` là bản CALLER ĐƯA; ba chốt v3 (C-BCN-5'·5a·6)
  // đều đo so với nó, và trước bản vá KHÔNG chỗ nào đối chiếu nó với datum trên chuỗi.
  // Lệch một trường ⇒ cả ba tính trên một mốc KHÔNG TỒN TẠI và vẫn xanh ở local.
  it("BEACON-014: currentBeacon lệch datum trên chuỗi bị chặn, dù ba chốt v3 đều 'xanh'", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const chainDatum  = onChain({ index: 1_000_000n });
    const callerBelief = onChain({ index: 5_000_000n });  // caller tin index cao hơn thật
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(chainDatum, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      // Nhất quán với bản CALLER TIN ⇒ C-BCN-6 đi qua; chỉ BEACON-014 bắt được.
      newBeacon: nextBeacon(callerBelief, 10n),
      committeeKeyHashes: COMMITTEE,
      currentBeacon: callerBelief,
    })).rejects.toThrow(/BEACON-014/);
  });

  it("BEACON-010: beacon UTxO không có datum bị chặn, không đoán mốc", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    const u = beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n });
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: { ...u, datum: undefined },
      newBeacon: nextBeacon(cur, 10n),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-010/);
  });

  // BEACON-001 thay chỗ của "drop_value ≤ 0" ở v2. Không phải đổi tên: `rate_root` là TỐC ĐỘ
  // tích luỹ chứ không phải lượng mở mỗi cửa sổ, nên 0 ở đây làm chỉ số ĐỨNG YÊN mãi mãi —
  // beacon vẫn hợp lệ, sổ vẫn đúng, và không tài khoản nào vest thêm được một oildrop.
  it("BEACON-001: từ chối rate_root ≤ 0", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { rate_root: 0n }),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-001/);
  });

  // BEACON-007 — chốt MỚI ở v3, không có bản v2 tương ứng. `trim_den` là MẪU SỐ của phép cắt
  // ngọn ở `claim_account ▸ Redeem`: đặt nó bằng 0 làm MỌI giao dịch rút của toàn hệ đổ vỡ
  // vĩnh viễn, trong khi beacon vẫn hợp lệ và sổ vẫn đúng — không ai kêu.
  it("BEACON-007: từ chối trim_den ≤ 0 (một con số khoá cứng đường rút của cả hệ)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { trim_den: 0n }),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-007/);
  });

  it("rejects when NFT count ≠ 1", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n }), // no NFT
      newBeacon: nextBeacon(cur, 10n),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/exactly 1 authenticity NFT/);
  });

  // ── Issue #72 lỗ 3: biên của tốc độ, ép ở beacon.ak C-BCN-5a/5b ──────
  // Chốt thật nằm ở validator; các ca dưới đây kiểm rằng builder KHÔNG dựng ra tx chắc
  // chắn bị chuỗi từ chối, và từ chối bằng một câu nói ra con số + cái biên nó vượt.
  // v3 đổi ĐẠI LƯỢNG bị kẹp: `drop_value` (lượng mở mỗi cửa sổ) → `rate_root` (tốc độ,
  // NGUYÊN THUỶ; `W := w²` là dẫn xuất). Biên đọc từ `constants.ts`, không gõ lại số.

  it("BEACON-004: từ chối rate_root vượt TRẦN cứng", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { rate_root: RATE_ROOT_MAX + 1n }),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-004/);
  });

  it("BEACON-004: từ chối rate_root dưới SÀN cứng (ca bò trườn — vesting gần như đóng băng)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain();
    // `RATE_ROOT_MIN − 1` vẫn > 0, nên BEACON-001 KHÔNG che mất ca này: thứ đỏ phải là
    // biên cứng, không phải phép so dấu đứng trước nó.
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { rate_root: RATE_ROOT_MIN - 1n }),
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/BEACON-004/);
  });

  it("BEACON-005: từ chối một lượt NỚI vượt +10% khi biết beacon hiện tại", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain({ rate_root: 100_000n });
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { rate_root: 110_001n }),
      committeeKeyHashes: COMMITTEE,
      currentBeacon: cur,
    })).rejects.toThrow(/BEACON-005/);
  });

  it("BEACON-005: +10% CHẴN đi qua — mệnh đề là ≤, không phải <", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain({ rate_root: 100_000n });
    const res = await buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { rate_root: 110_000n }),
      committeeKeyHashes: COMMITTEE,
      currentBeacon: cur,
    });
    expect(res.newBeacon.rate_root).toBe(110_000n);
  });

  // BEACON-008 — chốt v3 thay chỗ "chiều GIẢM" của v2, và KHÁC v2 ở CHIỀU chứ không ở độ
  // lớn. v2 dùng một hàm lệch ĐỐI XỨNG nên trần ±10% chặn tốc độ mà KHÔNG chặn chiều. Ca
  // dưới đây hạ đúng MỘT đơn vị: nó nằm gọn trong ±10% của v2 ⇒ một bản còn dùng phép so
  // đối xứng sẽ cho qua, và chỉ chốt một-chiều mới bắt được.
  it("BEACON-008: hạ rate_root MỘT đơn vị cũng bị chặn (một chiều, không phải ±10%)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain({ rate_root: 100_000n });
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 10n, { rate_root: 99_999n }),
      committeeKeyHashes: COMMITTEE,
      currentBeacon: cur,
    })).rejects.toThrow(/BEACON-008/);
  });

  // ── C-BCN-6: chỉ số CỘNG DỒN — quá khứ định giá bằng `rate_root` CŨ ──
  // Đây là chốt trung tâm của v3: tốc độ mới chỉ có hiệu lực TỪ cửa sổ này trở đi, nên một
  // lượt post không với ngược lại được vào bất kỳ điểm nào của quá khứ. Hai ca dưới phân
  // biệt hai cực — thừa số ĐÚNG là `cur.rate_root`, thừa số SAI là `newBeacon.rate_root`.

  it("BEACON-009: index tính bằng rate_root MỚI bị chặn", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain({ epoch: 9n, index: 1_000_000n, rate_root: 10_000n });
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: {
        ...cur, epoch: 12n, rate_root: 11_000n,
        index: cur.index + 11_000n * 3n,      // SAI: định giá 3 cửa sổ quá khứ bằng tốc độ MỚI
      },
      committeeKeyHashes: COMMITTEE,
      currentBeacon: cur,
    })).rejects.toThrow(/BEACON-009/);
  });

  it("C-BCN-6: index = index cũ + rate_root CŨ · số cửa sổ trôi qua thì đi qua", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const cur = onChain({ epoch: 9n, index: 1_000_000n, rate_root: 10_000n });
    const res = await buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, 12n, { rate_root: 11_000n }),
      committeeKeyHashes: COMMITTEE,
      currentBeacon: cur,
    });
    expect(res.newBeacon.index).toBe(1_000_000n + 10_000n * 3n);   // KHÔNG dùng 11.000
    expect(res.newBeacon.rate_root).toBe(11_000n);
  });

  // ── Issue #72 lỗ 2: nhãn epoch phải là cửa sổ hiện tại (C-BCN-3) ─────

  it("BEACON-006: từ chối nhãn epoch không khớp cửa sổ hiện tại", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const msPerEpoch = 432_000_000n;
    const wrongLabel = epochWindow(msPerEpoch).epoch + 2n;
    const cur = onChain({ epoch: wrongLabel - 1n });
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, wrongLabel),
      committeeKeyHashes: COMMITTEE,
      msPerEpoch,
    })).rejects.toThrow(/BEACON-006/);
  });

  it("BEACON-006: nhãn == cửa sổ hiện tại đi qua, và tx mang CẢ HAI đầu validity range", async () => {
    // Đóng băng đồng hồ: builder gọi `epochWindow` theo giờ thật lần nữa, và cả `loMs = now − 60s`
    // lẫn `hiMs = now + TTL` lệch vài ms giữa hai lần gọi ⇒ bài đỏ chập chờn. Chỉ giả `Date`.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 8, 17, 12, 0, 0));
    onTestFinished(() => { vi.useRealTimers(); });
    const { lucid, rec } = mockLucid("addr_wallet");
    const msPerEpoch = 432_000_000n;
    const w = epochWindow(msPerEpoch);
    const cur = onChain({ epoch: w.epoch - 1n });
    const res = await buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(cur, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: nextBeacon(cur, w.epoch),
      committeeKeyHashes: COMMITTEE,
      msPerEpoch,
    });
    expect(res.newBeacon.epoch).toBe(w.epoch);
    // Đầu TRÊN là phần mới, và là phần duy nhất chứng minh được nhãn không bị dán lùi.
    expect(rec.validFrom).toEqual([Number(w.loMs)]);
    expect(rec.validTo).toEqual([Number(w.hiMs)]);
  });
});

// ── epochWindow — Luật 2b phía bên dựng tx ────────────────────────────
// Hàm thuần, nhưng nhánh biên của nó là thứ hỏng vài lần mỗi chu kỳ mà không có gì báo:
// cửa sổ mặc định vắt qua biên epoch ⇒ validator từ chối ⇒ lỗi chỉ nói "validator crashed".
describe("epochWindow — cả hai đầu rơi cùng một cửa sổ", () => {
  const MSPE = 432_000_000n;

  // Ba mệnh đề, và mệnh đề thứ ba là mệnh đề bị thiếu trước đây:
  //   (1) lo và hi cùng một cửa sổ          — điều validator ép (`get_epoch_strict`)
  //   (2) hi > lo                           — khoảng không rỗng
  //   (3) lo ≤ now ≤ hi                     — khoảng CHỨA thời điểm gửi
  // (1)+(2) xanh trọn vẹn trên bản cũ trong khi (3) đỏ ở 60 giây đầu mỗi cửa sổ: khoảng
  // hợp lệ, không rỗng, cùng epoch — và đã hết hạn.
  function assertWindow(nowMs: bigint) {
    const w = epochWindow(MSPE, nowMs);
    expect(w.loMs / MSPE).toBe(w.epoch);
    expect(w.hiMs / MSPE).toBe(w.epoch);
    expect(w.hiMs).toBeGreaterThan(w.loMs);
    expect(w.loMs).toBeLessThanOrEqual(nowMs);
    expect(w.hiMs).toBeGreaterThanOrEqual(nowMs);
    // Mệnh đề thứ tư: không vượt chân trời dự báo của node (PastHorizon).
    expect(w.hiMs - nowMs).toBeLessThanOrEqual(WINDOW_TTL_MS);
    return w;
  }

  // Bốn mốc đầu là bốn mốc ĐỎ đo được trên bản cũ, giữ nguyên số. Chúng phân biệt được hai
  // cực: mốc giữa cửa sổ xanh ở cả bản cũ lẫn bản mới nên một mình nó không kiểm gì.
  it.each([
    ["ngay lúc cửa sổ mở", 100n * MSPE],
    ["+1 ms", 100n * MSPE + 1n],
    ["+30 s — giữa dải hỏng cũ", 100n * MSPE + 30_000n],
    ["+59.999 s — mốc từng cho khoảng ÂM", 100n * MSPE + 59_999n],
    ["+60 s — mốc đầu tiên bản cũ đúng", 100n * MSPE + 60_000n],
    ["giữa cửa sổ", 100n * MSPE + MSPE / 2n],
    ["1 s trước biên — vùng chết cũ", 101n * MSPE - 1_000n],
    ["ms cuối cùng của cửa sổ", 101n * MSPE - 1n],
  ])("%s: lo ≤ now ≤ hi và hai đầu cùng cửa sổ", (_ten, nowMs) => {
    const w = assertWindow(nowMs as bigint);
    expect(w.epoch).toBe(100n);
  });

  it("nhãn epoch là cửa sổ đang chạy, không phải cửa sổ mà cái đệm 60 s rơi vào", () => {
    expect(epochWindow(MSPE, 100n * MSPE).epoch).toBe(100n);
    expect(epochWindow(MSPE, 100n * MSPE - 1n).epoch).toBe(99n);
  });

  it("hi = now + TTL khi cuối cửa sổ còn xa — mốc đỏ trên bản đặt hi ở cuối cửa sổ", () => {
    expect(epochWindow(MSPE, 100n * MSPE).hiMs).toBe(100n * MSPE + WINDOW_TTL_MS);
  });

  it("hi sát cuối cửa sổ khi cửa sổ hết trước TTL — không vắt sang cửa sổ sau", () => {
    expect(epochWindow(MSPE, 101n * MSPE - 1_000n).hiMs).toBe(101n * MSPE - 1n);
    expect(epochWindow(MSPE, 101n * MSPE - WINDOW_TTL_MS).hiMs).toBe(101n * MSPE - 1n);
  });

  it("msPerEpoch ≤ 0 thì NÉM, không trả về một cửa sổ vô nghĩa", () => {
    expect(() => epochWindow(0n, 1n)).toThrow();
    expect(() => epochWindow(-1n, 1n)).toThrow();
  });
});

// ── buildRedeemTx (Capped Drop v3) ─────────────────────────────────────
//
//   A(t)    = index + rate_root · (t − epoch)
//   A_span  = A(t) − index_at_start
//   vested  = min(E, isqrt(dpe² · E · A_span²))
//   trần    = max(TRIM_FLOOR, total_redeemed · trim_num / trim_den)
//   amount  = min(vested − redeemed, trần)
//
// `start_epoch` KHÔNG còn đi vào phép tính — nó chỉ là nhãn kiểm toán. Mọi ca dưới đây do
// đó neo vào `index_at_start`, và beacon luôn dán nhãn cửa sổ 97 trong khi các cửa sổ xét
// là 100..105: hai số phải KHÁC nhau, nếu không `A(t) = index` phẳng và một bản hiện thực
// quên hẳn số hạng `rate_root · (t − epoch)` vẫn xanh.
describe("buildRedeemTx — vested = min(E, isqrt(dpe²·E·A_span²))", () => {
  const BCN_EPOCH = 97n;
  const MARK      = 100n;     // cửa sổ mà tài khoản chụp mốc chỉ số

  /** Beacon của khối này. κ mặc định 1/1000 = giá trị vận hành. */
  function bcn(over: Partial<BeaconDatum> = {}): BeaconDatum {
    return bcnDatum({ epoch: BCN_EPOCH, index: 1_000_000n, rate_root: RATE, ...over });
  }
  /** κ = 1/1 ⇒ trần một lượt = chính `total_redeemed`; dùng khi ca KHÔNG đo phép cắt ngọn. */
  const WIDE = bcn({ trim_num: 1n, trim_den: 1n });

  // `total_redeemed` LỚN là cách duy nhất mở trần một lượt ra đủ rộng: ở `total_redeemed = 0`
  // thì SÀN (1.000 LAMP) là thứ đang chặn, và mọi ca kỳ vọng rút trọn phần đã vest sẽ đỏ.
  // Đó là hành vi ĐÚNG — xem hai ca cắt ngọn ở cuối khối.
  const RICH = lampOildrop(10_000_000n);

  function claimUtxo(
    redeemed: bigint, entitlement = E, markWindow = MARK, dpe = 1n,
    extra: Record<string, bigint> = {}, beacon: BeaconDatum = bcn(),
  ): UTxO {
    return {
      txHash: "11".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_CLAIM),
      assets: { lovelace: 2_000_000n, ...extra },
      datum: claimAccountDatumToCbor({
        owner: OWNER, entitlement, redeemed,
        // `start_epoch` cố ý đặt LỆCH mốc chỉ số: ở v3 nó không vào phép tính nữa, nên một
        // bản còn tính theo `t − start_epoch` phải ra số KHÁC và đỏ.
        start_epoch: markWindow - 7n, drops_per_epoch: dpe,
        index_at_start: beaconIndexAt(beacon, markWindow),
      }),
    };
  }
  // Fixture PHẢI mang TRSY: claim_account.ak:138-148 (C-SOLV-3/4/5) đòi đúng 1 input mang TRSY ở
  // MỌI lần redeem. Bản cũ không mang NFT nào ⇒ 8 ca redeem chạy trên hình dạng chuỗi TỪ CHỐI, và
  // chính vì thế đường redeem chưa từng bị ép kiểm — bài test xanh đang GIỮ lỗ, không phải gác nó.
  function treasuryUtxo(
    lamp: bigint, extra: Record<string, bigint> = {},
    cum = E, totalRedeemed = RICH,
  ): UTxO {
    return {
      txHash: "22".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_TREASURY),
      assets: { lovelace: 5_000_000n, [TRSY_UNIT]: 1n, [LAMP_UNIT]: lamp, ...extra },
      datum: treasuryDatumToCbor({
        committee_hash: "ee".repeat(28),
        outstanding_entitlement: cum,
        total_redeemed: totalRedeemed,
      }),
    };
  }
  function dropBeaconUtxo(d: BeaconDatum = bcn()): UTxO {
    return {
      txHash: "33".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_BEACON),
      assets: { lovelace: 2_000_000n },
      datum: beaconDatumToCbor(d),
    };
  }

  const base = {
    network: NETWORK, claimScript: FAKE_CLAIM, treasuryScript: FAKE_TREASURY,
    lampPolicyId: LAMP_POLICY, treasuryNftPolicy: TRSY_POLICY,
  };

  it("releases vested−redeemed, preserves treasury dust + committee_hash, sets redeemed+=amount", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    const DUST = toUnit("dd".repeat(28), "f00d");
    // Mốc ở cửa sổ 100, xét ở 103 ⇒ A_span = 3·RATE = 300.000.
    //   vested = isqrt(1² · 250.000 LAMP · 300.000²) = 500.000 · 300.000 = 150.000 LAMP
    //   redeemed = 50.000 LAMP ⇒ uncapped = 100.000 LAMP
    //   trần = max(1.000 LAMP, 10.000.000 LAMP · 1/1) = 10.000.000 LAMP ⇒ KHÔNG chạm
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(PER_WINDOW, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n), { [DUST]: 3n }),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    });
    expect(res.vested).toBe(3n * PER_WINDOW);
    expect(res.amount).toBe(2n * PER_WINDOW);                        // 150.000 − 50.000
    expect(res.trimmed).toBe(0n);                                    // trần không chạm
    expect(res.trimCap).toBe(RICH);                                  // κ = 1/1
    expect(res.newClaimDatum.redeemed).toBe(3n * PER_WINDOW);        // = redeemed + amount
    expect(res.newClaimDatum.entitlement).toBe(E);                   // unchanged
    expect(res.newClaimDatum.start_epoch).toBe(MARK - 7n);           // unchanged
    expect(res.newClaimDatum.drops_per_epoch).toBe(1n);              // unchanged
    // C-RDM-4: mốc chỉ số BẤT BIẾN khi rút. Dời nó là dời gốc toạ độ của cả lịch mở khoá —
    // một lần rút sẽ tự đặt lại `A_span = 0` và tài khoản đứng im mãi.
    // Số tính tay: A(100) = 1.000.000 + 100.000·(100 − 97) = 1.300.000.
    expect(res.newClaimDatum.index_at_start).toBe(1_300_000n);

    // 2 inputs spent (claim + treasury), beacon read-only
    expect(rec.collectFrom).toHaveLength(2);
    expect(rec.readFrom).toHaveLength(1);
    expect(rec.attach).toEqual(expect.arrayContaining([FAKE_CLAIM, FAKE_TREASURY]));

    // treasury output: LAMP 1.000.000 → 900.000, dust + lovelace bảo toàn
    const treasuryOut = rec.payData.find(p => p.address === scriptAddr(FAKE_TREASURY))!;
    expect(treasuryOut.assets[LAMP_UNIT]).toBe(lampOildrop(1_000_000n) - 2n * PER_WINDOW);
    expect(treasuryOut.assets.lovelace).toBe(5_000_000n);
    expect(treasuryOut.assets[DUST]).toBe(3n);
    const treOutDatum = decodeTreasuryDatum(Data.from(treasuryOut.datum));
    // C-SOLV-3: redeem TRẢ NỢ ⇒ sổ cái giảm ĐÚNG amount, cùng nhịp với pool.
    // Bản đầu ép sổ cái BẤT BIẾN ở đây — chính là nguồn bế tắc grant (xem treasury.ak).
    expect(treOutDatum.outstanding_entitlement).toBe(E - 2n * PER_WINDOW);
    // C-RDM-TOTAL: `total_redeemed` tăng ĐÚNG amount. Hai vế KHÁC 0 là cố ý — ở 0 thì
    // "giữ nguyên" và "cộng đúng amount" chỉ phân biệt được nếu amount khác 0, và một bản
    // đặt lại về 0 vẫn xanh khi đầu vào cũng là 0.
    expect(treOutDatum.total_redeemed).toBe(RICH + 2n * PER_WINDOW);
    expect(treOutDatum.committee_hash).toBe("ee".repeat(28));

    // user receives exactly amount LAMP
    expect(rec.payAddr).toHaveLength(1);
    expect(rec.payAddr[0]!.assets[LAMP_UNIT]).toBe(2n * PER_WINDOW);
    expect(rec.payAddr[0]!.address).toBe("addr_user");

    // owner signs
    expect(rec.signers).toContain(OWNER);
  });

  it("E nhỏ hơn một cửa sổ → nhận trọn entitlement ngay cửa sổ đầu (cap E)", async () => {
    const { lucid } = mockLucid("addr_user");
    // E = 400 LAMP, A_span = RATE ⇒ bound = isqrt(400 LAMP)·RATE = 20.000 · 100.000
    // = 2.000 LAMP ≫ E ⇒ `vested` bị CHẶN bởi E, không bởi chỉ số. Đây là vế `min(E, …)`.
    const small = lampOildrop(400n);
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: MARK + 1n,
      claimAccountUtxo: claimUtxo(0n, small, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000n), {}, lampOildrop(1_000n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    });
    expect(res.vested).toBe(small);
    expect(res.amount).toBe(small);
    expect(res.newClaimDatum.redeemed).toBe(small);
  });

  it("drip: một cửa sổ mở đúng √E · rate_root", async () => {
    const { lucid } = mockLucid("addr_user");
    // A_span = RATE ⇒ vested = 500.000 · 100.000 = 50.000 LAMP = PER_WINDOW.
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: MARK + 1n,
      claimAccountUtxo: claimUtxo(0n, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    });
    expect(res.vested).toBe(PER_WINDOW);
    expect(res.amount).toBe(PER_WINDOW);
  });

  it("sets validFrom khi truyền validFromMs", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    await buildRedeemTx({
      ...base, lucid, currentEpoch: MARK + 2n, validFromMs: 2n * 86_400_000n,
      claimAccountUtxo: claimUtxo(0n, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    });
    expect(rec.validFrom).toEqual([Number(2n * 86_400_000n)]);
  });

  // ── C-RDM-TRIM / C-RDM-CAP: trần MỘT LƯỢT rút ────────────────────────
  // Chốt MỚI ở v3. Hai ca phân biệt hai NHÁNH của `max(...)`: sàn và tỉ lệ. Ca nào chỉ đo
  // một nhánh thì nó xanh cả khi bản hiện thực bỏ hẳn nhánh kia.

  it("C-RDM-TRIM: ở total_redeemed = 0 thì SÀN chặn, và phần bị cắt được NÓI RA", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    // `total_redeemed = 0` là ĐIỂM HẤP THỤ nếu thiếu sàn: trần 0 ⇒ không ai rút được ⇒
    // `total_redeemed` mãi bằng 0. Sàn tồn tại chính để phá điểm đó.
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(0n, E, MARK),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n), {}, E, 0n),
      dropBeaconUtxo: dropBeaconUtxo(),
    });
    expect(res.vested).toBe(3n * PER_WINDOW);
    expect(res.trimCap).toBe(TRIM_FLOOR);
    expect(res.amount).toBe(TRIM_FLOOR);
    // Phần bị cắt KHÔNG mất — nó còn nguyên quyền và chờ lượt sau. Gộp nó vào `amount` là
    // nói dối một chiều; im lặng là để người dùng đọc phép cắt thành tịch thu.
    expect(res.trimmed).toBe(3n * PER_WINDOW - TRIM_FLOOR);
    expect(res.newClaimDatum.redeemed).toBe(TRIM_FLOOR);
    // Và `total_redeemed` ra khỏi 0 — vòng sau trần đã rộng hơn.
    const treOut = rec.payData.find(p => p.assets[TRSY_UNIT] === 1n)!;
    expect(decodeTreasuryDatum(Data.from(treOut.datum)).total_redeemed).toBe(TRIM_FLOOR);
  });

  it("C-RDM-TRIM: nhánh TỈ LỆ chặn khi total_redeemed · κ vượt sàn", async () => {
    const { lucid } = mockLucid("addr_user");
    // κ = 1/1000 và total_redeemed = 2.000.000 LAMP ⇒ trần = 2.000 LAMP > sàn 1.000 LAMP.
    // Một bản bỏ hẳn nhánh tỉ lệ (chỉ giữ sàn) sẽ trả 1.000 LAMP ở đây và đỏ.
    const totalRedeemed = lampOildrop(2_000_000n);
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(0n, E, MARK),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n), {}, E, totalRedeemed),
      dropBeaconUtxo: dropBeaconUtxo(),
    });
    expect(res.trimCap).toBe(lampOildrop(2_000n));
    expect(res.trimCap).toBeGreaterThan(TRIM_FLOOR);
    expect(res.amount).toBe(lampOildrop(2_000n));
    expect(res.trimmed).toBe(3n * PER_WINDOW - lampOildrop(2_000n));
  });

  // REDEEM-013 — đối xứng với CLAIM-021 ở đường claim. Địa chỉ kho KHÔNG phải một UTxO: A-DEST hạ
  // cánh không datum và `Refill` (treasury.ak:177) tồn tại chính vì kho sẽ có nhiều UTxO. Chọn theo
  // SỐ DƯ LAMP thì có ngày vớ trúng cái không mang TRSY ⇒ validator từ chối ⇒ mất collateral.
  it("REDEEM-013: từ chối treasury UTxO KHÔNG mang NFT TRSY (dù thừa LAMP)", async () => {
    const { lucid } = mockLucid("addr_user");
    const noTrsy: UTxO = {
      txHash: "22".repeat(32), outputIndex: 1,
      address: scriptAddr(FAKE_TREASURY),
      assets: { lovelace: 5_000_000n, [LAMP_UNIT]: lampOildrop(999_999n) }, // thừa LAMP, thiếu TRSY
      datum: treasuryDatumToCbor({
        committee_hash: "ee".repeat(28), outstanding_entitlement: E, total_redeemed: RICH,
      }),
    };
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(PER_WINDOW, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: noTrsy,
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    })).rejects.toThrow(/REDEEM-013/);
  });

  it("REDEEM-013: từ chối cả khi kho mang 2 TRSY (không mơ hồ carrier)", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(PER_WINDOW, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n), { [TRSY_UNIT]: 2n }),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    })).rejects.toThrow(/REDEEM-013/);
  });

  // REDEEM-014 — `treasury.ak:92-95` ép nợ_out == nợ_in − released VÀ nợ_out ≥ 0. Builder
  // trước bản này trừ thẳng, dựng ra tx sổ cái ÂM: CBOR hợp lệ, chuỗi từ chối, mất collateral.
  it("REDEEM-014: từ chối khi sổ cái nợ kho < amount (nợ_out sẽ âm)", async () => {
    const { lucid } = mockLucid("addr_user");
    // Cửa sổ 101 ⇒ amount = PER_WINDOW = 50.000 LAMP; sổ cái nợ chỉ 10 LAMP.
    // Pool LAMP để DƯ để REDEEM-012 không che mất ca này — nó đứng TRƯỚC REDEEM-014.
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: MARK + 1n,
      claimAccountUtxo: claimUtxo(0n, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n), {}, lampOildrop(10n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    })).rejects.toThrow(/REDEEM-014/);
  });

  it("rejects double-redeem (redeemable ≤ 0, đã redeem hết vested)", async () => {
    const { lucid } = mockLucid("addr_user");
    // Cửa sổ 103 ⇒ vested = 3·PER_WINDOW; redeemed đúng bằng đó → uncapped = 0 → reject.
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(3n * PER_WINDOW, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    })).rejects.toThrow(/redeemable ≤ 0/);
  });

  it("rejects khi chưa tới cửa sổ mở khoá (A_span = 0)", async () => {
    const { lucid } = mockLucid("addr_user");
    // Mốc chỉ số chụp ở ĐÚNG cửa sổ đang xét ⇒ A_span = 0 ⇒ vested = 0 ⇒ reject.
    // Ở v3 điều kiện này đọc từ CHỈ SỐ, không từ `start_epoch` — mà fixture để `start_epoch`
    // lệch 7 cửa sổ về TRƯỚC, nên một bản còn so `t ≤ start_epoch` sẽ cho qua và đỏ ở đây.
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(0n, E, 103n, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    })).rejects.toThrow(/redeemable ≤ 0/);
  });

  it("rejects beacon thiếu inline datum", async () => {
    const { lucid } = mockLucid("addr_user");
    // Không dựng được beacon "kind sai" vì `BeaconKind` chỉ còn DropParam — cực duy nhất
    // ca này còn giữ được là beacon KHÔNG có datum. Builder phải NÉM, không được đoán.
    const noDatum: UTxO = { ...dropBeaconUtxo(WIDE), datum: null as unknown as string };
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 103n,
      claimAccountUtxo: claimUtxo(0n, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n)),
      dropBeaconUtxo: noDatum,
    })).rejects.toThrow(/no inline datum/);
  });

  it("rejects treasury với LAMP không đủ", async () => {
    const { lucid } = mockLucid("addr_user");
    // amount = PER_WINDOW = 50.000 LAMP ở cửa sổ 101; kho chỉ có 100 LAMP.
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: MARK + 1n,
      claimAccountUtxo: claimUtxo(0n, E, MARK, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(100n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    })).rejects.toThrow(/< amount/);
  });

  // VESTED-005 — mốc chỉ số ở TƯƠNG LAI so với beacon. On-chain `expect a_span >= 0` từ
  // chối thẳng, nên off-chain phải NÉM chứ không được kẹp về 0: kẹp làm ví dựng ra một giao
  // dịch mà validator chắc chắn từ chối, và lỗi hiện ra ở nơi không đọc được nguyên nhân.
  it("VESTED-005: A_span âm thì NÉM, không kẹp về 0", async () => {
    const { lucid } = mockLucid("addr_user");
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: MARK,
      claimAccountUtxo: claimUtxo(0n, E, MARK + 5n, 1n, {}, WIDE),
      treasuryUtxo: treasuryUtxo(lampOildrop(1_000_000n)),
      dropBeaconUtxo: dropBeaconUtxo(WIDE),
    })).rejects.toThrow(/VESTED-005/);
  });
});

// ── SOLVENCY GUARD (over-collateralization, lúc cấp E) ──────────────────
describe("assertClaimSolvency — Σ(E−redeemed) ≤ treasury", () => {
  it("pass khi đúng bằng quỹ (over-collateral biên)", () => {
    // treasury 1000, other 400, this 600 → tổng 1000 == 1000 → OK.
    expect(() => assertClaimSolvency(1000n, 400n, 600n)).not.toThrow();
  });

  it("pass khi quỹ dư", () => {
    expect(() => assertClaimSolvency(1000n, 100n, 200n)).not.toThrow();
  });

  it("reject khi Σ vượt quỹ 1 oildrop", () => {
    // 400 + 601 = 1001 > 1000 → CLAIM-010.
    expect(() => assertClaimSolvency(1000n, 400n, 601n)).toThrow(/CLAIM-010/);
  });

  it("reject khi quỹ rỗng nhưng cấp E", () => {
    expect(() => assertClaimSolvency(0n, 0n, 1n)).toThrow(/CLAIM-010/);
  });
});

describe("buildClaimTx — solvency guard tích hợp", () => {
  function claimUtxoS(datum: any): UTxO {
    return {
      txHash: "cd".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_CLAIM),
      assets: { lovelace: 2_000_000n },
      datum: claimAccountDatumToCbor(datum),
    };
  }

  it("CREATE: reject khi amount vượt treasury (under-collateralized)", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(600n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
      solvency: { treasuryLamp: lampOildrop(1000n), otherOutstanding: lampOildrop(500n) },
    })).rejects.toThrow(/CLAIM-010/);  // 500 + 600 = 1100 > 1000
  });

  it("CREATE: pass khi trong hạn mức quỹ", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(400n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
      solvency: { treasuryLamp: lampOildrop(1000n), otherOutstanding: lampOildrop(500n) },
    });
    expect(res.mode).toBe("create");         // 500 + 400 = 900 ≤ 1000
    expect(rec.payData.filter(x => x.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
  });

  it("UPDATE: dùng entitlement−redeemed sau khi tăng để tính outstanding", async () => {
    const { lucid } = mockLucid("addr_wallet");
    // prev: E=300, redeemed=100 → outstanding cũ 200; +amount 250 → rebase E=450, redeemed=0
    // → thisOutstandingAfter = 450 (không đổi so với trước rebase). other 600 → 1050 > 1000 → reject.
    const prev = {
      owner: OWNER, entitlement: lampOildrop(300n), redeemed: lampOildrop(100n),
      start_epoch: 2n, drops_per_epoch: 1n, index_at_start: beaconIndexAt(bcnDatum(), 2n),
    };
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 9n,
      claimAccountUtxo: claimUtxoS(prev), committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
      solvency: { treasuryLamp: lampOildrop(1000n), otherOutstanding: lampOildrop(600n) },
    })).rejects.toThrow(/CLAIM-010/);
  });

  it("không có solvency param → bỏ qua guard (không regression)", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(999999n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
    });
    expect(res.mode).toBe("create");
    expect(rec.payData.filter(x => x.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
  });
});

// ── TREASURY CO-SPEND BẮT BUỘC (review PR #22, điểm 4) ─────────────────
describe("buildClaimTx — treasury co-spend", () => {
  it("collect treasury với redeemer GrantEntitlement (constr 1)", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(400n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(lampOildrop(100n)), accountNft: accNft,
      beacon: bcnParam(),
    });
    const tre = rec.collectFrom.find(c => c.utxos[0]?.assets[TRSY_UNIT] === 1n);
    expect(tre).toBeDefined();
    expect(tre!.redeemer).toBe(grantEntitlementRedeemerToCbor());
    expect(TREASURY_REDEEMER.GrantEntitlement).toBe(1);
  });

  it("sổ cái nợ += amount, pool LAMP bất biến (C-SOLV-1 / C-VAL-0)", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(400n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(lampOildrop(100n)), accountNft: accNft,
      beacon: bcnParam(),
    });
    expect(res.newTreasuryDatum.outstanding_entitlement).toBe(lampOildrop(500n));
    const treOut = rec.payData.find(p => p.assets[TRSY_UNIT] === 1n)!;
    const treOutDatum = decodeTreasuryDatum(Data.from(treOut.datum));
    expect(treOutDatum.outstanding_entitlement).toBe(lampOildrop(500n));
    expect(treOut.assets[LAMP_UNIT]).toBe(lampOildrop(100_000n));
    // C-RDM-TOTAL: `Release` là đường DUY NHẤT `total_redeemed` được tăng, và Grant KHÔNG
    // phải đường đó ⇒ giữ NGUYÊN. Trường này là mẫu số của phép cắt ngọn ở MỌI tài khoản
    // khác: chạm vào nó ở đây là nới (hoặc siết) trần rút của TOÀN hệ bằng một lượt cấp
    // quyền. Đầu vào KHÁC 0 là cố ý — ở 0 thì "giữ nguyên" và "xoá trắng" ra cùng một số.
    expect(TRSY_TOTAL_REDEEMED).not.toBe(0n);
    expect(res.newTreasuryDatum.total_redeemed).toBe(TRSY_TOTAL_REDEEMED);
    expect(treOutDatum.total_redeemed).toBe(TRSY_TOTAL_REDEEMED);
  });

  it("CLAIM-021: từ chối treasury UTxO KHÔNG mang TRSY", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const noNft = { ...trsyUtxo(0n) };
    delete (noNft.assets as Record<string, bigint>)[TRSY_UNIT];
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(400n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, accountNft: accNft,
      treasury: { utxo: noNft, script: FAKE_TREASURY, nftPolicy: TRSY_POLICY },
      beacon: bcnParam(),
    })).rejects.toThrow(/CLAIM-021/);
  });
});

// ── C-ACC-1: CREATE phải đúc NFT tài khoản đúng tên ────────────────────
// treasury.GrantEntitlement đòi tx đúc ĐÚNG 1 NFT dưới account_nft_policy, tên
// blake2b_256(owner), và NFT đó hạ cánh trên chính ClaimAccount output. Off-chain
// dựng tx thiếu bước này thì tx chắc chắn fail lúc submit → chặn ngay ở builder.
describe("buildClaimTx — CREATE đúc account NFT (C-ACC-1)", () => {
  it("đúc ĐÚNG 1 NFT tên blake2b_256(owner) dưới policy suy từ script", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n), accountNft: accNft,
      beacon: bcnParam(),
    });

    const pid  = mintingPolicyToId(FAKE_ACC_NFT);
    const name = accountNftName(OWNER);
    const unit = toUnit(pid, name);

    // tên = blake2b-256 của owner pkh (32 byte = 64 hex) — KHÔNG phải chính pkh.
    expect(name).toHaveLength(64);
    expect(name).not.toBe(OWNER);

    // đúng 1 lần mint, đúng 1 asset, đúng 1 đơn vị.
    expect(rec.mint).toHaveLength(1);
    expect(rec.mint[0]!.assets).toEqual({ [unit]: 1n });
    expect(rec.mint[0]!.redeemer).toBe(mintAccountRedeemerToCbor());

    // minting policy phải được attach, nếu không tx không có script để chạy.
    expect(rec.attachMint).toContain(FAKE_ACC_NFT);

    // NFT hạ cánh trên chính ClaimAccount output (A-ACC-4), không đi chỗ khác.
    const accOut = rec.payData.find(p => p.assets[TRSY_UNIT] !== 1n)!;
    expect(accOut.address).toBe(scriptAddr(FAKE_CLAIM));
    expect(accOut.assets[unit]).toBe(1n);
    expect(res.accountNftUnit).toBe(unit);
  });

  it("CLAIM-030: từ chối CREATE khi thiếu accountNft", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
    })).rejects.toThrow(/CLAIM-030/);
  });

  it("CLAIM-031: từ chối khi policyId khai báo lệch policy id suy từ script", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
      accountNft: { script: FAKE_ACC_NFT, policyId: "99".repeat(28) },
    })).rejects.toThrow(/CLAIM-031/);
  });

  it("UPDATE KHÔNG đúc gì (claim_account ép is_zero(tx.mint))", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const prev = {
      owner: OWNER, entitlement: lampOildrop(100n), redeemed: 0n,
      start_epoch: 3n, drops_per_epoch: 1n, index_at_start: beaconIndexAt(bcnDatum(), 3n),
    };
    await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(60n), currentEpoch: 9n,
      claimAccountUtxo: {
        txHash: "ab".repeat(32), outputIndex: 0, address: scriptAddr(FAKE_CLAIM),
        assets: { lovelace: 2_000_000n }, datum: claimAccountDatumToCbor(prev),
      },
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      beacon: bcnParam(),
    });
    expect(rec.mint).toHaveLength(0);
    expect(rec.attachMint).toHaveLength(0);
  });
});

// ── Vector đối chiếu blake2b_256 — NGOÀI hệ, không tự soi mình ────────────────
//
// Vì sao cần: mọi kiểm tra khác về tên NFT account đều gọi `accountNftName` ở CẢ HAI vế,
// nên chúng xanh kể cả khi hàm băm sai loại (blake2b-512 cắt ngắn, sha256, có personal…).
// Tên sai ⇒ `claim_account` (C-ACC-0) không tìm thấy NFT ⇒ account KHÔNG BAO GIỜ spend
// được, mà LAMP là hệ KHÔNG BURN: số khoá trong đó chết vĩnh viễn.
//
// Giá trị kỳ vọng dưới đây KHÔNG chép từ mã off-chain. Nó là output thật của chính Aiken:
//   test vector_khop_python() {
//     blake2b_256(#"0000…00ab") == #"f9efbd6f…2127"
//   }                                  → pass, mem 805 cpu 376479 (aiken check, 2026-08-18)
// và trùng byte với `hashlib.blake2b(..., digest_size=32)` của Python — hai bản hiện thực
// độc lập với @noble/hashes mà off-chain đang dùng.
describe("accountNftName — vector đối chiếu Aiken blake2b_256", () => {
  it("khớp ĐÚNG byte digest mà validator on-chain tính ra", () => {
    expect(accountNftName("00".repeat(27) + "ab")).toBe(
      "f9efbd6f7704806f47919961cd591dd70b0be92b10f9d44f9c2f561348fa2127",
    );
  });

  it("chấp nhận tiền tố 0x và chữ HOA, ra cùng một tên", () => {
    const want = "f9efbd6f7704806f47919961cd591dd70b0be92b10f9d44f9c2f561348fa2127";
    expect(accountNftName("0x" + "00".repeat(27) + "AB")).toBe(want);
  });

  it("từ chối hex hỏng thay vì băm bừa ra một tên không spend được", () => {
    expect(() => accountNftName("xyz")).toThrow(/ACCNFT-001/);
    expect(() => accountNftName("abc")).toThrow(/ACCNFT-001/);
    expect(() => accountNftName("")).toThrow(/ACCNFT-001/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// C-SOLV-5 — ĐỊA CHỈ KHO MANG THEO TỪ INPUT, KHÔNG DỰNG LẠI TỪ SCRIPT HASH
// ════════════════════════════════════════════════════════════════════════
//
// Trên Cardano một địa chỉ script có HAI dạng cùng chung một script hash:
//   enterprise = chỉ payment credential
//   base       = payment credential + stake credential (kho được uỷ quyền stake)
// Cùng hash, KHÁC địa chỉ. `claim_account.ak:105` (nhánh Claim) và `:146` (nhánh Redeem)
// ép `tre_in_addr == tre_out_addr` — so CẢ `Address`, tức kể cả stake credential.
// `credentialToAddress(network, scriptHashToCredential(h))` LUÔN trả dạng enterprise.
//
// ⚠️ VÌ SAO 96 CA CŨ KHÔNG BẮT ĐƯỢC: mọi fixture kho trong tệp này dùng `scriptAddr()`,
// tức luôn enterprise. Ở cực đó hai vế trùng nhau NGẪU NHIÊN, nên bài xanh đang GIỮ lỗ
// chứ không gác nó. Hai ca dưới đây phân biệt HAI CỰC: đầu vào enterprise và đầu vào base
// phải cho hai địa chỉ đầu ra KHÁC NHAU. Ca nào xanh ở cả hai cực thì nó không kiểm gì —
// nên mỗi ca mở đầu bằng chốt `entAddr !== baseAddr`, canh chính cái fixture.
describe("C-SOLV-5 — địa chỉ kho theo input, hai cực enterprise/base", () => {
  const STAKE_KH  = "77".repeat(28);
  const TRE_HASH  = validatorToScriptHash(FAKE_TREASURY);
  const entAddr   = credentialToAddress(NETWORK, scriptHashToCredential(TRE_HASH));
  const baseAddr  = credentialToAddress(
    NETWORK, scriptHashToCredential(TRE_HASH), keyHashToCredential(STAKE_KH),
  );

  // Beacon của khối này: nhãn cửa sổ 0, còn các tx chạy ở cửa sổ 3 (redeem) và 5 (claim) —
  // hai số phải KHÁC nhau, nếu không `A(t) = index` phẳng. κ = 1/1 cộng `total_redeemed`
  // lớn để trần một lượt KHÔNG chạm: khối này đo ĐỊA CHỈ, không đo phép cắt ngọn.
  const SOLV_BCN = bcnDatum({ epoch: 0n, index: 1_000_000n, trim_num: 1n, trim_den: 1n });
  const SOLV_MARK = 1n;

  /** Kho mang TRSY, đặt ở địa chỉ chỉ định (enterprise hoặc base). */
  function treAt(
    address: string, lamp = lampOildrop(1000n), cum = lampOildrop(1000n),
    totalRedeemed = lampOildrop(1_000_000n),
  ): UTxO {
    return {
      txHash: "22".repeat(32), outputIndex: 0,
      address,
      assets: { lovelace: 5_000_000n, [TRSY_UNIT]: 1n, [LAMP_UNIT]: lamp },
      datum: treasuryDatumToCbor({
        committee_hash: "ee".repeat(28),
        outstanding_entitlement: cum,
        total_redeemed: totalRedeemed,
      }),
    };
  }
  function accUtxo(redeemed = 0n): UTxO {
    return {
      txHash: "11".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_CLAIM),
      assets: { lovelace: 2_000_000n },
      datum: claimAccountDatumToCbor({
        owner: OWNER, entitlement: lampOildrop(250n), redeemed,
        start_epoch: 0n, drops_per_epoch: 1n,
        index_at_start: beaconIndexAt(SOLV_BCN, SOLV_MARK),
      }),
    };
  }
  function beaconUtxo(): UTxO {
    return bcnUtxo(SOLV_BCN);
  }
  const rbase = {
    network: NETWORK, claimScript: FAKE_CLAIM, treasuryScript: FAKE_TREASURY,
    lampPolicyId: LAMP_POLICY, treasuryNftPolicy: TRSY_POLICY,
  };

  /** Địa chỉ của output mang TRSY trong tx đã dựng. */
  function treOutAddr(rec: Recorded): string {
    return rec.payData.find(p => p.assets[TRSY_UNIT] === 1n)!.address;
  }

  it("fixture phân biệt được hai cực (cùng script hash, khác Address)", () => {
    expect(baseAddr).not.toBe(entAddr);
    expect(validatorToScriptHash(FAKE_TREASURY)).toBe(TRE_HASH); // cùng hash, khác địa chỉ
  });

  it("buildRedeemTx — kho enterprise ⇒ output enterprise (cực 1)", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    await buildRedeemTx({
      ...rbase, lucid, currentEpoch: 3n,
      claimAccountUtxo: accUtxo(), treasuryUtxo: treAt(entAddr), dropBeaconUtxo: beaconUtxo(),
    });
    expect(treOutAddr(rec)).toBe(entAddr);
  });

  it("buildRedeemTx — kho base (có stake cred) ⇒ output GIỮ stake cred (cực 2)", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    await buildRedeemTx({
      ...rbase, lucid, currentEpoch: 3n,
      claimAccountUtxo: accUtxo(), treasuryUtxo: treAt(baseAddr), dropBeaconUtxo: beaconUtxo(),
    });
    // Dựng lại từ hash sẽ ra `entAddr` ⇒ `trsy_in_addr != trsy_out_addr` ⇒ chuỗi TỪ CHỐI.
    expect(treOutAddr(rec)).toBe(baseAddr);
    expect(treOutAddr(rec)).not.toBe(entAddr);
  });

  it("buildClaimTx UPDATE — kho enterprise ⇒ output enterprise (cực 1)", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER,
      amount: lampOildrop(10n), currentEpoch: 5n, committeeKeyHashes: COMMITTEE,
      claimAccountUtxo: accUtxo(),
      treasury: { utxo: treAt(entAddr), script: FAKE_TREASURY, nftPolicy: TRSY_POLICY },
      beacon: bcnParam(),
    });
    expect(treOutAddr(rec)).toBe(entAddr);
  });

  it("buildClaimTx UPDATE — kho base ⇒ output GIỮ stake cred (cực 2)", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER,
      amount: lampOildrop(10n), currentEpoch: 5n, committeeKeyHashes: COMMITTEE,
      claimAccountUtxo: accUtxo(),
      treasury: { utxo: treAt(baseAddr), script: FAKE_TREASURY, nftPolicy: TRSY_POLICY },
      beacon: bcnParam(),
    });
    expect(treOutAddr(rec)).toBe(baseAddr);
    expect(treOutAddr(rec)).not.toBe(entAddr);
  });

  // Đường CREATE: `claim_account` spend KHÔNG chạy (không có account input) nên chuỗi
  // KHÔNG từ chối — nhưng NFT "TRSY" bị âm thầm hạ từ base xuống enterprise, mất uỷ quyền
  // stake mà không ai đỏ. Đây là cực "rò êm" của cùng một dòng mã.
  it("buildClaimTx CREATE — kho base KHÔNG bị âm thầm hạ về enterprise", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK, ownerPkh: OWNER,
      amount: lampOildrop(10n), currentEpoch: 5n, committeeKeyHashes: COMMITTEE,
      treasury: { utxo: treAt(baseAddr), script: FAKE_TREASURY, nftPolicy: TRSY_POLICY },
      beacon: bcnParam(),
      accountNft: accNft,
    });
    expect(treOutAddr(rec)).toBe(baseAddr);
    expect(treOutAddr(rec)).not.toBe(entAddr);
  });
});
