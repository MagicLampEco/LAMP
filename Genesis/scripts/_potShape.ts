// _potShape.ts — phần THUẦN của lượt rót LAMP vào KHO SCRIPT của một pot: soát đích, soát
// datum, dựng value, soát output ĐÃ DỰNG / ĐÃ LÊN CHUỖI. Không mạng, không khoá, có bài kiểm.
//
// Dùng chung cho hai runner rót pot, để một cổng soát chỉ có MỘT bản:
//   · `29_fund_script_pot.ts`       — rót từ ví vận hành;
//   · `30_feeder_accounts.ts` STEP=fundpot — rót thẳng từ địa chỉ các feeder.
//
// Rót đúng ĐỊA CHỈ chưa phải rót vào SỔ. Kho script nhận ra tài sản của nó bằng cái validator của
// nó đọc (datum, hình dạng value), không bằng địa chỉ. Nên lượt rót đòi người chạy NÓI RA hình
// dạng UTxO kho nhận, và mọi cổng dưới đây soát đúng hình dạng đó:
//   địa chỉ = POT_ADDRESS, payment credential là Script, hash == POT_SCRIPT_HASH (khai hai lần để
//             một lỗi gõ ở một chỗ không lọt qua);
//   value   = đúng {lovelace, LAMP} — không asset nào khác;
//   datum   = InlineDatum(POT_DATUM_CBOR) — BẮT BUỘC, không mặc định; không datum hash, không
//             script ref.
// Runner không trả lời hộ câu "nhánh nào của validator pot tiêu lại được UTxO này" — nó chỉ bảo
// đảm UTxO tạo ra có ĐÚNG hình dạng người chạy khai.
//
// Tệp này không import `config.ts` (tệp đó ném ngay lúc nạp khi môi trường chưa dựng), nên bài
// kiểm nạp được nó ở mọi máy.
import { Data, getAddressDetails } from "@lucid-evolution/lucid";

/** Trường bắt buộc, không mặc định. */
export function requireField(name: string, raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) throw new Error(`POT-FUND-001: thiếu ${name}. Không có giá trị mặc định cho bất cứ trường nào của lượt rót.`);
  return v;
}

/** Hex thường hoá (bỏ `0x`, chữ thường), tuỳ chọn ép đúng số byte. */
export function hexField(name: string, v: string, bytes?: number): string {
  const h = v.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(h) || h.length % 2 !== 0) throw new Error(`POT-FUND-002: ${name} không phải hex.`);
  if (bytes !== undefined && h.length !== bytes * 2) {
    throw new Error(`POT-FUND-003: ${name} phải dài ${bytes} byte, đang ${h.length / 2}.`);
  }
  return h;
}

/** Số nguyên DƯƠNG từ chuỗi môi trường. */
export function positiveBig(name: string, raw: string): bigint {
  const v = raw.trim();
  if (!/^[0-9]+$/.test(v) || BigInt(v) <= 0n) {
    throw new Error(`POT-FUND-004: ${name}='${raw}' phải là số nguyên dương.`);
  }
  return BigInt(v);
}

export interface PotTarget {
  address:    string;
  scriptHash: string;   // 28 byte hex, chữ thường
  datumCbor:  string;   // CBOR Plutus Data, hex chữ thường
}

/**
 * Soát địa chỉ pot: đúng mạng, payment credential kiểu Script, hash khớp lời khai.
 * Cardano không chạy validator lúc TẠO output — đây là chỗ duy nhất chặn một lỗi gõ đích.
 */
export function assertPotAddress(address: string, scriptHash: string, networkId: 0 | 1): void {
  const det = getAddressDetails(address);
  if (det.networkId !== networkId) {
    throw new Error(`POT-FUND-005: ${address} thuộc networkId ${det.networkId}, chờ ${networkId}.`);
  }
  if (det.paymentCredential?.type !== "Script") {
    throw new Error(`POT-FUND-006: ${address} không có payment credential kiểu Script — đây không phải kho script.`);
  }
  if (det.paymentCredential.hash.toLowerCase() !== scriptHash.toLowerCase()) {
    throw new Error(
      `POT-FUND-007: địa chỉ mang script hash ${det.paymentCredential.hash}, lời khai POT_SCRIPT_HASH là ` +
      `${scriptHash}. Hai nguồn lệch nhau thì không gửi.`,
    );
  }
}

/** Datum bắt buộc: có mặt, là hex, và giải mã được thành Plutus Data. Trả hex chữ thường. */
export function assertPotDatum(raw: string | undefined): string {
  const cbor = hexField("POT_DATUM_CBOR", requireField("POT_DATUM_CBOR", raw));
  try {
    Data.from(cbor);
  } catch (e) {
    throw new Error(`POT-FUND-008: POT_DATUM_CBOR không giải mã được thành Plutus Data (${String(e)}).`);
  }
  return cbor;
}

/** Ba lời khai của đích pot → một `PotTarget` đã soát. Mọi trường bắt buộc, không mặc định. */
export function potTarget(env: { address?: string; scriptHash?: string; datumCbor?: string },
                          networkId: 0 | 1): PotTarget {
  const address = requireField("POT_ADDRESS", env.address);
  const scriptHash = hexField("POT_SCRIPT_HASH", requireField("POT_SCRIPT_HASH", env.scriptHash), 28);
  const datumCbor = assertPotDatum(env.datumCbor);
  assertPotAddress(address, scriptHash, networkId);
  return { address, scriptHash, datumCbor };
}

/**
 * Đọc ba lời khai pot từ môi trường theo TÊN (`POT_ADDRESS`, `POT_SCRIPT_HASH`, `POT_DATUM_CBOR`).
 *
 * Ghi chú cho `tests/envGuards.test.ts` ▸ CALL-SITE: cổng đó bắt `process.env.<X>_HASH` đọc trần vì
 * một APPLY-PARAM sai là policy-id sai vĩnh viễn. `POT_SCRIPT_HASH` KHÔNG phải apply-param — nó là
 * lời khai thứ hai để đối chiếu với hash nằm trong `POT_ADDRESS` — và cổng ở đây còn chặt hơn
 * `requiredHashParam`: không có placeholder ở chế độ dựng thử, và phải khớp địa chỉ.
 */
export function potTargetFromEnv(env: Record<string, string | undefined>, networkId: 0 | 1): PotTarget {
  return potTarget({
    address: env["POT_ADDRESS"], scriptHash: env["POT_SCRIPT_HASH"], datumCbor: env["POT_DATUM_CBOR"],
  }, networkId);
}

/** Value của output pot: đúng {lovelace, LAMP}. */
export function potOutputAssets(lovelace: bigint, lampUnit: string, amount: bigint): Record<string, bigint> {
  if (amount <= 0n) throw new Error(`POT-FUND-004: lượng LAMP rót vào pot phải > 0 (đang ${amount}).`);
  if (lovelace <= 0n) throw new Error(`POT-FUND-004: lovelace của output pot phải > 0 (đang ${lovelace}).`);
  if (lampUnit === "lovelace" || !/^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(lampUnit)) {
    throw new Error(`POT-FUND-002: đơn vị LAMP '${lampUnit}' không phải policy(28 byte)+tên hex.`);
  }
  return { lovelace, [lampUnit]: amount };
}

/** Hình dạng một output — khớp `TxOutput` của lucid và `UTxO` đọc từ nhà cung cấp. */
export interface OutputShape {
  address:    string;
  assets:     Record<string, bigint>;
  datum?:     string | null;
  datumHash?: string | null;
  scriptRef?: unknown;
}

export interface PotExpect {
  lampUnit:  string;
  amount:    bigint;
  datumCbor: string;
}

/** Những chỗ một output pot lệch hình dạng đã khai. Rỗng = khớp. */
export function potOutputFailures(o: OutputShape, e: PotExpect): string[] {
  const fails: string[] = [];
  const lamp = o.assets[e.lampUnit] ?? 0n;
  if (lamp !== e.amount) fails.push(`LAMP ${lamp} ≠ ${e.amount}`);
  const others = Object.keys(o.assets).filter((k) => k !== "lovelace" && k !== e.lampUnit);
  if (others.length > 0) fails.push(`mang asset lạ: ${others.join(",")}`);
  if (!o.datum) {
    fails.push(o.datumHash ? `datum là HASH ${o.datumHash}, cần inline` : `không có inline datum`);
  } else if (o.datum.toLowerCase() !== e.datumCbor.toLowerCase()) {
    fails.push(`datum ${o.datum} ≠ ${e.datumCbor}`);
  }
  if (o.scriptRef) fails.push(`mang script ref`);
  return fails;
}

/**
 * Trong danh sách output (của giao dịch ĐÃ DỰNG, hoặc UTxO của một tx đọc lại ở địa chỉ pot):
 * ĐÚNG MỘT output ở địa chỉ pot, và nó đúng hình dạng đã khai. `code` phân biệt chỗ gọi — trước
 * khi ký (chặn) hay sau khi lên chuỗi (báo).
 */
export function assertPotOutputs(outs: OutputShape[], address: string, e: PotExpect, code: string): void {
  const at = outs.filter((o) => o.address === address);
  const fails: string[] = [];
  if (at.length !== 1) fails.push(`có ${at.length} output ở địa chỉ pot, cần đúng 1`);
  if (at[0]) fails.push(...potOutputFailures(at[0], e));
  if (fails.length > 0) throw new Error(`${code}: ${fails.join("; ")}`);
}

/** Tổng một đơn vị tài sản trên các output ở một địa chỉ. */
export function unitAt(outs: OutputShape[], address: string, unit: string): bigint {
  return outs.filter((o) => o.address === address).reduce((s, o) => s + (o.assets[unit] ?? 0n), 0n);
}
