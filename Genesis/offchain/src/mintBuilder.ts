// LAMP Genesis mintBuilder — dựng tx LAZY-MINT LAMP (CONTRACT §5; lamp_mint.ak).
//
// Flow (khớp luật onchain):
//   - Input:  SupplyState UTxO (mang thread NFT) — spend redeemer Advance.
//   - Mint:   Δ oildrop LAMP qua policy lamp_mint, redeemer DistributionVest|ReserveDraw.
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
// ⚠ VÁ TIẾP 2026-08-12 (review PR #23). Ba guard, xếp theo mức thiệt hại:
//   GMB-006 — `recipientDatum` từ TUỲ CHỌN → BẮT BUỘC. Đây là ca DUY NHẤT trong builder
//     mà lỗi làm MẤT TIỀN chứ không phải hỏng tx: kho là địa chỉ script, `lamp_mint` cấp
//     phép A-DEST bằng `qty_to_script` (đếm theo payment credential, KHÔNG nhìn datum) nên
//     tx thiếu datum vẫn HỢP LỆ và mint xong; UTxO sinh ra thì `treasury.ak:27
//     expect Some(datum)` từ chối vĩnh viễn, mà LAMP không burn được. Bản trước để optional
//     và mặc định rơi vào `pay.ToAddress` — đường MẶC ĐỊNH chính là đường mất tiền.
//   GMB-005 — đối chiếu registry/kho ref-input thật sự mang NFT. GMB-004 so recipient với
//     `khoRefUtxo.address`; nếu chính khoRefUtxo sai thì phép so tự thoả ⇒ guard vô nghĩa.
//     Chạy TRƯỚC GMB-004 để lỗi nói đúng nguyên nhân gốc.
//   (GMB-004 giữ nguyên.)
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

  /** Đường mint + lượng oildrop. */
  route: MintRoute;
  amount: bigint;

  /** Người nhận tLAMP đã mint (bech32 address).
   *  A-DEST (DistributionVest): PHẢI là địa chỉ KHO — tức chính địa chỉ đang giữ
   *  `khoRefUtxo`. Rót về ví cá nhân thì validator reject (qty_to_script < Δ).
   *  Builder ĐỐI CHIẾU điều này trước khi build (GMB-004) thay vì để hỏng trên chuỗi. */
  recipient: string;

  /** Inline datum đặt kèm output kho (hex CBOR). **BẮT BUỘC** — kho LUÔN là địa chỉ
   *  script (`qty_to_script` chỉ đếm output Script, ví VK không tính), mà rót vào script
   *  KHÔNG datum thì `treasury.ak:27 expect Some(datum)` fail ⇒ UTxO không spend được,
   *  LAMP no-burn ⇒ MẤT VĨNH VIỄN. Tx vẫn HỢP LỆ khi thiếu datum (validator đếm theo
   *  payment credential, không nhìn datum) nên chuỗi KHÔNG cứu được — phải chặn ở đây. */
  recipientDatum: string;

  /** Reference input: UTxO mang **registry NFT** — validator đọc RegistryDatum từ đây để
   *  biết `token_tag` này ai được mint (WHO-gate). Thiếu ⇒ validator crash. */
  registryRefUtxo: UTxO;

  /** policy id registry NFT (hex) — để ĐỐI CHIẾU `registryRefUtxo` thật sự mang NFT đó
   *  (GMB-005). Không có nó thì builder chỉ tin lời caller. */
  registryNftPolicyId: string;

  /** Reference input: UTxO mang **kho NFT** — validator đọc địa chỉ kho từ đây (A-DEST
   *  động). Thiếu ⇒ validator crash. */
  khoRefUtxo: UTxO;

  /** policy id kho NFT (hex) — ĐỐI CHIẾU `khoRefUtxo` (GMB-005). GMB-004 so recipient với
   *  `khoRefUtxo.address`; nếu chính khoRefUtxo sai thì phép so đó vô nghĩa. */
  khoNftPolicyId: string;

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

/** Ép UTxO reference thật sự mang ĐÚNG 1 NFT của `policyId` (GMB-005). */
function assertHoldsNft(u: UTxO, policyId: string, label: string): void {
  const qty = Object.entries(u.assets)
    .filter(([unit]) => unit.startsWith(policyId))
    .reduce((s, [, q]) => s + q, 0n);
  if (qty !== 1n) {
    throw new Error(
      `GMB-005: ${label} tại ${u.address} không mang đúng 1 NFT policy ${policyId} ` +
      `(thấy ${qty}). Validator đọc gate qua reference input này — sai UTxO thì tx chắc ` +
      `chắn fail on-chain.`,
    );
  }
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

  // GMB-005 (ref-input thật): ĐỐI CHIẾU hai reference input TRƯỚC GMB-004. GMB-004 so
  // recipient với `khoRefUtxo.address` — nếu chính khoRefUtxo là UTxO sai (vd ví của
  // caller) thì phép so đó tự thoả và guard vô nghĩa. Kiểm NFT trước, so địa chỉ sau.
  assertHoldsNft(p.registryRefUtxo, p.registryNftPolicyId, "registryRefUtxo (WHO-gate)");
  assertHoldsNft(p.khoRefUtxo, p.khoNftPolicyId, "khoRefUtxo (A-DEST)");

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

  // GMB-006 (no-datum = mất tiền): kho là địa chỉ script. Rót vào script KHÔNG datum thì
  // tx VẪN HỢP LỆ (lamp_mint đếm theo payment credential, không nhìn datum) nhưng UTxO
  // sinh ra không ai spend được — `treasury.ak:27 expect Some(datum)` fail — và LAMP không
  // burn được. Đây là ca DUY NHẤT trong builder mà lỗi làm MẤT tiền chứ không phải hỏng tx.
  if (!p.recipientDatum) {
    throw new Error(
      `GMB-006: thiếu recipientDatum. Kho (${p.recipient}) là địa chỉ script — rót LAMP ` +
      `vào script không datum sinh UTxO KHÔNG THỂ SPEND, mà LAMP không burn được ⇒ MẤT ` +
      `VĨNH VIỄN. Cấp inline datum hợp lệ của kho (TreasuryDatum) trước khi mint.`,
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

  // LUÔN ToContract — không còn nhánh ToAddress (xem GMB-006).
  txb = txb.pay.ToContract(
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
