// LampDistribution refillBuilder — gộp N UTxO ở địa chỉ kho về MỘT singleton.
//
// Vì sao nhánh này tồn tại: LAMP rót về kho qua A-DEST hạ cánh thành UTxO RIÊNG, thường
// KHÔNG datum và KHÔNG mang NFT "TRSY". Lúc đó tài sản nằm TRONG SÂN kho mà NGOÀI SỔ kho —
// `claim_account.ak` ▸ `find_treasury_in` đòi đúng một input kho MANG TRSY, nên nhánh Redeem
// buộc tiêu cái vỏ rỗng và giải ngân bằng 0. `Refill` là nhánh DUY NHẤT gộp được hai thứ đó.
//
// CHỈ có chế độ CHỈ-ĐỊNH-TƯỜNG-MINH: caller tự nêu từng UTxO. Cố ý KHÔNG tự quét địa chỉ kho —
// ai cũng đỗ được một UTxO ở địa chỉ script (Cardano không chạy validator lúc TẠO), và hai loại
// UTxO người lạ đỗ được vẫn làm hỏng một tx gộp: tài sản trùng TÊN "TRSY" dưới policy khác (chuỗi
// thấy 2 carrier ⇒ từ chối, xem `excluded` bên dưới) và UTxO datum-hash mà provider không có
// preimage (Lucid không lập được witness ⇒ `complete()` ném).
//
// ── Luật sổ cái: SỔ RA = SỔ CỦA CARRIER (C-REF-PROV) ────────────────────────────────────────
// `treasury.ak` nhánh `Refill` đọc sổ qua `fn carrier_ledger`: đúng MỘT input ở địa chỉ kho mang
// tài sản tên "TRSY" (`fn bears_treasury_nft`, nhận theo TÊN, policy bất kỳ, qty == 1); sổ ra
// (`committee_hash`, `outstanding_entitlement`, `total_redeemed`) phải BẰNG sổ của input đó;
// datum mọi input khác bị BỎ QUA (kể cả datum-hash); value mọi input vẫn gộp. Builder này mirror
// đúng luật đó. Trước 2026-09-26 builder cộng TỔNG sổ mọi input có datum (mirror bản validator cũ
// đã bị thay) — với UTxO lạ mang datum khống, tx dựng ra bị chuỗi từ chối, tức người lạ chặn được
// Refill bằng một UTxO rẻ tiền (CONTRACT §4c `RFL-BUILDER-SUM-01`, nay đã đóng).
//
// Mệnh đề nhánh `Refill` mà builder phải thoả (trích theo TÊN, không theo số dòng):
//   util.committee_approved(committee, threshold, extra_signatories)          → RFL-008
//   assets.is_zero(tx.mint)                                                   → không mint
//   KHÔNG input/output nào ở `claim_account_hash` (C-REF-ACC)                 → không đụng tài khoản
//   util.count_outputs_at_script == 1, output InlineDatum → TreasuryDatum     → 1 output inline
//   carrier_ledger: đúng 1 carrier, InlineDatum, cả hai sổ ≥ 0               → RFL-003/004/006/012/013/014
//   out_datum.{committee_hash, outstanding_entitlement, total_redeemed} == carrier
//   deposited = lamp_out − lamp_in ≥ 0                                        → RFL-007
//   tre_out.value == value_in + deposited LAMP (mọi asset khác bảo toàn)      → gộp value
//   out_datum.outstanding_entitlement ≤ lamp_out                              → RFL-009
//
// RFL-005 CHẶT HƠN `treasury.ak`: chuỗi nhận carrier theo TÊN, còn builder đòi carrier mang TRSY
// của ĐÚNG policy thật (`treasuryNftPolicy`), vì `claim_account.ak` tìm kho THUẦN THEO policy đó.

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

/** Độ dài hex của một policy id (28 byte). */
const POLICY_HEX_LEN = 56;

/** Strip leading 0x + lowercase. */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

/**
 * UTxO có mang một tài sản tên `nftAssetName` ("TRSY") dưới một policy KHÁC `nftPolicy` không.
 *
 * `treasury.ak` ▸ `fn bears_treasury_nft` nhận carrier theo TÊN tài sản, không theo policy. Nên
 * một UTxO như vậy, nếu bị gộp cùng carrier thật, làm tập carrier trên chuỗi có 2 phần tử ⇒
 * `carrier_ledger` (`expect [carrier]`) từ chối cả giao dịch. Builder loại nó khỏi tập gộp.
 * Loại theo MỌI số lượng (không chỉ qty == 1): qty ≠ 1 thì chuỗi không coi là carrier, nhưng
 * gộp vào thì kho thật mang theo rác trùng tên mãi mãi — không có lý do gì để nhận.
 */
export function bearsForeignTreasuryName(
  u: UTxO, nftPolicy: string, nftAssetName: string = TREASURY_NFT_ASSET_NAME,
): boolean {
  const pol = normHex(nftPolicy);
  const name = normHex(nftAssetName);
  for (const unit of Object.keys(u.assets)) {
    if (unit === "lovelace" || unit.length <= POLICY_HEX_LEN) continue;
    const p = unit.slice(0, POLICY_HEX_LEN).toLowerCase();
    const n = unit.slice(POLICY_HEX_LEN).toLowerCase();
    if (n === name && p !== pol) return true;
  }
  return false;
}

export interface RefillParams {
  lucid:   LucidEvolution;

  /**
   * CÁC UTxO kho phải gộp — caller CHỈ ĐỊNH TỪNG CÁI, không quét.
   * Mọi phần tử phải ở CÙNG một địa chỉ (xem RFL-002): `treasury.ak` nhánh `Refill` ép value ra
   * bằng TỔNG value vào, và địa chỉ ra được mang theo từ input chứ không dựng lại từ script hash.
   * Phần tử mang tài sản tên "TRSY" dưới policy KHÁC bị loại khỏi tập gộp (xem `excluded`).
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
   * Policy NFT "TRSY" THẬT (`treasury_nft`, one-shot). BẮT BUỘC, không mặc định — dùng để
   * (a) nhận carrier đúng policy, (b) loại UTxO mang TRSY giả, (c) RFL-005.
   */
  treasuryNftPolicy:     string;
  treasuryNftAssetName?: string;

  /**
   * LAMP nạp THÊM từ ví (oildrop). Mặc định 0 — thuần gộp, không nạp.
   * Phải ≥ 0 (`treasury.ak` nhánh `Refill`, `deposited >= 0`); ví phải có đủ, nếu không
   * `complete()` ném.
   */
  depositOildrop?: bigint;
}

export interface RefillExcluded {
  /** `<txHash>#<outputIndex>` */
  ref:    string;
  reason: string;
}

export interface RefillResult {
  tx:              TxSignBuilder;
  /** Số UTxO kho ĐÃ gộp (sau khi loại `excluded`). */
  merged:          number;
  /**
   * UTxO caller nêu nhưng builder KHÔNG gộp, kèm lý do. Không rỗng thì value của chúng nằm lại
   * ở địa chỉ kho — in ra, đừng nuốt (cũng có trong `summary`).
   */
  excluded:        RefillExcluded[];
  /** LAMP trong kho trước / sau (oildrop), tính trên tập ĐÃ gộp. */
  lampBefore:      bigint;
  lampAfter:       bigint;
  /** Lượng nạp thêm — `deposited` của nhánh `Refill`. */
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
  const nftAssetName = params.treasuryNftAssetName ?? TREASURY_NFT_ASSET_NAME;
  const nftUnit = toUnit(params.treasuryNftPolicy, nftAssetName);
  const deposited = params.depositOildrop ?? 0n;
  const refOf = (u: UTxO) => `${u.txHash}#${u.outputIndex}`;

  // ── RFL-001: phải có input ────────────────────────────────────────────
  if (treasuryUtxos.length === 0) {
    throw new Error("RFL-001: treasuryUtxos rỗng — Refill cần ít nhất 1 UTxO kho.");
  }

  // ── RFL-011: cấm nêu cùng một UTxO hai lần ─────────────────────────────
  // Input của một tx Cardano là một TẬP HỢP: chuỗi chỉ tiêu nó MỘT lần bất kể caller liệt kê
  // bao nhiêu lần, nhưng vòng gộp `mergedAssets` bên dưới cộng theo từng PHẦN TỬ của mảng —
  // nêu trùng thì cộng hai lần trong khi chuỗi chỉ tiêu một lần. Nhánh `Refill` ép value ra
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
  // và `claim_account.ak` (C-SOLV-5) so CẢ `Address` sẽ từ chối mọi redeem sau đó.
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

  // ── Phân loại input: carrier · loại bỏ · gộp thường ─────────────────────
  // carrier  = mang ĐÚNG 1 NFT TRSY của policy THẬT (mirror `bears_treasury_nft` qty == 1).
  // loại bỏ  = không phải carrier và mang tài sản tên TRSY dưới policy KHÁC — gộp vào thì chuỗi
  //            thấy 2 carrier ⇒ `carrier_ledger` từ chối ⇒ người lạ chặn được Refill.
  // còn lại  = gộp value, BỎ QUA datum (inline, datum-hash, rác, khống — không số nào đi vào sổ).
  const carriers: UTxO[] = [];
  const collected: UTxO[] = [];
  const excluded: RefillExcluded[] = [];
  for (const u of treasuryUtxos) {
    const isCarrier = (u.assets[nftUnit] ?? 0n) === 1n;
    if (!isCarrier && bearsForeignTreasuryName(u, params.treasuryNftPolicy, nftAssetName)) {
      excluded.push({
        ref: refOf(u),
        reason: `mang tài sản tên TRSY dưới policy KHÁC '${normHex(params.treasuryNftPolicy)}' — ` +
          `chuỗi nhận carrier theo TÊN nên gộp vào là 2 carrier ⇒ từ chối`,
      });
      continue;
    }
    if (isCarrier) carriers.push(u);
    collected.push(u);
  }

  // ── RFL-003: phải có carrier ─────────────────────────────────────────
  // `carrier_ledger` `expect [carrier]`: 0 carrier ⇒ từ chối. (Trước 2026-09-26 mã này nghĩa là
  // "không input nào mang inline datum" — mirror bản TỔNG đã bị thay.)
  if (carriers.length === 0) {
    throw new Error(
      `RFL-003: không input nào mang NFT kho '${nftUnit}' (policy thật). \`treasury.ak\` ▸ ` +
      `\`carrier_ledger\` đòi ĐÚNG MỘT carrier — sổ cái ra chỉ lấy từ nó. Thêm UTxO mang TRSY ` +
      `vào tập gộp.`,
    );
  }
  // ── RFL-004: không quá một carrier ────────────────────────────────────
  // One-shot policy nói trạng thái này không thể có; gặp thì state đang lỗi hoặc đang trộn hai
  // lần triển khai. `carrier_ledger` từ chối ≥2 carrier. (Trước 2026-09-26 mã này nghĩa là "hai
  // input khai committee_hash khác nhau" — vô nghĩa khi chỉ còn MỘT datum được đọc.)
  if (carriers.length > 1) {
    throw new Error(
      `RFL-004: ${carriers.length} input cùng mang NFT kho '${nftUnit}' ` +
      `(${carriers.map(refOf).join(", ")}). \`carrier_ledger\` đòi ĐÚNG MỘT carrier; policy ` +
      `one-shot nói hai carrier là không thể — state đang lỗi, DỪNG và đối chiếu chuỗi.`,
    );
  }
  const carrier = carriers[0]!;

  // ── RFL-006: carrier phải mang INLINE datum ──────────────────────────
  // `carrier_ledger` `expect InlineDatum(d) = carrier.output.datum`. Datum-hash (kể cả khi đã
  // resolve được preimage) hay không datum ⇒ chuỗi từ chối. CHỈ áp cho carrier: datum-hash của
  // input KHÁC thì chuỗi bỏ qua (Lucid vẫn cần preimage để lập witness — không có thì
  // `complete()` ném, không mất collateral).
  if (carrier.datumHash || !carrier.datum) {
    throw new Error(
      `RFL-006: carrier ${refOf(carrier)} ${carrier.datumHash ? "dùng datum-hash" : "không mang datum"}. ` +
      `\`carrier_ledger\` đòi INLINE datum — không có đường nào gộp được kho này bằng Refill.`,
    );
  }

  // ── RFL-012: datum carrier phải giải mã được thành TreasuryDatum ────────
  // `carrier_ledger` `expect td: TreasuryDatum = d`. Không bọc thì lỗi ném ra là `DATUM-0xx`
  // trần trụi, không nói UTxO nào. Datum rác của input KHÁC carrier thì chuỗi bỏ qua ⇒ builder
  // cũng bỏ qua, không giải mã.
  let carrierDatum: TreasuryDatum;
  try {
    carrierDatum = decodeTreasuryDatum(Data.from(carrier.datum));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `RFL-012: carrier ${refOf(carrier)} mang inline datum không giải mã được thành ` +
      `TreasuryDatum (${msg}). \`carrier_ledger\` từ chối — kho này không gộp được.`,
    );
  }

  // ── RFL-013 / RFL-014: hai trường sổ của carrier không âm (C-REF-SIGN) ──
  // Mirror `carrier_ledger` `td.outstanding_entitlement >= 0` / `td.total_redeemed >= 0`.
  // Trước 2026-09-26 hai cổng này CHẶT HƠN chuỗi và áp cho MỌI input có datum (chuỗi cũ cộng
  // từng số hạng không kiểm dấu). Nay chuỗi ép đúng điều đó trên carrier, và số của input khác
  // không đi vào sổ ở BẤT KỲ dấu nào ⇒ hai cổng chỉ còn áp cho carrier.
  if (carrierDatum.outstanding_entitlement < 0n) {
    throw new Error(
      `RFL-013: carrier ${refOf(carrier)} khai outstanding_entitlement = ` +
      `${carrierDatum.outstanding_entitlement} < 0. \`carrier_ledger\` (C-REF-SIGN) từ chối.`,
    );
  }
  if (carrierDatum.total_redeemed < 0n) {
    throw new Error(
      `RFL-014: carrier ${refOf(carrier)} khai total_redeemed = ` +
      `${carrierDatum.total_redeemed} < 0. \`carrier_ledger\` (C-REF-SIGN) từ chối.`,
    );
  }

  // ── Tổng value vào (mirror `value_in` của nhánh `Refill`) ───────────────
  const mergedAssets: Record<string, bigint> = {};
  for (const u of collected) {
    for (const [unit, qty] of Object.entries(u.assets)) {
      mergedAssets[unit] = (mergedAssets[unit] ?? 0n) + qty;
    }
  }
  const lampBefore = mergedAssets[lampUnit] ?? 0n;

  // ── RFL-005: output PHẢI mang đúng 1 TRSY của policy thật ──────────────
  // `treasury.ak` không đòi điều này (nó chỉ bảo toàn mọi asset), nhưng `claim_account.ak`
  // (`find_treasury_in`/`find_treasury_out`) đòi. Lớp phòng thủ sau RFL-003/004: bắt ca một
  // input mang TRSY thật với số lượng ≠ 1 (không phải carrier, nhưng làm output lệch).
  const nftQty = mergedAssets[nftUnit] ?? 0n;
  if (nftQty !== 1n) {
    throw new Error(
      `RFL-005: tập gộp mang ${nftQty} NFT '${nftUnit}', phải đúng 1. ` +
      `Kho gộp xong phải redeem được (claim_account.ak ▸ find_treasury_in đòi input kho mang TRSY). ` +
      `Đưa ĐÚNG carrier TRSY vào tập input.`,
    );
  }

  // ── RFL-007: deposited ≥ 0 ────────────────────────────────────────────
  if (deposited < 0n) {
    throw new Error(
      `RFL-007: depositOildrop = ${deposited} < 0. ` +
      `Nhánh \`Refill\` ép \`deposited >= 0\` — Refill KHÔNG phải cửa rút.`,
    );
  }
  const lampAfter = lampBefore + deposited;
  if (deposited > 0n) mergedAssets[lampUnit] = lampAfter;

  // ── RFL-009: sổ nợ CARRIER ≤ pool ra ────────────────────────────────────
  // Mirror `out_datum.outstanding_entitlement <= lamp_out`; out = sổ carrier.
  if (carrierDatum.outstanding_entitlement > lampAfter) {
    throw new Error(
      `RFL-009: sổ nợ carrier = ${carrierDatum.outstanding_entitlement} oildrop > pool ra = ` +
      `${lampAfter} oildrop. Nhánh \`Refill\` (C-SOLV-2 mở rộng) từ chối. Nạp thêm ít nhất ` +
      `${carrierDatum.outstanding_entitlement - lampAfter} oildrop qua depositOildrop, hoặc ` +
      `gộp thêm UTxO mang LAMP.`,
    );
  }

  // ── RFL-008: đủ NGƯỜI ký, không phải đủ PHẦN TỬ danh sách ──────────────
  // `util.committee_approved` on-chain đếm trên `list.unique(committee)` — thành viên committee
  // PHÂN BIỆT có mặt trong `extra_signatories`. Đếm độ dài mảng truyền vào thì `[A, A]` cũng đạt
  // ngưỡng 2 như `[A, B]` — signer trùng bị tính hai lần, và chuỗi từ chối ở đúng ca mà cổng
  // vừa cho qua.
  const signers = [...new Set(committeeSigners.map(normHex))];
  if (signers.length < committeeThreshold) {
    throw new Error(
      `RFL-008: mới có ${signers.length} người ký PHÂN BIỆT (nhận ${committeeSigners.length} ` +
      `khoá), ngưỡng committee là ${committeeThreshold}. \`util.committee_approved\` từ chối ⇒ ` +
      `mất collateral. Bổ sung keyhash của thành viên KHÁC, không lặp lại khoá đã có.`,
    );
  }

  // ── Datum ra = sổ CARRIER, nguyên cả ba trường (C-REF-PROV + C-REF-TOTAL) ──
  const newTreasuryDatum: TreasuryDatum = {
    committee_hash:          carrierDatum.committee_hash,
    outstanding_entitlement: carrierDatum.outstanding_entitlement,
    total_redeemed:          carrierDatum.total_redeemed,
  };

  // ── Build tx ──────────────────────────────────────────────────────────
  // Địa chỉ ra MANG THEO từ input, KHÔNG dựng lại từ script hash — cùng lý do đã ghi ở
  // `redeemBuilder.ts` (địa chỉ kho mang theo stake credential).
  let txb = lucid
    .newTx()
    .collectFrom(collected, refillRedeemerToCbor())
    .attach.SpendingValidator(treasuryScript)
    .pay.ToAddressWithData(
      treasuryAddress,
      { kind: "inline", value: treasuryDatumToCbor(newTreasuryDatum) },
      mergedAssets,
    );
  for (const s of signers) txb = txb.addSignerKey(s);

  const tx = await txb.complete();

  const shape = (u: UTxO) =>
    u.datumHash ? "datum-hash" : u.datum ? "inline" : "không";
  const summary = [
    `═══ Refill — gộp kho về singleton ═══`,
    `Địa chỉ kho:    ${treasuryAddress}`,
    `Gộp:            ${collected.length} UTxO → 1`,
    ...collected.map((u) => {
      const l = u.assets[lampUnit] ?? 0n;
      const n = u.assets[nftUnit] ?? 0n;
      return `  · ${refOf(u)}  ${u.assets["lovelace"] ?? 0n} lovelace` +
             `  ${l} oildrop  TRSY×${n}  datum=${shape(u)}${u === carrier ? "  ← carrier (nguồn sổ)" : ""}`;
    }),
    ...(excluded.length
      ? [`KHÔNG gộp:      ${excluded.length} UTxO (value nằm lại ở địa chỉ kho)`,
         ...excluded.map((x) => `  · ${x.ref}  — ${x.reason}`)]
      : []),
    `committee_hash: ${carrierDatum.committee_hash}`,
    `Sổ cái nợ:      ${carrierDatum.outstanding_entitlement} oildrop (= sổ carrier; datum input khác bỏ qua)`,
    `Đã phát ra:     ${carrierDatum.total_redeemed} oildrop (= sổ carrier)`,
    `LAMP:           ${lampBefore} → ${lampAfter} oildrop  (nạp thêm ${deposited})`,
    `Người ký:       ${signers.length}/${committeeThreshold} — ${signers.join(", ")}`,
  ].join("\n");

  return {
    tx, merged: collected.length, excluded,
    lampBefore, lampAfter, deposited, newTreasuryDatum, summary,
    outputLovelace: mergedAssets["lovelace"] ?? 0n,
  };
}
