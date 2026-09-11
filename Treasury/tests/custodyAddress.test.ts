// Vitest — địa chỉ kho: MANG THEO từ input, KHÔNG dựng lại từ script hash.
//
// Vì sao bộ kiểm này tồn tại: `custody.ak` ép `cust_out.address == cust_in.address` KỂ CẢ
// stake credential ở cả ba nhánh tiêu kho — C-COL-ADDR (`validators/custody.ak:143-144`),
// C-REL-ADDR (`:188-189`), C-MIG-ADDR (`:290-292`). Bản cũ của `collectBuilder`/
// `releaseBuilder` dựng lại địa chỉ output từ `validatorToScriptHash(custodyScript)`, tức
// LUÔN ra enterprise (stake part `None`). Hôm nay kho được gieo enterprise nên hai bên
// trùng nhau NGẪU NHIÊN và không ca nào đỏ; đúng vào lượt kho có stake credential thì mọi
// tx collect/release dựng ra đều bị on-chain từ chối.
//
// HAI CỰC PHẢI PHÂN BIỆT ĐƯỢC: cùng MỘT custody script, một địa chỉ enterprise và một địa
// chỉ base phải cho hai kết quả KHÁC NHAU. Bản cũ cho cùng một kết quả ở cả hai cực — đó
// chính là điều các ca dưới đây đo.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  credentialToAddress, getAddressDetails, keyHashToCredential, scriptHashToCredential,
  validatorToScriptHash, type Network, type Validator,
} from "@lucid-evolution/lucid";

import { custodyOutputAddress, custodySeedAddress } from "../offchain/src/collectBuilder.js";

const PLUTUS_JSON = resolve(process.cwd(), "../onchain/plutus.json");
const NETWORK: Network = "Preview";

/** Stake key hash (28 byte) — giá trị giữ chỗ, chỉ cần đúng độ dài. */
const STAKE_KEY_HASH = "5e".repeat(28);
const OTHER_SCRIPT_HASH = "a7".repeat(28);

function loadCustodyScript(): Validator {
  const pj = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const v = pj.validators.find((x: { title: string }) => x.title === "custody.custody.spend");
  if (!v) throw new Error("custody.custody.spend không có trong plutus.json — chạy aiken build");
  return { type: "PlutusV3", script: v.compiledCode as string };
}

const CUSTODY_SCRIPT = loadCustodyScript();
const CUSTODY_HASH = validatorToScriptHash(CUSTODY_SCRIPT);

const enterpriseAddr = credentialToAddress(NETWORK, scriptHashToCredential(CUSTODY_HASH));
const baseAddr = credentialToAddress(
  NETWORK, scriptHashToCredential(CUSTODY_HASH), keyHashToCredential(STAKE_KEY_HASH),
);

describe("hai cực phải khác nhau — tiền đề của mọi ca dưới", () => {
  it("enterprise và base của CÙNG một script là hai địa chỉ KHÁC nhau", () => {
    expect(baseAddr).not.toBe(enterpriseAddr);
  });
  it("hai cực chung payment credential, khác stake part", () => {
    const e = getAddressDetails(enterpriseAddr);
    const b = getAddressDetails(baseAddr);
    expect(e.paymentCredential?.hash).toBe(b.paymentCredential?.hash);
    expect(e.stakeCredential).toBeUndefined();
    expect(b.stakeCredential?.hash).toBe(STAKE_KEY_HASH);
  });
});

describe("custodyOutputAddress — C-COL-ADDR / C-REL-ADDR / C-MIG-ADDR", () => {
  it("kho ENTERPRISE → output đúng địa chỉ enterprise đó", () => {
    expect(custodyOutputAddress(enterpriseAddr, CUSTODY_SCRIPT)).toBe(enterpriseAddr);
  });

  // ĐÂY là ca mà bản cũ trượt: nó trả enterpriseAddr cho input base.
  it("kho BASE → output GIỮ NGUYÊN stake credential, KHÔNG rơi về enterprise", () => {
    const out = custodyOutputAddress(baseAddr, CUSTODY_SCRIPT);
    expect(out).toBe(baseAddr);
    expect(out).not.toBe(enterpriseAddr);
    expect(getAddressDetails(out).stakeCredential?.hash).toBe(STAKE_KEY_HASH);
  });

  it("hai cực cho hai kết quả KHÁC nhau (bản dựng-lại-từ-hash cho cùng một kết quả)", () => {
    expect(custodyOutputAddress(baseAddr, CUSTODY_SCRIPT))
      .not.toBe(custodyOutputAddress(enterpriseAddr, CUSTODY_SCRIPT));
  });

  it("CUSTODY-ADDR-002: input ở script KHÁC → ném, không im lặng mang theo", () => {
    const foreign = credentialToAddress(NETWORK, scriptHashToCredential(OTHER_SCRIPT_HASH));
    expect(() => custodyOutputAddress(foreign, CUSTODY_SCRIPT)).toThrow(/CUSTODY-ADDR-002/);
  });

  it("CUSTODY-ADDR-001: input ở ví thường (VerificationKey) → ném", () => {
    const wallet = credentialToAddress(NETWORK, keyHashToCredential(STAKE_KEY_HASH));
    expect(() => custodyOutputAddress(wallet, CUSTODY_SCRIPT)).toThrow(/CUSTODY-ADDR-001/);
  });
});

describe("custodySeedAddress — chỗ DUY NHẤT quyết định hình dạng địa chỉ kho", () => {
  it("không truyền stake credential → enterprise (giữ nguyên hành vi cũ)", () => {
    expect(custodySeedAddress(NETWORK, CUSTODY_SCRIPT)).toBe(enterpriseAddr);
  });

  it("truyền stake credential → base, và KHÁC bản enterprise", () => {
    const out = custodySeedAddress(NETWORK, CUSTODY_SCRIPT, keyHashToCredential(STAKE_KEY_HASH));
    expect(out).toBe(baseAddr);
    expect(out).not.toBe(enterpriseAddr);
  });

  it("cả hai cực dùng CÙNG payment credential ⟹ đổi hình dạng KHÔNG đổi script hash", () => {
    const withStake = custodySeedAddress(
      NETWORK, CUSTODY_SCRIPT, keyHashToCredential(STAKE_KEY_HASH),
    );
    const without = custodySeedAddress(NETWORK, CUSTODY_SCRIPT);
    expect(getAddressDetails(withStake).paymentCredential?.hash).toBe(CUSTODY_HASH);
    expect(getAddressDetails(without).paymentCredential?.hash).toBe(CUSTODY_HASH);
  });

  it("địa chỉ gieo ra được `custodyOutputAddress` nhận lại nguyên vẹn (gieo → tiêu khớp nhau)", () => {
    for (const stake of [undefined, keyHashToCredential(STAKE_KEY_HASH)]) {
      const seeded = custodySeedAddress(NETWORK, CUSTODY_SCRIPT, stake);
      expect(custodyOutputAddress(seeded, CUSTODY_SCRIPT)).toBe(seeded);
    }
  });
});
