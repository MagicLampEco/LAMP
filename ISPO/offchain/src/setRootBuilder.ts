// setRootBuilder — ISPO SetRoot: admin nạp Merkle root epoch kế tiếp + đúc BỘ
// CLAIM-SLOT gửi vào registry.
//
// FLOW (cần ngưỡng admin_threshold chữ ký):
//   1. Spend POOL UTxO (redeemer IspoRedeemer::SetRoot{root}).
//   2. Mint BỘ SLOT NFT (redeemer MintSlots): mỗi owner trong root mới → 1 slot
//      name=blake2b_256(epoch||owner), qty +1. Hợp lệ vì tx có POOL NFT input.
//   3. Output:
//      - pool' = pool (value bảo toàn TUYỆT ĐỐI) + datum epoch_roots append root.
//      - registry: mỗi slot NFT 1 output ở Script(ispoMarkerScript).
//   4. addSigner cho admin (ngưỡng kiểm on-chain).
//
// onchain ép: epoch_roots append đúng 1; pool.value bảo toàn; ngưỡng admin; slot
// KHÔNG rò rỉ ngoài registry. Slot-set khớp đúng leaf của root dựa admin (off-chain).

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy,
  type TxSignBuilder, Data,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { POOL_NFT_NAME } from "./constants.js";
import { decodeIspoDatum, ispoDatumToCbor, setRootRedeemerToCbor, mintSlotsRedeemerToCbor } from "./datum.js";
import { markerName } from "./merkle.js";
import type { IspoDatum } from "./types.js";

export interface SetRootParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (inline IspoDatum, mang POOL NFT). */
  poolUtxo: UTxO;
  /** Applied ispo_pool spend validator. */
  ispoPoolScript: Validator;
  /** Applied ispo_marker spend validator (registry GIỮ slot). */
  ispoMarkerScript: Validator;
  /** Applied ispo_nft minting policy (POOL+SLOT). */
  ispoNftPolicy: MintingPolicy;
  /** policyId của ispoNftPolicy. */
  ispoNftPolicyId: string;

  /** Merkle root (hex) của epoch KẾ TIẾP (= epoch_roots.length hiện tại). */
  root: string;
  /** Danh sách owner (pkh hex) có entitlement trong epoch mới → đúc slot. */
  owners: string[];

  /** pkh admin ký (đủ ngưỡng admin_threshold). */
  adminSigners: string[];

  /** ADA min mỗi output slot ở registry. Mặc định 2 ADA. */
  slotLovelace?: bigint;
}

export interface SetRootResult {
  tx: TxSignBuilder;
  epoch: number;
  root: string;
  slotUnits: string[];
  registryAddress: string;
  datumAfter: IspoDatum;
  summary: string;
}

export async function buildSetRootTx(params: SetRootParams): Promise<SetRootResult> {
  const {
    lucid, network, poolUtxo, ispoPoolScript, ispoMarkerScript,
    ispoNftPolicy, ispoNftPolicyId, root, owners, adminSigners,
  } = params;

  const slotLovelace = params.slotLovelace ?? 2_000_000n;
  const poolNftUnit = toUnit(ispoNftPolicyId, POOL_NFT_NAME);

  if (!poolUtxo.datum) throw new Error("ISPO-SETROOT-001: poolUtxo không có inline datum");
  const datum: IspoDatum = decodeIspoDatum(Data.from(poolUtxo.datum));

  if ((poolUtxo.assets[poolNftUnit] ?? 0n) < 1n) {
    throw new Error("ISPO-SETROOT-002: poolUtxo không mang POOL NFT");
  }
  // epoch mới = vị trí append = số root hiện có.
  const epoch = BigInt(datum.epoch_roots.length);
  if (epoch > datum.end_epoch + 1n) {
    throw new Error(`ISPO-SETROOT-003: epoch ${epoch} vượt end_epoch+1 (${datum.end_epoch + 1n})`);
  }
  if (adminSigners.length === 0) {
    throw new Error("ISPO-SETROOT-004: cần ít nhất 1 admin signer");
  }

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(ispoPoolScript)),
  );
  const registryAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(ispoMarkerScript)),
  );

  // ── datum sau: append root (field khác bất biến) ─────────────────────────
  const datumAfter: IspoDatum = {
    ...datum,
    epoch_roots: [...datum.epoch_roots, root],
  };

  // ── pool output: value bảo toàn TUYỆT ĐỐI ────────────────────────────────
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets };

  // ── bộ slot: mỗi owner → 1 slot NFT (name=blake2b_256(epoch||owner)) ──────
  const slotUnits: string[] = [];
  const mintBundle: Record<string, bigint> = {};
  for (const owner of owners) {
    const sName = markerName(epoch, owner);
    const unit = toUnit(ispoNftPolicyId, sName);
    if (mintBundle[unit] !== undefined) {
      throw new Error(`ISPO-SETROOT-005: owner trùng trong epoch ${epoch}: ${owner}`);
    }
    mintBundle[unit] = 1n;
    slotUnits.push(unit);
  }

  let txb = lucid
    .newTx()
    .collectFrom([poolUtxo], setRootRedeemerToCbor(root))
    .attach.SpendingValidator(ispoPoolScript)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: ispoDatumToCbor(datumAfter) },
      poolOutAssets,
    );

  if (slotUnits.length > 0) {
    txb = txb
      .mintAssets(mintBundle, mintSlotsRedeemerToCbor())
      .attach.MintingPolicy(ispoNftPolicy);
    // mỗi slot 1 output ở registry.
    for (const unit of slotUnits) {
      txb = txb.pay.ToAddress(registryAddress, { lovelace: slotLovelace, [unit]: 1n });
    }
  }

  for (const pkh of adminSigners) txb = txb.addSignerKey(pkh);

  const tx = await txb.complete();

  const summary = [
    `═══ ISPO SetRoot (epoch ${epoch}) ═══`,
    `Root:         ${root}`,
    `Slots minted: ${slotUnits.length} → registry`,
    `Registry:     ${registryAddress}`,
    `Admin signs:  ${adminSigners.length}`,
  ].join("\n");

  return { tx, epoch: Number(epoch), root, slotUnits, registryAddress, datumAfter, summary };
}
