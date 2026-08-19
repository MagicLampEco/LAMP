// Builder logic tests — KHÔNG submit thật (không có Blockfrost/compiled validator).
// Mock tx-builder chain ghi lại các call → assert datum/redeemer/asset preservation
// + validation errors. CONTRACT v2 "Capped Drop".

import { describe, it, expect } from "vitest";
import { validatorToScriptHash, credentialToAddress, scriptHashToCredential, toUnit, Data } from "@lucid-evolution/lucid";
import type { UTxO, Validator } from "@lucid-evolution/lucid";

import { buildClaimTx, assertClaimSolvency } from "../offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../offchain/src/redeemBuilder.js";
import { buildPostBeaconTx } from "../offchain/src/beaconBuilder.js";
import {
  claimAccountDatumToCbor, beaconDatumToCbor, treasuryDatumToCbor,
  decodeTreasuryDatum, TREASURY_REDEEMER, grantEntitlementRedeemerToCbor,
} from "../offchain/src/datum.js";
import {
  committeeThreshold, assertCommitteeShape, assertCommitteeSigners,
} from "../offchain/src/committee.js";
import { TREASURY_NFT_ASSET_NAME } from "../offchain/src/constants.js";
import { lampOildrop } from "./helpers.js";

// ── Mock Lucid tx-builder ──────────────────────────────────────────────
interface Recorded {
  collectFrom: { utxos: UTxO[]; redeemer: string }[];
  attach:      Validator[];
  readFrom:    UTxO[][];
  payData:     { address: string; datum: string; assets: Record<string, bigint> }[];
  payAddr:     { address: string; assets: Record<string, bigint> }[];
  signers:     string[];
  validFrom:   number[];
}

function mockLucid(walletAddress: string): { lucid: any; rec: Recorded } {
  const rec: Recorded = {
    collectFrom: [], attach: [], readFrom: [], payData: [], payAddr: [], signers: [], validFrom: [],
  };
  const txb: any = {
    collectFrom(utxos: UTxO[], redeemer: string) { rec.collectFrom.push({ utxos, redeemer }); return txb; },
    attach: { SpendingValidator(v: Validator) { rec.attach.push(v); return txb; } },
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

const NETWORK = "Preview" as const;
const OWNER   = "aabbccddeeff00112233445566778899aabbccddeeff001122334455";
const LAMP_POLICY = "ff".repeat(28);
const LAMP_UNIT   = toUnit(LAMP_POLICY, "744c414d50"); // tLAMP canonical
const D = lampOildrop(100n);

// committee 3 keys, threshold 2
const COMMITTEE = ["11".repeat(28), "22".repeat(28), "33".repeat(28)];

// Treasury authenticity NFT (TRSY) — treasury co-spend là BẮT BUỘC với mọi Claim
// (on-chain `find_treasury_in` đòi đúng 1 input mang TRSY), nên mọi ca buildClaimTx
// dưới đây đều phải cấp `treasury`.
const TRSY_POLICY = "ab".repeat(28);
const TRSY_UNIT   = toUnit(TRSY_POLICY, TREASURY_NFT_ASSET_NAME);

function trsyUtxo(outstanding: bigint, lamp = lampOildrop(100_000n)): UTxO {
  return {
    txHash: "33".repeat(32), outputIndex: 0,
    address: credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(FAKE_TREASURY))),
    assets: { lovelace: 5_000_000n, [TRSY_UNIT]: 1n, [LAMP_UNIT]: lamp },
    datum: treasuryDatumToCbor({ committee_hash: "ee".repeat(28), outstanding_entitlement: outstanding }),
  };
}

function trsyParam(outstanding: bigint, lamp = lampOildrop(100_000n)) {
  return { utxo: trsyUtxo(outstanding, lamp), script: FAKE_TREASURY, nftPolicy: TRSY_POLICY };
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
  it("pays initial datum {entitlement=amount, redeemed=0, start=current, dpe=1}", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
    });
    expect(res.mode).toBe("create");
    // CREATE: không spend ClaimAccount nào; treasury co-spend là input DUY NHẤT.
    expect(rec.collectFrom.filter(c => c.utxos[0]?.assets[TRSY_UNIT] !== 1n)).toHaveLength(0);
    expect(rec.payData.filter(x => x.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.payData[0]!.address).toBe(scriptAddr(FAKE_CLAIM));
    expect(rec.signers.length).toBeGreaterThanOrEqual(2);
    expect(res.newDatum).toEqual({
      owner: OWNER, entitlement: lampOildrop(250n),
      redeemed: 0n, start_epoch: 5n, drops_per_epoch: 1n,
    });
    expect(rec.payData[0]!.datum).toBe(claimAccountDatumToCbor(res.newDatum));
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

  it("increments entitlement, preserves owner+redeemed+start+dpe+assets", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const prev = { owner: OWNER, entitlement: lampOildrop(100n), redeemed: lampOildrop(40n), start_epoch: 3n, drops_per_epoch: 1n };
    const DUST = toUnit("ab".repeat(28), "cafe");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(60n), currentEpoch: 9n,
      claimAccountUtxo: claimUtxo(prev, { [DUST]: 7n }),
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
    });
    expect(res.mode).toBe("update");
    expect(rec.collectFrom.filter(c => c.utxos[0]?.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.attach).toContain(FAKE_CLAIM);
    expect(res.newDatum).toEqual({
      owner: OWNER, entitlement: lampOildrop(160n),   // +60
      redeemed: lampOildrop(40n),                     // unchanged
      start_epoch: 3n,                            // unchanged
      drops_per_epoch: 1n,                        // unchanged
    });
    expect(rec.payData[0]!.assets).toEqual({ lovelace: 2_000_000n, [DUST]: 7n });
  });

  it("rejects amount ≤ 0", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: 0n, currentEpoch: 1n, committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
    })).rejects.toThrow(/amount must be > 0/);
  });

  it("rejects owner mismatch on update", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const prev = { owner: "00".repeat(28), entitlement: 1n, redeemed: 0n, start_epoch: 0n, drops_per_epoch: 1n };
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: 1n, currentEpoch: 1n,
      claimAccountUtxo: claimUtxo(prev), committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
    })).rejects.toThrow(/ownerPkh mismatch/);
  });

  it("rejects below-threshold signers", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: 1n, currentEpoch: 1n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      signerKeyHashes: [COMMITTEE[0]!],   // 1 < threshold 2
    })).rejects.toThrow(/need ≥ 2 signers/);
  });
});

// ── buildPostBeaconTx (DropParam) ──────────────────────────────────────
describe("buildPostBeaconTx — DropParam{D}", () => {
  const NFT_POLICY = "cd".repeat(28);
  const NFT_UNIT   = toUnit(NFT_POLICY, "44524f50"); // "DROP" default asset name

  function beaconUtxo(epoch: bigint, dropValue: bigint, assets: Record<string, bigint>): UTxO {
    return {
      txHash: "cd".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_BEACON),
      assets,
      datum: beaconDatumToCbor({ epoch, kind: "DropParam", drop_value: dropValue }),
    };
  }

  it("posts new DropParam beacon, preserves NFT + assets, no mint", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(9n, lampOildrop(80n), { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: { epoch: 10n, kind: "DropParam", drop_value: D },
      committeeKeyHashes: COMMITTEE,
    });
    expect(rec.collectFrom.filter(c => c.utxos[0]?.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.payData.filter(x => x.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
    expect(rec.payData[0]!.assets).toEqual({ lovelace: 2_000_000n, [NFT_UNIT]: 1n });
    expect(rec.payData[0]!.datum).toBe(beaconDatumToCbor({ epoch: 10n, kind: "DropParam", drop_value: D }));
    expect(rec.signers.length).toBeGreaterThanOrEqual(2);
    expect(res.newBeacon.epoch).toBe(10n);
    expect(res.newBeacon.drop_value).toBe(D);
  });

  it("rejects drop_value ≤ 0", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(9n, D, { lovelace: 2_000_000n, [NFT_UNIT]: 1n }),
      newBeacon: { epoch: 10n, kind: "DropParam", drop_value: 0n },
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/drop_value .* must be > 0/);
  });

  it("rejects when NFT count ≠ 1", async () => {
    const { lucid } = mockLucid("addr_wallet");
    await expect(buildPostBeaconTx({
      lucid, beaconScript: FAKE_BEACON, network: NETWORK,
      beaconNftPolicy: NFT_POLICY,
      beaconUtxo: beaconUtxo(9n, D, { lovelace: 2_000_000n }), // no NFT
      newBeacon: { epoch: 10n, kind: "DropParam", drop_value: D },
      committeeKeyHashes: COMMITTEE,
    })).rejects.toThrow(/exactly 1 authenticity NFT/);
  });
});

// ── buildRedeemTx (Capped Drop) ────────────────────────────────────────
describe("buildRedeemTx — vested = min(E, D·dpe·Δ)", () => {
  function claimUtxo(
    redeemed: bigint, entitlement = lampOildrop(250n), startEpoch = 0n, dpe = 1n,
    extra: Record<string, bigint> = {},
  ): UTxO {
    return {
      txHash: "11".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_CLAIM),
      assets: { lovelace: 2_000_000n, ...extra },
      datum: claimAccountDatumToCbor({
        owner: OWNER, entitlement, redeemed, start_epoch: startEpoch, drops_per_epoch: dpe,
      }),
    };
  }
  function treasuryUtxo(lamp: bigint, extra: Record<string, bigint> = {}, cum = lampOildrop(1000n)): UTxO {
    return {
      txHash: "22".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_TREASURY),
      assets: { lovelace: 5_000_000n, [LAMP_UNIT]: lamp, ...extra },
      datum: treasuryDatumToCbor({ committee_hash: "ee".repeat(28), outstanding_entitlement: cum }),
    };
  }
  function dropBeaconUtxo(dropValue: bigint): UTxO {
    return {
      txHash: "33".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_BEACON),
      assets: { lovelace: 2_000_000n },
      datum: beaconDatumToCbor({ epoch: 7n, kind: "DropParam", drop_value: dropValue }),
    };
  }

  const base = {
    network: NETWORK, claimScript: FAKE_CLAIM, treasuryScript: FAKE_TREASURY,
    lampPolicyId: LAMP_POLICY,
  };

  it("releases vested−redeemed, preserves treasury dust + committee_hash, sets redeemed+=amount", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    const DUST = toUnit("dd".repeat(28), "f00d");
    // E=250, D=100, dpe=1, t0=0, t=3 → vested=min(250,300)=250; redeemed=100 → amount=150.
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: 3n,
      claimAccountUtxo: claimUtxo(lampOildrop(100n)),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n), { [DUST]: 3n }),
      dropBeaconUtxo: dropBeaconUtxo(D),
    });
    expect(res.vested).toBe(lampOildrop(250n));
    expect(res.amount).toBe(lampOildrop(150n));                           // 250 − 100
    expect(res.newClaimDatum.redeemed).toBe(lampOildrop(250n));           // = redeemed + amount
    expect(res.newClaimDatum.entitlement).toBe(lampOildrop(250n));        // unchanged
    expect(res.newClaimDatum.start_epoch).toBe(0n);                   // unchanged
    expect(res.newClaimDatum.drops_per_epoch).toBe(1n);              // unchanged

    // 2 inputs spent (claim + treasury), beacon read-only
    expect(rec.collectFrom).toHaveLength(2);
    expect(rec.readFrom).toHaveLength(1);
    expect(rec.attach).toEqual(expect.arrayContaining([FAKE_CLAIM, FAKE_TREASURY]));

    // treasury output: LAMP 1000→850, dust + lovelace bảo toàn
    const treasuryOut = rec.payData.find(p => p.address === scriptAddr(FAKE_TREASURY))!;
    expect(treasuryOut.assets[LAMP_UNIT]).toBe(lampOildrop(850n));
    expect(treasuryOut.assets.lovelace).toBe(5_000_000n);
    expect(treasuryOut.assets[DUST]).toBe(3n);
    // C-SOLV-3: redeem TRẢ NỢ ⇒ sổ cái giảm ĐÚNG amount, cùng nhịp với pool (1000→850).
    // Bản đầu ép sổ cái BẤT BIẾN ở đây — chính là nguồn bế tắc grant (xem treasury.ak).
    expect(decodeTreasuryDatum(Data.from(treasuryOut.datum)).outstanding_entitlement)
      .toBe(lampOildrop(1000n) - lampOildrop(150n));

    // user receives exactly amount LAMP
    expect(rec.payAddr).toHaveLength(1);
    expect(rec.payAddr[0]!.assets[LAMP_UNIT]).toBe(lampOildrop(150n));
    expect(rec.payAddr[0]!.address).toBe("addr_user");

    // owner signs
    expect(rec.signers).toContain(OWNER);
  });

  it("E < D → epoch đầu nhận hết entitlement", async () => {
    const { lucid } = mockLucid("addr_user");
    // E=30 < D=100, t=1 → vested=min(30,100)=30, redeemed=0 → amount=30.
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: 1n,
      claimAccountUtxo: claimUtxo(0n, lampOildrop(30n)),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
      dropBeaconUtxo: dropBeaconUtxo(D),
    });
    expect(res.amount).toBe(lampOildrop(30n));
    expect(res.newClaimDatum.redeemed).toBe(lampOildrop(30n));
  });

  it("drip: t=1 chỉ mở 1 drop D", async () => {
    const { lucid } = mockLucid("addr_user");
    // E=250, D=100, t=1 → vested=100, redeemed=0 → amount=100.
    const res = await buildRedeemTx({
      ...base, lucid, currentEpoch: 1n,
      claimAccountUtxo: claimUtxo(0n),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
      dropBeaconUtxo: dropBeaconUtxo(D),
    });
    expect(res.amount).toBe(lampOildrop(100n));
  });

  it("sets validFrom khi truyền validFromMs", async () => {
    const { lucid, rec } = mockLucid("addr_user");
    await buildRedeemTx({
      ...base, lucid, currentEpoch: 2n, validFromMs: 2n * 86_400_000n,
      claimAccountUtxo: claimUtxo(0n),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
      dropBeaconUtxo: dropBeaconUtxo(D),
    });
    expect(rec.validFrom).toEqual([Number(2n * 86_400_000n)]);
  });

  it("rejects double-redeem (redeemable ≤ 0, đã redeem hết vested)", async () => {
    const { lucid } = mockLucid("addr_user");
    // t=1 → vested=100; redeemed=100 → amount 0 → reject.
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 1n,
      claimAccountUtxo: claimUtxo(lampOildrop(100n)),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
      dropBeaconUtxo: dropBeaconUtxo(D),
    })).rejects.toThrow(/redeemable ≤ 0/);
  });

  it("rejects khi chưa tới epoch mở khoá (t ≤ t0)", async () => {
    const { lucid } = mockLucid("addr_user");
    // t0=5, t=5 → vested=0 → amount 0 → reject.
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 5n,
      claimAccountUtxo: claimUtxo(0n, lampOildrop(250n), 5n),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
      dropBeaconUtxo: dropBeaconUtxo(D),
    })).rejects.toThrow(/redeemable ≤ 0/);
  });

  it("rejects beacon kind ≠ DropParam", async () => {
    const { lucid } = mockLucid("addr_user");
    const badBeacon: UTxO = {
      txHash: "33".repeat(32), outputIndex: 0,
      address: scriptAddr(FAKE_BEACON),
      assets: { lovelace: 2_000_000n },
      // Constr index 9 (unknown kind) → decode reject
      datum: "d87b9f0700ff", // arbitrary - will fail decode; use explicit below
    };
    // dùng datum hợp lệ nhưng kind sai không tạo được vì chỉ có DropParam.
    // Thay vào: kiểm tra decode reject beacon thiếu datum.
    const noDatum: UTxO = { ...badBeacon, datum: null as any };
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 3n,
      claimAccountUtxo: claimUtxo(0n),
      treasuryUtxo: treasuryUtxo(lampOildrop(1000n)),
      dropBeaconUtxo: noDatum,
    })).rejects.toThrow(/no inline datum/);
  });

  it("rejects treasury với LAMP không đủ", async () => {
    const { lucid } = mockLucid("addr_user");
    // amount=100 ở t=1; treasury chỉ 50 LAMP.
    await expect(buildRedeemTx({
      ...base, lucid, currentEpoch: 1n,
      claimAccountUtxo: claimUtxo(0n),
      treasuryUtxo: treasuryUtxo(lampOildrop(50n)),
      dropBeaconUtxo: dropBeaconUtxo(D),
    })).rejects.toThrow(/< amount/);
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
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      solvency: { treasuryLamp: lampOildrop(1000n), otherOutstanding: lampOildrop(500n) },
    })).rejects.toThrow(/CLAIM-010/);  // 500 + 600 = 1100 > 1000
  });

  it("CREATE: pass khi trong hạn mức quỹ", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(400n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      solvency: { treasuryLamp: lampOildrop(1000n), otherOutstanding: lampOildrop(500n) },
    });
    expect(res.mode).toBe("create");         // 500 + 400 = 900 ≤ 1000
    expect(rec.payData.filter(x => x.assets[TRSY_UNIT] !== 1n)).toHaveLength(1);
  });

  it("UPDATE: dùng entitlement−redeemed sau khi tăng để tính outstanding", async () => {
    const { lucid } = mockLucid("addr_wallet");
    // prev: E=300, redeemed=100 → outstanding cũ 200; +amount 250 → E=550, redeemed=100
    // → thisOutstandingAfter = 450. other 600 → 1050 > 1000 → reject.
    const prev = { owner: OWNER, entitlement: lampOildrop(300n), redeemed: lampOildrop(100n), start_epoch: 2n, drops_per_epoch: 1n };
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(250n), currentEpoch: 9n,
      claimAccountUtxo: claimUtxoS(prev), committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
      solvency: { treasuryLamp: lampOildrop(1000n), otherOutstanding: lampOildrop(600n) },
    })).rejects.toThrow(/CLAIM-010/);
  });

  it("không có solvency param → bỏ qua guard (không regression)", async () => {
    const { lucid, rec } = mockLucid("addr_wallet");
    const res = await buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(999999n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(0n),
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
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(lampOildrop(100n)),
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
      committeeKeyHashes: COMMITTEE, treasury: trsyParam(lampOildrop(100n)),
    });
    expect(res.newTreasuryDatum.outstanding_entitlement).toBe(lampOildrop(500n));
    const treOut = rec.payData.find(p => p.assets[TRSY_UNIT] === 1n)!;
    expect(decodeTreasuryDatum(Data.from(treOut.datum)).outstanding_entitlement).toBe(lampOildrop(500n));
    expect(treOut.assets[LAMP_UNIT]).toBe(lampOildrop(100_000n));
  });

  it("CLAIM-021: từ chối treasury UTxO KHÔNG mang TRSY", async () => {
    const { lucid } = mockLucid("addr_wallet");
    const noNft = { ...trsyUtxo(0n) };
    delete (noNft.assets as Record<string, bigint>)[TRSY_UNIT];
    await expect(buildClaimTx({
      lucid, claimScript: FAKE_CLAIM, network: NETWORK,
      ownerPkh: OWNER, amount: lampOildrop(400n), currentEpoch: 5n,
      committeeKeyHashes: COMMITTEE,
      treasury: { utxo: noNft, script: FAKE_TREASURY, nftPolicy: TRSY_POLICY },
    })).rejects.toThrow(/CLAIM-021/);
  });
});
