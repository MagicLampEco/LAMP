// Treasury reserveGateBuilder — dựng tx SPEND reserve_gate (ép SÀN + giữ auth, reserve_gate.ak).
//
// VAI TRÒ (cầu Reserve↔Treasury, lớp ép sàn):
//   reserve_gate giữ Treasury-pull auth NFT. Spend hợp lệ ⟺ Treasury parked < floor_oildrop.
//   Khi gate spend → auth NFT thành input → thỏa điều kiện "treasury_auth NFT input" của
//   reserve_draw.ak (Reserve), cho phép Reserve nhả. 2 validator chạy ĐỒNG THỜI 1 tx:
//   reserve_gate (ép sàn + re-output auth về gate) và reserve_draw (ép trần epoch + kế toán).
//
//   Builder này CHỈ dựng phần GATE: spend auth UTxO + reference custody THẬT + re-output auth
//   về gate. Phần Reserve (spend ReserveState, mint LAMP, recreate ReserveState, SupplyState…)
//   do Reserve SDK drawBuilder dựng — caller GỘP 2 phần vào 1 tx (xem §Gộp bên dưới).
//
// Param onchain (apply trước deploy):
//   custody_nft_policy/name — authenticity custody (custody_seed one-shot NFT).
//   lamp_policy/token_name  — LAMP/tLAMP (đo parked trong custody.value).
//   floor_oildrop               — SÀN parked. parked < floor_oildrop mới cho kéo.
//   auth_policy/auth_name    — = treasury_auth_policy/name của reserve_draw (reserve_auth đúc).
//
// Datum + redeemer gate = Void = Constr(0, []).

import {
  Constr, Data, toUnit,
  type Assets, type LucidEvolution, type TxSignBuilder, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

/** Redeemer/datum Void (Constr(0, [])) — gate không trạng thái. */
export function voidCbor(): string {
  return Data.to(new Constr(0, []));
}

/**
 * Đọc parked LAMP từ custody UTxO (số LAMP/tLAMP trong value). KHÔNG decode datum —
 * gate chỉ cần value. Trả 0n nếu không có unit LAMP.
 */
export function parkedOf(custodyUtxo: UTxO, lampPolicyId: string, tokenName: string): bigint {
  const unit = toUnit(lampPolicyId, tokenName);
  return custodyUtxo.assets[unit] ?? 0n;
}

export interface ReserveGateSpendParams {
  lucid: LucidEvolution;

  /** Auth UTxO ngồi tại reserve_gate (mang auth NFT + inline Void datum). */
  authUtxo: UTxO;
  /** reserve_gate spend validator (đã apply-param). */
  gateScript: Validator;
  /** script address giữ auth NFT (nơi re-output auth) — = địa chỉ reserve_gate. */
  gateAddress: string;

  /** policy id (hex) + asset name (hex) auth NFT. */
  authPolicyId: string;
  authName: string;

  /** Custody UTxO THẬT (mang custody NFT) — dùng làm REFERENCE INPUT (KHÔNG tiêu). */
  custodyUtxo: UTxO;

  /** policy id (hex) + asset name (hex) LAMP/tLAMP — đo parked (khớp param onchain). */
  lampPolicyId: string;
  tokenName: string;

  /** SÀN parked (oildrop) — khớp param floor_oildrop onchain. parked < floor mới cho kéo. */
  floorOildrop: bigint;

  /** min-ADA kèm auth NFT re-output (mặc định = ADA hiện có ở authUtxo, fallback 2 tADA). */
  minAda?: bigint;
}

/**
 * Dựng PHẦN GATE của tx Treasury-pull:
 *   - spend authUtxo (redeemer Void) + attach gateScript.
 *   - reference custodyUtxo (CIP-31, KHÔNG tiêu).
 *   - re-output auth NFT VỀ gateAddress (inline Void datum) — tái dùng.
 *
 * Fail-fast offchain: ép parked < floorOildrop trước khi build (khớp G-FLOOR-1 onchain),
 * tránh submit tx chắc-chắn-fail tốn phí.
 *
 * GỘP với Reserve: caller dùng `attachGateSpend(txb, params)` để thêm phần gate vào
 * một TxBuilder Reserve đang dựng (drawBuilder), rồi `.complete()` MỘT lần → 1 tx duy nhất.
 */
export function attachGateSpend(
  txb: ReturnType<LucidEvolution["newTx"]>,
  p: ReserveGateSpendParams,
): ReturnType<LucidEvolution["newTx"]> {
  const parked = parkedOf(p.custodyUtxo, p.lampPolicyId, p.tokenName);
  if (parked >= p.floorOildrop) {
    throw new Error(
      `RGATE-001: parked (${parked}) ≥ floor (${p.floorOildrop}) — Treasury KHÔNG dưới sàn, không được kéo Reserve.`,
    );
  }

  const authUnit = toUnit(p.authPolicyId, p.authName);
  const authQty = p.authUtxo.assets[authUnit] ?? 0n;
  if (authQty !== 1n) {
    throw new Error(`RGATE-002: authUtxo không mang đúng 1 auth NFT (${authUnit} = ${authQty}).`);
  }

  const minAda = p.minAda ?? (p.authUtxo.assets["lovelace"] ?? 2_000_000n);
  const authReoutput: Assets = { lovelace: minAda, [authUnit]: 1n };

  return txb
    // Spend auth UTxO (redeemer Void) — kích hoạt reserve_gate.
    .collectFrom([p.authUtxo], voidCbor())
    .attach.SpendingValidator(p.gateScript)
    // Reference custody THẬT (đọc parked, KHÔNG tiêu).
    .readFrom([p.custodyUtxo])
    // Re-output auth NFT VỀ gate (datum Void) — tái dùng vô hạn.
    .pay.ToAddressWithData(
      p.gateAddress,
      { kind: "inline", value: voidCbor() },
      authReoutput,
    );
}

/**
 * Dựng tx CHỈ-GATE (không gộp Reserve) — hữu ích để test cấu trúc gate độc lập.
 * Tx thực địa thường GỘP với Reserve (xem attachGateSpend). Tx chỉ-gate này sẽ
 * KHÔNG hợp lệ một mình trên chain nếu thiếu reserve_draw co-spend, nhưng dựng được.
 */
export async function buildGateOnlyTx(p: ReserveGateSpendParams): Promise<{
  tx: TxSignBuilder;
  parked: bigint;
  summary: string;
}> {
  const parked = parkedOf(p.custodyUtxo, p.lampPolicyId, p.tokenName);
  const txb = attachGateSpend(p.lucid.newTx(), p);
  const tx = await txb.complete();

  const summary = [
    `═══ Reserve Gate Spend (ép sàn) ═══`,
    `Auth:    ${p.authPolicyId}.${p.authName}`,
    `Custody: ${p.custodyUtxo.txHash}#${p.custodyUtxo.outputIndex} (reference)`,
    `Parked:  ${parked} < floor ${p.floorOildrop} ✓`,
    `→ auth re-output về gate: ${p.gateAddress}`,
  ].join("\n");

  return { tx, parked, summary };
}
