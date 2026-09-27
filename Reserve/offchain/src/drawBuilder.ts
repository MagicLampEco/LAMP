// LAMP Reserve drawBuilder — dựng tx DRAW (demand-gated qua Treasury-pull; reserve_draw.ak).
//
// Reserve = lớp đệm sau cùng, trần CỨNG mỗi epoch (max_per_epoch = total/1000). Mỗi epoch
// Treasury "kéo" tối đa trần; logic sàn (parked < floor) nằm Ở TREASURY. Builder ép luật
// onchain reserve_draw + Genesis lamp_mint:
//
//   - Input:  ReserveState UTxO (mang reserve thread NFT) — redeemer Draw.
//             SupplyState  UTxO (mang SUPPLY NFT)         — redeemer Advance (Genesis).
//             Treasury auth UTxO (mang Treasury auth NFT) — redeemer Void (reserve_gate).
//             KHO custody UTxO (mang kho NFT)             — redeemer MigrateIn (Treasury).
//             ReserveState NFT đóng vai "meter" gate nhịp của Genesis ReserveDraw.
//   - Mint:   delta oildrop LAMP qua policy lamp_mint, redeemer ReserveDraw (Constr 1).
//   - Output: ReserveState' (NFT trả lại, drawn_oildrop += delta, last_epoch := epoch).
//             SupplyState'  (NFT trả lại, reserve_minted += delta).
//             KHO custody'  (value += delta LAMP **VÀ** một DÒNG SỔ += delta trong datum).
//             Auth NFT'     (về ĐÚNG địa chỉ gate, inline datum Void, value nguyên như input).
//
// ⚠ PHẦN GATE DO BUILDER NÀY DỰNG, KHÔNG ĐỂ CALLER GHÉP THÊM:
//   Tiêu auth UTxO kích `reserve_gate.spend` (`Treasury/onchain/validators/reserve_gate.ak`),
//   và validator đó đòi TRONG CÙNG tx: đúng 1 output mang auth NFT (G-DS-1), ở đúng địa chỉ
//   input kể cả stake credential (G-REOUT-1), inline datum Void (G-DATUM-1), không reference
//   script (G-REF-1), lovelace không giảm (G-VALUE-1), và parked của kho < sàn (G-FLOOR-1).
//   Bản cũ `.collectFrom(auth)` mà KHÔNG tái tạo output auth ⇒ mọi lượt draw qua SDK bị gate
//   từ chối; và nếu gate có ngày bị nới, auth NFT rơi về ví người dựng qua output thối.
//   Không import `attachGateSpend` của Treasury SDK vì §PHỤ THUỘC MỘT CHIỀU dưới đây — hình
//   dạng output được dựng lại tại chỗ, gương từng luật G-* ở trên. Caller KHÔNG được gọi thêm
//   `attachGateSpend` lên tx này: auth UTxO sẽ bị collect hai lần và có hai output auth.
//
// ⚠ ĐÍCH KHÔNG PHẢI MỘT ĐỊA CHỈ, MÀ LÀ MỘT DÒNG SỔ — vì sao bản này không còn `reserve_dest`:
//   Bản cũ rót toàn bộ delta tới ĐỊA CHỈ kho bằng `.pay.ToAddress(...)`, sinh một UTxO KHÔNG
//   datum. Validator giữ kho (`Treasury/onchain/validators/custody.ak`) lại ĐÒI datum, nên số
//   LAMP đó nằm TRONG SÂN kho mà NGOÀI SỔ kho: không hình dạng giao dịch nào tiêu lại được nó.
//   Về kế toán, đóng băng ngoài sổ = ĐỐT, chỉ khác tên — trong khi bất biến sản phẩm nói LAMP
//   KHÔNG đốt (`Treasury/CONTRACT.md §5`).
//   `reserve_draw.ak` nay ép Luật 9+10: tx phải TIÊU đúng 1 UTxO mang kho NFT, và UTxO đó phải
//   ở đúng script hash của `custody`. Kho bị tiêu ⇒ `custody` nhánh `MigrateIn` chạy ⇒ nó ép Δ
//   vào value (C-MIG-7) VÀ vào sổ (C-MIG-8) trong CÙNG một tx.
//
// PHỤ THUỘC MỘT CHIỀU: SDK này KHÔNG import Treasury SDK (`Reserve/offchain/package.json` chỉ
// phụ thuộc lucid). Datum/redeemer/value của kho do CALLER tính bằng Treasury SDK rồi truyền
// vào dạng CBOR + Assets — cùng khuôn đã dùng cho SupplyState của Genesis.
//
// delta tính qua applyDraw(state, epoch, requested) — kẹp trần/pot, fail-fast nếu
// t ≤ last_epoch (đã draw trong/sau epoch này) hoặc pot cạn.
//
// LƯU Ý: epoch phải khớp validity_range.lower_bound onchain (get_epoch lower_bound). Caller
// truyền `validFromUnixMs`/`epoch` nhất quán; builder set validFrom để lower_bound = epoch.

import {
  Constr, Data, toUnit, getAddressDetails, validatorToScriptHash,
  type Assets, type LucidEvolution, type MintingPolicy, type TxSignBuilder,
  type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import { TLAMP_NAME } from "./constants.js";
import {
  decodeReserveState, reserveStateToCbor, drawRedeemerToCbor,
} from "./datum.js";
import { applyDraw, maxPerEpoch } from "./math.js";
import type { ReserveState } from "./types.js";

export interface DrawParams {
  lucid: LucidEvolution;

  /** ReserveState UTxO (inline ReserveState datum + reserve thread NFT bắt buộc). */
  reserveUtxo: UTxO;
  /** reserve_draw spend validator (giữ ReserveState). */
  reserveScript: Validator;
  /**
   * KHÔNG CÒN DÙNG để dựng output — địa chỉ recreate lấy từ chính `reserveUtxo.address`.
   *
   * Luật 7 (`reserve_draw.ak:159`) ép `s_out.address == own_out.address`, tức ĐỊA CHỈ INPUT
   * kể cả stake credential. Nhận địa chỉ qua một trường rời là để hai nguồn cùng tả một sự
   * thật, và bản trong kho đã trôi thật: bộ kiểm truyền `"addr_test1reserve"` trong khi
   * `reserveUtxo.address` là một địa chỉ script Preview khác hẳn — không ca nào đỏ.
   *
   * Giữ lại làm ĐỐI CHIẾU tuỳ chọn: truyền vào thì phải khớp `reserveUtxo.address`.
   */
  reserveAddress?: string;
  /** policy id reserve thread NFT (hex) + asset name (hex). */
  reserveThreadPolicyId: string;
  reserveThreadName: string;

  /** asset name LAMP (hex) — khớp param onchain token_name (testnet "tLAMP"/mainnet "LAMP"). */
  tokenName?: string;

  /** SupplyState UTxO (Genesis) + spend validator + address + redeemer CBOR. */
  supplyUtxo: UTxO;
  supplyStateScript: Validator;
  supplyStateAddress: string;
  /** datum CBOR của SupplyState' (đã cộng reserve_minted += delta — caller tính qua Genesis SDK). */
  supplyStateOutDatumCbor: string;
  /** value (assets) của SupplyState output (SUPPLY NFT + min-ADA). */
  supplyStateOutValue: Assets;
  /** redeemer spend SupplyState (Genesis SupplyStateRedeemer.Advance CBOR). */
  supplyStateRedeemerCbor: string;

  /**
   * Treasury auth UTxO (mang Treasury co-spend authority NFT — bằng chứng Treasury-pull).
   *
   * VECTOR 3 (Critical): UTxO này PHẢI nằm Ở gate script (reserve_gate). reserve_draw onchain
   * (param gate_script_hash) chỉ chấp nhận auth NFT khi input của nó ở đúng gate hash → spend
   * nó BẮT BUỘC kích reserve_gate.spend (ép parked < floor). Auth ở ví thường/script khác →
   * onchain reject. Caller chịu trách nhiệm chọn UTxO ở gate (xem gateScriptHash).
   */
  treasuryAuthUtxo: UTxO;
  /**
   * Script hash của reserve_gate (Treasury) — KHỚP param onchain gate_script_hash của
   * reserve_draw (= hash của reserve_gate validator). Auth UTxO ở trên phải thuộc script này.
   * (Tham chiếu/đối chiếu: reserve_draw đã apply-param gate_script_hash = hash này.)
   */
  gateScriptHash: string;
  /**
   * `reserve_gate` spend validator (đã apply-param) — BẮT BUỘC: auth UTxO luôn ở gate (RDB-002),
   * nên tiêu nó luôn kích gate. Hash của nó phải khớp `gateScriptHash` (RDB-007).
   *
   * Redeemer gate là Void, cố định — không nhận qua tham số (bản cũ nhận `treasuryAuthRedeemerCbor`
   * tuỳ chọn: bỏ trống thì lucid dựng spend script không redeemer).
   */
  gateScript: Validator;
  /** policy id (hex) + asset name (hex) auth NFT — khớp param `auth_policy`/`auth_name` của gate. */
  authPolicyId: string;
  authName: string;
  /**
   * SÀN parked (oildrop) — khớp param `floor_oildrop` của reserve_gate. G-FLOOR-1 đo LAMP trong
   * value của UTxO mang custody NFT; ở đường rút này đó chính là `custodyUtxo` (vai input,
   * trạng thái VÀO). parked ≥ sàn ⇒ builder ném RDB-009 trước khi dựng.
   *
   * Giả định: param `custody_nft_*` của gate trùng `reserveKhoNft*` ở dưới. Lệch thì G-CUST-1
   * on-chain không tìm thấy custody nào (builder không thêm reference input) ⇒ tx bị từ chối —
   * hỏng về phía đóng, không mất gì.
   */
  floorOildrop: bigint;

  /** lamp_mint minting policy + policy id (hex). */
  tlampPolicy: MintingPolicy;
  tlampPolicyId: string;
  /** redeemer mint route ReserveDraw (Genesis MINT_ROUTE.ReserveDraw = Constr(1,[])) CBOR. */
  reserveDrawRedeemerCbor: string;

  /**
   * KHO custody UTxO — mang kho NFT (`reserveKhoNftPolicyId`, `reserveKhoNftName`) qty 1,
   * ngồi ở custody script.
   *
   * Luật 9 (`reserve_draw.ak`): tx PHẢI TIÊU đúng 1 UTxO mang kho NFT. Luật 10: UTxO đó phải ở
   * ĐÚNG `custody_script_hash`. Bị tiêu là điều kiện để `custody` nhánh `MigrateIn` chạy và ghi
   * Δ vào SỔ — không tiêu thì không ai ghi sổ, và Δ thành LAMP ngoài sổ.
   */
  custodyUtxo: UTxO;
  /** Validator `custody` (Treasury, đã apply-param) — đính để tiêu kho. */
  custodyScript: Validator;
  /**
   * policy id (hex) + asset name (hex) của KHO NFT — khớp param `kho_nft_policy`/`kho_nft_name`
   * (khe #6-7) của `reserve_draw` onchain.
   *
   * ⚠ TÊN MANG TIỀN TỐ `reserveKho…` LÀ CÓ CHỦ Ý (2026-09-11). Cặp này PHẢI trùng khe #13-14
   * `reserve_kho_nft_policy`/`reserve_kho_nft_name` của `Genesis/onchain/validators/lamp_mint.ak`
   * — hai validator canh CÙNG một instance `custody`. Nó KHÔNG phải cặp `kho_nft_*` khe #9-10
   * của `lamp_mint` (kho Distribution, một cái kho khác hẳn). Trước bản đổi tên, trường này tên
   * `khoNftPolicyId` — trùng y hệt tên trường trỏ kho Distribution ở
   * `Genesis/offchain/src/mintBuilder.ts`, nên hai kho khác nhau nhìn như một.
   *
   * Ràng buộc khớp cặp được ép ở tầng APPLY-PARAM, nơi giá trị còn sửa được:
   * `Genesis/offchain/src/reserveKhoPair.ts::assertReserveKhoPair` (APPLY-003). Ở tầng dựng tx
   * này thì policy-id đã chốt trong bytecode, không còn gì để ép.
   */
  reserveKhoNftPolicyId: string;
  reserveKhoNftName: string;
  /** script hash của `custody` — khớp param custody_script_hash onchain (Luật 10). */
  custodyScriptHash: string;
  /**
   * Redeemer tiêu kho: `MigrateIn { source }` với `source` GHIM bằng hằng
   * `reserve_source_tag` (Treasury SDK: `custodyRedeemerToCbor({kind:"MigrateIn",
   * source: RESERVE_SOURCE_TAG})`). C-MIG-8 từ chối mọi nhãn khác.
   */
  custodyRedeemerCbor: string;
  /**
   * Datum kho SAU lượt nạp — sổ đã cộng Δ tại dòng (RESERVE_INFLOW_BUCKET_ID, lamp, token),
   * epoch := epoch hiện tại, MỌI trường khác bảo toàn (Treasury SDK: `planMigrateDatum` →
   * `custodyDatumToCbor`). Đây là "DÒNG SỔ" — thiếu nó thì C-MIG-8 từ chối tx.
   */
  custodyOutDatumCbor: string;
  /**
   * Value kho SAU lượt nạp — phần phi-lovelace phải KHỚP TUYỆT ĐỐI value vào ⊕ Δ LAMP;
   * lovelace chỉ được TĂNG (C-MIG-7 nới `>=` vì lượt migrate đầu thêm asset mới ⇒ min-UTxO
   * tăng). Builder tự kiểm vế này trước khi dựng (RDB-005).
   */
  custodyOutValue: Assets;

  /** Epoch hiện tại (khớp validity_range.lower_bound onchain). */
  epoch: bigint;
  /** Unix-time (ms) cận DƯỚI validity_range — phải nằm trong epoch trên (caller bảo đảm). */
  validFromUnixMs: number;
  /** Unix-time (ms) cận TRÊN validity_range — phải CÙNG epoch lower (Luật 2b ghim t). */
  validToUnixMs: number;

  /** Lượng Treasury muốn kéo (oildrop). Mặc định = trần epoch (kéo tối đa). */
  requestedOildrop?: bigint;

  /** min-ADA giữ ở ReserveState output (mặc định 2 tADA). */
  reserveMinAda?: bigint;
}

/** Đọc ReserveState datum từ UTxO (inline). */
export function readReserveState(utxo: UTxO): ReserveState {
  if (!utxo.datum) throw new Error("RDB-001: ReserveState UTxO thiếu inline datum");
  return decodeReserveState(Data.from(utxo.datum));
}

/** Datum/redeemer Void = Constr(0, []) — hình dạng reserve_gate đòi (G-DATUM-1, redeemer `_r: Void`). */
function voidCbor(): string {
  return Data.to(new Constr(0, []));
}

/**
 * Gương off-chain các luật của `reserve_gate.spend` mà builder này chịu trách nhiệm dựng đúng.
 * Chạy TRƯỚC khi đụng `p.lucid`.
 *
 *   RDB-007  hash(gateScript) == gateScriptHash — script đính phải là script giữ auth UTxO.
 *   RDB-008  auth UTxO mang ĐÚNG 1 auth NFT (G-AUTH-1); output tái tạo lấy nguyên value này nên
 *            nó cũng là vế "đúng 1 output mang auth NFT" (G-DS-1).
 *   RDB-009  parked của kho < sàn (G-FLOOR-1).
 */
function assertGateOk(p: DrawParams, lampUnit: string): void {
  const gateHash = validatorToScriptHash(p.gateScript);
  if (gateHash !== p.gateScriptHash) {
    throw new Error(
      `RDB-007: hash(gateScript) = ${gateHash} khác gateScriptHash (${p.gateScriptHash}) — ` +
      `script đính không phải script đang giữ auth UTxO, tx sẽ thiếu witness cho reserve_gate.`,
    );
  }

  const authUnit = toUnit(p.authPolicyId, p.authName);
  const authQty = p.treasuryAuthUtxo.assets[authUnit] ?? 0n;
  if (authQty !== 1n) {
    throw new Error(
      `RDB-008: treasuryAuthUtxo không mang đúng 1 auth NFT (${authUnit} = ${authQty}) — ` +
      `reserve_gate G-AUTH-1 + G-DS-1 đòi đúng 1 ở input và đúng 1 ở output về gate.`,
    );
  }

  const parked = p.custodyUtxo.assets[lampUnit] ?? 0n;
  if (parked >= p.floorOildrop) {
    throw new Error(
      `RDB-009: parked (${parked}) ≥ sàn (${p.floorOildrop}) — reserve_gate G-FLOOR-1 chỉ cho kéo ` +
      `Reserve khi Treasury DƯỚI sàn.`,
    );
  }
}

/** Value thread NFT (1 reserve NFT + min-ADA) cho output ReserveState'. */
function reserveNftAssets(policyId: string, name: string, minAda: bigint): Assets {
  return {
    lovelace: minAda,
    [toUnit(policyId, name)]: 1n,
  };
}

/**
 * Kiểm value kho ra khớp C-MIG-7 — gương off-chain của `migrate.value_ok`.
 *
 * Đây là chốt bắt đúng LỚP LỖI đã gây ra sự cố: rót Δ tới đích mà không đúng hình dạng thì
 * on-chain từ chối (tốn phí) hoặc — ở bản cũ, khi đích là một địa chỉ trần — LỌT và làm Δ
 * mắc ngoài sổ. Kiểm ở đây để nó đỏ TRƯỚC khi tx đi ra mạng.
 *
 * Phi-lovelace: ĐẲNG THỨC (asset đích tăng đúng Δ, mọi asset khác NGUYÊN — NFT authenticity,
 * kho NFT, token thuê bao khác). Lovelace: chỉ được TĂNG.
 */
function assertCustodyValueOk(
  valueIn: Assets, valueOut: Assets, lampUnit: string, delta: bigint,
): void {
  if ((valueOut["lovelace"] ?? 0n) < (valueIn["lovelace"] ?? 0n)) {
    throw new Error(
      `RDB-005: lovelace kho GIẢM (${valueIn["lovelace"] ?? 0n} → ${valueOut["lovelace"] ?? 0n}) — ` +
      `C-MIG-7 chỉ cho lovelace TĂNG (vét ADA của kho bị chặn).`,
    );
  }
  const want: Record<string, bigint> = {};
  for (const [u, q] of Object.entries(valueIn)) if (u !== "lovelace" && q !== 0n) want[u] = q;
  want[lampUnit] = (want[lampUnit] ?? 0n) + delta;

  for (const u of new Set([...Object.keys(valueOut), ...Object.keys(want)])) {
    if (u === "lovelace") continue;
    const got = valueOut[u] ?? 0n;
    const exp = want[u] ?? 0n;
    if (got !== exp) {
      throw new Error(
        `RDB-005: custodyOutValue sai ở ${u} — cần ${exp}, nhận ${got}. ` +
        `C-MIG-7 đòi phi-lovelace == value vào ⊕ ${delta} ${lampUnit}, mọi asset khác NGUYÊN.`,
      );
    }
  }
}

/**
 * Dựng tx draw. Tính ReserveState' + delta qua applyDraw (kẹp trần/pot; fail-fast nếu
 * t ≤ last_epoch hoặc pot cạn), rồi build: spend ReserveState (Draw) + spend SupplyState
 * (Advance) + spend Treasury auth (reserve_gate, Void) + spend KHO custody (MigrateIn)
 * + mint delta LAMP (route ReserveDraw) + recreate cả 2 state + tái tạo KHO với
 * value += Δ VÀ dòng sổ += Δ + tái tạo auth NFT về gate.
 */
export async function buildDrawTx(p: DrawParams): Promise<{
  tx: TxSignBuilder;
  nextReserve: ReserveState;
  drawn: bigint;
}> {
  const minAda = p.reserveMinAda ?? 2_000_000n;
  const tokenName = p.tokenName ?? TLAMP_NAME;

  // VECTOR 3 guard: auth UTxO PHẢI ở gate script. reserve_draw onchain reject auth không-ở-gate;
  // bắt sớm offchain (paymentCredential.hash == gateScriptHash) tránh dựng tx chắc-chắn-fail.
  const authCred = p.treasuryAuthUtxo.address
    ? getAddressDetails(p.treasuryAuthUtxo.address).paymentCredential
    : undefined;
  if (
    !authCred ||
    authCred.type !== "Script" ||
    authCred.hash !== p.gateScriptHash
  ) {
    throw new Error(
      "RDB-002: treasuryAuthUtxo phải ở gate script (reserve_gate) khớp gateScriptHash — " +
        "Vector 3: auth ở ví thường/script khác sẽ bị reserve_draw onchain reject.",
    );
  }

  // G-* gate guard: gương `reserve_gate.ak` — xem assertGateOk.
  const lampUnit = toUnit(p.tlampPolicyId, tokenName);
  assertGateOk(p, lampUnit);

  // Luật 9 guard: kho UTxO phải mang ĐÚNG 1 kho NFT. Không NFT thì on-chain không nhận nó là
  // kho "thật" — `count_inputs_with_nft(...) == 1` sẽ đếm 0 và cả tx chết.
  const khoUnit = toUnit(p.reserveKhoNftPolicyId, p.reserveKhoNftName);
  const khoQty = p.custodyUtxo.assets[khoUnit] ?? 0n;
  if (khoQty !== 1n) {
    throw new Error(
      `RDB-003: custodyUtxo không mang đúng 1 kho NFT (${khoUnit} = ${khoQty}) — ` +
      `Luật 9 của reserve_draw ép tx TIÊU đúng 1 UTxO mang kho NFT.`,
    );
  }

  // Luật 10 guard: kho UTxO phải ở ĐÚNG custody script hash. "Bị tiêu" chỉ kích validator ĐANG
  // GIỮ nó; NFT nằm ở script khác (hay ví thường) thì cái chạy KHÔNG phải `custody`, và KHÔNG
  // AI ép Δ vào sổ — đúng lỗ đã gây ra sự cố, chỉ khác đường vào.
  const khoCred = p.custodyUtxo.address
    ? getAddressDetails(p.custodyUtxo.address).paymentCredential
    : undefined;
  if (!khoCred || khoCred.type !== "Script" || khoCred.hash !== p.custodyScriptHash) {
    throw new Error(
      `RDB-004: custodyUtxo phải ở SCRIPT custody khớp custodyScriptHash (${p.custodyScriptHash}) — ` +
      `Luật 10: kho NFT ở script khác thì validator chạy không phải custody, không ai ghi Δ vào sổ.`,
    );
  }

  // Luật 7 guard: ReserveState' phải ở ĐÚNG địa chỉ input, kể cả stake credential
  // (`reserve_draw.ak:159` ▸ `expect s_out.address == own_out.address`). Địa chỉ recreate
  // lấy thẳng từ input; `reserveAddress` nếu có chỉ được phép TRÙNG.
  const reserveOutAddress = p.reserveUtxo.address;
  if (!reserveOutAddress) {
    throw new Error(
      "RDB-006: reserveUtxo không có address — Luật 7 đòi recreate ReserveState ở ĐÚNG địa chỉ input.",
    );
  }
  if (p.reserveAddress !== undefined && p.reserveAddress !== reserveOutAddress) {
    throw new Error(
      `RDB-006: reserveAddress (${p.reserveAddress}) khác reserveUtxo.address (${reserveOutAddress}) — ` +
      `Luật 7 ép s_out.address == own_out.address kể cả stake credential; hai nguồn lệch nhau ` +
      `nghĩa là một trong hai đã cũ. Bỏ hẳn reserveAddress, địa chỉ lấy từ input.`,
    );
  }

  const sIn = readReserveState(p.reserveUtxo);
  const requested = p.requestedOildrop ?? maxPerEpoch(sIn.total_oildrop);
  // Fail-fast offchain: ép t>last_epoch + delta>0 (≤trần & ≤pot) + transition đúng.
  const { next: sOut, drawn } = applyDraw(sIn, p.epoch, requested);

  const mintAssets: Assets = { [lampUnit]: drawn };

  const reserveOutValue = reserveNftAssets(
    p.reserveThreadPolicyId, p.reserveThreadName, minAda,
  );

  // C-MIG-7 guard: value kho ra == value vào ⊕ Δ (phi-lovelace đẳng thức, lovelace chỉ tăng).
  assertCustodyValueOk(p.custodyUtxo.assets, p.custodyOutValue, lampUnit, drawn);

  const txb = p.lucid
    .newTx()
    // ReserveState (Draw) — gate nhịp/meter của Genesis ReserveDraw.
    .collectFrom([p.reserveUtxo], drawRedeemerToCbor())
    .attach.SpendingValidator(p.reserveScript)
    // SupplyState (Advance) — Genesis cộng reserve_minted += delta.
    .collectFrom([p.supplyUtxo], p.supplyStateRedeemerCbor)
    .attach.SpendingValidator(p.supplyStateScript)
    // Treasury auth UTxO (redeemer Void) — kích reserve_gate (ép sàn) + thoả Luật 5 của
    // reserve_draw. Output tái tạo auth NFT ở dưới là PHẦN BẮT BUỘC của cùng lượt tiêu này.
    .collectFrom([p.treasuryAuthUtxo], voidCbor())
    .attach.SpendingValidator(p.gateScript)
    // KHO custody (MigrateIn) — TIÊU kho để chính validator kho ghi Δ vào SỔ (Luật 9+10).
    // Đây là chỗ thay cho `.pay.ToAddress(reserveDest, …)` của bản cũ: kho phải bị TIÊU và
    // TÁI TẠO, không phải được rót thêm một UTxO trần bên cạnh.
    .collectFrom([p.custodyUtxo], p.custodyRedeemerCbor)
    .attach.SpendingValidator(p.custodyScript)
    // Mint delta LAMP qua route ReserveDraw.
    .mintAssets(mintAssets, p.reserveDrawRedeemerCbor)
    .attach.MintingPolicy(p.tlampPolicy)
    // Recreate ReserveState' (NFT trả lại, drawn_oildrop += delta, last_epoch := epoch).
    // Địa chỉ TỪ CHÍNH `reserveUtxo.address` — Luật 7 ép `s_out.address == own_out.address`.
    .pay.ToContract(
      reserveOutAddress,
      { kind: "inline", value: reserveStateToCbor(sOut) },
      reserveOutValue,
    )
    // Recreate SupplyState' (NFT trả lại, reserve_minted += delta).
    .pay.ToContract(
      p.supplyStateAddress,
      { kind: "inline", value: p.supplyStateOutDatumCbor },
      p.supplyStateOutValue,
    )
    // Tái tạo KHO: value += Δ LAMP **VÀ** datum có DÒNG SỔ += Δ (C-MIG-7 + C-MIG-8).
    //
    // Địa chỉ lấy TỪ CHÍNH `custodyUtxo.address`, không nhận qua tham số riêng: C-MIG-ADDR ép
    // `cust_out.address == cust_in.address` KỂ CẢ stake credential. Nhận địa chỉ rời thì có một
    // đường để hai giá trị lệch nhau, và lệch stake credential ở nhánh permissionless này là
    // đường để người dựng tx đổi phần thưởng uỷ quyền của cả kho về khoá của hắn.
    //
    // `ToContract` (không phải `ToAddress`) vì kho BẮT BUỘC có inline datum — một UTxO không
    // datum tại địa chỉ kho là chính cái hình dạng chết đã gây ra sự cố.
    .pay.ToContract(
      p.custodyUtxo.address,
      { kind: "inline", value: p.custodyOutDatumCbor },
      p.custodyOutValue,
    )
    // Tái tạo auth NFT về gate (G-REOUT-1 + G-DATUM-1 + G-VALUE-1 + G-REF-1 của reserve_gate).
    //
    // Địa chỉ TỪ CHÍNH `treasuryAuthUtxo.address` — G-REOUT-1 ép `auth_out.address ==
    // own_out.address` KỂ CẢ stake credential; cùng lý do như kho và ReserveState ở trên.
    // Value = NGUYÊN value input (lovelace không giảm, đúng 1 auth NFT, không asset nào rơi về
    // ví qua output thối). Inline Void, không reference script.
    .pay.ToContract(
      p.treasuryAuthUtxo.address,
      { kind: "inline", value: voidCbor() },
      { ...p.treasuryAuthUtxo.assets },
    )
    // validity_range: lower_bound → epoch; upper_bound CÙNG epoch (Luật 2b ghim t).
    .validFrom(p.validFromUnixMs)
    .validTo(p.validToUnixMs);

  const tx = await txb.complete();
  return { tx, nextReserve: sOut, drawn };
}
