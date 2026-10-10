// `dripFundTargetFailures` — soát đích FundPot khi đích là két drip (CONTRACT v0.3 §7).
// Thuần: bản ghi v0.2 đọc từ `deployed/deployments.json` thật; bản ghi v0.3 dựng tại chỗ.
import { describe, it, expect } from "vitest";
import { dripFundTargetFailures, readDripDeployments, type DripDeployment } from "../offchain/src/dripDeployment.js";

const KHO = "ea31abac" + "00".repeat(24);
const KHO_NFT = "b15dc079" + "11".repeat(24);
const V02 = readDripDeployments().find((d) => d.id === "preprod-early-tiger-deleg-v0.2")!;
const V03: DripDeployment = {
  id: "preprod-test-v0.3", network: "Preprod", campaign: "test", contractVersion: "v0.3",
  unappliedHash: "aa".repeat(28), appliedHash: "bb".repeat(28),
  address: "addr_test1wzaaaa", evidence: [],
  ...({ appliedWith: { returnScript: KHO, treasuryNftPolicy: KHO_NFT } } as object),
};
const base = {
  network: "Preprod", sourceTreasuryHash: KHO, sourceTreasuryNftPolicy: KHO_NFT,
  deployments: [V02, V03],
};

describe("dripFundTargetFailures", () => {
  it("két v0.2 đang chạy, datum Reserve, đúng địa chỉ ⇒ không lỗi", () => {
    expect(dripFundTargetFailures({ ...base, potScriptHash: V02.appliedHash, potAddress: V02.address, potDatumCbor: "d87980" })).toEqual([]);
  });
  it("đích không phải két drip (datum khác, hash lạ) ⇒ không ý kiến", () => {
    expect(dripFundTargetFailures({ ...base, potScriptHash: "cc".repeat(28), potAddress: "addr_test1wzcc", potDatumCbor: "4100" })).toEqual([]);
  });
  it("datum Reserve nhưng hash không có bản ghi ⇒ DRIP-FUND-001", () => {
    const f = dripFundTargetFailures({ ...base, potScriptHash: "cc".repeat(28), potAddress: "addr_test1wzcc", potDatumCbor: "D87980" });
    expect(f.join()).toMatch(/DRIP-FUND-001/);
  });
  it("hash két nhưng địa chỉ khác bản ghi ⇒ DRIP-FUND-002", () => {
    const f = dripFundTargetFailures({ ...base, potScriptHash: V02.appliedHash, potAddress: "addr_test1wzother", potDatumCbor: "d87980" });
    expect(f.join()).toMatch(/DRIP-FUND-002/);
  });
  it("hash két nhưng datum không phải Reserve ⇒ DRIP-FUND-003", () => {
    const f = dripFundTargetFailures({ ...base, potScriptHash: V02.appliedHash, potAddress: V02.address, potDatumCbor: "4100" });
    expect(f.join()).toMatch(/DRIP-FUND-003/);
  });
  it("v0.3 áp đúng kho đang rót ⇒ không lỗi", () => {
    expect(dripFundTargetFailures({ ...base, potScriptHash: V03.appliedHash, potAddress: V03.address, potDatumCbor: "d87980" })).toEqual([]);
  });
  it("v0.3 áp return_script của kho khác ⇒ DRIP-FUND-004", () => {
    const f = dripFundTargetFailures({ ...base, sourceTreasuryHash: "dd".repeat(28), potScriptHash: V03.appliedHash, potAddress: V03.address, potDatumCbor: "d87980" });
    expect(f.join()).toMatch(/DRIP-FUND-004: .*return_script/);
  });
  it("v0.3 áp NFT TREASURY khác ⇒ DRIP-FUND-004", () => {
    const f = dripFundTargetFailures({ ...base, sourceTreasuryNftPolicy: "ee".repeat(28), potScriptHash: V03.appliedHash, potAddress: V03.address, potDatumCbor: "d87980" });
    expect(f.join()).toMatch(/DRIP-FUND-004: .*treasury_nft_policy/);
  });
  it("hai bản ghi cùng hash ⇒ DRIP-FUND-001", () => {
    const f = dripFundTargetFailures({ ...base, deployments: [V02, { ...V02, id: "dup" }], potScriptHash: V02.appliedHash, potAddress: V02.address, potDatumCbor: "d87980" });
    expect(f.join()).toMatch(/DRIP-FUND-001: .*2 bản ghi/);
  });
});
