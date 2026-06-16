// PlatformKit · registryQuery discover platform từ utxos[] thuần (không chain thật).

import { describe, it, expect } from "vitest";
import {
  discoverPlatforms, filterByStatus, findPlatform, platformNftPresent,
  findDuplicatePlatformIds, verifyEntryAgainstCustody,
  type QueryUtxo,
} from "../offchain/src/registryQuery.js";
import { planRegister } from "../offchain/src/registrationBuilder.js";
import { platformEntryToCbor } from "../offchain/src/registryDatum.js";
import type { PlatformEntry } from "../offchain/src/types.js";
import { asciiToHex } from "../offchain/src/encoding.js";

const BEACON = "12".repeat(28);
const CUSTODY_HASH = "34".repeat(28);
const SEED_POLICY  = "56".repeat(28);

/** Custody UTxO hợp lệ cho R-BIND khi dựng entry test. */
const okCustody = (instanceHex: string) => ({
  value: { [`${SEED_POLICY}|${instanceHex}`]: 1n, "|": 2_000_000n },
  scriptHash: CUSTODY_HASH,
});

/** Dựng UTxO entry mang beacon NFT + inline datum từ một PlatformEntry. */
function entryUtxo(entry: PlatformEntry, extraAssets: Record<string, bigint> = {}): QueryUtxo {
  const unit = BEACON + entry.platform_id;
  return {
    assets: { lovelace: 2_000_000n, [unit]: 1n, ...extraAssets },
    datum: platformEntryToCbor(entry),
    txHash: "aa".repeat(32),
    outputIndex: 0,
  };
}

function mkEntry(name: string, status: PlatformEntry["status"] = "Active"): PlatformEntry {
  const plan = planRegister({
    config: {
      platformId: asciiToHex(name),
      instanceId: asciiToHex(`${name}-inst`),
      acceptedAssets: [{ policy: "", name: "" }],
      buckets: [{ id: 0n, label: "ops" }],
      cutBps: 300n,
      governanceRef: "cc".repeat(28),
      msPerEpoch: 86_400_000n,
      reservedMinAda: 2_000_000n,
      registryAuthority: "ab".repeat(28),
      genesisRef: { transaction_id: "ff".repeat(32), output_index: 0n },
    },
    beaconPolicy: BEACON, custodyHash: CUSTODY_HASH, seedPolicy: SEED_POLICY,
    createdEpoch: 1n,
    custodyUtxo: okCustody(asciiToHex(`${name}-inst`)),
  });
  return { ...plan.entry, status };
}

describe("discoverPlatforms", () => {
  it("decode mọi entry UTxO mang beacon NFT", () => {
    const utxos: QueryUtxo[] = [
      entryUtxo(mkEntry("PhoenixKey")),
      entryUtxo(mkEntry("OriLife")),
      // UTxO thường (không beacon) → bỏ qua.
      { assets: { lovelace: 5_000_000n }, datum: null },
    ];
    const found = discoverPlatforms(utxos, BEACON);
    expect(found.length).toBe(2);
    expect(found.map((p) => p.entry.platform_id).sort())
      .toEqual([asciiToHex("OriLife"), asciiToHex("PhoenixKey")].sort());
    expect(found[0]!.nftUnit.startsWith(BEACON)).toBe(true);
  });

  it("loại entry giả: datum.platform_id != NFT name", () => {
    const real = mkEntry("PhoenixKey");
    // UTxO mang NFT name "PhoenixKey" nhưng datum khai platform_id "OriLife" → giả.
    const fake: QueryUtxo = {
      assets: { lovelace: 2_000_000n, [BEACON + asciiToHex("PhoenixKey")]: 1n },
      datum: platformEntryToCbor({ ...real, platform_id: asciiToHex("OriLife") }),
    };
    expect(discoverPlatforms([fake], BEACON).length).toBe(0);
    expect(() => discoverPlatforms([fake], BEACON, { strict: true })).toThrow(/QUERY-004/);
  });

  it("strict: UTxO beacon thiếu datum → ném", () => {
    const u: QueryUtxo = { assets: { lovelace: 2_000_000n, [BEACON + asciiToHex("X")]: 1n }, datum: null };
    expect(discoverPlatforms([u], BEACON).length).toBe(0);
    expect(() => discoverPlatforms([u], BEACON, { strict: true })).toThrow(/QUERY-003/);
  });

  it("bỏ qua policy khác (chỉ lọc đúng beacon policy)", () => {
    const u = entryUtxo(mkEntry("PhoenixKey"));
    expect(discoverPlatforms([u], "99".repeat(28)).length).toBe(0);
  });
});

describe("filter + find + present", () => {
  const utxos = [
    entryUtxo(mkEntry("PhoenixKey", "Active")),
    entryUtxo(mkEntry("OriLife", "Paused")),
  ];
  const found = discoverPlatforms(utxos, BEACON);

  it("filterByStatus", () => {
    expect(filterByStatus(found, "Active").length).toBe(1);
    expect(filterByStatus(found, "Active")[0]!.entry.platform_id).toBe(asciiToHex("PhoenixKey"));
  });
  it("findPlatform theo id", () => {
    expect(findPlatform(found, asciiToHex("OriLife"))!.entry.status).toBe("Paused");
    expect(findPlatform(found, asciiToHex("Nope"))).toBeUndefined();
  });
  it("platformNftPresent", () => {
    expect(platformNftPresent(utxos[0]!, BEACON, asciiToHex("PhoenixKey"))).toBe(true);
    expect(platformNftPresent(utxos[0]!, BEACON, asciiToHex("OriLife"))).toBe(false);
  });
});

describe("audit #2 — duplicate platform_id (không im lặng chọn cái đầu)", () => {
  it("2 entry trùng platform_id → đánh dấu duplicate + findDuplicatePlatformIds bắt được", () => {
    const dup1 = mkEntry("PhoenixKey", "Active");
    const dup2 = mkEntry("PhoenixKey", "Paused");   // cùng platform_id, UTxO khác.
    const uniq = mkEntry("OriLife", "Active");
    const utxos: QueryUtxo[] = [
      entryUtxo(dup1),
      { ...entryUtxo(dup2), txHash: "bb".repeat(32), outputIndex: 1 },
      entryUtxo(uniq),
    ];
    const found = discoverPlatforms(utxos, BEACON);
    expect(found.length).toBe(3);

    // PhoenixKey (2 bản) bị đánh dấu duplicate; OriLife thì không.
    const pk = found.filter((p) => p.entry.platform_id === asciiToHex("PhoenixKey"));
    expect(pk.length).toBe(2);
    expect(pk.every((p) => p.duplicate)).toBe(true);
    const ori = found.find((p) => p.entry.platform_id === asciiToHex("OriLife"))!;
    expect(ori.duplicate).toBe(false);

    // findDuplicatePlatformIds: chỉ PhoenixKey trùng.
    const dups = findDuplicatePlatformIds(found);
    expect(dups.size).toBe(1);
    expect(dups.get(asciiToHex("PhoenixKey"))!.length).toBe(2);
    expect(dups.has(asciiToHex("OriLife"))).toBe(false);
  });

  it("không trùng → findDuplicatePlatformIds rỗng", () => {
    const found = discoverPlatforms(
      [entryUtxo(mkEntry("PhoenixKey")), entryUtxo(mkEntry("OriLife"))], BEACON,
    );
    expect(findDuplicatePlatformIds(found).size).toBe(0);
    expect(found.every((p) => !p.duplicate)).toBe(true);
  });

  it("audit #3 — registryScriptHash: entry ở script lạ bị đánh dấu foreignScript", () => {
    const good: QueryUtxo = { ...entryUtxo(mkEntry("PhoenixKey")), scriptHash: "77".repeat(28) };
    const foreign: QueryUtxo = { ...entryUtxo(mkEntry("OriLife")), scriptHash: "99".repeat(28) };
    const found = discoverPlatforms([good, foreign], BEACON, { registryScriptHash: "77".repeat(28) });
    const pk = found.find((p) => p.entry.platform_id === asciiToHex("PhoenixKey"))!;
    const ori = found.find((p) => p.entry.platform_id === asciiToHex("OriLife"))!;
    expect(pk.foreignScript).toBe(false);
    expect(ori.foreignScript).toBe(true);
  });
});

describe("audit #6 — verifyEntryAgainstCustody (đối soát entry với custody thật)", () => {
  const entry = mkEntry("PhoenixKey");   // seed_policy=SEED_POLICY, custody_hash=CUSTODY_HASH, instance=PhoenixKey-inst.
  const instHex = asciiToHex("PhoenixKey-inst");

  it("happy: custody mang đúng 1 NFT @ đúng script hash → ok", () => {
    const custody: QueryUtxo = {
      assets: { lovelace: 2_000_000n, [SEED_POLICY + instHex]: 1n },
      scriptHash: CUSTODY_HASH,
    };
    expect(verifyEntryAgainstCustody(entry, custody)).toEqual({ ok: true });
  });

  it("sai script hash → {ok:false, reason custody_hash}", () => {
    const custody: QueryUtxo = {
      assets: { lovelace: 2_000_000n, [SEED_POLICY + instHex]: 1n },
      scriptHash: "00".repeat(28),
    };
    const r = verifyEntryAgainstCustody(entry, custody);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/custody_hash/);
  });

  it("thiếu NFT authenticity → {ok:false, reason NFT}", () => {
    const custody: QueryUtxo = { assets: { lovelace: 2_000_000n }, scriptHash: CUSTODY_HASH };
    const r = verifyEntryAgainstCustody(entry, custody);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/NFT/);
  });

  it("thiếu scriptHash (không đối soát được) → {ok:false}", () => {
    const custody: QueryUtxo = { assets: { lovelace: 2_000_000n, [SEED_POLICY + instHex]: 1n } };
    const r = verifyEntryAgainstCustody(entry, custody);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scriptHash/);
  });
});
