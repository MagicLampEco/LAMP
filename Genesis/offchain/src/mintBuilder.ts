// LAMP Genesis mintBuilder — dựng tx LAZY-MINT LAMP (CONTRACT §5; lamp_mint.ak).
//
// Flow (khớp luật onchain):
//   - Input:  SupplyState UTxO (mang thread NFT) — spend redeemer Advance.
//   - Mint:   Δ oil LAMP qua policy lamp_mint, redeemer DistributionVest|ReserveDraw.
//   - Output: SupplyState' tại CÙNG script address, mang lại thread NFT, datum cập nhật
//             (dist_minted hoặc reserve_minted += Δ); + Δ tLAMP trả `recipient`.
//   - Ref:    registry UTxO (mang registry NFT) + kho UTxO (mang kho NFT) — WHO-gate và
//             A-DEST được validator đọc ĐỘNG qua `tx.reference_inputs`.
//   - Sign:   authority mà RegistryDatum chỉ định cho `token_tag` (extra_signatories).
//
// PHẠM VI: builder này phục vụ đường DistributionVest. Đường ReserveDraw KHÔNG dùng chữ
// ký — gate onchain đòi tx SPEND meter NFT (= reserve_thread NFT, permissionless). Tx
// ReserveDraw thật được dựng bởi `Reserve/offchain/drawBuilder.ts`. KHÔNG dùng builder này
// cho ReserveDraw.
//
// Invariants ép TRƯỚC khi build (fail-fast offchain qua applyMint): Δ>0, ≤ cap, đúng quota.
//
// ⚠ ĐÃ SỬA 2026-08-05 — trước đó builder này KHÔNG dùng được với `lamp_mint` canonical.
// Nó còn ở hình dạng v1/anchor: chỉ `addSigner(authority)` rồi `pay.ToAddress(recipient)`,
// KHÔNG có `readFrom`. Validator canonical (`lamp_mint.ak` 12 tham số) đọc **registry** để
// biết ai được mint và đọc **kho-NFT** để biết A-DEST rót đi đâu, cả hai qua reference
// input. Thiếu chúng thì `expect` đầu tiên trong validator crash ⇒ MỌI tx dựng bằng builder
// này đều fail, không tuỳ tham số. Đường chạy thật duy nhất trước bản vá là
// `scripts/canonical_mint.ts:99` (`.readFrom([regU, khoU])`) — builder nay theo đúng nó.
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

  /** Người nhận tLAMP đã mint (bech32 address).
   *  A-DEST (DistributionVest): PHẢI là địa chỉ KHO — tức chính địa chỉ đang giữ
   *  `khoRefUtxo`. Rót về ví cá nhân thì validator reject (qty_to_script < Δ).
   *  Builder ĐỐI CHIẾU điều này trước khi build (GMB-004) thay vì để hỏng trên chuỗi. */
  recipient: string;

  /** Inline datum đặt kèm output kho (hex CBOR). Kho `treasury.ak` đòi datum hợp lệ;
   *  bỏ trống thì UTxO kho không spend được — LAMP no-burn ⇒ kẹt vĩnh viễn. */
  recipientDatum?: string;

  /** Reference input: UTxO mang **registry NFT** — validator đọc RegistryDatum từ đây để
   *  biết `token_tag` này ai được mint (WHO-gate). Thiếu ⇒ validator crash. */
  registryRefUtxo: UTxO;

  /** Reference input: UTxO mang **kho NFT** — validator đọc địa chỉ kho từ đây (A-DEST
   *  động). Thiếu ⇒ validator crash. */
  khoRefUtxo: UTxO;

  /** Keyhash authority phải ký (đúng đường mint) — addSigner để Lucid đòi chữ ký.
   *  PHẢI khớp `Authority` mà RegistryDatum gán cho `token_tag`. */
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

  // GMB-004 (A-DEST): validator đọc địa chỉ kho ĐỘNG từ UTxO mang kho-NFT. Nếu recipient
  // khác địa chỉ đó thì `qty_to_script < Δ` ⇒ reject. Bắt ở đây, trước khi tốn phí — và
  // quan trọng hơn: trước khi ai đó tưởng mint thành công rồi đi tìm LAMP ở sai chỗ.
  if (p.recipient !== p.khoRefUtxo.address) {
    throw new Error(
      `GMB-004: recipient (${p.recipient}) KHÁC địa chỉ kho mang kho-NFT ` +
      `(${p.khoRefUtxo.address}). DistributionVest bắt buộc rót toàn bộ LAMP vào kho ` +
      `(A-DEST) — validator sẽ từ chối tx này.`,
    );
  }

  const supplyOutValue = threadNftAssets(p.threadPolicyId, minAda);
  const recipientValue: Assets = { [tlampUnit]: p.amount, lovelace: minAda };

  let txb = p.lucid
    .newTx()
    .collectFrom([p.supplyUtxo], supplyStateRedeemerToCbor())
    .attach.SpendingValidator(p.supplyStateScript)
    .mintAssets(mintAssets, mintRouteToCbor(p.route))
    .attach.MintingPolicy(p.tlampPolicy)
    // WHO-gate (registry) + A-DEST (kho) — validator đọc cả hai qua reference input.
    .readFrom([p.registryRefUtxo, p.khoRefUtxo])
    .pay.ToContract(
      p.supplyStateAddress,
      { kind: "inline", value: supplyStateToCbor(sOut) },
      supplyOutValue,
    );

  txb = p.recipientDatum === undefined
    ? txb.pay.ToAddress(p.recipient, recipientValue)
    : txb.pay.ToContract(
        p.recipient,
        { kind: "inline", value: p.recipientDatum },
        recipientValue,
      );

  for (const kh of p.authoritySigners) {
    txb = txb.addSignerKey(kh);
  }

  const tx = await txb.complete();
  return { tx, nextState: sOut };
}
