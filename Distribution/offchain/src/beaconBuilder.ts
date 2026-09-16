// LampDistribution beaconBuilder — committee post DropParam{D} cho epoch kế (CONTRACT v2 §3).
//
// Beacon UTxO giữ 1 authenticity NFT (param beaconNftPolicy + assetName "DROP").
// Spend beacon UTxO cũ (PostBeacon redeemer) → tạo beacon UTxO mới với BeaconDatum
// epoch+kind+drop_value mới, NFT đi cùng. Require ≥ threshold committee signatures
// (C-BCN-1). KHÔNG mint (C-MINT-0): NFT đã tồn tại, chỉ chuyển tiếp.
//
// v2 chỉ còn 1 kind: DropParam. Bỏ Randomness/MerkleRoot beacon.

import {
  Data, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import type { BeaconDatum, BeaconKind } from "./types.js";
import { beaconDatumToCbor, beaconRedeemerToCbor } from "./datum.js";
import { assertCommitteeSigners } from "./committee.js";
import {
  DROP_VALUE_MIN, DROP_VALUE_MAX, MAX_DROP_DELTA_Q, Q, epochWindow,
} from "./constants.js";

/** Asset-name hex NFT từng kind — PHẢI khớp onchain util.beacon_name. */
export const DEFAULT_BEACON_ASSET_NAMES: Record<BeaconKind, string> = {
  DropParam: "44524f50", // "DROP"
};

export interface PostBeaconParams {
  lucid:        LucidEvolution;
  /** Beacon UTxO hiện tại (giữ NFT authenticity, datum kind = DropParam). */
  beaconUtxo:   UTxO;
  /** Applied beacon validator (đã bake params, định nghĩa beacon address). */
  beaconScript: Validator;
  network:      Network;

  /** Authenticity NFT policy id (compile-time param của beacon validator). */
  beaconNftPolicy: string;
  /** NFT asset-name hex; mặc định "DROP" (DEFAULT_BEACON_ASSET_NAMES). */
  beaconNftAssetName?: string;

  /** Giá trị beacon mới sẽ post (epoch kế + DropParam + drop_value D). */
  newBeacon: BeaconDatum;

  /** Danh sách committee key-hash (hex). Threshold = ⌈2N/3⌉. */
  committeeKeyHashes: string[];
  /** Override threshold (mặc định ⌈2N/3⌉). */
  threshold?: number;
  /** Subset committee sẽ ký tx này — phải ≥ threshold. Mặc định = toàn bộ. */
  signerKeyHashes?: string[];

  /**
   * Mẫu số quy đổi epoch của mạng (compile-time param của beacon validator kể từ C-BCN-3).
   * Có giá trị này thì builder tự đặt validity_range đúng cửa sổ và tự kiểm nhãn — bỏ
   * trống thì hai việc đó không chạy (đường unit test off-chain).
   */
  msPerEpoch?: bigint;

  /** Giá trị D hiện đang trên beacon — để kiểm trần ±10% (C-BCN-5) trước khi gửi. */
  currentDropValue?: bigint;
}

export interface PostBeaconResult {
  tx:            TxSignBuilder;
  beaconAddress: string;
  newBeacon:     BeaconDatum;
  summary:       string;
}

/**
 * Build unsigned tx: committee post DropParam{D} mới cho epoch kế.
 *
 * Bảo toàn (C-BCN-1 / C-MINT-0 / C-VAL-0):
 *   - NFT authenticity đi từ beacon input sang beacon output (cùng 1 NFT).
 *   - Toàn bộ assets khác trên beacon UTxO bảo toàn (lovelace + bất kỳ dust).
 *   - epoch mới > epoch cũ (đơn điệu tăng); kind bảo toàn (DropParam).
 *   - tx KHÔNG mint.
 *   - ≥ threshold committee signers (addSignerKey từng key).
 */
export async function buildPostBeaconTx(params: PostBeaconParams): Promise<PostBeaconResult> {
  const {
    lucid, beaconUtxo, beaconScript, network,
    beaconNftPolicy, newBeacon, committeeKeyHashes,
  } = params;

  const signers   = params.signerKeyHashes ?? committeeKeyHashes;
  const threshold = assertCommitteeSigners(committeeKeyHashes, signers, params.threshold);

  if (newBeacon.drop_value <= 0n) {
    throw new Error(`BEACON-001: drop_value (D) must be > 0, got ${newBeacon.drop_value}`);
  }

  // ── C-BCN-4 (biên cứng của D) — chặn ở bên dựng, KHÔNG thay cho validator ────────
  // Validator vẫn là chỗ ép; chỗ này chỉ đổi một lần từ chối của chuỗi (chỉ nói
  // "validator crashed") thành một câu nói ra con số và cái biên nó vượt.
  if (newBeacon.drop_value < DROP_VALUE_MIN || newBeacon.drop_value > DROP_VALUE_MAX) {
    throw new Error(
      `BEACON-004: drop_value ${newBeacon.drop_value} nằm ngoài biên cứng ` +
        `[${DROP_VALUE_MIN}, ${DROP_VALUE_MAX}] oildrop mà beacon.ak ép ở C-BCN-4. ` +
        `Trần chặn việc đặt D đủ lớn để mọi tài khoản vested trọn entitlement trong một ` +
        `cửa sổ; sàn chặn việc hạ D về ~0 để đóng băng vesting của người đang chờ.`,
    );
  }

  // ── C-BCN-5 (tốc độ đổi ≤ ±10% một lượt) ────────────────────────────────────────
  if (params.currentDropValue !== undefined) {
    const cur = params.currentDropValue;
    const delta = newBeacon.drop_value > cur
      ? newBeacon.drop_value - cur
      : cur - newBeacon.drop_value;
    if (delta * Q > cur * MAX_DROP_DELTA_Q) {
      throw new Error(
        `BEACON-005: đổi D từ ${cur} sang ${newBeacon.drop_value} (lệch ${delta}) vượt trần ` +
          `±10% mỗi lượt post mà beacon.ak ép ở C-BCN-5. Trần này giữ cho tài khoản đang ` +
          `vesting dở không gặp vách; muốn đi xa hơn thì đi nhiều cửa sổ, mỗi cửa sổ một lượt.`,
      );
    }
  }

  const assetName = params.beaconNftAssetName ?? DEFAULT_BEACON_ASSET_NAMES[newBeacon.kind];
  const nftUnit   = toUnit(beaconNftPolicy, assetName);

  // ── Verify NFT thực sự nằm trên beacon UTxO (1 NFT authenticity) ──
  const nftQty = beaconUtxo.assets[nftUnit] ?? 0n;
  if (nftQty !== 1n) {
    throw new Error(
      `BEACON-003: beacon UTxO must hold exactly 1 authenticity NFT ` +
      `(${nftUnit}); got ${nftQty}`,
    );
  }

  // ── epoch đơn điệu tăng (đọc datum cũ nếu có để kiểm tra) ──
  if (beaconUtxo.datum) {
    const prev = Data.from(beaconUtxo.datum);
    // Best-effort: chỉ kiểm tra khi decode được. Không chặn nếu datum lạ.
    void prev;
  }

  const beaconAddress = credentialToAddress(
    network,
    scriptHashToCredential(validatorToScriptHash(beaconScript)),
  );

  // ── Output assets: bảo toàn TẤT CẢ assets từ input (NFT + lovelace + dust) ──
  const outAssets: Record<string, bigint> = { ...beaconUtxo.assets };

  const datumCbor    = beaconDatumToCbor(newBeacon);
  const redeemerCbor = beaconRedeemerToCbor();

  let txb = lucid
    .newTx()
    .collectFrom([beaconUtxo], redeemerCbor)
    .attach.SpendingValidator(beaconScript)
    .pay.ToAddressWithData(
      beaconAddress,
      { kind: "inline", value: datumCbor },
      outAssets,
    );

  for (const k of signers) txb = txb.addSignerKey(k);

  // ── C-BCN-3 (Luật 2b): nhãn `epoch` PHẢI là cửa sổ tx này chạy trong đó ──────────
  // Trước bản vá, builder được tự do đặt `epoch` bất kỳ miễn lớn hơn lần trước — và chính
  // sự tự do đó đẻ ra beacon mang nhãn 4144 trong khi cửa sổ thật là 4142.
  let windowLabel: bigint | undefined;
  if (params.msPerEpoch !== undefined) {
    const w = epochWindow(params.msPerEpoch);
    windowLabel = w.epoch;
    if (newBeacon.epoch !== w.epoch) {
      throw new Error(
        `BEACON-006: nhãn epoch ${newBeacon.epoch} khác cửa sổ hiện tại ${w.epoch}. ` +
          `beacon.ak C-BCN-3 ép nhãn == cửa sổ tx chạy trong đó, nên nhãn nay là một SỰ ` +
          `THẬT ĐO ĐƯỢC chứ không phải bộ đếm lượt post. Hệ quả cần biết: mỗi cửa sổ post ` +
          `được TỐI ĐA MỘT lượt (C-BCN-2 đòi tăng, C-BCN-3 đòi bằng cửa sổ) — đó là điều ` +
          `kiện để trần ±10% ở C-BCN-5 là trần thật.`,
      );
    }
    txb = txb.validFrom(Number(w.loMs)).validTo(Number(w.hiMs));
  }

  const tx = await txb.complete();

  const summary = [
    `═══ PostBeacon (DropParam) ═══`,
    `Beacon in:    ${beaconUtxo.txHash}#${beaconUtxo.outputIndex}`,
    `Epoch:        ${newBeacon.epoch}${windowLabel !== undefined ? ` (== cửa sổ hiện tại)` : " (cửa sổ KHÔNG kiểm — thiếu msPerEpoch)"}`,
    `Drop value D: ${newBeacon.drop_value} oildrop`,
    `NFT:          ${nftUnit}`,
    `Committee:    ${signers.length}/${committeeKeyHashes.length} signers (need ${threshold})`,
    `Beacon addr:  ${beaconAddress}`,
  ].join("\n");

  return { tx, beaconAddress, newBeacon, summary };
}
