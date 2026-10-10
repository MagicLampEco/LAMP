// _devPotPayouts.ts — danh sách chi hàng loạt từ pot development (mạng thử), thuần, không đọc chuỗi.
// `31_preprod_dev_pot.ts` ▸ STEP=pay-batch dùng nó; bài kiểm ở `Genesis/tests/devPotPayouts.test.ts`.
//
// Vì sao có: trên mạng thử, người muốn thử một luồng cần tLAMP (vd khoá tLAMP để đúc CARP) không có
// đường tự lấy tLAMP về ví khoá. Pot development là nguồn; tệp này biến nó thành một vòi CÓ SỔ:
// mỗi ví nhận tối đa một lần (sổ đã chi chặn lần hai), mỗi suất có trần, một giao dịch chi cả lô.
//
// HỢP ĐỒNG DỮ LIỆU (bên gom yêu cầu ghi tệp, LAMP đọc):
//   {
//     "schema":  "devpot-payouts/1",
//     "network": "Preprod" | "Preview",
//     "payouts": [
//       { "address": "addr_test1q…",     // ví KHOÁ (payment credential là key) trên mạng thử
//         "oildrop": "100000000",         // chuỗi số nguyên dương, đơn vị oildrop (1 LAMP = 10^6)
//         "ref":     "carpetmint-tester-01" }  // nhãn nguồn yêu cầu, để đối chiếu sổ
//     ]
//   }
//
// VÌ SAO CHỈ VÍ KHOÁ. Bên tiêu thụ đầu tiên là luồng đúc CARP, nơi chủ khoản thế chấp phải là ví
// khoá (đích script bị từ chối). Ví script có đường riêng (két drip, `33_drip_pot.ts`).
import { getAddressDetails } from "@lucid-evolution/lucid";

export const DEVPOT_PAYOUTS_SCHEMA = "devpot-payouts/1";
/** Số output chi tối đa mỗi giao dịch — giữ tx dưới trần kích thước với dư địa rộng. */
export const DEVPOT_MAX_BATCH = 40;
/** Trần mặc định mỗi suất: 10.000 tLAMP. Ghi đè bằng tham số `capOildrop`. */
export const DEVPOT_DEFAULT_CAP_OILDROP = 10_000_000_000n;

export type DevPotNetwork = "Preprod" | "Preview";

export interface DevPotPayout {
  address:   string;
  credHash:  string;   // payment key-hash — khoá của sổ đã chi
  oildrop:   bigint;
  ref:       string;
}

function fail(code: string, msg: string): never {
  throw new Error(`${code}: ${msg}`);
}

/** Đọc + soát danh sách. Ném ở lỗi ĐẦU TIÊN kèm chỉ số dòng — sai một dòng thì không chi dòng nào. */
export function parseDevPotPayouts(
  raw: unknown,
  network: string,
  capOildrop: bigint = DEVPOT_DEFAULT_CAP_OILDROP,
): DevPotPayout[] {
  if (network !== "Preprod" && network !== "Preview") {
    fail("DEVPOT-PAY-002", `vòi pot development chỉ chạy trên mạng thử, đang '${network}'.`);
  }
  if (typeof raw !== "object" || raw === null) fail("DEVPOT-PAY-001", "tệp không phải một đối tượng JSON.");
  const o = raw as Record<string, unknown>;
  if (o.schema !== DEVPOT_PAYOUTS_SCHEMA) {
    fail("DEVPOT-PAY-001", `schema '${String(o.schema)}', chờ '${DEVPOT_PAYOUTS_SCHEMA}'.`);
  }
  if (o.network !== network) {
    fail("DEVPOT-PAY-002", `danh sách cho mạng '${String(o.network)}', đang chạy '${network}'.`);
  }
  if (!Array.isArray(o.payouts) || o.payouts.length === 0) {
    fail("DEVPOT-PAY-003", "`payouts` phải là mảng không rỗng.");
  }
  if (o.payouts.length > DEVPOT_MAX_BATCH) {
    fail("DEVPOT-PAY-003", `${o.payouts.length} dòng, trần ${DEVPOT_MAX_BATCH} mỗi giao dịch — tách tệp.`);
  }
  if (capOildrop <= 0n) fail("DEVPOT-PAY-006", `trần mỗi suất phải > 0 (đang ${capOildrop}).`);

  const seen = new Map<string, number>();
  return o.payouts.map((p: unknown, i: number) => {
    const at = `dòng #${i}`;
    if (typeof p !== "object" || p === null) fail("DEVPOT-PAY-004", `${at} không phải đối tượng.`);
    const r = p as Record<string, unknown>;
    if (typeof r.address !== "string" || typeof r.oildrop !== "string" || typeof r.ref !== "string" || !r.ref) {
      fail("DEVPOT-PAY-004", `${at} thiếu address / oildrop / ref (cả ba là chuỗi, ref không rỗng).`);
    }
    let d: ReturnType<typeof getAddressDetails>;
    try { d = getAddressDetails(r.address); } catch { fail("DEVPOT-PAY-005", `${at} địa chỉ không giải mã được.`); }
    if (d.paymentCredential?.type !== "Key") {
      fail("DEVPOT-PAY-005", `${at} không phải ví khoá — vòi chỉ chi ra ví khoá.`);
    }
    if (d.networkId !== 0) fail("DEVPOT-PAY-005", `${at} không thuộc mạng thử.`);
    if (!/^[1-9][0-9]*$/.test(r.oildrop)) fail("DEVPOT-PAY-006", `${at} oildrop '${r.oildrop}' không phải số nguyên dương.`);
    const amount = BigInt(r.oildrop);
    if (amount > capOildrop) fail("DEVPOT-PAY-006", `${at} ${amount} oildrop vượt trần ${capOildrop} mỗi suất.`);
    const cred = d.paymentCredential.hash.toLowerCase();
    const prev = seen.get(cred);
    if (prev !== undefined) fail("DEVPOT-PAY-007", `${at} trùng ví với dòng #${prev} — mỗi ví một suất.`);
    seen.set(cred, i);
    return { address: r.address, credHash: cred, oildrop: amount, ref: r.ref };
  });
}

/** Một dòng sổ đã chi (JSON Lines, mỗi lượt chi thêm dòng, không sửa dòng cũ). */
export interface DevPotLedgerLine {
  credHash: string;
  address:  string;
  oildrop:  string;
  ref:      string;
  tx:       string;
  at:       string;   // ISO 8601
}

/** Đọc sổ đã chi. Dòng hỏng thì NÉM — sổ hỏng mà bỏ qua là mở đường chi lần hai. */
export function parseDevPotLedger(text: string): Map<string, DevPotLedgerLine> {
  const out = new Map<string, DevPotLedgerLine>();
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let v: unknown;
    try { v = JSON.parse(line); } catch { fail("DEVPOT-LEDGER-001", `dòng ${i + 1} của sổ không phải JSON.`); }
    const r = v as Record<string, unknown>;
    if (typeof r.credHash !== "string" || !/^[0-9a-f]{56}$/.test(r.credHash) || typeof r.tx !== "string") {
      fail("DEVPOT-LEDGER-001", `dòng ${i + 1} của sổ thiếu credHash (56 hex) hoặc tx.`);
    }
    out.set(r.credHash, r as unknown as DevPotLedgerLine);
  });
  return out;
}

/** Tách danh sách thành phần phải chi và phần đã chi trước đó (theo sổ). */
export function planDevPotPayouts(
  payouts: DevPotPayout[],
  ledger: Map<string, DevPotLedgerLine>,
): { toPay: DevPotPayout[]; alreadyPaid: { payout: DevPotPayout; line: DevPotLedgerLine }[]; total: bigint } {
  const toPay: DevPotPayout[] = [];
  const alreadyPaid: { payout: DevPotPayout; line: DevPotLedgerLine }[] = [];
  for (const p of payouts) {
    const line = ledger.get(p.credHash);
    if (line) alreadyPaid.push({ payout: p, line });
    else toPay.push(p);
  }
  return { toPay, alreadyPaid, total: toPay.reduce((s, p) => s + p.oildrop, 0n) };
}

/** Dòng sổ cho một lượt chi đã vào block. */
export function devPotLedgerLines(paid: DevPotPayout[], tx: string, at: Date): string {
  return paid.map((p) => JSON.stringify({
    credHash: p.credHash, address: p.address, oildrop: p.oildrop.toString(), ref: p.ref, tx, at: at.toISOString(),
  } satisfies DevPotLedgerLine)).join("\n") + "\n";
}
