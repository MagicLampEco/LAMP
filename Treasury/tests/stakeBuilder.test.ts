// Vitest — apply-param `treasury_stake` + địa chỉ kho dạng BASE.
//
// Vì sao bộ kiểm này tồn tại: đường gieo cũ dựng địa chỉ ENTERPRISE
// (`config.ts` ▸ `scriptAddress`, hai tham số). Kho gieo ở địa chỉ enterprise KHÔNG có
// phần stake ⇒ không uỷ quyền được ⇒ không sinh thưởng; và `custody.ak` ghim
// `cust_out.address == cust_in.address` kể cả phần stake, nên không có tx nào dời được kho
// sang địa chỉ base sau đó. Sai một lần là sai vĩnh viễn cho instance đó.
//
// Ba khe của `treasury_stake` đều NƯỚNG vào script hash ⇒ vào phần stake của địa chỉ. Nên
// mỗi ca dưới đây hỏi đúng một câu: "đổi khe này thì địa chỉ có đổi không?" Không đổi tức
// là khe đó không thật sự đi vào hash, và lúc đó hai instance khác nhau dùng chung một kho.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Constr, getAddressDetails, validatorToScriptHash,
  type Network, type Validator,
} from "@lucid-evolution/lucid";
import {
  applyTreasuryStake, treasuryStakeParamList, treasuryStakeHash,
  custodyBaseAddress, custodyRewardCredential,
} from "../offchain/src/stakeBuilder.js";

const PLUTUS_JSON = resolve(process.cwd(), "../onchain/plutus.json");
const NETWORK: Network = "Preview";

function load(title: string): Validator {
  const pj = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const v = pj.validators.find((x: { title: string }) => x.title === title);
  if (!v) throw new Error(`${title} không có trong plutus.json — chạy aiken build trong onchain/`);
  return { type: "PlutusV3", script: v.compiledCode as string };
}

const STAKE_RAW = load("treasury_stake.treasury_stake.withdraw");
const CUSTODY = load("custody.custody.spend");
const CUSTODY_HASH = validatorToScriptHash(CUSTODY);

const INSTANCE = "74726561737572792d637573746f64792d7631";   // "treasury-custody-v1"
const ADMIN = "5e".repeat(28);

const base = { instanceId: INSTANCE, rewardCred: { kind: "Script" as const, hash: CUSTODY_HASH }, delegationAdmin: ADMIN };
const applied = applyTreasuryStake(STAKE_RAW.script, base);

// ══ Thứ tự + hình dạng khe ═════════════════════════════════════════════
describe("treasuryStakeParamList", () => {
  it("đúng BA khe, thứ tự [instance_id, reward_cred, delegation_admin]", () => {
    const l = treasuryStakeParamList(base);
    expect(l).toHaveLength(3);
    expect(l[0]).toBe(INSTANCE);
    expect(l[2]).toBe(ADMIN);
  });

  // `Credential` on-chain: VerificationKey = Constr 0, Script = Constr 1. Đảo hai số này
  // thì apply vẫn chạy, hash vẫn ra, địa chỉ vẫn hợp lệ — và validator từ chối MỌI lần rút
  // thưởng. Không có gì kêu cho tới lúc đó.
  it("reward_cred kiểu Script là Constr 1, VerificationKey là Constr 0", () => {
    const s = treasuryStakeParamList(base)[1] as Constr<unknown>;
    expect(s.index).toBe(1);
    expect(s.fields).toEqual([CUSTODY_HASH]);
    const v = treasuryStakeParamList({ ...base, rewardCred: { kind: "VerificationKey", hash: ADMIN } })[1] as Constr<unknown>;
    expect(v.index).toBe(0);
  });

  it("ĐỎ: instance_id rỗng — validator từ chối nó ngay dòng đầu", () => {
    expect(() => treasuryStakeParamList({ ...base, instanceId: "" })).toThrow(/TSTAKE-003/);
  });

  it("ĐỎ: reward_cred.hash sai độ dài", () => {
    expect(() => treasuryStakeParamList({ ...base, rewardCred: { kind: "Script", hash: "aa" } })).toThrow(/TSTAKE-004/);
  });

  it("ĐỎ: delegation_admin sai độ dài", () => {
    expect(() => treasuryStakeParamList({ ...base, delegationAdmin: "aa" })).toThrow(/TSTAKE-005/);
  });

  it("ĐỎ: chuỗi không phải hex, và hex lẻ byte", () => {
    expect(() => treasuryStakeParamList({ ...base, delegationAdmin: "zz".repeat(28) })).toThrow(/TSTAKE-001/);
    expect(() => treasuryStakeParamList({ ...base, instanceId: "abc" })).toThrow(/TSTAKE-002/);
  });
});

// ══ Ba khe đều thật sự đi vào hash ══════════════════════════════════════
describe("cả ba khe nướng vào script hash", () => {
  const h = treasuryStakeHash(applied);

  it("đổi instance_id → hash ĐỔI", () => {
    expect(treasuryStakeHash(applyTreasuryStake(STAKE_RAW.script, { ...base, instanceId: "6162" }))).not.toBe(h);
  });

  it("đổi reward_cred.hash → hash ĐỔI", () => {
    expect(treasuryStakeHash(applyTreasuryStake(STAKE_RAW.script, {
      ...base, rewardCred: { kind: "Script", hash: "a7".repeat(28) },
    }))).not.toBe(h);
  });

  // Ca này phân biệt được hai cực mà một phép kiểm chỉ so độ dài KHÔNG phân biệt: cùng một
  // chuỗi 28 byte, chỉ khác KIỂU credential.
  it("đổi KIỂU reward_cred (Script ↔ VerificationKey), giữ nguyên hash → vẫn ĐỔI", () => {
    expect(treasuryStakeHash(applyTreasuryStake(STAKE_RAW.script, {
      ...base, rewardCred: { kind: "VerificationKey", hash: CUSTODY_HASH },
    }))).not.toBe(h);
  });

  it("đổi delegation_admin → hash ĐỔI", () => {
    expect(treasuryStakeHash(applyTreasuryStake(STAKE_RAW.script, { ...base, delegationAdmin: "a7".repeat(28) }))).not.toBe(h);
  });

  it("cùng ba khe → hash LẶP LẠI (apply là hàm thuần)", () => {
    expect(treasuryStakeHash(applyTreasuryStake(STAKE_RAW.script, { ...base }))).toBe(h);
  });
});

// ══ Địa chỉ kho dạng base ══════════════════════════════════════════════
describe("custodyBaseAddress", () => {
  const addr = custodyBaseAddress(NETWORK, CUSTODY, applied);
  const d = getAddressDetails(addr);

  it("phần payment là hash custody, phần stake là hash treasury_stake", () => {
    expect(d.paymentCredential?.hash).toBe(CUSTODY_HASH);
    expect(d.paymentCredential?.type).toBe("Script");
    expect(d.stakeCredential?.hash).toBe(treasuryStakeHash(applied));
    expect(d.stakeCredential?.type).toBe("Script");
  });

  // HAI CỰC: cùng một custody script, base ≠ enterprise. Đây là chỗ đường gieo cũ sai — nó
  // cho ra bản enterprise ở cả hai cực nên không ca nào đỏ.
  it("KHÁC địa chỉ enterprise của cùng custody script", () => {
    const ent = custodyBaseAddress(NETWORK, CUSTODY, applied).replace(/^addr_test1x/, "addr_test1w");
    expect(addr).not.toBe(ent);
    expect(d.stakeCredential).toBeDefined();
  });

  it("đổi phần stake → ĐỊA CHỈ đổi, dù payment giữ nguyên", () => {
    const other = applyTreasuryStake(STAKE_RAW.script, { ...base, instanceId: "6162" });
    const addr2 = custodyBaseAddress(NETWORK, CUSTODY, other);
    expect(addr2).not.toBe(addr);
    expect(getAddressDetails(addr2).paymentCredential?.hash).toBe(CUSTODY_HASH);
  });

  it("custodyRewardCredential trỏ đúng phần stake", () => {
    expect(custodyRewardCredential(applied)).toEqual({ kind: "Script", hash: treasuryStakeHash(applied) });
  });
});
