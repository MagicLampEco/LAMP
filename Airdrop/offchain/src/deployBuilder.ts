// deployBuilder — TIGER Airdrop SETUP (one-shot). Đúc POOL NFT + toàn bộ N
// claim-slot NFT (name = leaf, qty 1), phân phối:
//   - POOL NFT + kho LAMP + datum AirdropPool → địa chỉ pool script.
//   - mỗi slot NFT (+ min-ADA) → marker_dest (registry).
//
// ─────────────────────────────────────────────────────────────────────────
// ONE-SHOT: tx consume genesis_ref → MintPool chỉ chạy ≤ 1 lần → slot bất khả
// tái sinh. deployBuilder dựng tất định từ cây Merkle (leaves = tên slot).
//
// N LỚN (vượt giới hạn tx size ~ vài trăm slot/tx): chia nhiều tx SETUP.
//   - Tx ĐẦU (buildDeploySetupTx): consume genesis_ref, đúc POOL + SETUP authority
//     token + lô slot đầu. Giữ authority ở output để tx tiếp dùng.
//   - Tx TIẾP (buildSetupSlotBatchTx): consume authority UTxO, đúc thêm lô slot,
//     trả authority về (continue) hoặc BURN authority (tx cuối, finalize).
//   Onchain airdrop_nft.MintPool ép: tx ĐẦU genesis ⇒ POOL qty 1 + pool OUTPUT có
//   claimed_count == 0; tx tiếp authority input ⇒ POOL qty 0 (chống đúc POOL thứ 2)
//   + CẤM re-mint authority (qty authority ≤ 0) + PHẢI tham chiếu POOL UTxO (input
//   thường HOẶC reference input bằng .readFrom([poolUtxo])) để onchain đọc được
//   claimed_count và ép == 0. ⇒ Khi implement buildSetupSlotBatchTx: BẮT BUỘC thêm
//   .readFrom([poolUtxo]) (hoặc collectFrom pool — nhưng reference rẻ hơn, không
//   tiêu pool). Gate claimed_count == 0 là khoá trustless: sau khi claim mở, KHÔNG
//   tx nào đúc thêm slot được.
//
// Builder này lo lô đơn (single-tx) cho snapshot nhỏ/vừa; helper batch cho N lớn.

import {
  toUnit,
  type LucidEvolution, type UTxO, type MintingPolicy, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import { airdropPoolToCbor, mintPoolRedeemerToCbor } from "./datum.js";
import { POOL_NFT_NAME } from "./constants.js";
import type { AirdropPool, MerkleTree } from "./types.js";

/** Asset name SETUP authority token = "ASETUP" (#"415345545550"). Khớp ledger.ak. */
export const SETUP_AUTHORITY_NAME = "415345545550";

export interface DeployParams {
  lucid: LucidEvolution;

  /** UTxO genesis (one-shot) — phải nằm trong inputs của tx SETUP. */
  genesisUtxo: UTxO;

  /** Minting policy airdrop_nft (đã apply genesis_ref của genesisUtxo). */
  airdropNftPolicy: MintingPolicy;
  /** policyId của airdrop_nft. */
  airdropNftPolicyId: string;

  /** Địa chỉ pool script — POOL NFT + kho LAMP + datum ngụ ở đây. */
  poolAddress: string;
  /** Datum pool ban đầu (claimed_count=0; marker_dest = địa chỉ registry). */
  pool: AirdropPool;

  /** Cây Merkle — leaves = tên slot NFT (1 slot/leaf). */
  tree: MerkleTree;

  lamp_policy: string;
  lamp_name: string;
  /** Tổng LAMP (oil) nạp vào pool = tổng snapshot. */
  poolLampAmount: bigint;

  /** min-ADA kèm POOL UTxO. Mặc định 2 ADA. */
  poolLovelace?: bigint;
  /** min-ADA kèm mỗi slot UTxO. Mặc định 2 ADA (đủ để Sweep gom về Treasury sau). */
  slotLovelace?: bigint;

  /** Nếu set: đúc thêm SETUP authority token (multi-tx SETUP cho N lớn). */
  withAuthority?: boolean;
}

export interface DeployResult {
  tx: TxSignBuilder;
  poolNftUnit: string;
  slotUnits: string[];
  summary: string;
}

/** SETUP single-tx: đúc POOL + tất cả slot, phân phối. Dùng khi N vừa 1 tx chứa. */
export async function buildDeployTx(params: DeployParams): Promise<DeployResult> {
  const {
    lucid, genesisUtxo, airdropNftPolicy, airdropNftPolicyId,
    poolAddress, pool, tree, lamp_policy, lamp_name, poolLampAmount,
  } = params;

  const poolLovelace = params.poolLovelace ?? 2_000_000n;
  const slotLovelace = params.slotLovelace ?? 2_000_000n;

  const poolNftUnit = toUnit(airdropNftPolicyId, POOL_NFT_NAME);
  const lampUnit = toUnit(lamp_policy, lamp_name);
  const slotUnits = tree.leaves.map((leaf) => toUnit(airdropNftPolicyId, leaf));

  // mint: POOL NFT +1, mỗi slot +1, (tùy chọn) authority +1.
  const mintAssets: Record<string, bigint> = { [poolNftUnit]: 1n };
  for (const u of slotUnits) mintAssets[u] = 1n;
  if (params.withAuthority) {
    mintAssets[toUnit(airdropNftPolicyId, SETUP_AUTHORITY_NAME)] = 1n;
  }

  let txb = lucid
    .newTx()
    .collectFrom([genesisUtxo])
    .mintAssets(mintAssets, mintPoolRedeemerToCbor())
    .attach.MintingPolicy(airdropNftPolicy)
    // POOL UTxO: POOL NFT + kho LAMP + datum.
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: airdropPoolToCbor(pool) },
      { lovelace: poolLovelace, [poolNftUnit]: 1n, [lampUnit]: poolLampAmount },
    );

  // mỗi slot NFT → marker_dest (registry).
  for (const u of slotUnits) {
    txb = txb.pay.ToAddress(pool.marker_dest, { lovelace: slotLovelace, [u]: 1n });
  }

  const tx = await txb.complete();

  const summary = [
    `═══ TIGER Airdrop SETUP (deploy, one-shot) ═══`,
    `Pool addr:    ${poolAddress}`,
    `Registry:     ${pool.marker_dest}`,
    `POOL NFT:     ${poolNftUnit}`,
    `Slots minted: ${slotUnits.length} (1/leaf)`,
    `Pool LAMP:    ${poolLampAmount / 1_000_000n} LAMP (${poolLampAmount} oil)`,
    `Merkle root:  ${pool.merkle_root}`,
    `Deadline:     epoch ${pool.deadline_epoch}`,
  ].join("\n");

  return { tx, poolNftUnit, slotUnits, summary };
}
