// LAMP Reserve drawBuilder — dựng tx DRAW (demand-gated qua Treasury-pull; reserve_draw.ak).
//
// Reserve = lớp đệm sau cùng, trần CỨNG mỗi epoch (max_per_epoch = total/1000). Mỗi epoch
// Treasury "kéo" tối đa trần; logic sàn (parked < floor) nằm Ở TREASURY. Builder ép luật
// onchain reserve_draw + Genesis tlamp_mint:
//
//   - Input:  ReserveState UTxO (mang reserve thread NFT) — redeemer Draw.
//             SupplyState  UTxO (mang SUPPLY NFT)         — redeemer Advance (Genesis).
//             Treasury auth UTxO (mang Treasury auth NFT) — bằng chứng Treasury-pull.
//             ReserveState NFT đóng vai "meter" gate nhịp của Genesis ReserveDraw.
//   - Mint:   delta oil LAMP qua policy tlamp_mint, redeemer ReserveDraw (Constr 1).
//   - Output: ReserveState' (NFT trả lại, drawn_oil += delta, last_epoch := epoch).
//             SupplyState'  (NFT trả lại, reserve_minted += delta).
//             delta LAMP tới reserve_dest (Treasury — TOÀN BỘ, không rò rỉ).
//
// delta tính qua applyDraw(state, epoch, requested) — kẹp trần/pot, fail-fast nếu
// t ≤ last_epoch (đã draw trong/sau epoch này) hoặc pot cạn.
//
// LƯU Ý: epoch phải khớp validity_range.lower_bound onchain (get_epoch lower_bound). Caller
// truyền `validFromUnixMs`/`epoch` nhất quán; builder set validFrom để lower_bound = epoch.

import {
  Data, toUnit,
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

  /** asset name LAMP (hex) — khớp param onchain lamp_name (testnet "tLAMP"/mainnet "LAMP"). */
  lampName?: string;

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

  /** Treasury auth UTxO (mang Treasury co-spend authority NFT — bằng chứng Treasury-pull). */
  treasuryAuthUtxo: UTxO;
  /** redeemer spend Treasury auth UTxO (Treasury validator quản — CBOR). */
  treasuryAuthRedeemerCbor?: string;
  /** Treasury validator giữ auth UTxO (đính nếu auth UTxO ở script address). */
  treasuryAuthScript?: Validator;

  /** tlamp_mint minting policy + policy id (hex). */
  tlampPolicy: MintingPolicy;
  tlampPolicyId: string;
  /** redeemer mint route ReserveDraw (Genesis MINT_ROUTE.ReserveDraw = Constr(1,[])) CBOR. */
  reserveDrawRedeemerCbor: string;

  /** Địa chỉ ĐÍCH nhận LAMP nhả (Treasury — khớp param onchain reserve_dest). */
  reserveDest: string;

  /** Epoch hiện tại (khớp validity_range.lower_bound onchain). */
  epoch: bigint;
  /** Unix-time (ms) cận DƯỚI validity_range — phải nằm trong epoch trên (caller bảo đảm). */
  validFromUnixMs: number;
  /** Unix-time (ms) cận TRÊN validity_range — phải CÙNG epoch lower (Luật 2b ghim t). */
  validToUnixMs: number;

  /** Lượng Treasury muốn kéo (oil). Mặc định = trần epoch (kéo tối đa). */
  requestedOil?: bigint;

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
 * Dựng tx draw. Tính ReserveState' + delta qua applyDraw (kẹp trần/pot; fail-fast nếu
 * t ≤ last_epoch hoặc pot cạn), rồi build: spend ReserveState (Draw) + spend SupplyState
 * (Advance) + spend Treasury auth (Treasury-pull) + mint delta LAMP (route ReserveDraw)
 * + recreate cả 2 state + trả delta LAMP cho reserve_dest (Treasury).
 */
export async function buildDrawTx(p: DrawParams): Promise<{
  tx: TxSignBuilder;
  nextReserve: ReserveState;
  drawn: bigint;
}> {
  const minAda = p.reserveMinAda ?? 2_000_000n;
  const lampName = p.lampName ?? TLAMP_NAME;

  const sIn = readReserveState(p.reserveUtxo);
  const requested = p.requestedOil ?? maxPerEpoch(sIn.total_oil);
  // Fail-fast offchain: ép t>last_epoch + delta>0 (≤trần & ≤pot) + transition đúng.
  const { next: sOut, drawn } = applyDraw(sIn, p.epoch, requested);

  const lampUnit = toUnit(p.tlampPolicyId, lampName);
  const mintAssets: Assets = { [lampUnit]: drawn };

  const reserveOutValue = reserveNftAssets(
    p.reserveThreadPolicyId, p.reserveThreadName, minAda,
  );
  const destValue: Assets = { [lampUnit]: drawn };

  let txb = p.lucid
    .newTx()
    // ReserveState (Draw) — gate nhịp/meter của Genesis ReserveDraw.
    .collectFrom([p.reserveUtxo], drawRedeemerToCbor())
    .attach.SpendingValidator(p.reserveScript)
    // SupplyState (Advance) — Genesis cộng reserve_minted += delta.
    .collectFrom([p.supplyUtxo], p.supplyStateRedeemerCbor)
    .attach.SpendingValidator(p.supplyStateScript)
    // Treasury auth UTxO — bằng chứng Treasury-pull (Treasury co-spend authority NFT).
    .collectFrom([p.treasuryAuthUtxo], p.treasuryAuthRedeemerCbor);

  // Đính Treasury validator nếu auth UTxO ở script address (co-spend authority).
  if (p.treasuryAuthScript) {
    txb = txb.attach.SpendingValidator(p.treasuryAuthScript);
  }

  txb = txb
    // Mint delta LAMP qua route ReserveDraw.
    .mintAssets(mintAssets, p.reserveDrawRedeemerCbor)
    .attach.MintingPolicy(p.tlampPolicy)
    // Recreate ReserveState' (NFT trả lại, drawn_oil += delta, last_epoch := epoch).
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
    // TOÀN BỘ delta LAMP tới reserve_dest (Treasury — không rò rỉ).
    .pay.ToAddress(p.reserveDest, destValue)
    // validity_range: lower_bound → epoch; upper_bound CÙNG epoch (Luật 2b ghim t).
    .validFrom(p.validFromUnixMs)
    .validTo(p.validToUnixMs);

  const tx = await txb.complete();
  return { tx, nextReserve: sOut, drawn };
}
