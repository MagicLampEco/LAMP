// LampDistribution fundPotBuilder — rót trọn một phân bổ từ kho Treasury vào một pot script.
// Spec: `Distribution/FundPot.md` v1.0. Validator: `treasury.ak` nhánh `FundPot`.
//
// Mệnh đề on-chain mà builder phải thoả (trích theo TÊN, không theo số dòng):
//   FP-1 util.committee_approved(committee, threshold, extra_signatories)        → FPB-009
//   FP-2 đúng 1 input ở script kho; `count_named(value, "TREASURY") == 1`        → FPB-007
//   FP-3 đúng 1 output ở script kho, ĐÚNG địa chỉ vào, inline datum == datum vào,
//        lovelace ra ≥ lovelace vào                                               → carrier ra dựng lại từ carrier vào
//   FP-4 funded = lamp_in − lamp_out > 0; ngoài ADA chỉ LAMP của carrier đổi     → FPB-001/008
//   FP-5 `pot_lamp_total`: output mang LAMP ngoài carrier ⇒ Script, ≠ kho, ≠ claim_account,
//        inline datum; tổng == funded                                             → FPB-004/005/006, FPB-010 (đọc lại)
//   FP-6 outstanding_entitlement ≤ lamp_out                                       → FPB-008
//   FP-7 `assets.is_zero(tx.mint)`                                                → builder không mint
//
// Ràng buộc CHỈ off-chain (chặt hơn chuỗi, có chủ đích):
//   • FPB-001 lượng rót == ngân sách pot trong sổ `pots.ts` (nguồn `Papers/pot-catalog.md` §1)
//     trừ phần đã rót ở lượt mồi; riêng lượt mồi rót đúng một suất D. Chuỗi KHÔNG ép số phân bổ
//     (`FundPot.md` §"Đúng số phân bổ…"), nên đây là chỗ DUY NHẤT nó được ép — ném nếu lệch.
//   • FPB-003 mỗi output pot ≥ D VÀ là BỘI của D (D = một suất của pot; Wakeme xác nhận
//     2026-10-03). Dịch vụ phát của pot chọn MỘT UTxO kho mỗi lượt và trả đúng D — output lẻ
//     suất để lại phần dư không ai rút được.
//   • FPB-010 `fundPotOutputFailures` đọc lại giao dịch ĐÃ DỰNG: Lucid tự chọn UTxO ví để trả
//     phí, và nếu UTxO đó mang LAMP thì tiền thối (địa chỉ VK) mang LAMP ⇒ FP-5a từ chối. Builder
//     không tính trước được, nên runner phải đọc lại trước khi ký.

import {
  Data, toUnit, getAddressDetails, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";

import type { TreasuryDatum } from "./types.js";
import { decodeTreasuryDatum, fundPotRedeemerToCbor } from "./datum.js";
import { TREASURY_NFT_ASSET_NAME } from "./constants.js";
import { potBudgetOildrop, type PotId } from "./pots.js";

const DEFAULT_LAMP_ASSET_NAME = "744c414d50"; // "tLAMP"
const POLICY_HEX_LEN = 56;
const DEFAULT_POT_LOVELACE = 2_000_000n;

const normHex = (h: string) => h.trim().toLowerCase().replace(/^0x/, "");

export interface FundPotTarget {
  /** Địa chỉ pot (bech32). Payment credential phải là Script, hash == `scriptHash`. */
  address:    string;
  /** Script hash của pot — khai lần hai để đối chiếu với hash nằm trong `address`. */
  scriptHash: string;
  /** Datum inline của mọi output pot (CBOR Plutus Data, hex). Ví dụ Wakeme: `4100`. */
  datumCbor:  string;
}

/**
 * Chia `amount` thành `k` output, mỗi output là bội của `share` và ≥ `share`. Số suất
 * n = amount / share chia đều, `n mod k` output đầu nhận thêm một suất. Ném nếu không chia được.
 */
export function splitPotOutputs(amount: bigint, share: bigint, k: number): bigint[] {
  if (!Number.isInteger(k) || k < 1) throw new Error(`FPB-002: số output pot K=${k} phải là số nguyên ≥ 1.`);
  if (share <= 0n) throw new Error(`FPB-003: suất pot D=${share} phải > 0.`);
  if (amount % share !== 0n) {
    throw new Error(`FPB-003: lượng rót ${amount} không phải bội của suất D=${share} (dư ${amount % share}).`);
  }
  const n = amount / share;
  const kk = BigInt(k);
  if (n < kk) throw new Error(`FPB-003: ${n} suất không đủ chia cho K=${k} output (mỗi output ≥ D).`);
  const base = n / kk;
  const extra = n % kk;
  return Array.from({ length: k }, (_, i) => (base + (BigInt(i) < extra ? 1n : 0n)) * share);
}

/**
 * Soát danh sách lượng cho K output pot: K ≥ 1, mỗi phần tử ≥ D và là bội của D, tổng == amount.
 * Thuần, không mạng — runner gọi được trước khi dựng.
 */
export function assertPotOutputAmounts(amounts: bigint[], amount: bigint, share: bigint): void {
  if (amounts.length < 1) throw new Error(`FPB-002: danh sách output pot rỗng — cần K ≥ 1.`);
  if (share <= 0n) throw new Error(`FPB-003: suất pot D=${share} phải > 0.`);
  amounts.forEach((a, i) => {
    if (a < share) throw new Error(`FPB-003: output pot #${i} = ${a} < suất D=${share}.`);
    if (a % share !== 0n) {
      throw new Error(`FPB-003: output pot #${i} = ${a} không phải bội của suất D=${share} (dư ${a % share}).`);
    }
  });
  const sum = amounts.reduce((s, a) => s + a, 0n);
  if (sum !== amount) {
    throw new Error(`FPB-002: tổng ${amounts.length} output pot = ${sum} ≠ lượng rót ${amount}.`);
  }
}

export interface FundPotParams {
  lucid: LucidEvolution;
  /** UTxO carrier của kho — caller chỉ định, builder KHÔNG quét địa chỉ kho. */
  treasuryUtxo:   UTxO;
  treasuryScript: Validator;
  committeeSigners:   string[];
  committeeThreshold: number;
  lampPolicyId:   string;
  lampAssetName?: string;
  /** Policy NFT "TREASURY" thật (one-shot). Bắt buộc. */
  treasuryNftPolicy:     string;
  treasuryNftAssetName?: string;
  /** Script hash `claim_account` của cùng cụm — FP-5b cấm rót về đó. */
  claimAccountHash: string;
  /** Mã pot trong sổ `pots.ts` — FPB-001 ép `amountOildrop` == ngân sách − `fundedBeforeOildrop`. */
  potId: PotId;
  /** Lượng đã rót vào pot này ở lượt trước (lượt mồi). Mặc định 0. Bên gọi đọc từ nguồn có ghi chép. */
  fundedBeforeOildrop?: bigint;
  /** Lượt mồi: rót đúng MỘT suất để chạy thử lối ra của kho mới. Mặc định false. */
  bootstrap?: boolean;
  pot:   FundPotTarget;
  amountOildrop:   bigint;
  /** D — một suất của pot. Mọi output pot ≥ D và là bội của D. */
  potShareOildrop: bigint;
  /** Lượng LAMP (oildrop) của từng output pot, K phần tử. */
  outputAmounts:   bigint[];
  /** Lovelace mỗi output pot. Mặc định 2 ADA. */
  potLovelace?:    bigint;
}

export interface FundPotResult {
  tx:              TxSignBuilder;
  funded:          bigint;
  lampBefore:      bigint;
  lampAfter:       bigint;
  treasuryDatum:   TreasuryDatum;
  /** Tài sản carrier ra (đã tính) — dùng để đọc lại giao dịch đã dựng. */
  carrierAssets:   Record<string, bigint>;
  summary:         string;
}

export async function buildFundPotTx(p: FundPotParams): Promise<FundPotResult> {
  const lampUnit = toUnit(p.lampPolicyId, p.lampAssetName ?? DEFAULT_LAMP_ASSET_NAME);
  const nftName = normHex(p.treasuryNftAssetName ?? TREASURY_NFT_ASSET_NAME);
  const nftUnit = toUnit(p.treasuryNftPolicy, nftName);
  const carrier = p.treasuryUtxo;
  const ref = `${carrier.txHash}#${carrier.outputIndex}`;
  const treasuryHash = normHex(validatorToScriptHash(p.treasuryScript));
  const claimHash = normHex(p.claimAccountHash);
  const potHash = normHex(p.pot.scriptHash);

  // ── FPB-001: đúng ngân sách pot trong sổ ─────────────────────────────
  // Hai hình dạng hợp lệ, không có hình dạng thứ ba:
  //   • lượt MỒI: đúng MỘT suất D, chưa rót gì trước đó — chạy thử lối ra của kho mới;
  //   • lượt TRỌN: đúng phần còn lại = ngân sách − đã rót trước.
  // Không có "rót bao nhiêu cũng được": một lượng tự do là chỗ pot bị rót thiếu mà không ai thấy.
  const budget = potBudgetOildrop(p.potId);
  const before = p.fundedBeforeOildrop ?? 0n;
  if (before < 0n || before >= budget) {
    throw new Error(
      `FPB-001: đã rót trước ${before} phải nằm trong [0, ngân sách ${budget}) của pot '${p.potId}'.`,
    );
  }
  if (p.amountOildrop <= 0n) throw new Error(`FPB-001: lượng rót phải > 0 (FP-4 \`funded > 0\`).`);
  if (p.bootstrap) {
    if (before !== 0n || p.amountOildrop !== p.potShareOildrop) {
      throw new Error(
        `FPB-001: lượt mồi phải rót đúng MỘT suất D=${p.potShareOildrop} vào pot chưa rót gì ` +
        `(đang rót ${p.amountOildrop}, đã rót trước ${before}).`,
      );
    }
  } else if (p.amountOildrop !== budget - before) {
    throw new Error(
      `FPB-001: lượng rót ${p.amountOildrop} ≠ phần còn lại của pot '${p.potId}' = ${budget} − ${before} ` +
      `= ${budget - before} oildrop (sổ \`pots.ts\`, nguồn Papers/pot-catalog.md §1). ` +
      `Chuỗi không ép số này — builder thì có.`,
    );
  }

  // ── FPB-002/003: K output, mỗi cái ≥ D và bội của D, tổng == amount ───
  assertPotOutputAmounts(p.outputAmounts, p.amountOildrop, p.potShareOildrop);

  // ── FPB-004: địa chỉ pot là Script, hash khớp lời khai ────────────────
  const det = getAddressDetails(p.pot.address);
  if (det.paymentCredential?.type !== "Script") {
    throw new Error(`FPB-004: pot ${p.pot.address} không có payment credential Script — FP-5a từ chối.`);
  }
  if (normHex(det.paymentCredential.hash) !== potHash) {
    throw new Error(`FPB-004: địa chỉ pot mang hash ${det.paymentCredential.hash}, lời khai ${potHash}.`);
  }
  // ── FPB-005: pot không phải kho, không phải claim_account ────────────
  if (potHash === treasuryHash) throw new Error(`FPB-005: pot trùng script kho ${treasuryHash} — FP-5b từ chối.`);
  if (potHash === claimHash) throw new Error(`FPB-005: pot trùng script claim_account ${claimHash} — FP-5b từ chối.`);
  // ── FPB-006: datum pot là Plutus Data giải mã được ───────────────────
  const potDatum = normHex(p.pot.datumCbor);
  try {
    Data.from(potDatum);
  } catch (e) {
    throw new Error(`FPB-006: datum pot '${p.pot.datumCbor}' không giải mã được (${String(e)}) — FP-5c cần inline datum.`);
  }

  // ── FPB-007: carrier ở script kho, đúng 1 TREASURY thật, không token trùng tên ─
  const cdet = getAddressDetails(carrier.address);
  if (cdet.paymentCredential?.type !== "Script" || normHex(cdet.paymentCredential.hash) !== treasuryHash) {
    throw new Error(`FPB-007: carrier ${ref} không nằm ở script kho ${treasuryHash}.`);
  }
  if ((carrier.assets[nftUnit] ?? 0n) !== 1n) {
    throw new Error(`FPB-007: carrier ${ref} không mang đúng 1 '${nftUnit}'.`);
  }
  let named = 0n;
  for (const [unit, q] of Object.entries(carrier.assets)) {
    if (unit !== "lovelace" && unit.length > POLICY_HEX_LEN && unit.slice(POLICY_HEX_LEN).toLowerCase() === nftName) named += q;
  }
  if (named !== 1n) {
    throw new Error(`FPB-007: carrier ${ref} mang ${named} đơn vị tên TREASURY (mọi policy) — FP-2 đòi đúng 1.`);
  }
  if (carrier.datumHash || !carrier.datum) {
    throw new Error(`FPB-007: carrier ${ref} không mang inline datum — FP-3 không thoả được.`);
  }
  let td: TreasuryDatum;
  try {
    td = decodeTreasuryDatum(Data.from(carrier.datum));
  } catch (e) {
    throw new Error(`FPB-007: datum carrier ${ref} không giải mã thành TreasuryDatum (${String(e)}).`);
  }

  // ── FPB-008: đủ LAMP và khả chi sau rót (FP-4 + FP-6) ────────────────
  const lampBefore = carrier.assets[lampUnit] ?? 0n;
  if (p.amountOildrop > lampBefore) {
    throw new Error(`FPB-008: kho có ${lampBefore} oildrop, cần rót ${p.amountOildrop}.`);
  }
  const lampAfter = lampBefore - p.amountOildrop;
  if (td.outstanding_entitlement > lampAfter) {
    throw new Error(
      `FPB-008: sổ nợ ${td.outstanding_entitlement} > pool sau rót ${lampAfter} — FP-6 từ chối.`,
    );
  }

  // ── FPB-009: đủ người ký PHÂN BIỆT ───────────────────────────────────
  const signers = [...new Set(p.committeeSigners.map(normHex))];
  if (signers.length < p.committeeThreshold) {
    throw new Error(`FPB-009: ${signers.length} người ký phân biệt < ngưỡng ${p.committeeThreshold} — FP-1 từ chối.`);
  }

  // ── Carrier ra: y nguyên trừ LAMP; datum là ĐÚNG chuỗi CBOR vào (FP-3) ──
  const carrierAssets: Record<string, bigint> = { ...carrier.assets };
  if (lampAfter === 0n) delete carrierAssets[lampUnit];
  else carrierAssets[lampUnit] = lampAfter;

  const potLovelace = p.potLovelace ?? DEFAULT_POT_LOVELACE;
  if (potLovelace <= 0n) throw new Error(`FPB-002: lovelace mỗi output pot phải > 0.`);

  let txb = p.lucid
    .newTx()
    .collectFrom([carrier], fundPotRedeemerToCbor())
    .attach.SpendingValidator(p.treasuryScript)
    .pay.ToAddressWithData(carrier.address, { kind: "inline", value: carrier.datum }, carrierAssets);
  for (const a of p.outputAmounts) {
    txb = txb.pay.ToAddressWithData(p.pot.address, { kind: "inline", value: potDatum }, { lovelace: potLovelace, [lampUnit]: a });
  }
  for (const s of signers) txb = txb.addSignerKey(s);
  const tx = await txb.complete();

  const summary = [
    `═══ FundPot — rót pot '${p.potId}' ═══`,
    `Carrier:        ${ref}  (${carrier.address})`,
    `Pot:            ${p.pot.address}  hash ${potHash}  datum ${potDatum}`,
    `Rót:            ${p.amountOildrop} oildrop qua ${p.outputAmounts.length} output (D = ${p.potShareOildrop})`,
    `LAMP kho:       ${lampBefore} → ${lampAfter}`,
    `Sổ nợ:          ${td.outstanding_entitlement} (không đổi) ≤ ${lampAfter}`,
    `Người ký:       ${signers.length}/${p.committeeThreshold}`,
  ].join("\n");

  return { tx, funded: p.amountOildrop, lampBefore, lampAfter, treasuryDatum: td, carrierAssets, summary };
}

/** Hình dạng một output — khớp `TxOutput` của lucid và `UTxO` đọc từ nhà cung cấp. */
export interface FundPotOutputShape {
  address:    string;
  assets:     Record<string, bigint>;
  datum?:     string | null | undefined;
  datumHash?: string | null | undefined;
}

export interface FundPotReadbackExpect {
  treasuryAddress:  string;
  treasuryHash:     string;
  claimAccountHash: string;
  lampUnit:         string;
  carrierAssets:    Record<string, bigint>;
  carrierDatumCbor: string;
  carrierLovelaceIn: bigint;
  pot:              FundPotTarget;
  potShareOildrop:  bigint;
  outputAmounts:    bigint[];
}

/**
 * FPB-010 — soát giao dịch ĐÃ DỰNG theo FP-3/FP-4/FP-5 (mirror `pot_lamp_total`) cộng các ràng
 * buộc off-chain (đúng K output ở pot, mỗi cái bội D, datum pot đúng lời khai). Rỗng = khớp.
 */
export function fundPotOutputFailures(outs: FundPotOutputShape[], e: FundPotReadbackExpect): string[] {
  const fails: string[] = [];
  const trsyHash = normHex(e.treasuryHash);
  const claimHash = normHex(e.claimAccountHash);
  const scriptHashOf = (addr: string): string | undefined => {
    const d = getAddressDetails(addr);
    return d.paymentCredential?.type === "Script" ? normHex(d.paymentCredential.hash) : undefined;
  };

  const atTreasury = outs.filter((o) => scriptHashOf(o.address) === trsyHash);
  if (atTreasury.length !== 1) fails.push(`có ${atTreasury.length} output ở script kho, cần đúng 1 (FP-3)`);
  const c = atTreasury[0];
  if (c) {
    if (c.address !== e.treasuryAddress) fails.push(`carrier ra ${c.address} ≠ địa chỉ vào ${e.treasuryAddress} (FP-3)`);
    if (!c.datum || normHex(c.datum) !== normHex(e.carrierDatumCbor)) fails.push(`datum carrier ra khác datum vào (FP-3)`);
    if ((c.assets["lovelace"] ?? 0n) < e.carrierLovelaceIn) fails.push(`lovelace carrier giảm (FP-3)`);
    const keys = new Set([...Object.keys(c.assets), ...Object.keys(e.carrierAssets)].filter((k) => k !== "lovelace"));
    for (const k of keys) {
      if ((c.assets[k] ?? 0n) !== (e.carrierAssets[k] ?? 0n)) fails.push(`carrier ra ${k} = ${c.assets[k] ?? 0n} ≠ ${e.carrierAssets[k] ?? 0n} (FP-4)`);
    }
  }

  let potTotal = 0n;
  let funded = 0n;
  for (const o of outs) {
    if (o === c) continue;
    const q = o.assets[e.lampUnit] ?? 0n;
    if (q === 0n) continue;
    funded += q;
    const h = scriptHashOf(o.address);
    if (h === undefined) { fails.push(`output ${o.address} mang ${q} LAMP mà không phải Script (FP-5a)`); continue; }
    if (h === trsyHash || h === claimHash) { fails.push(`output ${o.address} mang LAMP về kho/claim_account (FP-5b)`); continue; }
    if (!o.datum) { fails.push(`output ${o.address} mang LAMP mà không có inline datum (FP-5c)`); continue; }
    if (o.address !== e.pot.address) { fails.push(`output ${o.address} mang LAMP nhưng không phải pot đã khai`); continue; }
    if (normHex(o.datum) !== normHex(e.pot.datumCbor)) fails.push(`output pot mang datum ${o.datum} ≠ ${e.pot.datumCbor}`);
    if (q < e.potShareOildrop || q % e.potShareOildrop !== 0n) fails.push(`output pot ${q} không phải bội ≥ 1 của D=${e.potShareOildrop}`);
    potTotal += q;
  }
  const want = e.outputAmounts.reduce((s, a) => s + a, 0n);
  if (potTotal !== want) fails.push(`tổng LAMP ở pot ${potTotal} ≠ lượng rót ${want} (FP-5d)`);
  if (funded !== want) fails.push(`tổng LAMP rời carrier sang output khác ${funded} ≠ ${want} (FP-5d)`);
  const potCount = outs.filter((o) => o.address === e.pot.address && (o.assets[e.lampUnit] ?? 0n) > 0n).length;
  if (potCount !== e.outputAmounts.length) fails.push(`có ${potCount} output pot, cần K=${e.outputAmounts.length}`);
  return fails;
}
