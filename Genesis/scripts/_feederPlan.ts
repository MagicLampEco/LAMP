// _feederPlan.ts — phần THUẦN của `30_feeder_accounts.ts`: không mạng, không khoá, có bài kiểm.
//
// BỐI CẢNH (Capped Drop v3, `Distribution/capped-drop/CONTRACT.md §4d-1`). Pot Wakeme được cấp
// nguồn qua k tài khoản song song ("feeder"), mỗi tài khoản một khoá riêng dẫn xuất từ seed
// vận hành. Lý do là toán học của v3, không phải sở thích:
//   vested = min(E, √E · A_span)  ⇒ một tài khoản E mở khoá √E·w mỗi cửa sổ;
//   k tài khoản chia đều tổng T mở khoá k·√(T/k)·w = √(k·T)·w mỗi cửa sổ.
// Tốc độ tăng theo √k mà không đổi hằng số nào trên chuỗi. k là NÚM CÔNG SUẤT của người vận
// hành, không phải trần của cơ chế: thiếu thì thêm feeder, không phải đợi ai duyệt.
//
// Tên tài khoản = blake2b_256(owner) ⇒ mỗi khoá chỉ CREATE được một lần; k tài khoản ⇒ k khoá.
import { getAddressDetails } from "@lucid-evolution/lucid";

import { redeemable } from "../../Distribution/offchain/src/vested.js";
import type {
  BeaconDatum, ClaimAccountDatum, TreasuryDatum,
} from "../../Distribution/offchain/src/types.js";

/** Chỉ số tài khoản (CIP-1852 account index) của feeder thứ `i` trong dải. */
export interface FeederRange { base: number; count: number }

/**
 * FEED-RANGE: dải chỉ số khoá feeder. `base ≥ 1` là BẮT BUỘC: account index 0 là chính ví vận
 * hành — cùng payment key, cùng pkh — nên feeder số 0 trùng owner với tài khoản ví vận hành đã
 * mở và đường CREATE sẽ bị từ chối (A-ACC-2 đúc trùng tên). Trần 2^31 − 1 là trần của chỉ số
 * hardened trong đường dẫn dẫn xuất.
 */
export function feederIndices(r: FeederRange): number[] {
  if (!Number.isInteger(r.base) || !Number.isInteger(r.count)) {
    throw new Error(`FEED-RANGE-001: base/count phải là số nguyên (base=${r.base}, count=${r.count}).`);
  }
  if (r.base < 1) {
    throw new Error(
      `FEED-RANGE-002: FEEDER_BASE=${r.base} < 1. Chỉ số 0 là khoá của chính ví vận hành — ` +
      `feeder trùng owner với tài khoản đã có.`,
    );
  }
  if (r.count < 0) throw new Error(`FEED-RANGE-003: FEEDER_COUNT=${r.count} < 0.`);
  if (r.base + r.count - 1 > 0x7fffffff) {
    throw new Error(`FEED-RANGE-004: dải ${r.base}..${r.base + r.count - 1} vượt chỉ số hardened.`);
  }
  return Array.from({ length: r.count }, (_, i) => r.base + i);
}

/**
 * Bao nhiêu lượt CREATE vừa với phần kho còn trống. Kho chỉ nhận grant khi
 * `outstanding + E ≤ pool` (CLAIM-010, C-SOLV). Trả số lượt vừa — KHÔNG ném khi thiếu chỗ,
 * vì thiếu chỗ là trạng thái bình thường giữa hai lượt vest; phía gọi in ra và dừng.
 */
export function grantsThatFit(pool: bigint, outstanding: bigint, perFeeder: bigint,
                              wanted: number): number {
  if (perFeeder <= 0n) throw new Error(`FEED-GRANT-001: E mỗi feeder phải > 0 (đang ${perFeeder}).`);
  const free = pool - outstanding;
  if (free <= 0n) return 0;
  const fit = free / perFeeder;
  return fit >= BigInt(wanted) ? wanted : Number(fit);
}

export interface FeederAccount {
  pkh:   string;
  datum: ClaimAccountDatum;
}

export interface RedeemPick {
  pkh:    string;
  amount: bigint;
}

/**
 * Chọn tài khoản rút KẾ TIẾP: lấy tài khoản có `redeemable` LỚN NHẤT (hoà thì pkh nhỏ hơn, để
 * hai lần chạy trên cùng trạng thái chọn cùng một tài khoản). `redeemable` là hàm của SDK — cùng
 * hàm `buildRedeemTx` dùng, kể cả phép cắt ngọn — nên không có phép tính thứ hai để trôi.
 *
 * Vì sao lấy LỚN NHẤT: trần một lượt đọc `treasury.total_redeemed` (C-RDM-TRIM, toàn cục), nên
 * mỗi oildrop rút sớm nới trần cho mọi lượt sau. Rút lượt to trước là đường ngắn nhất qua dốc.
 *
 * `minAmount`: lượt rút dưới ngưỡng này bị bỏ qua — một lượt rút tốn phí như nhau bất kể số,
 * nên rút vụn là đốt phí. Trả `null` khi không tài khoản nào đạt ngưỡng.
 */
export function pickNextRedeem(accounts: FeederAccount[], beacon: BeaconDatum,
                               treasury: TreasuryDatum, window: bigint, trimFloor: bigint,
                               minAmount: bigint): RedeemPick | null {
  let best: RedeemPick | null = null;
  for (const a of accounts) {
    const amount = redeemable(a.datum, beacon, treasury, window, trimFloor);
    if (amount <= 0n || amount < minAmount) continue;
    if (!best || amount > best.amount || (amount === best.amount && a.pkh < best.pkh)) {
      best = { pkh: a.pkh, amount };
    }
  }
  return best;
}

/** Cắt danh sách thành lô ≤ `size` — lượt gom giới hạn số input theo kích thước giao dịch. */
export function chunk<T>(xs: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`FEED-SWEEP-001: cỡ lô ${size} không hợp lệ.`);
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * FEED-SWEEP-002/003: đích gom CHỈ được là ví payment-key, đúng mạng. Cardano không chạy
 * validator lúc TẠO output, nên gom vào một địa chỉ script mà không biết nó đòi datum gì là
 * khoá tài sản vĩnh viễn mà không gì đỏ: rót đúng địa chỉ chưa phải rót vào sổ của kho.
 * Rót vào kho có script thì đi runner riêng biết hình dạng kho đó.
 */
export function assertSweepTarget(addr: string, networkId: 0 | 1): void {
  if (!addr) throw new Error(`FEED-SWEEP-002: đặt SWEEP_TO = địa chỉ ví nhận.`);
  const d = getAddressDetails(addr);
  if (d.networkId !== networkId) {
    throw new Error(`FEED-SWEEP-002: ${addr} thuộc networkId ${d.networkId}, chờ ${networkId}.`);
  }
  if (d.paymentCredential?.type !== "Key") {
    throw new Error(
      `FEED-SWEEP-003: ${addr} có payment credential kiểu '${d.paymentCredential?.type}', ` +
      `không phải 'Key'. Lượt gom chỉ rót vào ví thường.`,
    );
  }
}

export interface TrancheCost {
  grants:           number;
  entitlementTotal: bigint;
  /** lovelace khoá trong UTxO tài khoản (min-ADA), mỗi grant một lần. */
  lockedLovelace:   bigint;
  /** lovelace phí ước lượng cho các lượt grant. */
  grantFeeLovelace: bigint;
}

/**
 * Chi phí một đợt CREATE. Hai hằng đo trên Preprod (tx `838307c9…da26`, 2026-09-26): UTxO tài
 * khoản khoá ~2 ADA, phí ~0,5 ADA. Đây là ƯỚC LƯỢNG để in kế hoạch — con số thật là của chuỗi.
 */
export function trancheCost(grants: number, perFeeder: bigint,
                            lockPerGrant = 2_000_000n, feePerGrant = 500_000n): TrancheCost {
  const g = BigInt(grants);
  return {
    grants,
    entitlementTotal: g * perFeeder,
    lockedLovelace:   g * lockPerGrant,
    grantFeeLovelace: g * feePerGrant,
  };
}
