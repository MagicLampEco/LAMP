// Logic thuần "điều tiết cung-cầu" — mirror onchain lib/magiclamp/treasury/split.ak.
// Chia LAMP thu được về ≥2 người nhận theo TRỌNG SỐ, mỗi người nhận là custody
// Accounting (script hash, KHÔNG ví PKH). MVP: 20% MagicLamp / 80% App, min_oil=360.
//
// Bất biến CỨNG (property-test khớp onchain):
//   (S1) Σ parts == total          — value bảo toàn TUYỆT ĐỐI, KHÔNG rơi oil.
//   (S2) part_i == ⌊ total × weight_i / 10000 ⌋ cho i ≥ 1; part_0 = floor_0 + remainder.
//   (S3) total ≥ min_oil.
//   (S4) Σ weight_bps == 10000.
//
// remainder (total − Σ floor) dồn vào recipient ĐẦU (MagicLamp) — protocol không thiệt.
// BigInt thuần (KHÔNG float) — khớp eUTXO determinism + chia trunc == floor (total ≥ 0).

const BPS_DENOM = 10_000n;
const SCRIPT_HASH_BYTES = 28; // blake2b-224 = 28 byte = 56 hex

/** Một người nhận: custody Accounting (script hash 28 byte hex) + trọng số bps. */
export interface Recipient {
  custody_hash: string; // hex — payment SCRIPT hash custody đích (KHÔNG ví PKH)
  weight_bps: bigint;
}

/** Tham số split. recipients ≥ 2; Σ weight == 10000; min_oil ≥ 0. */
export interface SplitParam {
  recipients: Recipient[];
  min_oil: bigint;
}

/** Σ weight_bps qua mọi recipient. */
export function weightsSum(recipients: Recipient[]): bigint {
  return recipients.reduce((acc, r) => acc + r.weight_bps, 0n);
}

/** Mọi weight_bps ∈ [0,10000]. */
export function allWeightsNonneg(recipients: Recipient[]): boolean {
  return recipients.every((r) => r.weight_bps >= 0n && r.weight_bps <= 10000n);
}

/** Độ dài hex của custody_hash (bỏ "0x", lowercase) tính theo byte. */
function hashByteLen(hex: string): number {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Math.floor(h.length / 2);
}

/** Mọi custody_hash đúng 28 byte (script blake2b-224). Sanity độ dài — SCRIPT-ness
 *  ép ở tầng output address (distribute + splitter v1.x). */
export function allHashesSized(recipients: Recipient[]): boolean {
  return recipients.every((r) => hashByteLen(r.custody_hash) === SCRIPT_HASH_BYTES);
}

/** param hợp lệ: ≥2 recipient, weight ∈ [0,10000], Σ weight == 10000, min_oil ≥ 0,
 *  hash 28 byte. Mirror split.ak param_valid. */
export function paramValid(param: SplitParam): boolean {
  return param.recipients.length >= 2
    && allWeightsNonneg(param.recipients)
    && weightsSum(param.recipients) === 10000n
    && param.min_oil >= 0n
    && allHashesSized(param.recipients);
}

/** total ≥ min_oil (S3). */
export function minOilOk(total: bigint, minOil: bigint): boolean {
  return total >= minOil;
}

/** ⌊ total × weight_bps / 10000 ⌋. total ≥ 0, weight ≥ 0 ⇒ trunc == floor. */
export function floorPart(total: bigint, weightBps: bigint): bigint {
  return (total * weightBps) / BPS_DENOM;
}

/** floor part theo thứ tự recipients (chưa dồn remainder). */
export function floorParts(total: bigint, recipients: Recipient[]): bigint[] {
  return recipients.map((r) => floorPart(total, r.weight_bps));
}

/**
 * split_amounts(total, recipients) -> bigint[] theo thứ tự recipients.
 * floor_parts với remainder (total − Σ floor) dồn vào phần tử ĐẦU (MagicLamp).
 * Bất biến S1: Σ == total. recipients rỗng → [].
 */
export function splitAmounts(total: bigint, recipients: Recipient[]): bigint[] {
  const floors = floorParts(total, recipients);
  const assigned = floors.reduce((acc, p) => acc + p, 0n);
  const remainder = total - assigned;
  if (floors.length === 0) return [];
  return [floors[0]! + remainder, ...floors.slice(1)];
}

/** Σ của bigint[] (helper bất biến S1). */
export function sumInts(xs: bigint[]): bigint {
  return xs.reduce((acc, x) => acc + x, 0n);
}

// ── MVP default param (20% MagicLamp / 80% App, min_oil = 360) ────────────

/** Dựng SplitParam MVP từ 2 custody hash (script). magiclampHash nhận remainder. */
export function mvpSplitParam(magiclampHash: string, appHash: string): SplitParam {
  return {
    recipients: [
      { custody_hash: magiclampHash, weight_bps: 2000n },
      { custody_hash: appHash, weight_bps: 8000n },
    ],
    min_oil: 360n,
  };
}
