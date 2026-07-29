// Treasury reserveAuthBuilder — dựng tx MINT one-shot Treasury-pull auth NFT (reserve_auth.ak).
//
// VAI TRÒ (cầu Reserve↔Treasury): reserve_auth là minting policy ONE-SHOT đúc credential
// "kéo" của Treasury. reserve_draw.ak (Reserve) nhả CHỈ khi tx có 1 input mang NFT này;
// reserve_gate.ak KHÓA NFT này và chỉ cho spend khi Treasury parked < floor. Builder này
// chỉ chạy MỘT LẦN (one-shot): đúc đúng 1 (auth_name, +1) rồi gửi tới địa chỉ gate.
//
// Param onchain (apply trước khi deploy):
//   genesis_ref — UTxO genesis tiêu đúng 1 lần (chọn 1 UTxO ví, đưa làm input).
//   auth_name   — asset name auth NFT (= treasury_auth_name của reserve_draw + reserve_gate).
//
// Redeemer MintAuth = Constr(0, []) (1 constructor duy nhất; KHÔNG burn).

import {
  Constr, Data, toUnit,
  type Assets, type LucidEvolution, type MintingPolicy, type TxSignBuilder, type UTxO,
} from "@lucid-evolution/lucid";

/** Redeemer mint reserve_auth (MintAuth = Constr(0, [])). */
export function mintAuthRedeemerToCbor(): string {
  return Data.to(new Constr(0, []));
}

export interface ReserveAuthMintParams {
  lucid: LucidEvolution;

  /** reserve_auth minting policy (đã apply-param genesis_ref + auth_name). */
  authPolicy: MintingPolicy;
  /** policy id (hex) của authPolicy — = treasury_auth_policy của reserve_draw. */
  authPolicyId: string;
  /** asset name auth NFT (hex) — = treasury_auth_name của reserve_draw + reserve_gate. */
  authName: string;

  /** UTxO genesis PHẢI tiêu trong tx này (khớp genesis_ref đã apply-param). One-shot. */
  genesisUtxo: UTxO;

  /** Địa chỉ NHẬN auth NFT — ĐÚNG NHẤT là địa chỉ reserve_gate (auth bị khóa tại gate). */
  gateAddress: string;

  /** min-ADA kèm auth NFT output (mặc định 2 tADA). */
  minAda?: bigint;
}

/**
 * Dựng tx mint one-shot auth NFT. Tiêu genesisUtxo (ép one-shot), đúc đúng 1
 * (authPolicyId, authName), gửi tới gateAddress kèm min-ADA. KHÔNG burn.
 *
 * LƯU Ý: auth NFT gate là validator datum Void → output tới gateAddress dùng inline
 * datum Void = Constr(0, []) để gate có thể spend lại sau (reserve_gate đọc datum Void).
 */
export async function buildReserveAuthMintTx(p: ReserveAuthMintParams): Promise<{
  tx: TxSignBuilder;
  authUnit: string;
  summary: string;
}> {
  const minAda = p.minAda ?? 2_000_000n;
  const authUnit = toUnit(p.authPolicyId, p.authName);

  const mintAssets: Assets = { [authUnit]: 1n };
  const gateValue: Assets = { lovelace: minAda, [authUnit]: 1n };

  // Datum Void cho gate UTxO (reserve_gate.spend đọc Option<Void> + redeemer Void).
  const voidDatum = Data.to(new Constr(0, []));

  const tx = await p.lucid
    .newTx()
    // ONE-SHOT: tiêu genesisUtxo (chứng minh policy chạy đúng 1 lần).
    .collectFrom([p.genesisUtxo])
    // Đúc đúng 1 auth NFT (redeemer MintAuth).
    .mintAssets(mintAssets, mintAuthRedeemerToCbor())
    .attach.MintingPolicy(p.authPolicy)
    // Gửi auth NFT tới reserve_gate (khóa tại gate, datum Void để spend lại).
    .pay.ToAddressWithData(
      p.gateAddress,
      { kind: "inline", value: voidDatum },
      gateValue,
    )
    .complete();

  const summary = [
    `═══ Reserve Auth Mint (one-shot) ═══`,
    `Auth policy: ${p.authPolicyId}`,
    `Auth name:   ${p.authName}`,
    `Genesis:     ${p.genesisUtxo.txHash}#${p.genesisUtxo.outputIndex}`,
    `→ gate:      ${p.gateAddress}`,
  ].join("\n");

  return { tx, authUnit, summary };
}
