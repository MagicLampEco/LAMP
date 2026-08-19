// deploy/redeemer codec — đối chiếu SETUP one-shot + BurnSlot với onchain.

import { describe, it, expect } from "vitest";
import { credentialToAddress, keyHashToCredential } from "@lucid-evolution/lucid";
import { mintPoolRedeemerToCbor, burnSlotRedeemerToCbor } from "../src/datum.js";
import { SETUP_AUTHORITY_NAME, buildDeployTx, type DeployParams } from "../src/deployBuilder.js";
import { buildSnapshotTree, totalOildrop } from "../src/snapshotTool.js";
import { POOL_NFT_NAME, DELEGATOR_CAMPAIGN_ID, ROLE_DELEGATOR } from "../src/constants.js";
import type { MerkleParams } from "../src/types.js";

describe("SETUP authority + asset name parity (byte-perfect onchain)", () => {
  it('SETUP_AUTHORITY_NAME = hex("ASETUP") = 415345545550', () => {
    expect(SETUP_AUTHORITY_NAME).toBe("415345545550");
    expect(Buffer.from("ASETUP", "ascii").toString("hex")).toBe(SETUP_AUTHORITY_NAME);
  });

  it('POOL_NFT_NAME = hex("APOOL") = 41504f4f4c', () => {
    expect(POOL_NFT_NAME).toBe("41504f4f4c");
    expect(Buffer.from("APOOL", "ascii").toString("hex")).toBe(POOL_NFT_NAME);
  });

  it("3 asset name (POOL / SETUP / leaf) phân biệt → không đụng namespace", () => {
    // leaf = blake2b 32 byte (64 hex) → không trùng POOL (10 hex) / SETUP (12 hex).
    expect(POOL_NFT_NAME).not.toBe(SETUP_AUTHORITY_NAME);
    expect(POOL_NFT_NAME.length).toBe(10);
    expect(SETUP_AUTHORITY_NAME.length).toBe(12);
  });
});

describe("AirdropNftRedeemer SETUP/BurnSlot codec (GIỮ Constr index)", () => {
  it("MintPool (SETUP one-shot) = Constr0 = d87980", () => {
    expect(mintPoolRedeemerToCbor()).toBe("d87980");
  });

  it("BurnSlot (Claim/Sweep) = Constr1 = d87a80 — index khớp MintClaim cũ", () => {
    expect(burnSlotRedeemerToCbor()).toBe("d87a80");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOY-001 — kho pool PHẢI == tổng cây Merkle.
//
// Vì sao: `poolLampAmount` từng là tham số TỰ DO, không dòng nào đối chiếu với cây.
// Nạp thiếu 1 oildrop thì SETUP thành công, mọi slot đúc đủ, hàng trăm claim đầu chạy
// trơn — rồi claimer CUỐI không bao giờ dựng nổi tx: `airdrop_pool` nhánh Claim ép
// pool_out == pool_in − amount, kho cạn thì vế đó không thoả được, và LAMP phần đó bị
// Sweep về treasury sau deadline. Không guard on-chain nào bắt được (on-chain chỉ thấy
// từng claim lẻ, không biết tổng cây), nên phải chặn ở đây — điểm hội tụ duy nhất.
// ─────────────────────────────────────────────────────────────────────────────

const P: MerkleParams = { campaignId: DELEGATOR_CAMPAIGN_ID, epoch: 637n, role: ROLE_DELEGATOR };
const addr = (pkh: string) => credentialToAddress("Preview", keyHashToCredential(pkh));
const ADDR_A = addr("00000000000000000000000000000000000000000000000000000a01");
const ADDR_B = addr("00000000000000000000000000000000000000000000000000000b02");
const MARKER = addr("00000000000000000000000000000000000000000000000000000d04");

/** Lucid giả: chỉ cần đủ để `buildDeployTx` chạy hết khi guard CHO QUA. */
function fakeLucid(): DeployParams["lucid"] {
  const b: Record<string, unknown> = {};
  b.collectFrom = () => b;
  b.mintAssets = () => b;
  b.attach = { MintingPolicy: () => b };
  b.pay = { ToAddressWithData: () => b, ToAddress: () => b };
  b.complete = async () => "TX-GIA";
  return { newTx: () => b } as unknown as DeployParams["lucid"];
}

function deployParams(poolLampAmount: bigint): DeployParams {
  const tree = buildSnapshotTree(
    [{ address: ADDR_A, amount: 100 }, { address: ADDR_B, amount: 250 }], // 350 LAMP
    P,
  );
  return {
    lucid: fakeLucid(),
    genesisUtxo: { txHash: "00".repeat(32), outputIndex: 0, address: ADDR_A, assets: { lovelace: 5_000_000n } } as DeployParams["genesisUtxo"],
    airdropNftPolicy: { type: "PlutusV3", script: "00" } as DeployParams["airdropNftPolicy"],
    airdropNftPolicyId: "facade01".padEnd(56, "0"),
    poolAddress: MARKER,
    pool: {
      merkle_root: tree.root, deadline_epoch: 999n,
      treasury_dest: ADDR_A, marker_dest: MARKER, claimed_count: 0n,
    },
    tree,
    lamp_policy: "beef0001".padEnd(56, "0"),
    lamp_name: "744c414d50",
    poolLampAmount,
  };
}

describe("buildDeployTx — DEPLOY-001 kho pool == tổng cây", () => {
  const p = deployParams(0n);
  const total = totalOildrop(p.tree.entries); // 350 LAMP = 350_000_000 oildrop

  it("khớp đúng ⇒ dựng được tx", async () => {
    const { summary } = await buildDeployTx(deployParams(total));
    expect(summary).toContain(`${total} oildrop`);
  });

  it("nạp THIẾU ⇒ ném, thông điệp nói claimer cuối fail vĩnh viễn", async () => {
    await expect(buildDeployTx(deployParams(total - 1n))).rejects.toThrow(
      /DEPLOY-001[\s\S]*VĨNH VIỄN/,
    );
  });

  it("nạp THỪA ⇒ ném, thông điệp nói LAMP kẹt tới Sweep", async () => {
    await expect(buildDeployTx(deployParams(total + 1n))).rejects.toThrow(
      /DEPLOY-001[\s\S]*Sweep/,
    );
  });

  it("đơn vị là OILDROP, không phải LAMP — nạp 350 (số LAMP) bị chặn", async () => {
    // Bằng chứng đơn vị: cùng con số nhưng sai 10^6 lần thì guard phải bắt.
    await expect(buildDeployTx(deployParams(350n))).rejects.toThrow(/DEPLOY-001/);
  });
});
