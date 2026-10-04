// Phần thuần của két drip — `Distribution/offchain/src/dripPot.ts`, hợp đồng
// `Distribution/drip-pot/CONTRACT.md` v0.2.
import { describe, it, expect } from "vitest";
import {
  dripVested, dripClaimable, encodeAccountDatum, decodeDripDatum, dripTagDatum, dripParamList,
  addressToData, dataToAddress, vaultKey, epochAt, DRIP_RESERVE_DATUM_CBOR,
} from "../../Distribution/offchain/src/dripPot.js";
import { Constr, Data, getAddressDetails } from "@lucid-evolution/lucid";

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
  const ok = { campaignIdHex: "65", lampPolicy: "00".repeat(28), lampName: "744c414d50", committee: ["aa".repeat(28)],
    threshold: 1n, msPerEpoch: 432_000_000n, windowOriginMs: 1_654_041_600_000n, vestEpochs: 36n };
  it("bộ đúng ra 8 tham số theo thứ tự §1", () => expect(dripParamList(ok)).toHaveLength(8));
  it("threshold 0, vest 0, khoá trùng vượt threshold đều bị từ chối", () => {
    expect(() => dripParamList({ ...ok, threshold: 0n })).toThrow(/DRIP-PARAM-002/);
    expect(() => dripParamList({ ...ok, vestEpochs: 0n })).toThrow(/DRIP-PARAM-001/);
    expect(() => dripParamList({ ...ok, committee: ["aa".repeat(28), "aa".repeat(28)], threshold: 2n })).toThrow(/DRIP-PARAM-002/);
  });
});

describe("epochAt — Preprod", () => {
  it("2026-10-03T00:00Z là đầu epoch 317", () => {
    const o = 1_654_041_600_000n, m = 432_000_000n;
    expect(epochAt(BigInt(Date.parse("2026-10-03T00:00:00Z")), o, m)).toBe(317n);
    expect(epochAt(BigInt(Date.parse("2026-10-02T23:59:59Z")), o, m)).toBe(316n);
  });
});
