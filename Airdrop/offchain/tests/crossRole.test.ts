// tests/crossRole.test.ts — cô lập theo VAI phải giữ được ở mức PROOF, không chỉ mức leaf.
//
// Hình lỗi đang canh: `buildSnapshotTree(rows, params)` nhận `params.role` bằng MỘT cửa,
// còn `rows.amount` đã được tính sẵn ở NGOÀI hàm, bằng một cửa khác — không có gì trong
// đường đó khẳng định cây đang dựng cho `role = SPO` thật sự được tính bằng NGÂN SÁCH của SPO.
// Hai giá trị buộc phải khớp nhau mà vào bằng hai đối số độc lập thì sớm muộn cũng lệch,
// và lệch IM LẶNG: tổng vẫn đúng, cây vẫn dựng được, proof của chính vai đó vẫn verify.
//
// `merkle.test.ts:77` đã canh mức leaf (đổi role → đổi leaf). Bộ này canh mức trên:
// một proof dựng cho vai này KHÔNG được verify dưới vai khác, và ngân sách của vai này
// không được lặng lẽ trở thành ngân sách của vai kia.
//
// Trạng thái đo được lúc viết: mọi nơi dựng MerkleParams trong `Airdrop/` đều dùng
// ROLE_DELEGATOR (demo_airdrop.ts:110, build_delegator_snapshot.ts:167,281 + tests).
// Chưa có đường nào dựng cây cho MCS/Engage/SPO ⇒ chỗ lệch chưa xảy ra được HÔM NAY,
// nhưng không phải vì có cổng chặn — mà vì mới hiện thực đúng một vai. Bẫy đã lên nòng.
import { describe, it, expect } from "vitest";
import { credentialToAddress, keyHashToCredential } from "@lucid-evolution/lucid";
import { buildSnapshotTree, exportClaims, type RawSnapshotRow } from "../src/snapshotTool.js";
import { verifyProof, leafHash } from "../src/merkle.js";
import {
  DELEGATOR_CAMPAIGN_ID,
  ROLE_DELEGATOR, ROLE_MCS, ROLE_ENGAGE, ROLE_SPO,
  DELEGATOR_TOTAL_OILDROP, SPO_POT_OILDROP, CS_POT_OILDROP,
} from "../src/constants.js";
import type { MerkleParams } from "../src/types.js";

function previewAddr(pkhHex: string): string {
  return credentialToAddress("Preview", keyHashToCredential(pkhHex));
}

const ADDR_A = previewAddr("00000000000000000000000000000000000000000000000000000a01");
const ADDR_B = previewAddr("00000000000000000000000000000000000000000000000000000b02");
const ADDR_C = previewAddr("00000000000000000000000000000000000000000000000000000c03");

const ROLES = [ROLE_DELEGATOR, ROLE_MCS, ROLE_ENGAGE, ROLE_SPO];

const rows: RawSnapshotRow[] = [
  { address: ADDR_A, amount: 10 },
  { address: ADDR_B, amount: 20 },
  { address: ADDR_C, amount: 30 },
];

const paramsFor = (role: number): MerkleParams => ({
  campaignId: DELEGATOR_CAMPAIGN_ID,
  epoch: 637n,
  role,
});

describe("cô lập theo vai — mức PROOF, không chỉ mức leaf", () => {
  it("proof dựng cho vai này KHÔNG verify dưới bất kỳ vai nào khác", () => {
    for (const built of ROLES) {
      const tree = buildSnapshotTree(rows, paramsFor(built));
      const claims = exportClaims(tree);

      for (const c of claims) {
        const entry = { address: c.address, amount: c.amount };
        // Vai đúng: phải qua.
        expect(verifyProof(tree.root, entry, c.proof, paramsFor(built))).toBe(true);
        // Mọi vai khác: phải HỎNG. Đây là ca mà mọi phép kiểm "tổng tiền đúng" đều để lọt.
        for (const other of ROLES) {
          if (other === built) continue;
          expect(verifyProof(tree.root, entry, c.proof, paramsFor(other))).toBe(false);
        }
      }
    }
  });

  it("bốn vai, cùng rows, cùng epoch, cùng campaign → bốn root KHÁC nhau", () => {
    const roots = ROLES.map((r) => buildSnapshotTree(rows, paramsFor(r)).root);
    expect(new Set(roots).size).toBe(ROLES.length);
  });

  it("leaf của cùng một người khác nhau theo vai — slot nullifier không đụng nhau", () => {
    const leaves = ROLES.map((r) => leafHash({ address: ADDR_A, amount: 10_000_000n }, paramsFor(r)));
    expect(new Set(leaves).size).toBe(ROLES.length);
  });
});

describe("ngân sách theo vai — bốn pot là bốn số, không được lẫn", () => {
  it("Delegator / SPO / CS là ba con số phân biệt", () => {
    const pots = [DELEGATOR_TOTAL_OILDROP, SPO_POT_OILDROP, CS_POT_OILDROP];
    expect(new Set(pots.map(String)).size).toBe(3);
  });

  it("ngân sách từng pot đúng theo AIRDROP-V2 (100M / 5M / 15M LAMP)", () => {
    expect(DELEGATOR_TOTAL_OILDROP).toBe(100_000_000n * 1_000_000n);
    expect(SPO_POT_OILDROP).toBe(5_000_000n * 1_000_000n);
    expect(CS_POT_OILDROP).toBe(15_000_000n * 1_000_000n);
  });

  it("tổng ba pot = 120M LAMP — nếu ca này đỏ thì một pot vừa bị đổi lẻ", () => {
    expect(DELEGATOR_TOTAL_OILDROP + SPO_POT_OILDROP + CS_POT_OILDROP)
      .toBe(120_000_000n * 1_000_000n);
  });
});
