// 20_canonical_genesis.ts — Tx A của policy LAMP canonical MỚI: đúc trọn bộ marker one-shot.
//
// ĐÂY LÀ BƯỚC KHÔNG LÀM LẠI ĐƯỢC. Mọi policy dưới đây nướng cùng một `genesis_ref`, và một
// UTxO chỉ tiêu được MỘT lần trong lịch sử chuỗi. Marker nào không đúc trong giao dịch này
// thì KHÔNG BAO GIỜ đúc được nữa dưới các policy-id đã tính — mà `lamp_mint` lại nướng sẵn
// những policy-id ấy. Thiếu một marker = một nhánh chết vĩnh viễn.
//
// Đó chính xác là chuyện đã xảy ra trên mainnet: bản mồi 2026-06-18 nướng `meter_nft_policy`
// = 28 byte 0 (`Genesis/offchain/src/deployed.ts:92`) ⇒ nhánh `ReserveDraw` không bao giờ
// thoả ⇒ 9,63 tỷ LAMP Reserve không rút được qua policy đó (deployed.ts:118-119). Nên ở đây
// NĂM marker đúc trong ĐÚNG một giao dịch, không chia lượt, không để dành:
//
//   SUPPLY   (oneshot_nft)   → SupplyState, neo định danh bộ đếm cap
//   REGISTRY (oneshot_nft)   → bảng registry token_tag → authority (WHO-gate)
//   METER    (oneshot_nft)   → cửa DUY NHẤT của nhánh ReserveDraw  ← khe đã chết ở mainnet
//   TREASURY (treasury_nft)  → kho A-DEST, nơi DistributionVest bắt buộc rót LAMP vào
//   DROP     (beacon_nft)    → beacon của Distribution, cần cho đường claim/redeem về sau
//
// DROP nằm trong danh sách vì đúng cái lý do trên: `beaconPid` đã nướng vào `claim_account`
// ⇒ vào `treHash` ⇒ vào ĐỊA CHỈ KHO. Không đúc nó bây giờ thì địa chỉ kho vẫn đúng, nhưng
// đường claim/redeem chết câm y hệt nhánh Reserve của mainnet — và lúc phát hiện thì hạt
// giống đã tiêu, không quay lui được.
//
// ── F1 ĐÓNG Ở LƯỢT GENESIS (chủ dự án chốt 2026-10-02) ─────────────────────────────────
// Bản trước để METER ở VÍ (Lớp 1) và hạt giống custody ở cùng khoá ⇒ hai giao dịch là rút trọn
// 9,63 tỷ Reserve về một script tuỳ chọn (F1). Nay KHÔNG marker nào chạm ví:
//
//   Tx A0 (riêng, gửi TRƯỚC)  tiêu hạt giống custody, đúc custody NFT → instance custody thật.
//   Tx A                     năm marker như trên, CỘNG auth NFT `reserve_auth` (genesis_ref =
//                            chính hạt giống genesis) → `reserve_gate`, và METER đúc THẲNG vào
//                            `reserve_draw` kèm `ReserveState` — không còn bước "dời MET".
//
// Vì sao custody không vào Tx A: `Treasury/onchain/validators/custody_seed.ak` luật S-MINT-2
// `expect list.length(assets.policies(tx.mint)) == 1`. Gộp được chỉ khi đổi bytes `custody_seed`
// ⇒ đổi khe #13 ⇒ đổi policy tLAMP đã công bố. Tx A0 không phụ thuộc output nào của Tx A nên gửi
// trước được; gửi trước thì không có thời điểm nào hạt giống custody sống cùng lúc với METER.
// Cổng đo đích marker trên output THẬT của cả hai giao dịch: `_genesisReservePlacement.ts`.
//
// ── NFT CON TRỎ GOVERNANCE (Treasury/GovernancePointer.md v0.1 §Genesis) ─────────────────
//   Tx P (riêng, gửi TRƯỚC Tx A0)  tiêu hạt giống con trỏ `POINTER_SEED_TX/IDX`, đúc `GOVPOINTER`
//                                  vào `Script(pointer_policy)`, datum đầu: governance_hash rỗng,
//                                  committee = [pkh vận hành], threshold 1, chưa niêm phong.
// `pointer_policy` (= script hash `governance_pointer` áp `(seed, change_delay_ms)`) là khe #1 của
// `custody` VÀ `CustodyDatum.governance_ref` — custody không còn nướng hash governance, nên
// governance dựng lại được mà không đúc lại kho. Thứ tự gửi P → A0 → A, mỗi bước chờ xác nhận
// (POINTER-ORDER-001, F1-ORDER-001). RIÊNG vì `custody_seed.ak` S-MINT-2 (một policy đúc / tx).
// Hạt giống con trỏ phải KHÁC hạt giống genesis và custody (POINTER-SEED-002).
//
// BIẾN BẮT BUỘC thêm cho đường này: `POINTER_SEED_TX`/`POINTER_SEED_IDX` (POINTER-SEED-001),
// `POINTER_CHANGE_DELAY_MS` (Preprod thiếu ⇒ 3_600_000; Mainnet thiếu ⇒ POINTER-DELAY-001),
// `RESERVE_FLOOR_OILDROP` (sàn cổng cầu, FLOOR-ENV-001), `CARP_POLICY_ID`/`CARP_TOKEN_NAME`
// (datum custody). Chạy khô thiếu CARP thì Tx A0 KHÔNG ĐO ĐƯỢC (in to) nhưng Tx A vẫn dựng;
// lượt gửi thật thiếu bất kỳ biến nào thì ném trước khi gửi gì. `GOVERNANCE_SCRIPT_HASH` KHÔNG
// còn được đọc (gỡ 2026-10-03).
//
// BIẾN BẮT BUỘC: `RESERVE_KHO_NFT_POLICY` (khe #13) và `CUSTODY_SEED_TX`/`CUSTODY_SEED_IDX` —
// UTxO hạt giống đã sinh ra policy id ấy. Hai thứ này là HAI MẶT của một sự thật, nên bước này
// đòi cả hai: có policy mà không có hạt giống thì không đo được việc hạt giống còn sống hay đã
// bị chính giao dịch này tiêu mất.
//
// Và bước này KHÔNG chỉ kiểm định dạng của policy ấy: cổng RESERVE-KHO-003 dẫn xuất policy TỪ
// hạt giống rồi so với biến (`_custodySeedRef.ts::reserveKhoParamsFromEnv`). Không có phép so
// đó thì một policy chép lại từ lượt chạy TRƯỚC vẫn qua mọi cổng — nó đủ 56 ký tự hex — và chỗ
// lệch chỉ lộ ra sau khi giao dịch không-làm-lại-được này đã lên chuỗi.
//
// Chạy:
//   NETWORK=Preprod CUSTODY_SEED_TX=… CUSTODY_SEED_IDX=… tsx 20_canonical_genesis.ts   # dựng + eval
//   NETWORK=Preprod CUSTODY_SEED_TX=… CUSTODY_SEED_IDX=… SUBMIT=true tsx 20_canonical_genesis.ts
//
// Policy phải công bố TRƯỚC khi gửi (nhà khác nướng nó vào hash): ghim hạt giống genesis và đòi
// policy đã công bố — lượt gửi thật ném nếu thiếu EXPECTED_LAMP_PID hoặc lệch:
//   … GENESIS_SEED_TX=… GENESIS_SEED_IDX=… tsx 20_canonical_genesis.ts            # in ra lampPid
//   … GENESIS_SEED_TX=… GENESIS_SEED_IDX=… EXPECTED_LAMP_PID=… SUBMIT=true tsx 20_canonical_genesis.ts
import {
  Constr, Data, coreToTxOutput, getAddressDetails, mintingPolicyToId, scriptFromNative,
  type LucidEvolution, type TxSignBuilder, type UTxO,
} from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, TOKEN_NAME, makeLucid, walletPkh, explorerTx } from "./config.js";
import { assertOneShotMarkers } from "./_guards.js";
import { supplyStateToCbor } from "../offchain/src/datum.js";
import { windowIndex } from "../../Utils/src/index.js";
import {
  deriveWiring, printWiring, registryDatum, treasuryDatum, genesisBeaconDatum, canonicalWindowOrigin,
  DIST_CAP, RESERVE_CAP, MS_PER_EPOCH, STATE_PATH, writeState, waitFor, type CanonicalState,
} from "./_canonical_v2.js";
import {
  assertExpectedLampPid, assertSeedNotCustody, assertSeedNotSpent, custodySeedRefFromEnv,
  findOwnedCustodySeed, findOwnedGenesisSeed, genesisSeedRefFromEnv, refKey,
  reserveKhoParamsFromEnv, txCollateralKeys, txInputKeys, type OutputRef,
} from "./_custodySeedRef.js";
import {
  INSTANCE_ID, RESERVE_TOTAL, VOID_DATUM, carpAssetFromEnv, custodySeedDatum, custodySeedPolicyId,
  deriveReserveWiring, epochNow, printReserveWiring,
  reserveFloorFromEnv, reserveStateDatum, resolveDelegationAdmin,
  assertPointerSeedDistinct, derivePointer, pointerDelayFromEnv, pointerSeedRefFromEnv,
} from "./_reserve_layer2.js";
import {
  assertMarkerPlacement, assertReserveTotalMatchesCap, assertTxKeepsSeed, overLimits,
  txA0MarkerTargets, txAMarkerTargets, txPMarkerTargets, type PlacedOutput, type TxBudget,
} from "./_genesisReservePlacement.js";
import { genesisPointerDatum, pointerDatumToCbor } from "../../Treasury/offchain/src/pointer.js";
import { floorSourceWarning } from "./_floorLabel.js";
import { custodyDatumToCbor } from "../../Treasury/offchain/src/datum.js";
import { mintAuthRedeemerToCbor } from "../../Treasury/offchain/src/reserveAuthBuilder.js";

/** min-ADA mỗi UTxO mang đúng 1 NFT + datum nhỏ. Dư một chút cho an toàn. */
const NFT_ADA = 2_000_000n;
/** Tám output NFT (Tx P + Tx A0 + Tx A) + phí + trả lại. Dưới mức này thì Lucid gãy ở bước cân bằng, khó đọc. */
const MIN_BALANCE = 22_000_000n;

/**
 * Tra hạt giống con trỏ theo outref. Đã tiêu ⇒ `undefined` (hợp lệ khi Tx P của chính lượt này đã
 * đặt NFT con trỏ — phân biệt ở cổng POINTER-SEED-004). Còn sống nhưng khoá khác ⇒ NÉM: Tx P sẽ
 * không ký tiêu được nó, và policy con trỏ đã nướng vào khe #1 custody.
 */
async function findOwnedPointerSeed(
  lucid: LucidEvolution, ref: OutputRef, pkh: string,
): Promise<UTxO | undefined> {
  const found = (await lucid.utxosByOutRef([ref])).find((u) => refKey(u) === refKey(ref));
  if (!found) return undefined;
  const pay = getAddressDetails(found.address).paymentCredential;
  if (pay?.type !== "Key" || pay.hash.toLowerCase() !== pkh.toLowerCase()) {
    throw new Error(
      `POINTER-SEED-003: hạt giống con trỏ ${refKey(ref)} còn sống nhưng nằm ở ${found.address}, ` +
        `payment credential ${pay ? `${pay.type}:${pay.hash}` : "(không đọc được)"} — KHÔNG phải ` +
        `khoá ${pkh} của ví đang chạy. Tx P sẽ không ký tiêu được nó.`,
    );
  }
  return found;
}
/**
 * lovelace đặt lên UTxO custody — PHẢI đúng bằng `reserved_min_ada` trong redeemer: `custody_seed.ak`
 * luật S-SEED-0 là một đẳng thức chính xác (cùng hằng với `24_reserve_layer2_init.ts`).
 */
const RESERVED_MIN_ADA = 2_000_000n;

/** Output thật của một giao dịch đã dựng — đọc từ thân giao dịch, không từ ý định người dựng. */
function builtOutputs(tx: TxSignBuilder): PlacedOutput[] {
  const outs = tx.toTransaction().body().outputs();
  const r: PlacedOutput[] = [];
  for (let k = 0; k < outs.len(); k++) {
    const o = coreToTxOutput(outs.get(k));
    r.push({ address: o.address, assets: o.assets });
  }
  return r;
}

/** Cỡ CBOR + tổng ExUnits của mọi redeemer (giá trị thư viện đã eval và ghi vào giao dịch). */
function builtBudget(tx: TxSignBuilder): TxBudget & { redeemers: number } {
  const rs = tx.toTransaction().witness_set().redeemers();
  let mem = 0n, steps = 0n, n = 0;
  if (rs) {
    const l = rs.to_flat_format();
    for (let i = 0; i < l.len(); i++) {
      const e = l.get(i).ex_units();
      mem += e.mem(); steps += e.steps(); n++;
    }
  }
  return { sizeBytes: tx.toCBOR().length / 2, mem, steps, redeemers: n };
}

/** In ngân sách + trần mạng. Không đọc được trần ⇒ nói "KHÔNG ĐO ĐƯỢC", không im. */
function reportBudget(lucid: LucidEvolution, label: string, tx: TxSignBuilder): string[] {
  const b = builtBudget(tx);
  console.log(`   ${label}: CBOR ${b.sizeBytes} byte · ${b.redeemers} redeemer · ExUnits mem=${b.mem} steps=${b.steps}`);
  const pp = lucid.config().protocolParameters;
  if (!pp) {
    console.log(`   ⚠ ${label}: KHÔNG ĐO ĐƯỢC trần mạng (thiếu protocolParameters) — chưa so được với trần.`);
    return [];
  }
  console.log(`   trần mạng: ${pp.maxTxSize} byte · mem ${pp.maxTxExMem} · steps ${pp.maxTxExSteps}`);
  const over = overLimits(b, pp);
  if (over.length) console.log(`   ✗ ${label} VƯỢT TRẦN: ${over.join("; ")}`);
  return over;
}

/**
 * Lùi đồng hồ máy dựng khi chọn nhãn cửa sổ cho beacon genesis. Nhãn lệch về TƯƠNG LAI (đồng hồ
 * máy chạy nhanh, dựng đúng lúc chuyển cửa sổ) làm lượt post beacon đầu tiên phải chờ trọn một
 * cửa sổ 5 ngày (C-BCN-2 đòi nhãn tăng); nhãn lệch về QUÁ KHỨ thì vô hại — chỉ số cộng dồn chỉ
 * được dùng qua hiệu. Nên lùi, cùng mức 60 s mà `epochWindow` của SDK dùng cho đầu dưới.
 */
const BEACON_LABEL_BACKDATE_MS = 60_000n;

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") {
    throw new Error(
      "CHẶN: script này là DIỄN TẬP. Phát hành mainnet đi theo runbook riêng " +
      "(`Genesis/mainnet-deploy-plan.md` mục D) và chỉ sau khi mục C xanh.",
    );
  }

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  console.log(`=== Tx A — genesis canonical v2 (${NETWORK}) === SUBMIT=${SUBMIT}\n`);

  // ── Chọn hạt giống ───────────────────────────────────────────────────────
  // Ưu tiên UTxO THUẦN ADA: token lạ đi kèm sẽ chảy vào output trả lại, thêm một thứ phải
  // cân mà không đổi gì về bảo đảm. Nhưng KHÔNG đòi cho bằng được — ví vận hành thật
  // thường không còn UTxO trắng nào, và chặn ở đây là chặn cả lượt phát hành vì một lý do
  // thẩm mỹ. Không có UTxO trắng thì lấy UTxO nhiều ADA nhất và nói rõ ra.
  //
  // Cũng không lấy bừa `utxos[0]`: thứ tự UTxO do nhà cung cấp trả về, không ổn định giữa
  // hai lượt gọi — mà `genesis_ref` là thứ nướng vào MỌI policy-id dưới đây.
  const utxos = await lucid.wallet().getUtxos();
  const balance = utxos.reduce((s, u) => s + (u.assets.lovelace ?? 0n), 0n);
  console.log(`ví: ${walletAddr}\nsố dư: ${balance / 1_000_000n} ADA (${utxos.length} UTxO)`);
  if (balance < MIN_BALANCE) {
    throw new Error(`cần ≥ ${MIN_BALANCE / 1_000_000n} ADA để dựng 8 output NFT (Tx P + Tx A0 + Tx A) + phí; đang có ${balance / 1_000_000n}.`);
  }
  // ── Chạy lại được: hạt giống của lượt trước đã tiêu thì NHẶT LẠI, không đúc lần hai ──
  // Vì sao cần: giao dịch lên chuỗi rồi thì không quay lui được, nên bất kỳ lỗi nào SAU bước gửi
  // (ghi tệp, mất mạng, tắt máy) sẽ để lại một lượt chạy có marker trên chuỗi mà không có state —
  // và các bước sau đọc `genesis_ref` từ state, nên chúng đứng hình. Đã xảy ra thật ở lượt Tx A
  // đầu tiên trên Preprod (2026-09-03): tx thành công, `JSON.stringify` ném vì BigInt.
  // ── Hạt giống CUSTODY: phải biết ở đây, và phải SỐNG SÓT qua bước này ────
  //
  // Khe #13 `reserve_kho_nft_policy` dưới đây là policy id của `custody_seed` áp trên một UTxO
  // hạt giống RIÊNG, và nó nướng vào policy-id của `lamp_mint` ở chính giao dịch không-làm-lại-
  // được này. Giữa đây và lúc bước Lớp 2 tiêu nó có sáu giao dịch, mỗi cái có coin-selection tự
  // do trên ví — và phép chọn hạt giống genesis bên dưới lấy UTxO NHIỀU ADA NHẤT, rất có thể
  // đúng cái vừa dành cho custody.
  //
  // Không đọc được hạt giống custody thì KHÔNG đo được va chạm đó. Trạng thái mù ở đây phải
  // kêu, không được cho qua: đây là bước duy nhất còn quay lui được.
  const custodySeed: OutputRef = custodySeedRefFromEnv(process.env);
  // Tra theo outref, không theo ví: hạt giống cất ở địa chỉ enterprise của cùng khoá là cách
  // giữ nó sống qua các giao dịch có coin-selection tự do — xem `findOwnedCustodySeed`.
  //
  // CHƯA ném ở đây: hạt giống đã tiêu là HỢP LỆ khi Tx A0 của chính lượt này đã đặt custody NFT
  // vào instance custody thật (gửi Tx A0 xong rồi Tx A trượt, chạy lại). Phân biệt hai ca cần
  // địa chỉ custody, tức cần `lampPid` — nên cổng CUSTODY-SEED-004 đứng sau phép dẫn xuất wiring.
  const custodySeedUtxo = await findOwnedCustodySeed(lucid, custodySeed, pkh);

  // ── Hạt giống CON TRỎ governance (GovernancePointer v0.1) — BẮT BUỘC, ghim trước ──
  // Đọc TRƯỚC phép chọn hạt giống genesis để loại nó khỏi tập ứng viên (cùng lý do hạt giống
  // custody ở trên). Policy con trỏ là hàm của outref này ⇒ vào khe #1 custody ⇒ vào địa chỉ kho.
  const pointerSeed: OutputRef = pointerSeedRefFromEnv(process.env);
  assertPointerSeedDistinct(pointerSeed, [{ label: "hạt giống custody", ref: custodySeed }]);
  const pointerSeedUtxo = await findOwnedPointerSeed(lucid, pointerSeed, pkh);

  const adopt = (process.env.ADOPT_GENESIS_TX ?? "").trim().toLowerCase();
  if (adopt) {
    const idx = Number(process.env.ADOPT_GENESIS_IDX ?? "0");
    if (!/^[0-9a-f]{64}$/.test(adopt)) throw new Error("ADOPT_GENESIS_TX phải là 64 ký tự hex.");
    assertSeedNotCustody({ txHash: adopt, outputIndex: idx }, custodySeed, "genesis_ref nhặt lại");
    assertPointerSeedDistinct(pointerSeed, [{ label: "genesis_ref nhặt lại", ref: { txHash: adopt, outputIndex: idx } }]);
    return adoptExisting(lucid, pkh, adopt, idx, custodySeed, pointerSeed);
  }

  // Hạt giống ghim trước (GENESIS_SEED_TX/IDX) thắng đường tự chọn — xem `genesisSeedRefFromEnv`.
  // Tra theo outref nên hạt giống cất ở enterprise của cùng khoá vẫn dùng được, dù nó nằm ngoài
  // `lucid.wallet().getUtxos()` (chỉ địa chỉ base).
  const pinned = genesisSeedRefFromEnv(process.env);
  const byAda = (a: UTxO, b: UTxO) => Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n));
  const enough = utxos.filter((u) => (u.assets.lovelace ?? 0n) >= 5_000_000n).sort(byAda);
  // Loại hạt giống custody khỏi TẬP ỨNG VIÊN, không chỉ cảnh báo sau khi đã chọn. Hai lớp, vì
  // chúng hỏng theo hai kiểu: bộ lọc sửa được ca thường gặp mà không bắt người chạy làm gì;
  // cổng SEED-002 bên dưới bắt ca bộ lọc bị gỡ hoặc đi vòng.
  const free = enough.filter((u) => refKey(u) !== refKey(custodySeed) && refKey(u) !== refKey(pointerSeed));
  const pure = free.filter((u) => Object.keys(u.assets).length === 1);
  const seed: UTxO | undefined = pinned
    ? await findOwnedGenesisSeed(lucid, pinned, pkh)
    : (pure[0] ?? free[0]);
  if (!seed) {
    throw new Error(
      "không có UTxO nào ≥ 5 ADA để làm hạt giống one-shot (đã loại hạt giống custody " +
      `${refKey(custodySeed)}). Tách thêm một UTxO rồi chạy lại.`,
    );
  }
  assertSeedNotCustody(seed, custodySeed, "hạt giống genesis");
  assertPointerSeedDistinct(pointerSeed, [{ label: "hạt giống genesis", ref: seed }]);
  const extra = Object.keys(seed.assets).length - 1;
  console.log(`hạt giống${pinned ? " (ghim)" : ""}: ${seed.txHash}#${seed.outputIndex}` +
    (extra > 0 ? `  (mang thêm ${extra} loại token — sẽ chảy vào output trả lại)` : "  (thuần ADA)"));
  console.log();

  // ── Tính toàn bộ wiring từ hạt giống ─────────────────────────────────────
  const reserveKho = await reserveKhoParamsFromEnv(process.env, custodySeed, {
    derivePid: custodySeedPolicyId, defaultName: INSTANCE_ID,
  });
  console.log(`✓ RESERVE-KHO-003: khe #13 khớp hạt giống ${refKey(custodySeed)} → ${reserveKho.pid}`);
  const { wiring, scripts } = await deriveWiring({
    genesisTxHash: seed.txHash, genesisIndex: seed.outputIndex, pkh, tokenName: TOKEN_NAME,
    reserveKhoPid: reserveKho.pid, reserveKhoName: reserveKho.name,
  });
  printWiring(wiring);
  // Cổng LAMP-PID — policy đã công bố cho nhà khác phải trùng policy sắp gửi.
  assertExpectedLampPid(wiring.lampPid, process.env, SUBMIT && pinned !== undefined);
  if (process.env.EXPECTED_LAMP_PID) console.log(`✓ LAMP-PID: khớp EXPECTED_LAMP_PID ${wiring.lampPid}`);

  // ── Cổng MARKER-001: không khe nào được là native-sig ────────────────────
  // Cổng này tồn tại vì bản diễn tập cũ (`canonical_mint.ts:108`, đã xoá khỏi kho — tra
  // `git show 930480e:Genesis/scripts/canonical_mint.ts`) đúc cả bốn marker bằng
  // `scriptFromNative({type:"sig"})` — đúc lại được bao nhiêu lần tuỳ ý. Ở đây nó phải im
  // lặng: bốn khe đều là policy one-shot. Nó kêu = wiring đã trôi, DỪNG.
  assertOneShotMarkers(
    { thread: wiring.markers.threadPid, registry: wiring.markers.regPid,
      kho: wiring.markers.khoPid, meter: wiring.markers.metPid },
    { submit: true, nativePolicyId: mintingPolicyToId(scriptFromNative({ type: "sig", keyHash: pkh })),
      env: process.env, warn: (m: string) => console.warn(m) },
  );
  console.log("\n✓ MARKER-001: bốn khe marker đều one-shot (không khe nào là native-sig).");

  // ── Lớp 2 đi cùng genesis: biến bắt buộc + wiring ─────────────────────────
  // Đọc TRƯỚC khi dựng bất cứ giao dịch nào: thiếu biến thì ném khi chưa có gì lên mạng.
  const floor = reserveFloorFromEnv(process.env);
  console.log(`\nsàn cổng cầu: ${floor.floorOildrop} oildrop [${floor.floorSource}]`);
  const canhBaoSan = floorSourceWarning(floor.floorSource);
  if (canhBaoSan) console.log(`⚠ ${canhBaoSan}`);
  // NFT con trỏ: policy = hash `governance_pointer` áp (seed, change_delay_ms). KHÔNG chạm mạng.
  const ptrDelay = pointerDelayFromEnv(process.env, wiring.network);
  const ptr = await derivePointer(pointerSeed.txHash, pointerSeed.outputIndex, ptrDelay.delayMs, wiring.network);
  console.log(`hạt giống con trỏ: ${refKey(pointerSeed)}  change_delay_ms=${ptrDelay.delayMs} [${ptrDelay.source}]`);
  console.log(`pointer policy (= khe #1 custody = governance_ref datum custody): ${ptr.policy}`);
  console.log(`pointer addr:  ${ptr.addr}`);
  const delegAdmin = resolveDelegationAdmin(pkh);

  // Hạt giống auth = CHÍNH hạt giống genesis. `reserve_auth` chỉ đòi `genesis_ref` nằm trong
  // input và đúc đúng 1 — Tx A tiêu hạt giống genesis đúng một lần, nên one-shot vẫn giữ. Lợi:
  // `authPid` (⇒ địa chỉ `reserve_gate` và `reserve_draw`) chốt được TỪ hạt giống đã ghim, không
  // thêm UTxO nào phải giữ sống, và METER đúc thẳng vào `reserve_draw` được ngay ở Tx A.
  const authRef: OutputRef = { txHash: seed.txHash, outputIndex: seed.outputIndex };
  // `deriveReserveWiring` chạy APPLY-003 (cặp kho #6-7 của reserve_draw == khe #13-14 lamp_mint)
  // và FLOOR-PAIR-001 (một sàn cho cả reserve_auth lẫn reserve_gate) trước khi dựng tham số.
  const rw = await deriveReserveWiring(wiring, {
    custodyTxHash: custodySeed.txHash, custodyIndex: custodySeed.outputIndex,
    pointerPolicy: ptr.policy,
    authTxHash: authRef.txHash, authIndex: authRef.outputIndex,
    network: wiring.network, delegationAdminPkh: delegAdmin, floor,
  });
  console.log();
  printReserveWiring(rw.reserve);

  const custodyLive = async () =>
    (await lucid.utxosAt(rw.reserve.custodyAddr))
      .filter((u) => (u.assets[rw.reserve.custodyNftUnit] ?? 0n) === 1n);
  const custodyAlreadyPlaced = (await custodyLive()).length === 1;

  // CỔNG CUSTODY-SEED-004 — đứng ở đây vì phải biết địa chỉ custody (cần `lampPid`).
  if (!custodySeedUtxo && !custodyAlreadyPlaced) {
    throw new Error(
      `CUSTODY-SEED-004: hạt giống custody ${refKey(custodySeed)} KHÔNG còn trên chuỗi, và custody ` +
      `NFT cũng không có ở ${rw.reserve.custodyAddr}. Khe #13 của lamp_mint là policy id của ` +
      `\`custody_seed\` áp trên đúng UTxO đó ⇒ policy trong khe #13 không bao giờ đúc được ⇒ nhánh ` +
      `ReserveDraw của token sắp đúc chết ngay từ lúc sinh. Chọn một hạt giống custody còn sống, ` +
      `tính lại RESERVE_KHO_NFT_POLICY từ nó, rồi chạy lại.`,
    );
  }

  // ══ Tx P — NFT con trỏ governance → governance_pointer (RIÊNG, gửi TRƯỚC Tx A0) ═══════════
  // GovernancePointer v0.1 §Genesis. Custody lượt sinh ghi `governance_ref = ptr.policy` và nướng
  // nó vào khe #1; con trỏ chưa đúc thì nhánh Release không có gì để đọc. Đúc TRƯỚC A0 để không có
  // thời điểm nào custody tồn tại mà con trỏ của nó chưa có.
  const overBudget: string[] = [];
  const pointerLive = async () =>
    (await lucid.utxosAt(ptr.addr)).filter((u) => (u.assets[ptr.unit] ?? 0n) === 1n);
  const pointerAlreadyPlaced = (await pointerLive()).length === 1;
  if (!pointerSeedUtxo && !pointerAlreadyPlaced) {
    throw new Error(
      `POINTER-SEED-004: hạt giống con trỏ ${refKey(pointerSeed)} KHÔNG còn trên chuỗi, và NFT con ` +
      `trỏ cũng không có ở ${ptr.addr}. Policy con trỏ ${ptr.policy} suy từ đúng UTxO đó và sắp ` +
      `nướng vào khe #1 custody ⇒ không bao giờ đúc được ⇒ nhánh Release của két chết từ lúc sinh. ` +
      `Chọn một hạt giống con trỏ còn sống rồi chạy lại.`,
    );
  }
  let pHash: string | undefined;
  if (pointerAlreadyPlaced) {
    console.log(`\n↷ Tx P bỏ qua — NFT con trỏ đã ở ${ptr.addr}`);
  } else {
    const txP = await lucid.newTx()
      .collectFrom([pointerSeedUtxo!])
      .mintAssets({ [ptr.unit]: 1n }, Data.void())
      .attach.MintingPolicy(ptr.script)
      // Datum đầu: governance_hash rỗng, committee = [pkh vận hành], threshold 1, chưa niêm phong,
      // không pending — `governance_pointer.ak` P-MINT-DATUM.
      .pay.ToContract(ptr.addr,
        { kind: "inline", value: pointerDatumToCbor(genesisPointerDatum([pkh], 1n)) },
        { lovelace: NFT_ADA, [ptr.unit]: 1n })
      .addSigner(walletAddr)
      .complete();
    // Tx P có chọn-đồng tự do: KHÔNG được chạm hạt giống genesis (Tx A) lẫn custody (Tx A0).
    assertTxKeepsSeed(txInputKeys(txP), txCollateralKeys(txP), refKey(seed), "hạt giống genesis", "Tx P");
    assertTxKeepsSeed(txInputKeys(txP), txCollateralKeys(txP), refKey(custodySeed), "hạt giống custody", "Tx P");
    assertMarkerPlacement(builtOutputs(txP), txPMarkerTargets(ptr.unit, ptr.addr), "Tx P");
    console.log(`\n✓ Tx P dựng xong + eval script OK — GOVPOINTER → ${ptr.addr}`);
    overBudget.push(...reportBudget(lucid, "Tx P", txP));
    if (SUBMIT) {
      if (overBudget.length) throw new Error(`TX-BUDGET-001: Tx P vượt trần mạng — ${overBudget.join("; ")}`);
      pHash = await (await txP.sign.withWallet().complete()).submit();
      console.log(`\n📤 Tx P con trỏ: ${pHash}\n   ${explorerTx(pHash)}`);
      await lucid.awaitTx(pHash);
      await waitFor("NFT con trỏ tại governance_pointer", pointerLive, (us) => us.length === 1);
      // Chỉ mục ví chậm một nhịp sau `awaitTx` — chờ nó bỏ hạt giống con trỏ trước khi Tx A0 chọn-đồng.
      await waitFor(`ví không còn hạt giống con trỏ ${refKey(pointerSeed)}`,
        () => lucid.wallet().getUtxos(), (us) => !us.some((u) => refKey(u) === refKey(pointerSeed)));
      console.log(`✓ NFT con trỏ ở governance_pointer`);
    }
  }

  // Lượt gửi thật: Tx A0 (và Tx A) chỉ đi khi NFT con trỏ ĐÃ ở `governance_pointer`.
  if (SUBMIT && (await pointerLive()).length !== 1) {
    throw new Error(
      `POINTER-ORDER-001: NFT con trỏ chưa ở ${ptr.addr} — KHÔNG gửi Tx A0. Tx P phải lên chuỗi ` +
      `trước: custody lượt sinh trỏ vào policy ${ptr.policy}, con trỏ vắng thì Release không đọc được gì.`,
    );
  }

  // ══ Tx A0 — custody NFT → instance custody thật (RIÊNG vì S-MINT-2, gửi TRƯỚC Tx A) ══════
  let a0Hash: string | undefined;
  if (custodyAlreadyPlaced) {
    console.log(`\n↷ Tx A0 bỏ qua — custody NFT đã ở ${rw.reserve.custodyAddr}`);
  } else {
    // CARP: lượt gửi thật ném nếu thiếu (cổng `required*Param`, submit: true). Lượt chạy khô thiếu
    // CARP thì Tx A0 KHÔNG ĐO ĐƯỢC — in to, rồi vẫn dựng Tx A để đo phần còn lại.
    let carp: { policy: string; name: string } | undefined;
    try {
      carp = carpAssetFromEnv(process.env);
    } catch (e) {
      if (SUBMIT) throw e;
      console.log(
        `\n⚠⚠ Tx A0 KHÔNG ĐO ĐƯỢC: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}\n` +
        `   Đặt CARP_POLICY_ID + CARP_TOKEN_NAME để dựng và eval Tx A0. Lượt gửi thật sẽ ném ở đây.`,
      );
    }
    if (carp) {
      const tx0 = await lucid.newTx()
        .collectFrom([custodySeedUtxo!])
        .mintAssets({ [rw.reserve.custodyNftUnit]: 1n }, Data.to(new Constr(0, [RESERVED_MIN_ADA])))
        .attach.MintingPolicy(rw.scripts.custodySeed)
        // Sổ RỖNG + lovelace ĐÚNG BẰNG `reserved_min_ada` — xem `custodySeedDatum()`.
        .pay.ToContract(rw.reserve.custodyAddr,
          { kind: "inline",
            value: custodyDatumToCbor(custodySeedDatum(wiring.lampPid, wiring.tokenName, ptr.policy, carp)) },
          { lovelace: RESERVED_MIN_ADA, [rw.reserve.custodyNftUnit]: 1n })
        .addSigner(walletAddr)
        .complete();
      // Tx A0 có chọn-đồng tự do: nó KHÔNG được chạm hạt giống genesis — Tx A còn cần nó.
      assertTxKeepsSeed(txInputKeys(tx0), txCollateralKeys(tx0), refKey(seed), "hạt giống genesis", "Tx A0");
      assertMarkerPlacement(builtOutputs(tx0),
        txA0MarkerTargets(rw.reserve.custodyNftUnit, rw.reserve.custodyAddr), "Tx A0");
      console.log(`\n✓ Tx A0 dựng xong + eval script OK — custody NFT → ${rw.reserve.custodyAddr}`);
      overBudget.push(...reportBudget(lucid, "Tx A0", tx0));
      if (SUBMIT) {
        if (overBudget.length) throw new Error(`TX-BUDGET-001: Tx A0 vượt trần mạng — ${overBudget.join("; ")}`);
        a0Hash = await (await tx0.sign.withWallet().complete()).submit();
        console.log(`\n📤 Tx A0 custody: ${a0Hash}\n   ${explorerTx(a0Hash)}`);
        await lucid.awaitTx(a0Hash);
        await waitFor("custody NFT tại instance custody", custodyLive, (us) => us.length === 1);
        console.log(`✓ custody NFT ở instance custody — hạt giống custody đã tiêu đúng chỗ`);
      }
    }
  }

  // Lượt gửi thật: Tx A chỉ đi khi custody NFT ĐÃ ở instance custody. Đây là thứ tự đóng F1 —
  // không có thời điểm nào METER tồn tại mà hạt giống custody còn sống ở khoá vận hành.
  if (SUBMIT && (await custodyLive()).length !== 1) {
    throw new Error(
      `F1-ORDER-001: custody NFT chưa ở ${rw.reserve.custodyAddr} — KHÔNG gửi Tx A. Tx A0 phải lên ` +
      `chuỗi trước (đóng F1: không lúc nào METER sống cùng hạt giống custody ở khoá vận hành).`,
    );
  }

  // ── Dựng Tx A ────────────────────────────────────────────────────────────
  const ss0 = supplyStateToCbor({
    dist_minted: 0n, reserve_minted: 0n, dist_cap: DIST_CAP, reserve_cap: RESERVE_CAP,
  });
  // `total_oildrop` của ReserveState sinh cùng giao dịch với SupplyState — đo ngay tại đây.
  assertReserveTotalMatchesCap(RESERVE_TOTAL, RESERVE_CAP);

  // Nhãn cửa sổ = `(t − window_origin_ms) / ms_per_epoch` (Specs/Window v1.0), cùng gốc đã nướng vào
  // `beacon` bởi `deriveWiring` (cả hai lấy từ `canonicalWindowOrigin(wiring.network)`).
  const beaconEpoch = windowIndex(
    BigInt(Date.now()) - BEACON_LABEL_BACKDATE_MS, canonicalWindowOrigin(wiring.network), MS_PER_EPOCH,
  );
  console.log(`\nBeacon genesis: nhãn cửa sổ ${beaconEpoch}, index 0 (gốc chỉ số cộng dồn).`);
  // `start_epoch` BẤT BIẾN (reserve_draw Luật 7). `last_epoch = 0` ⇒ lượt rút đầu ở cửa sổ bất kỳ > 0.
  const reserveStart = epochNow(canonicalWindowOrigin(wiring.network));
  console.log(`ReserveState lúc sinh: start_epoch=${reserveStart} total=${RESERVE_TOTAL} drawn=0 last_epoch=0`);

  const tx = await lucid.newTx()
    .collectFrom([seed])                                   // tiêu hạt giống — một lần duy nhất
    .mintAssets({ [wiring.threadUnit]: 1n }, Data.void()).attach.MintingPolicy(scripts.oneshotSupply)
    .mintAssets({ [wiring.regUnit]: 1n },    Data.void()).attach.MintingPolicy(scripts.oneshotReg)
    .mintAssets({ [wiring.metUnit]: 1n },    Data.void()).attach.MintingPolicy(scripts.oneshotMet)
    .mintAssets({ [wiring.khoUnit]: 1n }, Data.to(new Constr(0, []))).attach.MintingPolicy(scripts.treasuryNft)
    .mintAssets({ [toDropUnit(wiring)]: 1n }, Data.to(new Constr(0, []))).attach.MintingPolicy(scripts.beaconNft)
    // auth NFT Treasury-pull — genesis_ref = hạt giống genesis (xem `authRef` ở trên).
    .mintAssets({ [rw.reserve.authUnit]: 1n }, mintAuthRedeemerToCbor()).attach.MintingPolicy(rw.scripts.auth)
    // SupplyState tại tầng 3 — KHÔNG để ở ví. Ở ví thì mọi lần tiêu chỉ cần chữ ký, và
    // `supply_state.ak` (ép "tiêu SupplyState PHẢI kèm mint LAMP") không bao giờ chạy.
    .pay.ToContract(wiring.ssAddr, { kind: "inline", value: ss0 },
      { lovelace: NFT_ADA, [wiring.threadUnit]: 1n })
    // Registry PHẢI nằm ở `Script(regPid)` — không phải ở ví. `find_registry_datum` ép
    // `payment_credential == Script(registry_nft_policy)`, vì reference input không cần chữ ký
    // của ai: registry NFT nằm ở ví thì người giữ nó tự viết `entries` và tự cấp quyền đúc LAMP.
    // Mainnet dùng `registry_write` (gác bằng TAAD/OrgDID, tiêu được ⇒ xoay khoá được); màn diễn
    // tập dùng chính `oneshot_nft`, nên bảng registry ở đây BẤT BIẾN — xem runbook.
    .pay.ToContract(wiring.regAddr, { kind: "inline", value: registryDatum(pkh) },
      { lovelace: NFT_ADA, [wiring.regUnit]: 1n })
    // KHO A-DEST: TREASURY NFT bắt buộc hạ cánh ở một Script, mang TreasuryDatum, nợ mở = 0
    // (`treasury_nft.ak:50-56`). Chính ràng buộc này giữ cho A-DEST không trỏ về một ví.
    .pay.ToContract(wiring.treAddr, { kind: "inline", value: treasuryDatum(pkh) },
      { lovelace: NFT_ADA, [wiring.khoUnit]: 1n })
    // METER đúc THẲNG vào `reserve_draw` kèm ReserveState — đóng F1. Từ lúc sinh, tiêu METER =
    // chạy `reserve_draw.ak`: ≤1 lượt/cửa sổ · δ ≤ tổng/1000 · auth tiêu từ `reserve_gate` (cổng
    // sàn) · NFT kho ở ĐÚNG `custody_script_hash` (Luật 10) — đích tuỳ ý bị chặn.
    .pay.ToContract(rw.reserve.drawAddr, { kind: "inline", value: reserveStateDatum(reserveStart) },
      { lovelace: NFT_ADA, [wiring.metUnit]: 1n })
    // auth NFT bị khoá ở `reserve_gate`, datum Void: gate đọc `Option<Void>` và auth phải TIÊU
    // ĐƯỢC lại ở mọi lượt rút; `reserve_auth` cấm burn.
    .pay.ToContract(rw.reserve.gateAddr, { kind: "inline", value: VOID_DATUM },
      { lovelace: NFT_ADA, [rw.reserve.authUnit]: 1n })
    // Beacon v3 lúc sinh: `DropParam{epoch = cửa sổ genesis, index = 0, rate_root = w,
    // κ = 1/1000, speed_policies = []}` — dựng qua `genesisBeaconDatum` (SDK
    // `beaconDatumToCbor`), cùng giá trị với anh em đã chạy thật `Distribution/scripts/03_genesis.ts`.
    //
    // Bản trước ghi datum v2 `[epoch, kind, drop_value]` 3 trường. `beacon_nft.ak` KHÔNG kiểm
    // datum lúc đúc, nên Tx A vẫn qua — và beacon nằm đó với một datum mà `beacon.ak` v3 không
    // giải mã được: lượt post đầu tiên bị từ chối, và DROP NFT không dời được khỏi địa chỉ
    // này. Lỗi chỉ lộ SAU khi cả cụm đã đúc.
    //
    // `rate_root = w > 0` ngay từ genesis thay cho "D > 0" của v2: `RATE_ROOT_GENESIS` nằm trong
    // biên cứng C-BCN-5b, nên lượt post đầu có đường hợp lệ (giữ nguyên hoặc nới ≤ +10%) — không
    // còn cặp chốt loại nhau như `D = 0` của bản v2.
    .pay.ToContract(wiring.beaconAddr, { kind: "inline", value: genesisBeaconDatum(beaconEpoch) },
      { lovelace: NFT_ADA, [toDropUnit(wiring)]: 1n })
    .complete();

  // Cổng SEED-CHON-DONG-001 — xem `_custodySeedRef.ts`. Đo input THẬT của giao dịch vừa dựng,
  // nên nó vẫn đúng sau khi thư viện đổi cách chọn-đồng. Ở lượt gửi thật hạt giống custody đã
  // tiêu ở Tx A0 nên cổng im; ở lượt chạy khô (Tx A0 chưa gửi) nó vẫn đo đúng điều cần đo.
  assertSeedNotSpent(tx, custodySeed, "Tx A (genesis)");
  // Cổng F1-PLACE — sáu marker, đúng đích, không token marker nào về ví.
  assertMarkerPlacement(builtOutputs(tx), txAMarkerTargets({
    threadUnit: wiring.threadUnit, ssAddr: wiring.ssAddr,
    regUnit: wiring.regUnit, regAddr: wiring.regAddr,
    khoUnit: wiring.khoUnit, treAddr: wiring.treAddr,
    dropUnit: toDropUnit(wiring), beaconAddr: wiring.beaconAddr,
    metUnit: wiring.metUnit, drawAddr: rw.reserve.drawAddr,
    authUnit: rw.reserve.authUnit, gateAddr: rw.reserve.gateAddr,
  }), "Tx A");
  console.log(`✓ F1-PLACE: METER → reserve_draw, auth → reserve_gate, không marker nào về ví.`);

  console.log(`\n✓ Tx A dựng xong + eval script OK (CBOR ${tx.toCBOR().length / 2} byte).`);
  overBudget.push(...reportBudget(lucid, "Tx A", tx));

  if (!SUBMIT) {
    console.log(
      "\n(SUBMIT=false ⇒ KHÔNG gửi, KHÔNG ghi state.)\n" +
      "Hạt giống chưa tiêu nên chạy lại vẫn ra CHÍNH các policy-id trên.\n" +
      "Gửi thật: SUBMIT=true tsx 20_canonical_genesis.ts (gửi Tx P, rồi Tx A0, rồi Tx A — mỗi bước chờ xác nhận)",
    );
    return;
  }
  if (overBudget.length) throw new Error(`TX-BUDGET-001: vượt trần mạng — ${overBudget.join("; ")}`);

  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(`\n📤 Tx A: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  const state: CanonicalState = {
    wiring,
    tx: {
      genesis: hash, authMint: hash, meterPark: hash,
      ...(a0Hash ? { custodySeed: a0Hash } : {}),
      ...(pHash ? { pointerMint: pHash } : {}),
    },
    minted: { dist: "0", reserve: "0" },
    floorOildrop: floor.floorOildrop.toString(),
    floorSource: floor.floorSource,
    // Lớp 2 đã dựng XONG ở lượt genesis: `authRef` là hạt giống genesis, và `placedAtGenesis`
    // báo cho `24_reserve_layer2_init.ts` rằng không còn bước rời nào để chạy.
    reserve: {
      custodyRef: custodySeed, authRef, placedAtGenesis: true,
      pointer: { seedRef: pointerSeed, policy: ptr.policy, changeDelayMs: ptrDelay.delayMs.toString() },
    },
  };
  await writeState(state);
  console.log(`\n✅ Genesis xong — F1 đóng: METER ở reserve_draw, auth ở reserve_gate, custody ở instance thật.`);
  console.log(`   State → ${STATE_PATH}`);
  console.log("Bước kế: tsx 21_vest_to_kho.ts");
}

/** unit của DROP NFT — beacon policy + tên "DROP" ép bởi `beacon_nft.ak:55-56`. */
function toDropUnit(w: { markers: { beaconPid: string } }): string {
  return w.markers.beaconPid + "44524f50";
}

/**
 * Nhặt lại state cho một lượt genesis ĐÃ GỬI — không đúc gì thêm.
 *
 * Chỉ ghi state sau khi ĐỐI CHIẾU trên chuỗi rằng cả năm marker có thật và nằm đúng chỗ. Không
 * đối chiếu mà ghi bừa thì state trỏ vào một policy không ai giữ, và bước sau dựng giao dịch cho
 * nó — im lặng, không lỗi nào kêu.
 */
async function adoptExisting(
  lucid: Awaited<ReturnType<typeof makeLucid>>,
  pkh: string, txHash: string, idx: number, custodySeed: OutputRef, pointerSeed: OutputRef,
): Promise<void> {
  console.log(`=== NHẶT LẠI state của lượt genesis đã gửi ===`);
  console.log(`genesis_ref: ${txHash}#${idx}\n`);
  // Đường nhặt lại cũng đi qua RESERVE-KHO-003, dù genesis đã lên chuỗi. Ở đây nó không còn
  // phòng ngừa được gì — nó ĐỌC TÊN nguyên nhân. Khe #13 lệch thì mọi unit dẫn xuất đều lệch,
  // nên bốn phép đếm marker bên dưới sẽ ra "✗" cả bốn mà không nói vì sao; cổng này đứng trước
  // và nói thẳng là hạt giống custody trong env không phải hạt giống của lượt genesis ấy.
  const reserveKho = await reserveKhoParamsFromEnv(process.env, custodySeed, {
    derivePid: custodySeedPolicyId, defaultName: INSTANCE_ID,
  });
  const { wiring } = await deriveWiring({
    genesisTxHash: txHash, genesisIndex: idx, pkh, tokenName: TOKEN_NAME,
    reserveKhoPid: reserveKho.pid, reserveKhoName: reserveKho.name,
  });
  printWiring(wiring);

  const cnt = (us: { assets: Record<string, bigint> }[], u: string) =>
    us.reduce((s, x) => s + (x.assets[u] ?? 0n), 0n);
  const atSs = await lucid.utxosAt(wiring.ssAddr);
  const atTre = await lucid.utxosAt(wiring.treAddr);
  const atBcn = await lucid.utxosAt(wiring.beaconAddr);
  const atWlt = await lucid.wallet().getUtxos();

  const atReg = await lucid.utxosAt(wiring.regAddr);
  const checks: [string, bigint][] = [
    ["SUPPLY   @ supply_state", cnt(atSs, wiring.threadUnit)],
    ["TREASURY @ KHO",          cnt(atTre, wiring.khoUnit)],
    ["DROP     @ beacon",       cnt(atBcn, toDropUnit(wiring))],
  ];
  // METER: cụm CŨ để nó ở ví (Lớp 1, F1 MỞ); cụm theo đường mới đúc nó thẳng vào `reserve_draw`
  // cùng auth ở `reserve_gate` (authRef = genesis_ref). Hai ca ghi state khác nhau, nên đo cả hai.
  let placed: {
    authRef: OutputRef; floor: ReturnType<typeof reserveFloorFromEnv>;
    pointer: { seedRef: OutputRef; policy: string; changeDelayMs: string };
  } | undefined;
  if (cnt(atWlt, wiring.metUnit) === 1n) {
    console.log(`⚠ METER  @ ví: 1 — cụm CŨ, F1 MỞ tới khi chạy 24_reserve_layer2_init.ts.`);
  } else {
    const floor = reserveFloorFromEnv(process.env);
    const authRef: OutputRef = { txHash, outputIndex: idx };
    // Con trỏ: dựng lại từ CÙNG hạt giống + trễ đã dùng lúc gửi (env), rồi ĐẾM NFT trên chuỗi —
    // sai hạt giống/trễ thì policy khác ⇒ địa chỉ custody khác ⇒ dòng CUSTODY bên dưới cũng ✗.
    const ptrDelay = pointerDelayFromEnv(process.env, wiring.network);
    const ptr = await derivePointer(pointerSeed.txHash, pointerSeed.outputIndex, ptrDelay.delayMs, wiring.network);
    const rw = await deriveReserveWiring(wiring, {
      custodyTxHash: custodySeed.txHash, custodyIndex: custodySeed.outputIndex,
      pointerPolicy: ptr.policy,
      authTxHash: authRef.txHash, authIndex: authRef.outputIndex,
      network: wiring.network, delegationAdminPkh: resolveDelegationAdmin(pkh), floor,
    });
    checks.push(
      ["GOVPOINTER @ governance_pointer", cnt(await lucid.utxosAt(ptr.addr), ptr.unit)],
      ["METER    @ reserve_draw", cnt(await lucid.utxosAt(rw.reserve.drawAddr), wiring.metUnit)],
      ["AUTH     @ reserve_gate", cnt(await lucid.utxosAt(rw.reserve.gateAddr), rw.reserve.authUnit)],
      ["CUSTODY  @ instance",     cnt(await lucid.utxosAt(rw.reserve.custodyAddr), rw.reserve.custodyNftUnit)],
    );
    placed = {
      authRef, floor,
      pointer: { seedRef: pointerSeed, policy: ptr.policy, changeDelayMs: ptrDelay.delayMs.toString() },
    };
  }
  let bad = 0;
  console.log();
  for (const [name, n] of checks) {
    console.log(`${n === 1n ? "✓" : "✗"} ${name}: ${n}`);
    if (n !== 1n) bad++;
  }
  // REG kiểm riêng: nó có thể còn ở ví (lượt genesis dựng trước bản vá đặt nó ở ví). Đó KHÔNG
  // phải hỏng genesis — cổng WHO chỉ đọc REG lúc Tx B, nên còn kịp dời. Nói rõ chứ không đếm
  // chung vào `bad`, vì hai tình huống cần hai hành động khác nhau.
  const regAtScript = cnt(atReg, wiring.regUnit);
  const regAtWallet = cnt(atWlt, wiring.regUnit);
  if (regAtScript === 1n) {
    console.log(`✓ REG    @ Script(regPid): 1`);
  } else if (regAtWallet === 1n) {
    console.log(`⚠ REG    @ ví: 1 — SAI CHỖ. Cổng WHO đòi nó ở Script(regPid).`);
    console.log(`  Chạy 'tsx 20b_place_registry.ts' để dời trước khi vest.`);
  } else {
    console.log(`✗ REG: không thấy ở Script(regPid) lẫn ở ví`);
    bad++;
  }
  if (bad > 0) {
    throw new Error(
      `${bad} marker KHÔNG đúng 1 bản đúng chỗ. Hai nguyên nhân: genesis_ref này không phải lượt ` +
      `đang sống (kiểm lại ADOPT_GENESIS_TX/IDX), HOẶC mã validator đã đổi sau lượt đúc nên địa ` +
      `chỉ script dựng lại khác chỗ marker đang nằm (chạy lại 'aiken build' ở cả hai onchain; còn ` +
      `lệch thì cụm này thuộc một commit cũ). Không ghi state.`,
    );
  }

  // Đường nhặt-lại GHI HẠT GIỐNG y như đường chính. Nó biết giá trị đúng ở mức chắc chắn ngang
  // đường kia: `custodySeed` vừa đi qua `reserveKhoParamsFromEnv` ở trên, tức đã đối chứng với
  // khe #13 bằng RESERVE-KHO-003. Bỏ trường này ở đây thì lượt phục hồi — đúng lượt mà state
  // trước đó đã mất — sinh ra một state không có `reserve.custodyRef`, và cổng CUSTODY-SEED-002
  // ở bước 24 lại đối chiếu với hư không: cổng mất đúng ở lượt cần nó nhất.
  await writeState({
    wiring,
    tx: placed ? { genesis: txHash, authMint: txHash, meterPark: txHash } : { genesis: txHash },
    minted: { dist: "0", reserve: "0" },
    ...(placed
      ? {
          floorOildrop: placed.floor.floorOildrop.toString(),
          floorSource: placed.floor.floorSource,
          reserve: {
            custodyRef: custodySeed, authRef: placed.authRef, placedAtGenesis: true,
            pointer: placed.pointer,
          },
        }
      : { reserve: { custodyRef: custodySeed, authRef: { txHash: "", outputIndex: -1 } } }),
  });
  console.log(`\n✅ State đã nhặt lại → ${STATE_PATH}`);
  console.log(`   hạt giống custody đã ghi vào state: ${refKey(custodySeed)}`);
  console.log("Bước kế: tsx 21_vest_to_kho.ts");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
