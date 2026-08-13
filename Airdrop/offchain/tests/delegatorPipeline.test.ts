// delegatorPipeline.test.ts — END-TO-END OFFLINE của build_delegator_snapshot.ts:
//   accStakePerRegistration (join stake→payment + §1.5) → buildDelegatorEntitlements
//   → merkle.buildTree → snapshotTool.exportClaims → verifyProof mọi claim khớp root.
// Chứng minh trọn chuỗi tính (thứ CLI làm, trừ fetch mạng) sinh merkle root + proof đúng.

import { describe, it, expect } from "vitest";
import { bech32 } from "@scure/base";
import {
  accStakePerRegistration,
  type RegWithHistory,
  type StakeHistoryRow,
} from "../src/delegatorSnapshot.js";
import { buildDelegatorEntitlements } from "../src/delegator_entitlement.js";
import { buildTree } from "../src/merkle.js";
import { exportClaims } from "../src/snapshotTool.js";
import { verifyProof } from "../src/merkle.js";
import { DELEGATOR_CAMPAIGN_ID, ROLE_DELEGATOR } from "../src/constants.js";
import type { MerkleParams } from "../src/types.js";

const P: MerkleParams = { campaignId: DELEGATOR_CAMPAIGN_ID, epoch: 637n, role: ROLE_DELEGATOR };

/** enterprise addr_test (payment key, không stake) từ 28-byte hash → getAddressDetails parse được. */
function enterpriseAddr(seed: number): string {
  const hash = new Uint8Array(28);
  for (let i = 0; i < 28; i++) hash[i] = (seed * 31 + i * 7) & 0xff;
  const addr = new Uint8Array(29);
  addr[0] = 0x60; // header: enterprise, payment key, testnet
  addr.set(hash, 1);
  return bech32.encode("addr_test", bech32.toWords(addr), 1000);
}

function h(epoch: number, amount: string, pool = "poolX"): StakeHistoryRow {
  return { active_epoch: epoch, amount, pool_id: pool };
}

describe("pipeline Delegator v2 end-to-end (offline)", () => {
  it("join payment + §1.5 + merkle + proof roundtrip", () => {
    const payA = enterpriseAddr(1);
    const payB = enterpriseAddr(2);
    const payC = enterpriseAddr(3);

    const regs: RegWithHistory[] = [
      // A: chuỗi [620,621,622] liền = 3 epoch × 100 → accStake 300
      { stake_address: "stake_A", payment_address: payA,
        history: [h(620, "100"), h(621, "100"), h(622, "100")] },
      // B: [630,631] liền (2) tính = 200; [633] lẻ (loại). accStake 200
      { stake_address: "stake_B", payment_address: payB,
        history: [h(630, "100"), h(631, "100"), h(633, "9999")] },
      // C: chỉ [640] đơn epoch → accStake 0 → loại khỏi phân bổ
      { stake_address: "stake_C", payment_address: payC,
        history: [h(640, "100")] },
    ];

    const acc = accStakePerRegistration(regs, { n: 2 });
    // C bị loại; A=300, B=200
    expect(acc.eligible.map((e) => e.acc_stake_lovelace)).toEqual([300n, 200n]);
    expect(acc.zeroAcc.map((z) => z.stake_address)).toEqual(["stake_C"]);

    // budget 500 oildrop chia ∝ accStake (A:B = 300:200 = 3:2) → A=300, B=200
    const budgetOildrop = 500n;
    const ent = buildDelegatorEntitlements(acc.eligible, { budgetOildrop, capOildrop: null });
    expect(ent.distributed).toBe(500n);          // bảo toàn tuyệt đối (cap=null)
    expect(ent.leftover).toBe(0n);

    const byAddr = new Map(ent.entitlements.map((e) => [e.owner, e.amount]));
    expect(byAddr.get(payA)).toBe(300n);
    expect(byAddr.get(payB)).toBe(200n);
    // owner là PAYMENT address, KHÔNG phải stake (vá lỗ #1)
    expect(ent.entitlements.every((e) => e.owner.startsWith("addr_test"))).toBe(true);

    // merkle + claims + verify proof mọi leaf khớp root
    const tree = buildTree(ent.snapshot, P);
    expect(tree.root).toMatch(/^[0-9a-f]{64}$/);
    const claims = exportClaims(tree);
    expect(claims).toHaveLength(2);
    for (const c of claims) {
      const ok = verifyProof(tree.root, { address: c.address, amount: c.amount }, c.proof, P);
      expect(ok).toBe(true);
    }
  });

  it("cửa sổ [E_open,E_cut) áp per-registration", () => {
    const regs: RegWithHistory[] = [
      { stake_address: "s", payment_address: enterpriseAddr(9),
        history: [h(618, "5"), h(620, "100"), h(621, "100"), h(637, "5")] },
    ];
    // window [620,637): giữ 620,621 (chuỗi 2, tính) → 200. 618 & 637 bị cắt.
    const acc = accStakePerRegistration(regs, { n: 2, eOpen: 620, eCut: 637 });
    expect(acc.eligible[0]!.acc_stake_lovelace).toBe(200n);
    expect(acc.perReg[0]!.counted).toEqual([620, 621]);
  });
});
