// `custodySeedDatum()` — datum lượt SINH kho chung. Mọi trường ở đây BẤT BIẾN đời instance
// (lượt sinh dùng NFT one-shot), nên bài kiểm ghim từng trường chứ không chỉ "build được".
import { describe, it, expect } from "vitest";
import {
  CUSTODY_BUCKETS, CUSTODY_CUT_BPS, custodySeedDatum,
} from "../scripts/_reserve_layer2.js";
import { bucketsConfigOk } from "../../Treasury/offchain/src/collect.js";
import { custodyDatumToCbor, decodeCustodyDatum } from "../../Treasury/offchain/src/datum.js";
import { Data } from "@lucid-evolution/lucid";

const LAMP = "aa".repeat(28);
/** policy NFT con trỏ governance — GovernancePointer v0.1: `governance_ref` mang giá trị này. */
const GOV = "bb".repeat(28);
const CARP = { policy: "cc".repeat(28), name: "43415250" };

describe("custodySeedDatum — kho chung", () => {
  const d = custodySeedDatum(LAMP, "4c414d50", GOV, CARP);

  it("buckets đóng, hợp lệ theo luật seed (khác rỗng, tăng nghiêm ngặt, không dành riêng)", () => {
    expect(d.buckets).toEqual([0n, 1n, 2n]);
    expect(d.buckets).toEqual([...CUSTODY_BUCKETS]);
    expect(bucketsConfigOk(d.buckets)).toBe(true);
  });

  it("cut_bps = 10000 (100%)", () => {
    expect(d.cut_bps).toBe(10_000n);
    expect(CUSTODY_CUT_BPS).toBe(10_000n);
  });

  it("accepted_assets = LAMP + lovelace + CARP", () => {
    expect(d.accepted_assets).toEqual([
      { policy: LAMP, name: "4c414d50" },
      { policy: "", name: "" },
      CARP,
    ]);
  });

  it("round-trip CBOR giữ `buckets` (8 trường)", () => {
    const back = decodeCustodyDatum(Data.from(custodyDatumToCbor(d)));
    expect(back).toEqual(d);
  });

  it("buckets là bản sao — sửa kết quả không đổi hằng", () => {
    d.buckets.push(9n);
    expect(CUSTODY_BUCKETS).toEqual([0n, 1n, 2n]);
  });
});

describe("custodySeedDatum — CARP bắt buộc (accepted_assets bất biến sau lượt sinh)", () => {
  const bad: Array<[string, { policy: string; name: string }, RegExp]> = [
    ["policy rỗng", { policy: "", name: "43415250" }, /CARP-REF-001/],
    ["policy 0×28", { policy: "00".repeat(28), name: "43415250" }, /CARP-REF-001/],
    ["policy ngắn", { policy: "cc".repeat(27), name: "43415250" }, /CARP-REF-001/],
    ["policy chữ hoa", { policy: "CC".repeat(28), name: "43415250" }, /CARP-REF-001/],
    ["tên rỗng", { policy: "cc".repeat(28), name: "" }, /CARP-REF-002/],
    ["tên lẻ ký tự", { policy: "cc".repeat(28), name: "434" }, /CARP-REF-002/],
    ["tên > 32 byte", { policy: "cc".repeat(28), name: "ab".repeat(33) }, /CARP-REF-002/],
  ];
  for (const [label, carp, re] of bad) {
    it(label, () => expect(() => custodySeedDatum(LAMP, "4c414d50", GOV, carp)).toThrow(re));
  }
});

// GovernancePointer v0.1 §Genesis: `governance_ref` = policy NFT con trỏ (khe #1 custody), KHÔNG
// phải hash governance. BẤT BIẾN đời instance ⇒ giá trị chết ở đây là Release chết vĩnh viễn.
describe("custodySeedDatum — governance_ref = policy con trỏ", () => {
  it("ghi ĐÚNG policy con trỏ được truyền (không thay, không chuẩn hoá ngầm)", () => {
    const p = "9c".repeat(28);
    expect(custodySeedDatum(LAMP, "4c414d50", p, CARP).governance_ref).toBe(p);
  });
  const bad: Array<[string, string]> = [
    ["rỗng", ""], ["toàn 0", "0".repeat(56)], ["toàn f", "f".repeat(56)],
    ["chữ hoa", "BB".repeat(28)], ["27 byte", "bb".repeat(27)], ["29 byte", "bb".repeat(29)],
  ];
  for (const [label, p] of bad) {
    it(`ĐỎ: ${label} ⇒ POINTER-POLICY-001`, () =>
      expect(() => custodySeedDatum(LAMP, "4c414d50", p, CARP)).toThrow(/POINTER-POLICY-001/));
  }
});
