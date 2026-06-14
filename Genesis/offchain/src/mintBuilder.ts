// LAMP Genesis mintBuilder — dựng tx LAZY-MINT LAMP (CONTRACT §5; lamp_mint.ak).
//
// Flow (khớp luật onchain):
//   - Input:  SupplyState UTxO (mang thread NFT) — spend redeemer Advance.
//   - Mint:   Δ oil LAMP qua policy lamp_mint, redeemer DistributionVest|ReserveDraw.
//   - Output: SupplyState' tại CÙNG script address, mang lại thread NFT, datum cập nhật
//             (dist_minted hoặc reserve_minted += Δ); + Δ tLAMP trả `recipient`.
//   - Sign:   authority đúng đường mint (extra_signatories) — caller bảo đảm ví ký.
//
// PHẠM VI: builder này phục vụ đường DistributionVest (gate pubkey-sig). Đường ReserveDraw
// KHÔNG còn dùng chữ ký — gate onchain đòi tx SPEND ReserveMeter NFT (permissionless). Tx
// ReserveDraw thật được dựng bởi Reserve/offchain/reserveDrawBuilder.ts (co-spend Meter +
// SupplyState + mint tLAMP qua reserve_meter). KHÔNG dùng builder này cho ReserveDraw.
//
// Invariants ép TRƯỚC khi build (fail-fast offchain qua applyMint): Δ>0, ≤ cap, đúng quota.
//
// LƯU Ý KIẾN TRÚC: builder KHÔNG tự gắn signature — nó addSigner(authority) để Lucid
// yêu cầu ví ký. Caller (script/ví) cấp khóa thật. tx.mint thread NFT == 0 (không đụng
// thread) tự nhiên đúng vì builder chỉ mint tLAMP, không mint thread.

import {
  Data, toUnit,
  type Assets, type LucidEvolution, type MintingPolicy, type TxSignBuilder,
  type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import { SUPPLY_NAME } from "./constants.js";
import {
  decodeSupplyState, supplyStateToCbor, mintRouteToCbor, supplyStateRedeemerToCbor,
} from "./datum.js";
import { applyMint } from "./supplyState.js";
import type { MintRoute, SupplyState } from "./types.js";

export interface MintParams {
  lucid: LucidEvolution;

  /** SupplyState UTxO (inline SupplyState datum + thread NFT bắt buộc). */
  supplyUtxo: UTxO;

  /** supply_state spend validator (giữ SupplyState). */
  supplyStateScript: Validator;
  /** script address giữ SupplyState (nơi recreate output). */
  supplyStateAddress: string;

  /** lamp_mint minting policy + policy id (hex). */
  tlampPolicy: MintingPolicy;
  tlampPolicyId: string;

  /** asset name LAMP (hex) — khớp param token_name của lamp_mint khi apply-param:
   *  TLAMP_NAME ("744c414d50") cho testnet, LAMP_NAME ("4c414d50") cho mainnet. */
  tokenName: string;

  /** policy id thread NFT (hex) — để định vị NFT trong value. */
  threadPolicyId: string;

  /** Đường mint + lượng oil. */
  route: MintRoute;
  amount: bigint;

  /** Người nhận tLAMP đã mint (bech32 address). */
  recipient: string;

  /** Keyhash authority phải ký (đúng đường mint) — addSigner để Lucid đòi chữ ký. */
  authoritySigners: string[];

  /** min-ADA giữ ở SupplyState output (mặc định 2 tADA). */
  supplyMinAda?: bigint;
}

/** Đọc SupplyState datum từ UTxO (inline). */
export function readSupplyState(utxo: UTxO): SupplyState {
  if (!utxo.datum) throw new Error("GMB-001: SupplyState UTxO thiếu inline datum");
  return decodeSupplyState(Data.from(utxo.datum));
}

/** Giá trị thread NFT (1 SUPPLY) cho output SupplyState'. */
function threadNftAssets(threadPolicyId: string, minAda: bigint): Assets {
  return {
    lovelace: minAda,
    [toUnit(threadPolicyId, SUPPLY_NAME)]: 1n,
  };
}

/**
 * Dựng tx lazy-mint. Tính SupplyState' qua applyMint (ép cap/quota/Δ>0 fail-fast),
 * rồi build: spend SupplyState (Advance) + mint Δ tLAMP (route) + recreate SupplyState'
 * + trả Δ tLAMP cho recipient + addSigner(authority).
 */
export async function buildMintTx(p: MintParams): Promise<{
  tx: TxSignBuilder;
  nextState: SupplyState;
}> {
  const minAda = p.supplyMinAda ?? 2_000_000n;

  const sIn = readSupplyState(p.supplyUtxo);
  // Fail-fast offchain: ép đúng luật onchain TRƯỚC khi tốn phí.
  const sOut = applyMint(sIn, p.route, p.amount);

  const tlampUnit = toUnit(p.tlampPolicyId, p.tokenName);
  const mintAssets: Assets = { [tlampUnit]: p.amount };

  const supplyOutValue = threadNftAssets(p.threadPolicyId, minAda);
  const recipientValue: Assets = { [tlampUnit]: p.amount };

  let txb = p.lucid
    .newTx()
    .collectFrom([p.supplyUtxo], supplyStateRedeemerToCbor())
    .attach.SpendingValidator(p.supplyStateScript)
    .mintAssets(mintAssets, mintRouteToCbor(p.route))
    .attach.MintingPolicy(p.tlampPolicy)
    .pay.ToContract(
      p.supplyStateAddress,
      { kind: "inline", value: supplyStateToCbor(sOut) },
      supplyOutValue,
    )
    .pay.ToAddress(p.recipient, recipientValue);

  for (const kh of p.authoritySigners) {
    txb = txb.addSignerKey(kh);
  }

  const tx = await txb.complete();
  return { tx, nextState: sOut };
}
