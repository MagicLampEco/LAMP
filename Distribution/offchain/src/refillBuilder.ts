// LampDistribution refillBuilder — gộp N UTxO ở địa chỉ kho về MỘT singleton.
//
// Vì sao nhánh này tồn tại: LAMP rót về kho qua A-DEST hạ cánh thành UTxO RIÊNG, thường
// KHÔNG datum và KHÔNG mang NFT "TRSY". Lúc đó tài sản nằm TRONG SÂN kho mà NGOÀI SỔ kho —
// `claim_account.ak:210-223` đòi đúng một input kho MANG TRSY, nên nhánh Redeem buộc tiêu cái
// vỏ rỗng và giải ngân bằng 0. `Refill` là nhánh DUY NHẤT gộp được hai thứ đó về một chỗ.
//
// CHỈ có chế độ CHỈ-ĐỊNH-TƯỜNG-MINH: caller tự nêu từng UTxO. Cố ý KHÔNG có chế độ tự quét
// địa chỉ kho — ai cũng đỗ được một UTxO ở địa chỉ script (Cardano không chạy validator lúc
// TẠO), nên một UTxO mang datum-hash do người lạ đặt vào sẽ làm `fold_ledger`
// (`treasury.ak:306`) `fail` cho MỌI tx gộp quét-tất-cả. Quét = mời người lạ khoá nhánh này.
//
// Input:   N ≥ 1 UTxO ở địa chỉ kho, spend với Refill redeemer (Constr 2, no fields).
// Output:  ĐÚNG 1 UTxO ở địa chỉ kho, inline TreasuryDatum.
// Mint:    KHÔNG (validator ép `assets.is_zero(tx.mint)`).
// Chữ ký:  committee đạt ngưỡng.
//
// Mệnh đề `treasury.ak` nhánh Refill (`:185-261`) mà builder này phải thoả, theo đúng thứ tự:
//   :192  committee_approved(committee, threshold, extra_signatories)
//   :195  assets.is_zero(tx.mint)
//   :198  count_outputs_at_script == 1
//   :200  output có InlineDatum decode được thành TreasuryDatum
//   :220  ≥1 input mang datum  → ch
//   :221  out_datum.committee_hash == ch
//   :224  out_datum.outstanding_entitlement == Σ ledger_in
//   :231  deposited = lamp_out − lamp_in ≥ 0
//   :232  tre_out.value == value_in + deposited LAMP   (mọi asset khác bảo toàn TUYỆT ĐỐI)
//   :246  out_datum.outstanding_entitlement ≤ lamp_out
// Cộng thêm `fold_ledger` (`:298-320`): input datum-hash → fail; mọi input có datum phải khai
// CÙNG một `committee_hash`.

import {
  Data, toUnit,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import type { TreasuryDatum } from "./types.js";
import {
  decodeTreasuryDatum, treasuryDatumToCbor, refillRedeemerToCbor,
} from "./datum.js";
import { TREASURY_NFT_ASSET_NAME } from "./constants.js";

const DEFAULT_LAMP_ASSET_NAME = "744c414d50"; // "tLAMP" — canonical (khớp Genesis/Faucet)

/** Strip leading 0x + lowercase. */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export interface RefillParams {
  lucid:   LucidEvolution;

  /**
   * CÁC UTxO kho phải gộp — caller CHỈ ĐỊNH TỪNG CÁI, không quét.
   * Mọi phần tử phải ở CÙNG một địa chỉ (xem RFL-002): `treasury.ak:232` ép value bằng nhau
   * theo TỔNG, và địa chỉ ra được mang theo từ input chứ không dựng lại từ script hash.
   */
  treasuryUtxos:  UTxO[];
  treasuryScript: Validator;

  /**
   * Keyhash các thành viên committee sẽ ký tx này. Builder gọi `addSignerKey` cho từng cái —
   * thiếu chữ ký thật thì `complete()` vẫn dựng được nhưng chuỗi TỪ CHỐI, mất collateral.
   */
  committeeSigners: string[];
  /** Ngưỡng committee nướng trong script hash. Dùng để chặn SỚM ở RFL-008. */
  committeeThreshold: number;

  /** LAMP policy + asset-name (apply-param của chính `treasury.ak`). */
  lampPolicyId:   string;
  lampAssetName?: string;

  /**
   * Policy NFT "TRSY". BẮT BUỘC, không mặc định — cùng lý do với `REDEEM-013`:
   * gộp xong mà output KHÔNG mang TRSY thì kho hợp lệ với `treasury.ak` nhưng CHẾT với
   * `claim_account.ak`, và không có gì kêu lên. Xem RFL-005.
   */
  treasuryNftPolicy:     string;
  treasuryNftAssetName?: string;

  /**
   * LAMP nạp THÊM từ ví (oildrop). Mặc định 0 — thuần gộp, không nạp.
   * Phải ≥ 0 (`treasury.ak:231`); ví phải có đủ, nếu không `complete()` ném.
   */
  depositOildrop?: bigint;
}

export interface RefillResult {
  tx:              TxSignBuilder;
  /** Số UTxO kho đã gộp. */
  merged:          number;
  /** LAMP trong kho trước / sau (oildrop). */
  lampBefore:      bigint;
  lampAfter:       bigint;
  /** Lượng nạp thêm — `deposited` ở `treasury.ak:230`. */
  deposited:       bigint;
  newTreasuryDatum: TreasuryDatum;
  /**
   * Σ lovelace mà builder đã TÍNH cho output kho (`mergedAssets.lovelace`). Dùng để đọc lại
   * giao dịch ĐÃ DỰNG sau `complete()` và đối chiếu — xem RFL-010 ở `27_refill_treasury.ts`.
   * Lucid có thể ÂM THẦM nâng lovelace của output lên min-ADA khi bó tài sản gộp mang nhiều
   * loại (`@lucid-evolution/lucid` `Pay.ts ▸ ToAddressWithData`), và `summary` bên dưới in ra
   * đúng con số ĐÃ TÍNH này chứ không phải con số Lucid thật sự DỰNG.
   */
  outputLovelace:  bigint;
  summary:         string;
}

export async function buildRefillTx(params: RefillParams): Promise<RefillResult> {
  const {
    lucid, treasuryUtxos, treasuryScript,
    committeeSigners, committeeThreshold, lampPolicyId,
  } = params;
  const lampAssetName = params.lampAssetName ?? DEFAULT_LAMP_ASSET_NAME;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);
  const nftUnit = toUnit(
    params.treasuryNftPolicy, params.treasuryNftAssetName ?? TREASURY_NFT_ASSET_NAME,
  );
  const deposited = params.depositOildrop ?? 0n;

  // ── RFL-001: phải có input ────────────────────────────────────────────
  if (treasuryUtxos.length === 0) {
    throw new Error("RFL-001: treasuryUtxos rỗng — Refill cần ít nhất 1 UTxO kho.");
  }

  // ── RFL-011: cấm nêu cùng một UTxO hai lần ─────────────────────────────
  // Input của một tx Cardano là một TẬP HỢP: chuỗi chỉ tiêu nó MỘT lần bất kể caller liệt kê
  // bao nhiêu lần, nhưng vòng gộp `mergedAssets` bên dưới cộng theo từng PHẦN TỬ của mảng —
  // nêu trùng thì cộng hai lần trong khi chuỗi chỉ tiêu một lần. `treasury.ak:232` ép value ra
  // == Σ value vào TUYỆT ĐỐI ⇒ tx fail và mất collateral; nếu ví vận hành tình cờ có đủ LAMP dư
  // để `complete()` tự bù chỗ hụt, tx còn lên chuỗi được rồi mới fail — đắt hơn.
  const seenRefs = new Set<string>();
  for (const u of treasuryUtxos) {
    const k = `${normHex(u.txHash)}#${u.outputIndex}`;
    if (seenRefs.has(k)) {
      throw new Error(
        `RFL-011: '${k}' được nêu HAI LẦN trong tập gộp. Chuỗi chỉ tiêu nó một lần; value ra ` +
        `đã cộng theo số lần nêu ⇒ tx fail và mất collateral. Bỏ bản trùng khỏi REFILL_INPUTS.`,
      );
    }
    seenRefs.add(k);
  }

  // ── RFL-002: mọi input CÙNG một địa chỉ ───────────────────────────────
  // `treasury.ak` lọc input theo script hash, nhưng địa chỉ ra được MANG THEO từ input đầu.
  // Trộn hai dạng địa chỉ cùng script hash (enterprise và base) thì output mang một dạng, còn
  // tổng value lấy từ cả hai ⇒ tx vẫn hợp lệ với `treasury.ak` mà kho đổi địa chỉ im lặng,
  // và `claim_account.ak:146` (C-SOLV-5) so CẢ `Address` sẽ từ chối mọi redeem sau đó.
  const treasuryAddress = treasuryUtxos[0]!.address;
  for (const u of treasuryUtxos) {
    if (u.address !== treasuryAddress) {
      throw new Error(
        `RFL-002: các UTxO kho không cùng địa chỉ — '${treasuryAddress}' và '${u.address}'. ` +
        `Cùng script hash vẫn có thể khác địa chỉ (enterprise vs base có stake credential). ` +
        `Gộp chéo hai dạng làm kho đổi địa chỉ im lặng; chọn lại tập input.`,
      );
    }
  }

  // ── RFL-003 / RFL-004 / RFL-006: sổ cái + committee_hash chung (mirror fold_ledger) ──
  let ledgerIn = 0n;
  let committeeHash: string | undefined;
  for (const u of treasuryUtxos) {
    if (u.datumHash && !u.datum) {
      throw new Error(
        `RFL-006: UTxO ${u.txHash}#${u.outputIndex} dùng datum-hash. ` +
        `\`fold_ledger\` (treasury.ak:306) FAIL trên datum-hash — không xác thực được sổ cái. ` +
        `Bỏ UTxO này ra khỏi tập gộp; nó không gộp được bằng bất cứ tx nào.`,
      );
    }
    if (!u.datum) continue;                       // A-DEST hạ cánh: không datum, bỏ qua sổ cái
    let td: TreasuryDatum;
    try {
      td = decodeTreasuryDatum(Data.from(u.datum));
    } catch (e) {
      // RFL-012: một UTxO ở địa chỉ kho mang inline datum nhưng KHÔNG giải mã được thành
      // TreasuryDatum — hình dạng thật của "người lạ đặt rác vào địa chỉ script công khai"
      // (đầu tệp đã cảnh báo). Không bọc thì lỗi ném ra là `DATUM-001` trần trụi, không nói
      // UTxO nào và không nói phải làm gì.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `RFL-012: UTxO ${u.txHash}#${u.outputIndex} mang inline datum không giải mã được ` +
        `thành TreasuryDatum (${msg}). Bỏ UTxO này ra khỏi tập gộp.`,
      );
    }
    const ch = normHex(td.committee_hash);
    if (committeeHash === undefined) committeeHash = ch;
    else if (committeeHash !== ch) {
      throw new Error(
        `RFL-004: hai input khai committee_hash khác nhau ('${committeeHash}' vs '${ch}'). ` +
        `\`fold_ledger\` (treasury.ak:312) ép mọi input có datum phải khai CÙNG một giá trị. ` +
        `Nhiều khả năng đang trộn UTxO của hai lần triển khai khác nhau.`,
      );
    }
    ledgerIn += td.outstanding_entitlement;
  }
  if (committeeHash === undefined) {
    throw new Error(
      "RFL-003: không input nào mang inline TreasuryDatum. `treasury.ak:220` đòi ít nhất một, " +
      "nếu không `committee_hash` của output không ràng vào đâu. Thêm UTxO mang TRSY vào tập gộp.",
    );
  }

  // ── Tổng value vào (mirror `value_in`, treasury.ak:210) ───────────────
  const mergedAssets: Record<string, bigint> = {};
  for (const u of treasuryUtxos) {
    for (const [unit, qty] of Object.entries(u.assets)) {
      mergedAssets[unit] = (mergedAssets[unit] ?? 0n) + qty;
    }
  }
  const lampBefore = mergedAssets[lampUnit] ?? 0n;

  // ── RFL-005: output PHẢI mang đúng 1 TRSY ─────────────────────────────
  // `treasury.ak` không đòi điều này (nó chỉ bảo toàn mọi asset), nhưng `claim_account.ak`
  // đòi. Gộp mà không kéo theo carrier TRSY vào tập input thì tx hợp lệ, lên chuỗi trót lọt,
  // và kho vừa gộp KHÔNG dùng được cho redeem — đúng lớp "vỏ im lặng".
  const nftQty = mergedAssets[nftUnit] ?? 0n;
  if (nftQty !== 1n) {
    throw new Error(
      `RFL-005: tập gộp mang ${nftQty} NFT '${nftUnit}', phải đúng 1. ` +
      `Thiếu ⇒ kho gộp xong không redeem được (claim_account.ak:210-223 đòi input kho mang TRSY). ` +
      `Thừa ⇒ đang trộn hai kho. Đưa ĐÚNG carrier TRSY vào tập input.`,
    );
  }

  // ── RFL-007: deposited ≥ 0 (treasury.ak:231) ──────────────────────────
  if (deposited < 0n) {
    throw new Error(
      `RFL-007: depositOildrop = ${deposited} < 0. ` +
      `\`treasury.ak:231\` ép \`deposited >= 0\` — Refill KHÔNG phải cửa rút.`,
    );
  }
  const lampAfter = lampBefore + deposited;
  if (deposited > 0n) mergedAssets[lampUnit] = lampAfter;

  // ── RFL-009: sổ cái ≤ pool ra (treasury.ak:246) ───────────────────────
  if (ledgerIn > lampAfter) {
    throw new Error(
      `RFL-009: Σ sổ cái nợ = ${ledgerIn} oildrop > pool ra = ${lampAfter} oildrop. ` +
      `\`treasury.ak:246\` (C-SOLV-2 mở rộng) từ chối. Một input đang khai nợ khống, ` +
      `hoặc phải nạp thêm ít nhất ${ledgerIn - lampAfter} oildrop qua depositOildrop.`,
    );
  }

  // ── RFL-008: đủ NGƯỜI ký, không phải đủ PHẦN TỬ danh sách ──────────────
  // `committee_approved` on-chain (`util.ak:96,105`) đếm trên `list.unique(committee)` — thành
  // viên committee PHÂN BIỆT có mặt trong `extra_signatories`. Đếm độ dài mảng truyền vào thì
  // `[A, A]` cũng đạt ngưỡng 2 như `[A, B]` — signer trùng bị tính hai lần, và `treasury.ak:192`
  // từ chối ở đúng ca mà cổng vừa cho qua.
  const signers = [...new Set(committeeSigners.map(normHex))];
  if (signers.length < committeeThreshold) {
    throw new Error(
      `RFL-008: mới có ${signers.length} người ký PHÂN BIỆT (nhận ${committeeSigners.length} ` +
      `khoá), ngưỡng committee là ${committeeThreshold}. \`treasury.ak:192\` từ chối ⇒ mất ` +
      `collateral. Bổ sung keyhash của thành viên KHÁC, không lặp lại khoá đã có.`,
    );
  }

  // ── Datum ra: committee_hash bảo toàn, sổ cái = Σ vào (treasury.ak:221,224) ──
  const newTreasuryDatum: TreasuryDatum = {
    committee_hash:          committeeHash,
    outstanding_entitlement: ledgerIn,
  };

  // ── Build tx ──────────────────────────────────────────────────────────
  // Địa chỉ ra MANG THEO từ input, KHÔNG dựng lại từ script hash — cùng lý do đã ghi ở
  // `redeemBuilder.ts:177-185`.
  let txb = lucid
    .newTx()
    .collectFrom(treasuryUtxos, refillRedeemerToCbor())
    .attach.SpendingValidator(treasuryScript)
    .pay.ToAddressWithData(
      treasuryAddress,
      { kind: "inline", value: treasuryDatumToCbor(newTreasuryDatum) },
      mergedAssets,
    );
  for (const s of signers) txb = txb.addSignerKey(s);

  const tx = await txb.complete();

  const summary = [
    `═══ Refill — gộp kho về singleton ═══`,
    `Địa chỉ kho:    ${treasuryAddress}`,
    `Gộp:            ${treasuryUtxos.length} UTxO → 1`,
    ...treasuryUtxos.map((u) => {
      const l = u.assets[lampUnit] ?? 0n;
      const n = u.assets[nftUnit] ?? 0n;
      return `  · ${u.txHash}#${u.outputIndex}  ${u.assets["lovelace"] ?? 0n} lovelace` +
             `  ${l} oildrop  TRSY×${n}  datum=${u.datum ? "inline" : "không"}`;
    }),
    `committee_hash: ${committeeHash}`,
    `Sổ cái nợ:      ${ledgerIn} oildrop (Σ các input có datum)`,
    `LAMP:           ${lampBefore} → ${lampAfter} oildrop  (nạp thêm ${deposited})`,
    `Người ký:       ${signers.length}/${committeeThreshold} — ${signers.join(", ")}`,
  ].join("\n");

  return {
    tx, merged: treasuryUtxos.length,
    lampBefore, lampAfter, deposited, newTreasuryDatum, summary,
    outputLovelace: mergedAssets["lovelace"] ?? 0n,
  };
}
