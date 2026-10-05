// Phần thuần của két drip — `Distribution/offchain/src/dripPot.ts` + `dripDeployment.ts`, hợp đồng
// `Distribution/drip-pot/CONTRACT.md` v0.3. Bài Emulator của nhánh Return: `Distribution/tests/dripPotReturn.test.ts`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  dripVested, dripClaimable, encodeAccountDatum, decodeDripDatum, dripTagDatum, dripParamList,
  dripParamListV02, addressToData, dataToAddress, vaultKey, epochAt, DRIP_RESERVE_DATUM_CBOR,
} from "../../Distribution/offchain/src/dripPot.js";
import {
  DRIP_DEPLOYED_DIR, readDripCode, readDripDeployments, resolveDripScript,
} from "../../Distribution/offchain/src/dripDeployment.js";
import {
  LAMP_POLICY_REGISTRY, activeDistributionTreasury, selectActiveDistributionTreasury,
} from "../offchain/src/lampPolicies.js";
import { Constr, Data, getAddressDetails, validatorToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";

const BASE = "addr_test1qp067hf434akjn7yhvx25cahwzq4l7plj65szhh5zgp375zl4awntrtmd98ufwcv4f3mwuyptlurl94fq900gysrragqhrtrhl";
const SCRIPT_ENT = "addr_test1wr4rr2av837g60eszp23740c5zdgmxlg8ngyppx4jp8yxzq5c9k5s";

describe("dripVested — §3", () => {
  it("cửa sổ đầu tiên được tính đã nhả E/N, nhả hết sau N cửa sổ", () => {
    expect(dripVested(36_000n, 317n, 316n, 36n)).toBe(0n);
    expect(dripVested(36_000n, 317n, 317n, 36n)).toBe(1_000n);
    expect(dripVested(36_000n, 317n, 352n, 36n)).toBe(36_000n);
    expect(dripVested(36_000n, 317n, 999n, 36n)).toBe(36_000n);
  });
  it("chia sàn, không vượt E", () => {
    expect(dripVested(100n, 0n, 0n, 36n)).toBe(2n);
    expect(dripVested(100n, 0n, 35n, 36n)).toBe(100n);
  });
  it("lượng rút = vested − claimed", () => {
    expect(dripClaimable({ entitlement: 36_000n, claimed: 1_000n, startEpoch: 317n }, 318n, 36n)).toBe(1_000n);
    expect(dripClaimable({ entitlement: 36_000n, claimed: 2_000n, startEpoch: 317n }, 318n, 36n)).toBe(0n);
  });
});

describe("datum — §2", () => {
  it("Reserve = d87980 (đúng datum kho Treasury rót tới qua FundPot)", () => {
    expect(Data.to(new Constr(0, []))).toBe(DRIP_RESERVE_DATUM_CBOR);
    expect(decodeDripDatum(DRIP_RESERVE_DATUM_CBOR)).toBeNull();
  });
  it("Account mã hoá rồi giải mã giữ nguyên số", () => {
    const cbor = encodeAccountDatum({ vault: BASE, entitlement: 5n, claimed: 1n, startEpoch: 317n });
    const d = decodeDripDatum(cbor)!;
    expect([d.entitlement, d.claimed, d.startEpoch]).toEqual([5n, 1n, 317n]);
    expect(dataToAddress("Preprod", d.vaultData)).toBe(BASE);
    expect(vaultKey(BASE)).toBe(Data.to(new Constr(0, [new Constr(0, [getAddressDetails(BASE).paymentCredential!.hash]), new Constr(0, [new Constr(0, [new Constr(0, [getAddressDetails(BASE).stakeCredential!.hash])])])])));
  });
  it("địa chỉ: khoá + stake inline = Constr 0 [Constr 0 [pkh], Some(Inline(Constr 0 [skh]))]; script không stake = None", () => {
    const b = addressToData(BASE);
    expect((b.fields[0] as Constr<Data>).index).toBe(0);
    expect((b.fields[1] as Constr<Data>).index).toBe(0);
    const s = addressToData(SCRIPT_ENT);
    expect((s.fields[0] as Constr<Data>).index).toBe(1);
    expect((s.fields[1] as Constr<Data>).index).toBe(1);
  });
  it("dataToAddress là chiều ngược của addressToData (ví base + script enterprise)", () => {
    expect(dataToAddress("Preprod", addressToData(BASE))).toBe(BASE);
    expect(dataToAddress("Preprod", addressToData(SCRIPT_ENT))).toBe(SCRIPT_ENT);
  });
  it("datum lạ thì ném, không đoán", () => {
    expect(() => decodeDripDatum(Data.to(new Constr(1, [1n, 2n])))).toThrow(/DRIP-DATUM-001/);
    expect(() => decodeDripDatum(Data.to(new Constr(2, [])))).toThrow(/DRIP-DATUM-001/);
  });
  it("thẻ output đích = OutputReference Constr 0 [bytes, int]", () => {
    const h = "ab".repeat(32);
    expect(dripTagDatum(h, 3)).toBe(Data.to(new Constr(0, [h, 3n])));
  });
});

describe("tham số — DP-PARAM", () => {
  const v02 = { campaignIdHex: "65", lampPolicy: "00".repeat(28), lampName: "744c414d50", committee: ["aa".repeat(28)],
    threshold: 1n, msPerEpoch: 432_000_000n, windowOriginMs: 1_654_041_600_000n, vestEpochs: 36n };
  const ok = { ...v02, returnScript: "bb".repeat(28), treasuryNftPolicy: "cc".repeat(28) };
  it("v0.3 ra 10 tham số theo thứ tự §1, hai tham số cuối là return_script, treasury_nft_policy", () => {
    const l = dripParamList(ok);
    expect(l).toHaveLength(10);
    expect(l.slice(8)).toEqual(["bb".repeat(28), "cc".repeat(28)]);
    expect(l.slice(0, 8)).toEqual(dripParamListV02(v02));
  });
  it("v0.2 (két đang chạy Preprod) giữ 8 tham số", () => expect(dripParamListV02(v02)).toHaveLength(8));
  it("threshold 0, vest 0, khoá trùng vượt threshold đều bị từ chối", () => {
    expect(() => dripParamList({ ...ok, threshold: 0n })).toThrow(/DRIP-PARAM-002/);
    expect(() => dripParamList({ ...ok, vestEpochs: 0n })).toThrow(/DRIP-PARAM-001/);
    expect(() => dripParamList({ ...ok, committee: ["aa".repeat(28), "aa".repeat(28)], threshold: 2n })).toThrow(/DRIP-PARAM-002/);
  });
  it("return_script / treasury_nft_policy không phải 28 byte ⇒ DRIP-PARAM-003", () => {
    expect(() => dripParamList({ ...ok, returnScript: "bb".repeat(27) })).toThrow(/DRIP-PARAM-003/);
    expect(() => dripParamList({ ...ok, treasuryNftPolicy: "" })).toThrow(/DRIP-PARAM-003/);
  });
});

// Két v0.2 đang chạy Preprod (CONTRACT §10): bytecode đóng băng + bản ghi triển khai phải dựng lại
// ĐÚNG hash đã lên chuỗi. Không cần mạng, không cần aiken build.
describe("bản ghi triển khai — két v0.2 Preprod", () => {
  const rec = JSON.parse(readFileSync(resolve(DRIP_DEPLOYED_DIR, "deployments.json"), "utf8")).deployments[0];
  const w = rec.appliedWith;
  const params = { campaignIdHex: w.campaignIdHex, lampPolicy: w.lampPolicy, lampName: w.lampName,
    committee: w.committee, threshold: BigInt(w.threshold), msPerEpoch: BigInt(w.msPerEpoch),
    windowOriginMs: BigInt(w.windowOriginMs), vestEpochs: BigInt(w.vestEpochs) };
  it("tệp đóng băng có hash chưa áp 20d5ca92…, dựng lại ra hash + địa chỉ đã ghi (c739ee4c…)", () => {
    expect(readDripDeployments().map((d) => d.id)).toContain("preprod-early-tiger-deleg-v0.2");
    const r = resolveDripScript({ version: "v0.2", network: "Preprod", campaign: "early-tiger-deleg", params });
    expect(r.deployment?.id).toBe("preprod-early-tiger-deleg-v0.2");
    expect(r.hash).toBe("c739ee4ccf9e30aeda4103954fc7858778c13895a3d2d8f396bdc63e");
    expect(validatorToAddress("Preprod", r.script)).toBe("addr_test1wrrnnmjve70rptk6gype2n78skrh3sfcjk3a9k8nj67uv0s7c4z50");
    expect(validatorToScriptHash({ type: "PlutusV3", script: readDripCode(
      resolve(DRIP_DEPLOYED_DIR, "drip_pot-v0.2.blueprint.json"), "v0.2") })).toBe("20d5ca92e7477abb6892cd7866e12e4d9e5c54e15d62820fc946a5d3");
  });
  it("tham số lệch (committee khác) ⇒ DRIP-DEPLOY-005, không dựng im lặng một két khác", () => {
    expect(() => resolveDripScript({ version: "v0.2", network: "Preprod", campaign: "early-tiger-deleg",
      params: { ...params, committee: ["aa".repeat(28)] } })).toThrow(/DRIP-DEPLOY-005/);
  });
  it("v0.2 không có bản ghi cho chiến dịch khác ⇒ DRIP-DEPLOY-007", () => {
    expect(() => resolveDripScript({ version: "v0.2", network: "Preprod", campaign: "khac", params })).toThrow(/DRIP-DEPLOY-007/);
  });
  it("blueprint đóng băng đọc như v0.3 ⇒ DRIP-DEPLOY-003 (số tham số)", () => {
    expect(() => readDripCode(resolve(DRIP_DEPLOYED_DIR, "drip_pot-v0.2.blueprint.json"), "v0.3")).toThrow(/DRIP-DEPLOY-003/);
  });
  it("hash chưa áp lệch bản ghi ⇒ DRIP-DEPLOY-004", () => {
    expect(() => readDripCode(resolve(DRIP_DEPLOYED_DIR, "drip_pot-v0.2.blueprint.json"), "v0.2", "00".repeat(28))).toThrow(/DRIP-DEPLOY-004/);
  });
});

describe("kho Distribution của cụm ACTIVE — nguồn return_script / treasury_nft_policy", () => {
  it("preprod: trường có cấu trúc của bản ghi ACTIVE", () => {
    const t = activeDistributionTreasury("preprod");
    expect(t.recordId).toBe("preprod-oneshot-14param-final");
    expect(t.lampPolicy).toBe("493002cc03004e3e14fd607cfba59312bd946e478e69d6ab431ccfac");
    expect(t.scriptHash).toBe("ea31abac3c7c8d3f3010551f55f8a09a8d9be83cd04084d5904e4308");
    expect(t.nftPolicy).toBe("379e60c09b0c778dc7651e254a977f89017393226df389acd5f27277");
    // Đối chiếu chéo với chuỗi `evidence` CHỈ trong bài kiểm (mã chạy không đọc chuỗi đó).
    const rec = LAMP_POLICY_REGISTRY.find((r) => r.id === t.recordId)!;
    const kho = rec.evidence.find((e) => e.startsWith("Kho Treasury: "))!.slice("Kho Treasury: ".length).replace(/\.$/, "");
    expect(getAddressDetails(kho).paymentCredential).toEqual({ type: "Script", hash: t.scriptHash });
  });
  it("bản ACTIVE thiếu trường ⇒ TLAMP-SRC-007; mạng không có ACTIVE ⇒ ném, không trả rỗng", () => {
    const bare = LAMP_POLICY_REGISTRY.map((r) => ({ ...r, distributionTreasury: undefined }));
    expect(() => selectActiveDistributionTreasury(bare as never, "preprod")).toThrow(/TLAMP-SRC-007/);
    expect(() => activeDistributionTreasury("preview")).toThrow(/TLAMP-SRC-005/);
  });
});

describe("epochAt — Preprod", () => {
  it("2026-10-03T00:00Z là đầu epoch 317", () => {
    const o = 1_654_041_600_000n, m = 432_000_000n;
    expect(epochAt(BigInt(Date.parse("2026-10-03T00:00:00Z")), o, m)).toBe(317n);
    expect(epochAt(BigInt(Date.parse("2026-10-02T23:59:59Z")), o, m)).toBe(316n);
  });
});
