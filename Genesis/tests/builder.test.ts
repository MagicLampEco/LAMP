// Test buildGenesisTx — mock Lucid (KHÔNG submit). Assert:
//   G-MINT-1  mint == A oil tLAMP + 4 NFT pot (mỗi pot 1), không asset lạ.
//   G-SUM     Σ output tLAMP (4 custody) == A — token KHÔNG rơi ngoài 4 pot (đòn #5).
//   G-SEED    datum mỗi output đúng (tái dùng planGenesisPots tự kiểm).
// Mirror mock-Lucid của Distribution builders.test.ts.

import { describe, it, expect } from "vitest";
import {
  validatorToScriptHash, credentialToAddress, scriptHashToCredential, mintingPolicyToId,
  type Assets, type Validator, type MintingPolicy,
} from "@lucid-evolution/lucid";

import { buildGenesisTx, type PotCustody } from "../offchain/src/genesisBuilder.js";
import { TLAMP_ASSET_NAME } from "../offchain/src/pots.js";
import { POT_ID, TOTAL_SUPPLY_OIL, OIL_PER_LAMP, type PotName } from "../offchain/src/split.js";
import { custodyDatumFromCbor } from "@magiclamp/treasury-sdk";

const A = TOTAL_SUPPLY_OIL;
const NETWORK = "Preview" as const;

// ── Mock Lucid ──────────────────────────────────────────────────────────
interface Recorded {
  mint:    { assets: Assets; redeemer: string }[];
  attach:  MintingPolicy[];
  payData: { address: string; datum: string; assets: Assets }[];
}
function mockLucid(): { lucid: any; rec: Recorded } {
  const rec: Recorded = { mint: [], attach: [], payData: [] };
  const txb: any = {
    mintAssets(assets: Assets, redeemer: string) { rec.mint.push({ assets, redeemer }); return txb; },
    attach: { MintingPolicy(p: MintingPolicy) { rec.attach.push(p); return txb; } },
    pay: {
      ToAddressWithData(address: string, datum: { kind: string; value: string }, assets: Assets) {
        rec.payData.push({ address, datum: datum.value, assets }); return txb;
      },
    },
    async complete() { return { __mockTx: true }; },
  };
  const lucid = { newTx() { return txb; } };
  return { lucid, rec };
}

// fake validators — CBOR hợp lệ khác nhau → 4 script hash riêng (tách-hash mỗi pot).
const FAKE: Record<PotName, Validator> = {
  Distribution: { type: "PlutusV3", script: "49480100002221200101" },
  Reserve:      { type: "PlutusV3", script: "49480100002221200102" },
  Treasury:     { type: "PlutusV3", script: "49480100002221200103" },
  Deposits:     { type: "PlutusV3", script: "49480100002221200104" },
};
const GENESIS_POLICY: MintingPolicy = { type: "PlutusV3", script: "49480100002221200199" };

const TLAMP_POLICY = mintingPolicyToId(GENESIS_POLICY);
const RESERVED = 2_000_000n;

function custodies(): PotCustody[] {
  return (["Distribution", "Reserve", "Treasury", "Deposits"] as PotName[]).map((pot) => ({
    pot, script: FAKE[pot], minAda: RESERVED,
  }));
}

async function build() {
  const { lucid, rec } = mockLucid();
  const res = await buildGenesisTx({
    lucid, network: NETWORK,
    genesisPolicy: GENESIS_POLICY,
    custodies: custodies(),
    tlamp: { policy: TLAMP_POLICY, name: TLAMP_ASSET_NAME },
    governanceRef: "9999", cutBps: 1_000n, epoch: 0n, reservedMinAda: RESERVED,
  });
  return { res, rec };
}

function scriptAddr(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

describe("buildGenesisTx — G-MINT-1 (mint A tLAMP + 4 NFT)", () => {
  it("mint đúng A oil tLAMP + 4 NFT pot (mỗi pot 1)", async () => {
    const { res, rec } = await build();
    expect(rec.mint).toHaveLength(1);
    const m = rec.mint[0]!.assets;
    expect(m[res.tlampUnit]).toBe(A);
    for (const pot of ["Distribution", "Reserve", "Treasury", "Deposits"] as PotName[]) {
      expect(m[`${res.policyId}${POT_ID[pot]}`]).toBe(1n);
    }
  });

  it("KHÔNG mint asset lạ (đúng 5 entry: tLAMP + 4 NFT)", async () => {
    const { rec } = await build();
    expect(Object.keys(rec.mint[0]!.assets)).toHaveLength(5);
  });

  it("attach genesis minting policy", async () => {
    const { rec } = await build();
    expect(rec.attach).toEqual([GENESIS_POLICY]);
  });
});

describe("buildGenesisTx — G-SUM (Σ output == mint, đòn #5)", () => {
  it("đúng 4 custody output", async () => {
    const { rec } = await build();
    expect(rec.payData).toHaveLength(4);
  });

  it("Σ tLAMP 4 output == A (token KHÔNG rơi ngoài pot)", async () => {
    const { res, rec } = await build();
    const sum = rec.payData.reduce((s, o) => s + (o.assets[res.tlampUnit] ?? 0n), 0n);
    expect(sum).toBe(A);
  });

  it("circulating @genesis = mint − Σ output = 0", async () => {
    const { res, rec } = await build();
    const sum = rec.payData.reduce((s, o) => s + (o.assets[res.tlampUnit] ?? 0n), 0n);
    expect(res.mintedOil - sum).toBe(0n);
  });
});

describe("buildGenesisTx — mỗi pot đúng address/value/NFT/datum", () => {
  it("mỗi pot ở custody address riêng (4 hash phân biệt — đòn #2)", async () => {
    const { rec } = await build();
    const addrs = rec.payData.map((o) => o.address);
    expect(new Set(addrs).size).toBe(4);
    expect(addrs).toEqual([
      scriptAddr(FAKE.Distribution), scriptAddr(FAKE.Reserve),
      scriptAddr(FAKE.Treasury), scriptAddr(FAKE.Deposits),
    ]);
  });

  it("Distribution output: 34.2 tỷ tLAMP + NFT DR + reserved ADA", async () => {
    const { res, rec } = await build();
    const out = rec.payData[0]!;
    expect(out.assets[res.tlampUnit]).toBe(34_200_000_000n * OIL_PER_LAMP);
    expect(out.assets[`${res.policyId}${POT_ID.Distribution}`]).toBe(1n);
    expect(out.assets["lovelace"]).toBe(RESERVED);
  });

  it("Treasury output: 0 tLAMP (không key tLAMP) + NFT TR + reserved", async () => {
    const { res, rec } = await build();
    const out = rec.payData[2]!;
    expect(out.assets[res.tlampUnit]).toBeUndefined();
    expect(out.assets[`${res.policyId}${POT_ID.Treasury}`]).toBe(1n);
    expect(out.assets["lovelace"]).toBe(RESERVED);
  });

  it("datum mỗi output decode đúng instance_id pot", async () => {
    const { rec } = await build();
    const ids = rec.payData.map((o) => custodyDatumFromCbor(o.datum).instance_id);
    expect(ids).toEqual([POT_ID.Distribution, POT_ID.Reserve, POT_ID.Treasury, POT_ID.Deposits]);
  });
});

describe("buildGenesisTx — chặn input sai", () => {
  it("thiếu custody (3 thay vì 4) → throw", async () => {
    const { lucid } = mockLucid();
    await expect(buildGenesisTx({
      lucid, network: NETWORK, genesisPolicy: GENESIS_POLICY,
      custodies: custodies().slice(0, 3),
      tlamp: { policy: TLAMP_POLICY, name: TLAMP_ASSET_NAME },
      governanceRef: "9999", cutBps: 0n, epoch: 0n, reservedMinAda: RESERVED,
    })).rejects.toThrow(/GBUILD-001/);
  });
});
