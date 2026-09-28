// Faucet v3 datum/redeemer codec — roundtrip + Constr index ĐỌC TỪ `onchain/plutus.json`
// `definitions` (KHÔNG gõ tay index — nguồn duy nhất là blueprint sau `aiken build`).

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Data, Constr } from "@lucid-evolution/lucid";
import {
  encodeFaucetConfig, decodeFaucetConfig, faucetConfigToCbor, faucetConfigFromCbor,
  encodePoolDatum, decodePoolDatum, poolDatumToCbor, poolDatumFromCbor,
  encodeFaucetAccount, decodeFaucetAccount, faucetAccountToCbor, faucetAccountFromCbor,
  poolClaimOpenRedeemerToCbor, poolClaimAgainRedeemerToCbor, poolReclaimRedeemerToCbor,
  poolTopUpPoolRedeemerToCbor, poolRedeemerFromCbor, decodePoolRedeemer,
  encodeMpfProof, decodeMpfProof,
  accountUseRedeemerToCbor, accountTopUpRedeemerToCbor, accountReclaimIdleRedeemerToCbor,
  mintPoolRedeemerToCbor, mintAccountRedeemerToCbor, burnAccountRedeemerToCbor,
  mintGenesisRedeemerToCbor,
} from "../offchain/src/datum.js";
import { DRIP_OILDROP, COOLDOWN, MAX_CLAIMS_CEILING } from "../offchain/src/constants.js";

// `process.cwd()` — KHÔNG `import.meta.url` (vitest luôn chạy từ `offchain/`, xem
// `package.json` scripts `test`/`test:watch`; TS1470 "import.meta not allowed" nổ ở đây vì
// `tests/**` nằm ngoài rootDir ESM của package — rootDir-gap đã ghi ở đầu `tsconfig.json`,
// tránh THÊM một ca mới của cùng lỗ thay vì vá nó ở đây).
const PLUTUS_JSON_PATH = resolve(process.cwd(), "../onchain/plutus.json");

interface BlueprintCtor { title: string; index: number; fields: { title?: string }[] }
interface BlueprintDef { title: string; anyOf?: BlueprintCtor[]; fields?: { title?: string }[] }

let defs: Record<string, BlueprintDef>;

beforeAll(async () => {
  const bp = JSON.parse(await readFile(PLUTUS_JSON_PATH, "utf8"));
  defs = bp.definitions;
});

/** Index Constr của một constructor cụ thể trong một enum `magiclamp/faucet/ledger/<Name>`. */
function ctorIndex(typeName: string, ctorTitle: string): number {
  const key = `magiclamp/faucet/ledger/${typeName}`;
  const def = defs[key];
  if (!def?.anyOf) throw new Error(`blueprint thiếu definition '${key}'`);
  const ctor = def.anyOf.find((c) => c.title === ctorTitle);
  if (!ctor) throw new Error(`'${key}' không có constructor '${ctorTitle}'`);
  return ctor.index;
}

/** Danh sách field title (thứ tự) của MỘT record type có đúng 1 constructor. */
function recordFields(typeName: string): string[] {
  const key = `magiclamp/faucet/ledger/${typeName}`;
  const def = defs[key];
  const ctor = def?.anyOf?.[0];
  if (!ctor) throw new Error(`'${key}' không có constructor 0`);
  return ctor.fields.map((f) => f.title ?? "");
}

/** Tên field (thứ tự) của một constructor cụ thể trong enum `magiclamp/faucet/ledger/<Name>`. */
function ctorFields(typeName: string, ctorTitle: string): string[] {
  const def = defs[`magiclamp/faucet/ledger/${typeName}`];
  const ctor = def?.anyOf?.find((c) => c.title === ctorTitle);
  if (!ctor) throw new Error(`'${typeName}' không có constructor '${ctorTitle}'`);
  return ctor.fields.map((f) => f.title ?? "");
}

/** Index + tên field của một constructor trong `aiken/merkle_patricia_forestry/<Name>`. */
function mpfCtor(typeName: string, ctorTitle: string): { index: number; fields: string[] } {
  const def = defs[`aiken/merkle_patricia_forestry/${typeName}`];
  const ctor = def?.anyOf?.find((c) => c.title === ctorTitle);
  if (!ctor) throw new Error(`blueprint thiếu 'aiken/merkle_patricia_forestry/${typeName}.${ctorTitle}'`);
  return { index: ctor.index, fields: ctor.fields.map((f) => f.title ?? "") };
}

// Một bằng chứng đủ ba loại bước (giá trị hợp lệ về độ dài; đúng/sai toán học không phải việc
// của codec — bài parity ở `openedLedger.test.ts` lo phần đó).
const PROOF_SAMPLE = [
  { kind: "Branch" as const, skip: 0n, neighbors: "11".repeat(128) },
  { kind: "Fork" as const, skip: 2n, neighbor: { nibble: 13n, prefix: "00", root: "22".repeat(32) } },
  { kind: "Leaf" as const, skip: 1n, key: "33".repeat(32), value: "44".repeat(32) },
];

describe("PoolRedeemer / AccountRedeemer / FaucetNftRedeemer — index KHỚP blueprint", () => {
  it("PoolRedeemer: ClaimOpen{proof}/ClaimAgain/Reclaim{proof}/TopUpPool", () => {
    expect(poolClaimOpenRedeemerToCbor([])).toBe(Data.to(new Constr(ctorIndex("PoolRedeemer", "ClaimOpen"), [[]])));
    expect(poolClaimAgainRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("PoolRedeemer", "ClaimAgain"), [])));
    expect(poolReclaimRedeemerToCbor([])).toBe(Data.to(new Constr(ctorIndex("PoolRedeemer", "Reclaim"), [[]])));
    expect(poolTopUpPoolRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("PoolRedeemer", "TopUpPool"), [])));
    // Reclaim DỊCH 1→2 so với v2 — khoá cứng bằng số, không chỉ bằng tên hàm.
    expect(ctorIndex("PoolRedeemer", "Reclaim")).toBe(2);
    // v3.1: hai nhánh đổi sổ mang ĐÚNG một field `proof`; hai nhánh còn lại rỗng.
    expect(ctorFields("PoolRedeemer", "ClaimOpen")).toEqual(["proof"]);
    expect(ctorFields("PoolRedeemer", "Reclaim")).toEqual(["proof"]);
    expect(ctorFields("PoolRedeemer", "ClaimAgain")).toEqual([]);
    expect(ctorFields("PoolRedeemer", "TopUpPool")).toEqual([]);
  });

  it("ProofStep/Neighbor: index + thứ tự field KHỚP blueprint của thư viện MPF", () => {
    expect(mpfCtor("ProofStep", "Branch")).toEqual({ index: 0, fields: ["skip", "neighbors"] });
    expect(mpfCtor("ProofStep", "Fork")).toEqual({ index: 1, fields: ["skip", "neighbor"] });
    expect(mpfCtor("ProofStep", "Leaf")).toEqual({ index: 2, fields: ["skip", "key", "value"] });
    expect(mpfCtor("Neighbor", "Neighbor")).toEqual({ index: 0, fields: ["nibble", "prefix", "root"] });
  });

  it("PoolRedeemer có proof round-trip (ClaimOpen + Reclaim, đủ Branch/Fork/Leaf)", () => {
    expect(poolRedeemerFromCbor(poolClaimOpenRedeemerToCbor(PROOF_SAMPLE))).toEqual({ kind: "ClaimOpen", proof: PROOF_SAMPLE });
    expect(poolRedeemerFromCbor(poolReclaimRedeemerToCbor(PROOF_SAMPLE))).toEqual({ kind: "Reclaim", proof: PROOF_SAMPLE });
    expect(poolRedeemerFromCbor(poolClaimAgainRedeemerToCbor())).toEqual({ kind: "ClaimAgain" });
    expect(poolRedeemerFromCbor(poolTopUpPoolRedeemerToCbor())).toEqual({ kind: "TopUpPool" });
    expect(decodeMpfProof(encodeMpfProof(PROOF_SAMPLE))).toEqual(PROOF_SAMPLE);
  });

  it("proof hình dạng lạ → NÉM (neighbors sai độ dài, ClaimOpen thiếu proof, step index lạ)", () => {
    expect(() => poolClaimOpenRedeemerToCbor([{ kind: "Branch", skip: 0n, neighbors: "11".repeat(127) }]))
      .toThrow(/FAUCET-DATUM-005/);
    expect(() => poolReclaimRedeemerToCbor([{ kind: "Leaf", skip: -1n, key: "33".repeat(32), value: "44".repeat(32) }]))
      .toThrow(/FAUCET-DATUM-006/);
    expect(() => decodePoolRedeemer(new Constr(0, []))).toThrow(/FAUCET-DATUM-062/);
    expect(() => decodePoolRedeemer(new Constr(1, [[]]))).toThrow(/FAUCET-DATUM-062/);
    expect(() => decodePoolRedeemer(new Constr(0, [[new Constr(3, [0n])]]))).toThrow(/FAUCET-DATUM-071/);
    expect(() => decodePoolRedeemer(new Constr(4, []))).toThrow(/FAUCET-DATUM-061/);
  });

  it("AccountRedeemer: Use/TopUp/ReclaimIdle — TopUp XEN GIỮA, ReclaimIdle dịch 1→2", () => {
    expect(accountUseRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("AccountRedeemer", "Use"), [])));
    expect(accountTopUpRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("AccountRedeemer", "TopUp"), [])));
    expect(accountReclaimIdleRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("AccountRedeemer", "ReclaimIdle"), [])));
    expect(ctorIndex("AccountRedeemer", "ReclaimIdle")).toBe(2);
  });

  it("FaucetNftRedeemer: MintPool/MintAccount/BurnAccount — BurnAccount MỚI", () => {
    expect(mintPoolRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("FaucetNftRedeemer", "MintPool"), [])));
    expect(mintAccountRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("FaucetNftRedeemer", "MintAccount"), [])));
    expect(burnAccountRedeemerToCbor()).toBe(Data.to(new Constr(ctorIndex("FaucetNftRedeemer", "BurnAccount"), [])));
    expect(ctorIndex("FaucetNftRedeemer", "BurnAccount")).toBe(2);
  });

  it("TLampRedeemer::MintGenesis = Constr(0, []) — validator riêng, KHÔNG đổi ở bản vá này", () => {
    expect(mintGenesisRedeemerToCbor()).toBe("d87980");
  });
});

describe("FaucetConfig codec — 3 trường, thứ tự KHỚP blueprint", () => {
  const cfg = { drip_oildrop: DRIP_OILDROP, cooldown_epochs: COOLDOWN, max_claims_per_window: MAX_CLAIMS_CEILING };

  it("field order khớp blueprint (drip_oildrop, cooldown_epochs, max_claims_per_window)", () => {
    expect(recordFields("FaucetConfig")).toEqual(["drip_oildrop", "cooldown_epochs", "max_claims_per_window"]);
  });

  it("round-trips", () => {
    expect(faucetConfigFromCbor(faucetConfigToCbor(cfg))).toEqual(cfg);
  });

  it("encodes as Constr(0, [int,int,int])", () => {
    const back = decodeFaucetConfig(Data.from(faucetConfigToCbor(cfg)));
    expect(back.drip_oildrop).toBe(DRIP_OILDROP);
    expect(back.cooldown_epochs).toBe(COOLDOWN);
    expect(back.max_claims_per_window).toBe(MAX_CLAIMS_CEILING);
  });

  it("rejects wrong field count", () => {
    // d8799f01ff = Constr(0, [1]) → 1 field → reject (FaucetConfig cần 3).
    expect(() => decodeFaucetConfig(Data.from("d8799f01ff"))).toThrow(/3 field/);
  });
});

describe("PoolDatum codec — Constr(0, [FaucetConfig, window_epoch, claims_in_window, opened_root])", () => {
  const cfg = { drip_oildrop: DRIP_OILDROP, cooldown_epochs: COOLDOWN, max_claims_per_window: 20n };
  const pd = { cfg, window_epoch: 100n, claims_in_window: 3n, opened_root: "ab".repeat(32) };

  it("field order khớp blueprint (cfg, window_epoch, claims_in_window, opened_root)", () => {
    expect(recordFields("PoolDatum")).toEqual(["cfg", "window_epoch", "claims_in_window", "opened_root"]);
  });

  it("opened_root là trường THỨ TƯ, mã hoá dạng bytes (không bị gộp/đổi chỗ)", () => {
    const enc = encodePoolDatum(pd);
    expect(enc.fields).toHaveLength(4);
    expect(enc.fields[3]).toBe("ab".repeat(32));
    expect(poolDatumFromCbor(poolDatumToCbor(pd)).opened_root).toBe("ab".repeat(32));
  });

  it("rejects opened_root không đúng 32 byte — cả chiều mã hoá lẫn giải mã", () => {
    expect(() => poolDatumToCbor({ ...pd, opened_root: "ab".repeat(31) })).toThrow(/FAUCET-DATUM-005/);
    const short = Data.to(new Constr(0, [encodeFaucetConfig(cfg), 100n, 3n, "ab".repeat(28)]));
    expect(() => poolDatumFromCbor(short)).toThrow(/FAUCET-DATUM-005/);
    const notBytes = Data.to(new Constr(0, [encodeFaucetConfig(cfg), 100n, 3n, 7n]));
    expect(() => poolDatumFromCbor(notBytes)).toThrow(/FAUCET-DATUM-003/);
  });

  it("rejects datum 3 trường (hình dạng v3 trước sổ) — không đệm gốc rỗng", () => {
    const threeField = Data.to(new Constr(0, [encodeFaucetConfig(cfg), 100n, 3n]));
    expect(() => poolDatumFromCbor(threeField)).toThrow(/4 field/);
  });

  it("round-trips (nested Constr)", () => {
    expect(poolDatumFromCbor(poolDatumToCbor(pd))).toEqual(pd);
  });

  it("encode gói FaucetConfig làm Constr con", () => {
    const enc = encodePoolDatum(pd);
    expect(enc.index).toBe(0);
    expect(enc.fields[0]).toBeInstanceOf(Constr);
    expect((enc.fields[0] as Constr<unknown>).index).toBe(0);
  });

  it("rejects wrong field count", () => {
    expect(() => decodePoolDatum(Data.from("d8799f01ff"))).toThrow(/4 field/);
  });

  it("out_pd.cfg == cfg (C-CFG-1 offchain mirror): datum bảo toàn qua roundtrip", () => {
    const cbor = poolDatumToCbor(pd);
    const back = poolDatumFromCbor(cbor);
    expect(back.cfg).toEqual(cfg);
  });
});

describe("FaucetAccount codec — 3 trường: did_name, last_claim_epoch, last_touch_epoch", () => {
  const acct = { did_name: "a11ce0", last_claim_epoch: 100n, last_touch_epoch: 105n };

  it("field order khớp blueprint (did_name, last_claim_epoch, last_touch_epoch)", () => {
    expect(recordFields("FaucetAccount")).toEqual(["did_name", "last_claim_epoch", "last_touch_epoch"]);
  });

  it("round-trips — HAI mốc riêng, không gộp", () => {
    expect(faucetAccountFromCbor(faucetAccountToCbor(acct))).toEqual(acct);
  });

  it("encodes did_name as hex bytes, hai mốc như int riêng", () => {
    const back = decodeFaucetAccount(Data.from(faucetAccountToCbor(acct)));
    expect(back.did_name).toBe("a11ce0");
    expect(back.last_claim_epoch).toBe(100n);
    expect(back.last_touch_epoch).toBe(105n);
  });

  it("hai mốc LỆCH NHAU vẫn round-trip đúng (không bị gộp lại thành một)", () => {
    const a2 = { did_name: "deadbeefcafe", last_claim_epoch: 50n, last_touch_epoch: 9999n };
    const back = faucetAccountFromCbor(faucetAccountToCbor(a2));
    expect(back).toEqual(a2);
    expect(back.last_claim_epoch).not.toBe(back.last_touch_epoch);
  });

  it("rejects wrong field count (2 field — hình dạng v2 cũ)", () => {
    // d8799f4361626302ff xấp xỉ Constr(0,[bytes,int]) 2 field → reject (v3 cần 3).
    const twoField = Data.to(new Constr(0, ["616263", 2n]));
    expect(() => decodeFaucetAccount(Data.from(twoField))).toThrow(/3 field/);
  });
});

describe("Hình dạng lạ → NÉM, không đệm", () => {
  it("decodeFaucetConfig từ chối non-Constr", () => {
    expect(() => decodeFaucetConfig("deadbeef")).toThrow(/expected Constr/);
  });
  it("decodePoolDatum từ chối sai constructor index", () => {
    const wrongIndex = Data.to(new Constr(1, [encodeFaucetConfig({
      drip_oildrop: 1n, cooldown_epochs: 1n, max_claims_per_window: 1n,
    }), 0n, 0n, "00".repeat(32)]));
    expect(() => decodePoolDatum(Data.from(wrongIndex))).toThrow(/Constr 0/);
  });
});
