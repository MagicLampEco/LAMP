// LAMP Reserve drawBuilder — dựng tx DRAW (demand-gated qua Treasury-pull; reserve_draw.ak).
//
// Reserve = lớp đệm sau cùng, trần CỨNG mỗi epoch (max_per_epoch = total/1000). Mỗi epoch
// Treasury "kéo" tối đa trần; logic sàn (parked < floor) nằm Ở TREASURY. Builder ép luật
// onchain reserve_draw + Genesis lamp_mint:
//
//   - Input:  ReserveState UTxO (mang reserve thread NFT) — redeemer Draw.
//             SupplyState  UTxO (mang SUPPLY NFT)         — redeemer Advance (Genesis).
//             Treasury auth UTxO (mang Treasury auth NFT) — bằng chứng Treasury-pull.
//             KHO custody UTxO (mang kho NFT)             — redeemer MigrateIn (Treasury).
//             ReserveState NFT đóng vai "meter" gate nhịp của Genesis ReserveDraw.
//   - Mint:   delta oildrop LAMP qua policy lamp_mint, redeemer ReserveDraw (Constr 1).
//   - Output: ReserveState' (NFT trả lại, drawn_oildrop += delta, last_epoch := epoch).
//             SupplyState'  (NFT trả lại, reserve_minted += delta).
//             KHO custody'  (value += delta LAMP **VÀ** một DÒNG SỔ += delta trong datum).
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
  Data, toUnit, getAddressDetails,
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
  /** script address giữ ReserveState (nơi recreate output). */
  reserveAddress: string;
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
  /** redeemer spend Treasury auth UTxO (Treasury validator quản — CBOR). */
  treasuryAuthRedeemerCbor?: string;
  /** Treasury validator giữ auth UTxO (đính nếu auth UTxO ở script address). */
  treasuryAuthScript?: Validator;

  /** lamp_mint minting policy + policy id (hex). */
  tlampPolicy: MintingPolicy;
  tlampPolicyId: string;
  /** redeemer mint route ReserveDraw (Genesis MINT_ROUTE.ReserveDraw = Constr(1,[])) CBOR. */
  reserveDrawRedeemerCbor: string;

  /**
   * KHO custody UTxO — mang kho NFT (khoNftPolicyId, khoNftName) qty 1, ngồi ở custody script.
   *
   * Luật 9 (`reserve_draw.ak`): tx PHẢI TIÊU đúng 1 UTxO mang kho NFT. Luật 10: UTxO đó phải ở
   * ĐÚNG `custody_script_hash`. Bị tiêu là điều kiện để `custody` nhánh `MigrateIn` chạy và ghi
   * Δ vào SỔ — không tiêu thì không ai ghi sổ, và Δ thành LAMP ngoài sổ.
   */
  custodyUtxo: UTxO;
  /** Validator `custody` (Treasury, đã apply-param) — đính để tiêu kho. */
  custodyScript: Validator;
  /** policy id (hex) + asset name (hex) của KHO NFT — khớp param kho_nft_policy/name onchain. */
  khoNftPolicyId: string;
  khoNftName: string;
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
 * (Advance) + spend Treasury auth (Treasury-pull) + spend KHO custody (MigrateIn)
 * + mint delta LAMP (route ReserveDraw) + recreate cả 2 state + tái tạo KHO với
 * value += Δ VÀ dòng sổ += Δ.
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

  // Luật 9 guard: kho UTxO phải mang ĐÚNG 1 kho NFT. Không NFT thì on-chain không nhận nó là
  // kho "thật" — `count_inputs_with_nft(...) == 1` sẽ đếm 0 và cả tx chết.
  const khoUnit = toUnit(p.khoNftPolicyId, p.khoNftName);
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

  const sIn = readReserveState(p.reserveUtxo);
  const requested = p.requestedOildrop ?? maxPerEpoch(sIn.total_oildrop);
  // Fail-fast offchain: ép t>last_epoch + delta>0 (≤trần & ≤pot) + transition đúng.
  const { next: sOut, drawn } = applyDraw(sIn, p.epoch, requested);

  const lampUnit = toUnit(p.tlampPolicyId, tokenName);
  const mintAssets: Assets = { [lampUnit]: drawn };

  const reserveOutValue = reserveNftAssets(
    p.reserveThreadPolicyId, p.reserveThreadName, minAda,
  );

  // C-MIG-7 guard: value kho ra == value vào ⊕ Δ (phi-lovelace đẳng thức, lovelace chỉ tăng).
  assertCustodyValueOk(p.custodyUtxo.assets, p.custodyOutValue, lampUnit, drawn);

  let txb = p.lucid
    .newTx()
    // ReserveState (Draw) — gate nhịp/meter của Genesis ReserveDraw.
    .collectFrom([p.reserveUtxo], drawRedeemerToCbor())
    .attach.SpendingValidator(p.reserveScript)
    // SupplyState (Advance) — Genesis cộng reserve_minted += delta.
    .collectFrom([p.supplyUtxo], p.supplyStateRedeemerCbor)
    .attach.SpendingValidator(p.supplyStateScript)
    // Treasury auth UTxO — bằng chứng Treasury-pull (Treasury co-spend authority NFT).
    .collectFrom([p.treasuryAuthUtxo], p.treasuryAuthRedeemerCbor)
    // KHO custody (MigrateIn) — TIÊU kho để chính validator kho ghi Δ vào SỔ (Luật 9+10).
    // Đây là chỗ thay cho `.pay.ToAddress(reserveDest, …)` của bản cũ: kho phải bị TIÊU và
    // TÁI TẠO, không phải được rót thêm một UTxO trần bên cạnh.
    .collectFrom([p.custodyUtxo], p.custodyRedeemerCbor)
    .attach.SpendingValidator(p.custodyScript);

  // Đính Treasury validator nếu auth UTxO ở script address (co-spend authority).
  if (p.treasuryAuthScript) {
    txb = txb.attach.SpendingValidator(p.treasuryAuthScript);
  }

  txb = txb
    // Mint delta LAMP qua route ReserveDraw.
    .mintAssets(mintAssets, p.reserveDrawRedeemerCbor)
    .attach.MintingPolicy(p.tlampPolicy)
    // Recreate ReserveState' (NFT trả lại, drawn_oildrop += delta, last_epoch := epoch).
    .pay.ToContract(
      p.reserveAddress,
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
    // validity_range: lower_bound → epoch; upper_bound CÙNG epoch (Luật 2b ghim t).
    .validFrom(p.validFromUnixMs)
    .validTo(p.validToUnixMs);

  const tx = await txb.complete();
  return { tx, nextReserve: sOut, drawn };
}
