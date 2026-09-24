// LampDistribution beaconBuilder — committee post DropParam{D} cho epoch kế (CONTRACT v2 §3).
//
// Beacon UTxO giữ 1 authenticity NFT (param beaconNftPolicy + assetName "DROP").
// Spend beacon UTxO cũ (PostBeacon redeemer) → tạo beacon UTxO mới với BeaconDatum
// epoch+kind+drop_value mới, NFT đi cùng. Require ≥ threshold committee signatures
// (C-BCN-1). KHÔNG mint (C-MINT-0): NFT đã tồn tại, chỉ chuyển tiếp.
//
// v2 chỉ còn 1 kind: DropParam. Bỏ Randomness/MerkleRoot beacon.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import type { BeaconDatum, BeaconKind } from "./types.js";
import { beaconDatumToCbor, beaconDatumFromCbor, beaconRedeemerToCbor } from "./datum.js";
import { assertCommitteeSigners } from "./committee.js";
import {
  RATE_ROOT_MIN, RATE_ROOT_MAX, MAX_RATE_ROOT_DELTA_Q, Q, epochWindow,
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

  /**
   * Datum beacon HIỆN TẠI — để kiểm ba chốt v3 trước khi gửi: C-BCN-5' (chỉ nới),
   * C-BCN-5a (một lượt ≤ +10%), C-BCN-6 (chỉ số cộng dồn, quá khứ định giá bằng
   * `rate_root` CŨ). Bỏ trống thì ba phép kiểm đó không chạy — validator vẫn ép.
   *
   * v2 nhận một con số (`currentDropValue`); v3 phải nhận TRỌN datum vì C-BCN-6 cần cả
   * `index`, `rate_root` LẪN `epoch` của lượt trước.
   */
  currentBeacon?: BeaconDatum;
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

  if (newBeacon.rate_root <= 0n) {
    throw new Error(`BEACON-001: rate_root (w) phải > 0, nhận ${newBeacon.rate_root}`);
  }

  if (newBeacon.trim_den <= 0n) {
    throw new Error(
      `BEACON-007: trim_den phải > 0, nhận ${newBeacon.trim_den}. beacon.ak ép chốt này ` +
        `vì trim_den là mẫu số của phép cắt ngọn ở claim_account ▸ Redeem: đặt nó bằng 0 ` +
        `làm MỌI giao dịch rút của toàn hệ đổ vỡ vĩnh viễn, trong khi beacon vẫn hợp lệ và ` +
        `sổ vẫn đúng — không ai kêu.`,
    );
  }

  // ── C-BCN-5b (biên cứng của `rate_root`) — chặn ở bên dựng, KHÔNG thay validator ─
  // Validator vẫn là chỗ ép; chỗ này chỉ đổi một lần từ chối của chuỗi (chỉ nói
  // "validator crashed") thành một câu nói ra con số và cái biên nó vượt.
  if (newBeacon.rate_root < RATE_ROOT_MIN || newBeacon.rate_root > RATE_ROOT_MAX) {
    throw new Error(
      `BEACON-004: rate_root ${newBeacon.rate_root} nằm ngoài biên cứng ` +
        `[${RATE_ROOT_MIN}, ${RATE_ROOT_MAX}] mà beacon.ak ép ở C-BCN-5b.`,
    );
  }

  if (params.currentBeacon !== undefined) {
    const cur = params.currentBeacon;

    // ── C-BCN-5' (v3): `rate_root` CHỈ ĐƯỢC NỚI — MỘT CHIỀU ───────────────────────
    // Đây là chốt trung tâm của v3, và nó KHÁC v2 ở CHIỀU chứ không ở độ lớn. v2 dùng
    // một hàm đối xứng nên trần ±10% chặn tốc độ mà không chặn chiều; một lượt hạ 10%
    // khoá vĩnh viễn mọi tài khoản đã chạy từ 9 cửa sổ trở lên.
    if (newBeacon.rate_root < cur.rate_root) {
      throw new Error(
        `BEACON-008: hạ rate_root từ ${cur.rate_root} xuống ${newBeacon.rate_root} bị ` +
          `beacon.ak C-BCN-5' từ chối. Tốc độ tích luỹ CHỈ ĐƯỢC NỚI — hạ nó viết lại toàn ` +
          `bộ quá khứ của mọi tài khoản, không chỉ chặn một lần rút. Muốn siết thì siết ` +
          `trim_num (kênh một-lượt-rút), chỗ đó siết thoải mái.`,
      );
    }

    // ── C-BCN-5a: một lượt nới không quá +10% ────────────────────────────────────
    const delta = newBeacon.rate_root - cur.rate_root;
    if (delta * Q > cur.rate_root * MAX_RATE_ROOT_DELTA_Q) {
      throw new Error(
        `BEACON-005: nới rate_root từ ${cur.rate_root} lên ${newBeacon.rate_root} ` +
          `(lệch ${delta}) vượt trần +10% mỗi lượt post mà beacon.ak ép ở C-BCN-5a. ` +
          `Muốn đi xa hơn thì đi nhiều cửa sổ, mỗi cửa sổ một lượt.`,
      );
    }

    // ── C-BCN-6: chỉ số cộng dồn — quá khứ định giá bằng `rate_root` CŨ ──────────
    // Thừa số là `cur.rate_root`, KHÔNG phải `newBeacon.rate_root`. Đó là toàn bộ nội
    // dung của chốt: tốc độ mới chỉ có hiệu lực TỪ cửa sổ này trở đi, nên một lượt post
    // không với ngược lại được vào bất kỳ điểm nào của quá khứ.
    const expectedIndex =
      cur.index + cur.rate_root * (newBeacon.epoch - cur.epoch);
    if (newBeacon.index !== expectedIndex) {
      throw new Error(
        `BEACON-009: index ${newBeacon.index} khác giá trị C-BCN-6 đòi (${expectedIndex} ` +
          `= ${cur.index} + ${cur.rate_root}·(${newBeacon.epoch} − ${cur.epoch})). ` +
          `Quá khứ phải được định giá bằng rate_root CŨ.`,
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

  // ── C-BCN-2 + nền của ba chốt v3: đọc datum THẬT trên UTxO, không tin bản caller đưa ──
  //
  // Bản trước decode `prev` rồi `void prev;` — chú thích nói "kiểm tra epoch đơn điệu
  // tăng", mã không kiểm gì. Đó là dạng hỏng tệ hơn thiếu hẳn phép kiểm: người đọc thấy
  // một cái tên ở đúng chỗ và tin là chốt có người canh (`Forall §Kỷ luật phát ngôn` mục
  // 6 — "giao độ phủ cho hàng xóm có tên").
  //
  // Hai vế, và vế thứ hai mới là vế đắt:
  //
  //   (a) C-BCN-2 — `beacon.ak:69` ép `out_datum.epoch > datum.epoch`. Không kiểm ở đây
  //       thì một lượt post sai nhãn chỉ đổ lúc NỘP. Trên mạng thật cái giá không phải một
  //       thông báo lỗi mà là một CỬA SỔ: C-BCN-3 đòi nhãn == cửa sổ đang chạy, nên hỏng
  //       một lượt là mất lượt post của cả cửa sổ đó, và cửa sổ Preprod dài 5 NGÀY.
  //
  //   (b) `params.currentBeacon` là bản CALLER ĐƯA, không phải bản trên chuỗi. Ba chốt v3
  //       ở trên (C-BCN-5' · 5a · 6) đều đo so với nó. Lệch một trường thì cả ba tính trên
  //       một mốc KHÔNG TỒN TẠI, xanh hết ở local, rồi validator bác — hoặc tệ hơn, lọt
  //       qua validator với một `index` dựng từ mốc sai. Không nơi nào trong tệp này từng
  //       đối chiếu hai bản đó.
  if (!beaconUtxo.datum) {
    throw new Error(
      `BEACON-010: beacon UTxO ${beaconUtxo.txHash}#${beaconUtxo.outputIndex} không mang ` +
        `inline datum, nên không đọc được mốc trước. Không đoán mốc: C-BCN-2 và C-BCN-6 ` +
        `đều đo so với nó.`,
    );
  }

  let onChainPrev: BeaconDatum;
  try {
    onChainPrev = beaconDatumFromCbor(beaconUtxo.datum);
  } catch (e) {
    // KHÔNG nuốt. Một datum không giải được là trạng thái "KHÔNG ĐO ĐƯỢC", và nó phải kêu
    // TO HƠN một mệnh đề lệch — bản trước coi nó là "không sao" và đi tiếp.
    throw new Error(
      `BEACON-011: không giải được datum beacon trên chuỗi (${(e as Error).message}). ` +
        `Dừng ở đây thay vì dựng tiếp trên một mốc không đọc được.`,
    );
  }

  // (a) C-BCN-2
  if (newBeacon.epoch <= onChainPrev.epoch) {
    throw new Error(
      `BEACON-012: nhãn epoch ${newBeacon.epoch} không lớn hơn nhãn trên chuỗi ` +
        `${onChainPrev.epoch}; beacon.ak C-BCN-2 ép TĂNG NGHIÊM NGẶT. Bằng nhau nghĩa là ` +
        `cửa sổ này đã post rồi — mỗi cửa sổ post được TỐI ĐA MỘT lượt, nên lượt này phải ` +
        `chờ cửa sổ sau.`,
    );
  }
  if (newBeacon.kind !== onChainPrev.kind) {
    throw new Error(
      `BEACON-013: kind đổi từ ${onChainPrev.kind} sang ${newBeacon.kind}; ` +
        `beacon.ak C-BCN-2 ép kind bảo toàn.`,
    );
  }

  // (b) bản caller đưa phải KHỚP bản trên chuỗi
  if (params.currentBeacon !== undefined) {
    const c = params.currentBeacon;
    const lech = (
      [
        ["epoch", c.epoch, onChainPrev.epoch],
        ["kind", c.kind, onChainPrev.kind],
        ["index", c.index, onChainPrev.index],
        ["rate_root", c.rate_root, onChainPrev.rate_root],
        ["trim_num", c.trim_num, onChainPrev.trim_num],
        ["trim_den", c.trim_den, onChainPrev.trim_den],
      ] as const
    ).filter(([, a, b]) => a !== b);
    if (lech.length > 0) {
      throw new Error(
        `BEACON-014: currentBeacon caller đưa KHÁC datum trên chuỗi ở ` +
          lech.map(([t, a, b]) => `${t} (${a} ≠ ${b})`).join(", ") +
          `. Ba chốt v3 phía trên vừa đo so với một mốc không tồn tại.`,
      );
    }
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
    `Index A:      ${newBeacon.index} (cộng dồn)`,
    `rate_root w:  ${newBeacon.rate_root}`,
    `Cắt ngọn κ:   ${newBeacon.trim_num}/${newBeacon.trim_den}`,
    `NFT:          ${nftUnit}`,
    `Committee:    ${signers.length}/${committeeKeyHashes.length} signers (need ${threshold})`,
    `Beacon addr:  ${beaconAddress}`,
  ].join("\n");

  return { tx, beaconAddress, newBeacon, summary };
}
