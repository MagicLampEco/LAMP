// LAMP Genesis mintBuilder — dựng tx LAZY-MINT LAMP (CONTRACT §5; lamp_mint.ak).
//
// ⚠ HAI BẢN `lamp_mint` CÙNG TỒN TẠI — builder này phục vụ CẢ HAI, tách theo
// `mintParamCount`. Đừng gộp lại: chúng khác nhau ở chỗ tốn tiền nhất.
//
//   • **8 tham số (bản mồi) — ĐANG CHẠY TRÊN MAINNET**, policy
//     `55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0`
//     (`offchain/src/deployed.ts:63,65`). WHO-gate = danh sách pkh NƯỚNG SẴN vào tham số,
//     kiểm bằng `extra_signatories`; A-DEST = `dist_dest` NƯỚNG SẴN (script hash kho).
//     Validator **KHÔNG đọc reference input nào** (`457f312:.../lamp_mint.ak:169-172`).
//     Dưới policy đó KHÔNG TỒN TẠI registry UTxO nào để mà đọc.
//   • **12 tham số (registry-gate, bản B) — CHƯA TỪNG DEPLOY**, là bản ở HEAD
//     (`onchain/validators/lamp_mint.ak:59-72`). WHO-gate đọc **registry NFT**, A-DEST đọc
//     **kho NFT**, cả hai qua `tx.reference_inputs` ⇒ hai ref-input BẮT BUỘC.
//
//   Hai bản có **policy-id KHÁC NHAU** — chúng là hai token, không phải hai phiên bản của
//   một token. Gọi nhầm nhánh không sinh tx sai, nó sinh tx CHẮC CHẮN FAIL: nhánh 12 gắn
//   ref-input vào tx tiêu policy 8 tham số thì validator 8 tham số bỏ qua ref-input, nhưng
//   chỗ gọi lại phải bịa ra registry/kho UTxO không tồn tại để thoả kiểu ⇒ bế tắc ở
//   offchain. Trước bản vá 2026-08-16 builder chỉ có nhánh 12, tức nó **chắn ngang đường
//   đúc LAMP thật trên mainnet**.
//
// Flow (khớp luật onchain):
//   - Input:  SupplyState UTxO (mang thread NFT) — spend redeemer Advance.
//   - Mint:   Δ oildrop LAMP qua policy lamp_mint, redeemer DistributionVest|ReserveDraw.
//   - Output: SupplyState' tại CÙNG script address, mang lại thread NFT, datum cập nhật
//             (dist_minted hoặc reserve_minted += Δ); + Δ tLAMP trả `recipient`.
//   - Ref:    CHỈ nhánh 12 tham số — registry UTxO (mang registry NFT) + kho UTxO (mang kho
//             NFT). Nhánh 8 tham số KHÔNG có reference input (validator không đọc).
//   - Sign:   nhánh 12: authority mà RegistryDatum chỉ định cho `token_tag`;
//             nhánh 8: pkh trong `dist_authority` nướng sẵn (extra_signatories).
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
// ⚠ VÁ TIẾP 2026-08-16 — TÁCH NHÁNH THEO `mintParamCount` (xem đầu tệp). Guard mới:
//   GMB-007 — nhánh 8 tham số nhận `registryRefUtxo`/`khoRefUtxo`/policy-id của chúng thì
//     NÉM, không im lặng bỏ qua. Truyền được chúng nghĩa là chỗ gọi đang tin có một registry
//     dưới policy 8 tham số — niềm tin đó sai, và nếu để builder lặng lẽ nuốt thì cái sai ấy
//     đi tiếp vào tài liệu/tích hợp. Kiểu TS đã chặn (`?: never`); guard này bắt đường JS
//     thuần và mọi chỗ ép kiểu bằng `as`.
//   GMB-008 — `mintParamCount` thiếu hoặc không thuộc {8, 12}. Fail-closed: builder KHÔNG
//     đoán bản validator, vì đoán sai = dựng tx cho sai policy.
//   GMB-009 — nhánh 8 tham số thiếu `distDestAddress`. Không có ref-input để đọc A-DEST
//     động, nên không có nó thì GMB-004 mất chỗ đối chiếu và A-DEST không còn ai canh.
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

/** Phần tham số CHUNG cho cả hai bản validator. */
export interface MintParamsCommon {
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
   *  A-DEST (DistributionVest): PHẢI là địa chỉ KHO. Nhánh 12 tham số: chính địa chỉ đang
   *  giữ `khoRefUtxo` (đọc động). Nhánh 8 tham số: `distDestAddress` (nướng vào policy).
   *  Rót về ví cá nhân thì validator reject (qty_to_script < Δ). Builder ĐỐI CHIẾU điều này
   *  trước khi build (GMB-004) thay vì để hỏng trên chuỗi. */
  recipient: string;

  /** Inline datum đặt kèm output kho (hex CBOR). **BẮT BUỘC ở CẢ HAI NHÁNH.**
   *
   *  Nhánh 12 tham số — đây là ca MẤT TIỀN: kho là `treasury.ak`, mà rót vào script KHÔNG
   *  datum thì `treasury.ak:27 expect Some(datum)` fail ⇒ UTxO không spend được, LAMP
   *  no-burn ⇒ MẤT VĨNH VIỄN. Tx vẫn HỢP LỆ khi thiếu datum (validator đếm theo payment
   *  credential, không nhìn datum) nên chuỗi KHÔNG cứu được — phải chặn ở đây.
   *
   *  Nhánh 8 tham số — kho mainnet là `dist_treasury`, nhận `_datum: Option<Data>`
   *  (`Genesis/onchain/validators/dist_treasury.ak:16`) nên KHÔNG đòi datum và cũng KHÔNG
   *  từ chối datum. Vẫn giữ BẮT BUỘC: một luật cho cả hai nhánh, và đường mặc định không
   *  bao giờ là đường mất tiền. Datum đơn vị `"d87980"` là đủ. */
  recipientDatum: string;

  /** Keyhash authority phải ký (đúng đường mint) — addSigner để Lucid đòi chữ ký.
   *  Nhánh 12: khớp `Authority` mà RegistryDatum gán cho `token_tag`.
   *  Nhánh 8: khớp `dist_authority` nướng sẵn (mainnet: đúng MỘT pkh, threshold 1). */
  authoritySigners: string[];

  /** min-ADA giữ ở SupplyState output (mặc định 2 tADA). */
  supplyMinAda?: bigint;
}

/**
 * Tham số cho bản **12 tham số** (registry-gate, CHƯA deploy). Hai reference input là hợp
 * đồng gọi BẮT BUỘC — validator đọc WHO-gate và A-DEST qua `tx.reference_inputs`.
 */
export interface MintParamsV12 extends MintParamsCommon {
  mintParamCount: 12;

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

  /** Nhánh 12 đọc A-DEST động từ `khoRefUtxo` — CẤM truyền địa chỉ tĩnh (GMB-007). */
  distDestAddress?: never;
}

/**
 * Tham số cho bản **8 tham số** (bản mồi — ĐANG CHẠY MAINNET). KHÔNG reference input:
 * validator không đọc cái nào, và dưới policy đó không tồn tại registry UTxO để mà đọc.
 * Bốn trường ref-input bị CẤM (`?: never` ⇒ lỗi biên dịch; GMB-007 ⇒ lỗi runtime).
 */
export interface MintParamsV8 extends MintParamsCommon {
  mintParamCount: 8;

  /** Địa chỉ KHO tương ứng `dist_dest` NƯỚNG SẴN trong policy — A-DEST tĩnh. Builder so
   *  `recipient` với nó (GMB-004). Mainnet: đọc `deployedLamp("mainnet").khoAddress`
   *  (`deployed.ts:69`), ĐỪNG gõ tay. */
  distDestAddress: string;

  registryRefUtxo?: never;
  registryNftPolicyId?: never;
  khoRefUtxo?: never;
  khoNftPolicyId?: never;
}

/**
 * Hợp đồng gọi `buildMintTx` — union phân biệt theo `mintParamCount`. Gọi sai nhánh là
 * LỖI BIÊN DỊCH: nhánh 8 khai bốn trường ref-input là `never`, nhánh 12 khai
 * `distDestAddress` là `never`.
 */
export type MintParams = MintParamsV8 | MintParamsV12;

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

/** Bốn trường CHỈ có nghĩa ở bản 12 tham số. Truyền vào nhánh 8 ⇒ GMB-007. */
const FORBIDDEN_IN_V8 = [
  "registryRefUtxo", "registryNftPolicyId", "khoRefUtxo", "khoNftPolicyId",
] as const;

/**
 * Dựng tx lazy-mint. Tính SupplyState' qua applyMint (ép cap/quota/Δ>0 fail-fast),
 * rồi build: spend SupplyState (Advance) + mint Δ tLAMP (route) + recreate SupplyState'
 * + trả Δ tLAMP cho recipient + addSigner(authority).
 *
 * Hình dạng tx KHÁC NHAU theo `mintParamCount`:
 *   - 12: có `.readFrom([registryRefUtxo, khoRefUtxo])` (validator đọc WHO-gate + A-DEST);
 *   -  8: KHÔNG có reference input nào (validator không đọc).
 */
export async function buildMintTx(p: MintParams): Promise<{
  tx: TxSignBuilder;
  nextState: SupplyState;
}> {
  const minAda = p.supplyMinAda ?? 2_000_000n;

  // ── GMB-008 (fail-closed): KHÔNG đoán bản validator ────────────────────────
  // Không mặc định về 12. Hai bản có policy-id khác nhau; đoán sai là dựng tx cho sai
  // token, và LAMP không burn được nên sai không sửa được.
  if (p.mintParamCount !== 8 && p.mintParamCount !== 12) {
    throw new Error(
      `GMB-008: mintParamCount phải là 8 (bản mồi ĐANG CHẠY mainnet) hoặc 12 ` +
      `(registry-gate, chưa deploy), nhận ${String((p as { mintParamCount?: unknown }).mintParamCount)}. ` +
      `Đọc số này từ 'deployedLamp(network).mintParamCount', đừng đoán.`,
    );
  }

  // ── GMB-007: nhánh 8 KHÔNG được nhận ref-input ─────────────────────────────
  // Kiểu TS đã chặn; đây là lưới cho JS thuần và mọi chỗ ép kiểu bằng `as`. Ném chứ không
  // im lặng bỏ qua: truyền được registry/kho nghĩa là chỗ gọi tin dưới policy 8 tham số có
  // một registry — niềm tin đó SAI, và nuốt lặng thì nó đi tiếp vào tài liệu và tích hợp.
  if (p.mintParamCount === 8) {
    const forbidden = FORBIDDEN_IN_V8.filter(
      (k) => (p as unknown as Record<string, unknown>)[k] !== undefined,
    );
    if (forbidden.length > 0) {
      throw new Error(
        `GMB-007: nhánh 8 tham số nhận trường CẤM [${forbidden.join(", ")}]. Bản mồi đang chạy ` +
        `mainnet KHÔNG đọc reference input nào (457f312:lamp_mint.ak:169-172) và dưới policy ` +
        `đó KHÔNG TỒN TẠI registry UTxO. Muốn dùng registry-gate thì đó là policy-id KHÁC — ` +
        `chuyển sang mintParamCount: 12, đừng nhét ref-input vào bản 8.`,
      );
    }
  }

  const sIn = readSupplyState(p.supplyUtxo);
  // Fail-fast offchain: ép đúng luật onchain TRƯỚC khi tốn phí.
  const sOut = applyMint(sIn, p.route, p.amount);

  const tlampUnit = toUnit(p.tlampPolicyId, p.tokenName);
  const mintAssets: Assets = { [tlampUnit]: p.amount };

  // ── A-DEST: nguồn sự thật khác nhau giữa hai bản ───────────────────────────
  // 12: đọc ĐỘNG từ UTxO mang kho-NFT ⇒ phải kiểm chính UTxO đó trước (GMB-005).
  //  8: `dist_dest` NƯỚNG vào policy ⇒ không có gì để kiểm NFT; caller cấp địa chỉ tương
  //     ứng hash đã nướng (lấy từ `deployed.ts`, không gõ tay).
  let khoAddress: string;
  if (p.mintParamCount === 12) {
    // GMB-005 (ref-input thật): ĐỐI CHIẾU hai reference input TRƯỚC GMB-004. GMB-004 so
    // recipient với `khoRefUtxo.address` — nếu chính khoRefUtxo là UTxO sai (vd ví của
    // caller) thì phép so đó tự thoả và guard vô nghĩa. Kiểm NFT trước, so địa chỉ sau.
    assertHoldsNft(p.registryRefUtxo, p.registryNftPolicyId, "registryRefUtxo (WHO-gate)");
    assertHoldsNft(p.khoRefUtxo, p.khoNftPolicyId, "khoRefUtxo (A-DEST)");
    khoAddress = p.khoRefUtxo.address;
  } else {
    if (!p.distDestAddress) {
      throw new Error(
        `GMB-009: nhánh 8 tham số thiếu distDestAddress. A-DEST của bản mồi là hash ` +
        `dist_dest NƯỚNG SẴN trong policy — builder không suy ra được từ tx. Lấy từ ` +
        `'deployedLamp("mainnet").khoAddress' (deployed.ts:69).`,
      );
    }
    khoAddress = p.distDestAddress;
  }

  // GMB-004 (A-DEST): validator ép toàn bộ Δ rót vào kho. Nếu recipient khác địa chỉ đó thì
  // `qty_to_script < Δ` ⇒ reject. Bắt ở đây, trước khi tốn phí — và quan trọng hơn: trước
  // khi ai đó tưởng mint thành công rồi đi tìm LAMP ở sai chỗ.
  if (p.recipient !== khoAddress) {
    throw new Error(
      `GMB-004: recipient (${p.recipient}) KHÁC địa chỉ kho A-DEST (${khoAddress}). ` +
      `DistributionVest bắt buộc rót toàn bộ LAMP vào kho — validator sẽ từ chối tx này.`,
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
    .attach.MintingPolicy(p.tlampPolicy);

  // Reference input CHỈ ở bản 12 tham số: WHO-gate (registry) + A-DEST (kho) — validator
  // đọc cả hai qua `tx.reference_inputs`. Bản 8 tham số không đọc cái nào; gắn thêm ref-input
  // ở đó là rác làm phình tx, và tệ hơn: nó ngụ ý một registry không hề tồn tại.
  if (p.mintParamCount === 12) {
    txb = txb.readFrom([p.registryRefUtxo, p.khoRefUtxo]);
  }

  txb = txb.pay.ToContract(
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
