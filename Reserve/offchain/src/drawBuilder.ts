// LAMP Reserve drawBuilder — dựng tx DRAW (nhả linear 1001 epoch; reserve_draw.ak).
//
// Permissionless: KHÔNG chữ ký. Ai dựng tx đúng lịch cũng trigger được; con số nhả do
// hàm vested(t) quyết. Flow (khớp luật onchain reserve_draw + Genesis tlamp_mint):
//
//   - Input:  ReserveState UTxO (mang reserve thread NFT) — redeemer Draw.
//             SupplyState UTxO (mang SUPPLY NFT)          — redeemer Advance.
//             ReserveState NFT đóng vai "meter" gate nhịp của Genesis ReserveDraw.
//   - Mint:   draw oil tLAMP qua policy tlamp_mint, redeemer ReserveDraw (Constr 1).
//   - Output: ReserveState' tại CÙNG script (NFT trả lại, drawn_oil += draw).
//             SupplyState'  tại CÙNG script (NFT trả lại, reserve_minted += draw).
//             draw tLAMP tới reserve_dest (TOÀN BỘ, không rò rỉ).
//
// draw tính qua applyDraw(state, epoch) — fail-fast nếu chưa có gì tới hạn (epoch sai/sớm).
//
// LƯU Ý: epoch phải khớp validity_range.lower_bound onchain (get_epoch lower_bound). Caller
// truyền `validFromSlot`/`epoch` nhất quán; builder set validFrom để lower_bound = epoch.

import {
  Data, toUnit,
  type Assets, type LucidEvolution, type MintingPolicy, type TxSignBuilder,
  type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import { TLAMP_NAME } from "./constants.js";
import {
  decodeReserveState, reserveStateToCbor, drawRedeemerToCbor,
} from "./datum.js";
import { applyDraw } from "./math.js";
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

  /** SupplyState UTxO (Genesis) + spend validator + address + redeemer CBOR. */
  supplyUtxo: UTxO;
  supplyStateScript: Validator;
  supplyStateAddress: string;
  /** datum CBOR của SupplyState' (đã cộng reserve_minted += draw — caller tính qua Genesis SDK). */
  supplyStateOutDatumCbor: string;
  /** value (assets) của SupplyState output (SUPPLY NFT + min-ADA). */
  supplyStateOutValue: Assets;
  /** redeemer spend SupplyState (Genesis SupplyStateRedeemer.Advance CBOR). */
  supplyStateRedeemerCbor: string;

  /** tlamp_mint minting policy + policy id (hex). */
  tlampPolicy: MintingPolicy;
  tlampPolicyId: string;
  /** redeemer mint route ReserveDraw (Genesis MINT_ROUTE.ReserveDraw = Constr(1,[])) CBOR. */
  reserveDrawRedeemerCbor: string;

  /** Địa chỉ ĐÍCH nhận tLAMP nhả (Treasury hoặc thị trường — khớp param onchain reserve_dest). */
  reserveDest: string;

  /** Epoch hiện tại (khớp validity_range.lower_bound onchain). */
  epoch: bigint;
  /** Unix-time (ms) cận DƯỚI validity_range — phải nằm trong epoch trên (caller bảo đảm). */
  validFromUnixMs: number;

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
 * Dựng tx draw. Tính ReserveState' + draw qua applyDraw (fail-fast nếu chưa tới hạn),
 * rồi build: spend ReserveState (Draw) + spend SupplyState (Advance) + mint draw tLAMP
 * (route ReserveDraw) + recreate cả 2 state + trả draw tLAMP cho reserve_dest.
 */
export async function buildDrawTx(p: DrawParams): Promise<{
  tx: TxSignBuilder;
  nextReserve: ReserveState;
  drawn: bigint;
}> {
  const minAda = p.reserveMinAda ?? 2_000_000n;

  const sIn = readReserveState(p.reserveUtxo);
  // Fail-fast offchain: ép draw>0 + transition đúng TRƯỚC khi tốn phí.
  const { next: sOut, drawn } = applyDraw(sIn, p.epoch);

  const tlampUnit = toUnit(p.tlampPolicyId, TLAMP_NAME);
  const mintAssets: Assets = { [tlampUnit]: drawn };

  const reserveOutValue = reserveNftAssets(
    p.reserveThreadPolicyId, p.reserveThreadName, minAda,
  );
  const destValue: Assets = { [tlampUnit]: drawn };

  const txb = p.lucid
    .newTx()
    // ReserveState (Draw) — gate nhịp tất định, đóng vai meter của Genesis.
    .collectFrom([p.reserveUtxo], drawRedeemerToCbor())
    .attach.SpendingValidator(p.reserveScript)
    // SupplyState (Advance) — Genesis cộng reserve_minted += draw.
    .collectFrom([p.supplyUtxo], p.supplyStateRedeemerCbor)
    .attach.SpendingValidator(p.supplyStateScript)
    // Mint draw tLAMP qua route ReserveDraw.
    .mintAssets(mintAssets, p.reserveDrawRedeemerCbor)
    .attach.MintingPolicy(p.tlampPolicy)
    // Recreate ReserveState' (NFT trả lại, drawn_oil += draw).
    .pay.ToContract(
      p.reserveAddress,
      { kind: "inline", value: reserveStateToCbor(sOut) },
      reserveOutValue,
    )
    // Recreate SupplyState' (NFT trả lại, reserve_minted += draw).
    .pay.ToContract(
      p.supplyStateAddress,
      { kind: "inline", value: p.supplyStateOutDatumCbor },
      p.supplyStateOutValue,
    )
    // TOÀN BỘ draw tLAMP tới reserve_dest (không rò rỉ).
    .pay.ToAddress(p.reserveDest, destValue)
    // validity_range.lower_bound → epoch onchain (get_epoch lower_bound).
    .validFrom(p.validFromUnixMs);

  const tx = await txb.complete();
  return { tx, nextReserve: sOut, drawn };
}
