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
// Tên tài khoản = blake2b_256(owner) (A-ACC-4) ⇒ k tài khoản cần k khoá. Chuỗi KHÔNG chặn đúc
// lại cùng tên ở một giao dịch sau: A-ACC-2 chỉ đếm trong một giao dịch. "Mỗi khoá một tài
// khoản" là quy ước của runner, và runner giữ nó bằng cách đọc lại tài khoản ngay trước mỗi grant.
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
 * mở. Chuỗi KHÔNG chặn việc đó (A-ACC-2 chỉ đếm trong một giao dịch): grant nó sẽ đúc tài khoản
 * thứ hai cho ví vận hành, và `28_beacon_grant_redeem.ts` dừng ở REDEEM-000 vì thấy hai tài
 * khoản. Nên chính dải khoá phải chặn. Trần 2^31 − 1 là trần của chỉ số
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
  /** `txHash#index` của UTxO tài khoản. Một feeder có thể có hơn một tài khoản (xem đầu tệp). */
  ref?:  string | undefined;
}

export interface RedeemPick {
  pkh:    string;
  amount: bigint;
  ref?:   string | undefined;
}

/**
 * Chọn tài khoản rút KẾ TIẾP: lấy tài khoản có `redeemable` LỚN NHẤT (hoà thì pkh nhỏ hơn, rồi `ref` nhỏ hơn, để
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
    const better = best === null
      || amount > best.amount
      || (amount === best.amount &&
          (a.pkh < best.pkh || (a.pkh === best.pkh && (a.ref ?? "") < (best.ref ?? ""))));
    if (better) best = { pkh: a.pkh, amount, ref: a.ref };
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

// ── fundpot: rót LAMP từ địa chỉ feeder THẲNG vào kho script của pot ─────────

/** Một UTxO đang nằm ở địa chỉ enterprise của một feeder. */
export interface FeederUtxo {
  index:   number;                    // chỉ số khoá feeder
  pkh:     string;
  address: string;                    // địa chỉ enterprise của feeder
  ref:     string;                    // `txHash#index`
  assets:  Record<string, bigint>;
}

/** Một giao dịch rót: các input feeder, phần vào pot, phần LAMP thừa về feeder đầu lô. */
export interface PotBatch {
  inputs:        FeederUtxo[];
  lampIn:        bigint;
  potAmount:     bigint;
  change:        bigint;              // LAMP thừa, = lampIn − potAmount
  changeAddress: string;              // địa chỉ feeder ĐẦU lô
}

export interface PotFundPlan {
  batches:   PotBatch[];
  /** Tổng LAMP sẽ vào pot theo kế hoạch (≤ amount; < amount chỉ khi ALLOW_PARTIAL). */
  total:     bigint;
  /** LAMP dùng được ở các feeder (chỉ UTxO thuần {lovelace, LAMP}). */
  available: bigint;
  /** UTxO mang LAMP nhưng bị loại, kèm lý do — ĐẾM, không im. */
  excluded:  { ref: string; index: number; reason: string }[];
  partial:   boolean;
}

/**
 * FEED-POT: chọn UTxO LAMP ở địa chỉ các feeder cho đủ `amount`, chia thành lô ≤ `batchSize`
 * input mỗi giao dịch (mỗi input kèm một chữ ký feeder — giữ giao dịch dưới trần kích thước).
 *
 * Chọn LỚN TRƯỚC (hoà: chỉ số feeder nhỏ hơn, rồi `ref` nhỏ hơn) — ít input nhất, và hai lần chạy
 * trên cùng trạng thái chọn cùng một tập. Dừng ngay khi đủ, nên chỉ lô CUỐI có LAMP thừa; phần
 * thừa về địa chỉ feeder ĐẦU lô đó, không về ví nào khác.
 *
 * Loại (và đếm) UTxO mang asset khác ngoài {lovelace, LAMP}: tiêu nó thì asset lạ chảy theo
 * tiền thối về ví vận hành — lượt rót pot không được lặng lẽ dời tài sản khác.
 *
 * Không đủ LAMP, hoặc cần nhiều giao dịch hơn `maxTx` ⇒ NÉM (không rót một phần), trừ khi
 * `allowPartial`: lúc đó rót tối đa những gì có trong ≤ `maxTx` giao dịch.
 *
 * `minPotAmount` (D — một suất của pot): MỌI output pot phải mang ≥ D. Dịch vụ phát của Wakeme
 * (`PotUtxoSelector.selectPotUtxo`) chỉ chọn MỘT UTxO kho mang ≥ D và không có bộ dựng `Collect`,
 * nên một UTxO kho < D là LAMP nằm trong sân kho mà không bao giờ được phát — không gì báo.
 * Có lô nào rót < D (thường là lô cuối: nó chỉ rót phần còn lại) ⇒ NÉM FEED-POT-005, không rót.
 * Cố ý TỪ CHỐI chứ không GỘP lô cuối vào lô trước: mọi lô trừ lô cuối là một lát ĐẦY `batchSize`
 * input, nên gộp luôn vượt trần kích thước mà `batchSize` canh — nhánh gộp sẽ là mã chết. Người
 * chạy chỉnh AMOUNT_OILDROP (phần dư ≥ D) hoặc POT_BATCH là đủ, và cả hai đều thấy trước khi gửi.
 */
export function planPotFunding(utxos: FeederUtxo[], o: {
  lampUnit: string; amount: bigint; batchSize: number; maxTx: number; allowPartial: boolean;
  minPotAmount: bigint;
}): PotFundPlan {
  if (o.amount <= 0n) throw new Error(`FEED-POT-001: AMOUNT_OILDROP phải > 0 (đang ${o.amount}).`);
  if (!Number.isInteger(o.batchSize) || o.batchSize < 1) {
    throw new Error(`FEED-POT-002: cỡ lô ${o.batchSize} không hợp lệ.`);
  }
  if (!Number.isInteger(o.maxTx) || o.maxTx < 1) throw new Error(`FEED-POT-002: MAX_TX ${o.maxTx} không hợp lệ.`);
  if (o.minPotAmount < 1n) {
    throw new Error(`FEED-POT-002: suất tối thiểu mỗi output pot phải ≥ 1 (đang ${o.minPotAmount}).`);
  }

  const usable: FeederUtxo[] = [];
  const excluded: PotFundPlan["excluded"] = [];
  for (const u of utxos) {
    const lamp = u.assets[o.lampUnit] ?? 0n;
    if (lamp <= 0n) continue;
    const others = Object.keys(u.assets).filter((k) => k !== "lovelace" && k !== o.lampUnit);
    if (others.length > 0) {
      excluded.push({ ref: u.ref, index: u.index, reason: `mang asset khác: ${others.join(",")}` });
      continue;
    }
    usable.push(u);
  }
  const lampOf = (u: FeederUtxo): bigint => u.assets[o.lampUnit]!;
  usable.sort((a, b) => {
    const d = lampOf(b) - lampOf(a);
    if (d !== 0n) return d > 0n ? 1 : -1;
    if (a.index !== b.index) return a.index - b.index;
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  });
  const available = usable.reduce((s, u) => s + lampOf(u), 0n);

  if (available === 0n) {
    throw new Error(`FEED-POT-003: các feeder không có LAMP nào dùng được (loại ${excluded.length} UTxO). Cần ${o.amount}.`);
  }
  if (available < o.amount && !o.allowPartial) {
    throw new Error(
      `FEED-POT-003: feeder có ${available} oildrop LAMP, cần ${o.amount}, thiếu ${o.amount - available}. ` +
      `Không rót một phần — đặt ALLOW_PARTIAL=true nếu muốn rót phần đang có.`,
    );
  }
  const target = available < o.amount ? available : o.amount;

  // Lấy lớn trước tới khi đủ.
  const picked: FeederUtxo[] = [];
  let sum = 0n;
  for (const u of usable) {
    if (sum >= target) break;
    picked.push(u);
    sum += lampOf(u);
  }

  let batches: PotBatch[] = [];
  let remaining = target;
  for (let i = 0; i < picked.length; i += o.batchSize) {
    const inputs = picked.slice(i, i + o.batchSize);
    const lampIn = inputs.reduce((s, u) => s + lampOf(u), 0n);
    const potAmount = lampIn < remaining ? lampIn : remaining;
    remaining -= potAmount;
    batches.push({ inputs, lampIn, potAmount, change: lampIn - potAmount, changeAddress: inputs[0]!.address });
  }
  if (batches.length > o.maxTx) {
    if (!o.allowPartial) {
      throw new Error(
        `FEED-POT-004: cần ${batches.length} giao dịch để rót ${target}, MAX_TX=${o.maxTx}. ` +
        `Tăng MAX_TX (hoặc POT_BATCH), hoặc đặt ALLOW_PARTIAL=true để rót phần vừa ${o.maxTx} giao dịch.`,
      );
    }
    batches = batches.slice(0, o.maxTx);
  }
  // Soát SAU phép cắt MAX_TX, trên đúng tập lô sẽ gửi: không output pot nào < D.
  const small = batches.findIndex((b) => b.potAmount < o.minPotAmount);
  if (small >= 0) {
    throw new Error(
      `FEED-POT-005: lô ${small + 1}/${batches.length} rót ${batches[small]!.potAmount} < suất pot ${o.minPotAmount} — ` +
      `UTxO kho dưới một suất không bao giờ được phát (dịch vụ chỉ chọn MỘT UTxO ≥ suất). ` +
      `Đổi AMOUNT_OILDROP (hoặc POT_BATCH) để phần rót của mọi lô ≥ suất.`,
    );
  }
  const total = batches.reduce((s, b) => s + b.potAmount, 0n);
  return { batches, total, available, excluded, partial: total < o.amount };
}

// ── chạy khô ở một thời điểm khác + hạn giờ chờ giao dịch ─────────────────────

/**
 * FEED-ENV-003/004: `DRY_RUN_AT_MS` — dựng giao dịch như thể đồng hồ đang ở mốc này (posix ms),
 * để chạy khô Redeem ở cửa sổ SAU trước giờ: Lucid đánh giá pha 2 cục bộ, nên validator thấy
 * đúng cửa sổ của khoảng hiệu lực dựng ra. Trống ⇒ `undefined` (dùng giờ thật).
 *   · đặt cùng SUBMIT=true ⇒ NÉM: giao dịch dựng cho một thời điểm khác mà gửi đi thì hoặc bị
 *     từ chối, hoặc — tệ hơn — lọt vào đúng lúc mà người chạy không định;
 *   · STEP khác plan|redeem ⇒ NÉM: các bước khác không đọc mốc này, im lặng bỏ qua nó là để
 *     người chạy tin rằng mình đã thử ở cửa sổ kia.
 */
export function dryRunAtFromEnv(raw: string | undefined, submit: boolean, step: string): bigint | undefined {
  const v = (raw ?? "").trim();
  if (!v) return undefined;
  if (!/^[0-9]+$/.test(v)) throw new Error(`FEED-ENV-001: DRY_RUN_AT_MS='${raw}' không phải số nguyên không âm.`);
  if (submit) {
    throw new Error(`FEED-ENV-003: DRY_RUN_AT_MS chỉ hợp lệ khi SUBMIT=false — không gửi giao dịch dựng cho một thời điểm khác.`);
  }
  if (step !== "plan" && step !== "redeem") {
    throw new Error(`FEED-ENV-004: DRY_RUN_AT_MS chỉ áp cho STEP=plan|redeem (đang STEP=${step}).`);
  }
  return BigInt(v);
}

/**
 * Chờ `p` tối đa `ms` mili-giây; quá hạn ⇒ ném lỗi do `onTimeout` dựng. Không huỷ được `p` (nhà
 * cung cấp vẫn thăm dò ở nền) — người gọi phải để ngoại lệ đi lên tới chỗ thoát tiến trình.
 * Đồng hồ lấy qua `globalThis` có kiểu tường minh: tệp này lọt vào chương trình tsc không có
 * @types/node (xem `_guards.ts`, đoạn cuối phần đầu tệp).
 */
export async function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  if (!Number.isInteger(ms) || ms < 1) throw new Error(`FEED-ENV-001: hạn giờ ${ms} ms không hợp lệ (phải ≥ 1).`);
  const timers = globalThis as unknown as {
    setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void;
  };
  let handle: unknown;
  const deadline = new Promise<never>((_, reject) => {
    handle = timers.setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    timers.clearTimeout(handle);
  }
}

// ── sweep: gom ĐÚNG một lượng LAMP từ địa chỉ feeder về một ví payment-key ────

/**
 * FEED-SWEEP-004: lượng gom BẮT BUỘC, không mặc định. Thiếu ⇒ ném, không quay về "gom tất".
 * Chuỗi rỗng, không phải số nguyên, hoặc ≤ 0 đều ném cùng mã.
 */
export function sweepAmountFromEnv(raw: string | undefined): bigint {
  const v = (raw ?? "").trim();
  if (!v) {
    throw new Error(
      `FEED-SWEEP-004: STEP=sweep đòi AMOUNT_OILDROP (gom ĐÚNG bao nhiêu). Không có mặc định "gom tất" — ` +
      `bản cũ gom mọi UTxO LAMP ở cả dải.`,
    );
  }
  if (!/^[0-9]+$/.test(v) || BigInt(v) <= 0n) {
    throw new Error(`FEED-SWEEP-004: AMOUNT_OILDROP='${raw}' phải là số nguyên dương.`);
  }
  return BigInt(v);
}

/**
 * FEED-SWEEP: kế hoạch gom ĐÚNG `amount` oildrop LAMP. Dùng lại trọn phép chọn của
 * `planPotFunding` (lớn trước, loại UTxO mang asset lạ, phần thừa về feeder ĐẦU lô cuối) — một
 * phép chọn, hai đích, không có bản thứ hai để trôi. Khác fundpot ở hai chỗ:
 *   · đích là ví thường, không có ràng buộc suất ⇒ `minPotAmount = 1`;
 *   · KHÔNG có chế độ rót một phần: thiếu LAMP, hoặc cần nhiều giao dịch hơn `maxTx` ⇒ NÉM.
 * Bản cũ gom MỌI UTxO LAMP ở cả dải (tới SWEEP_BATCH × MAX_TX), nên "gom 100.000 cho X" khi
 * feeder đang giữ phần dành cho pot là gửi cả phần đó cho X — sang nhà khác thì không rút lại được.
 */
export function planSweep(utxos: FeederUtxo[], o: {
  lampUnit: string; amount: bigint; batchSize: number; maxTx: number;
}): PotFundPlan {
  if (o.amount <= 0n) throw new Error(`FEED-SWEEP-004: AMOUNT_OILDROP phải > 0 (đang ${o.amount}).`);
  if (!Number.isInteger(o.batchSize) || o.batchSize < 1) {
    throw new Error(`FEED-SWEEP-001: cỡ lô ${o.batchSize} không hợp lệ.`);
  }
  // allowPartial=true CHỈ để đọc được `available`/`total` thay vì câu lỗi của fundpot (câu đó gợi ý
  // ALLOW_PARTIAL, mà sweep không có); kế hoạch thiếu thì ném ngay dưới đây.
  const p = planPotFunding(utxos, { ...o, allowPartial: true, minPotAmount: 1n });
  if (p.partial) {
    throw new Error(
      `FEED-SWEEP-005: cần gom ${o.amount} oildrop LAMP, feeder dùng được ${p.available} ` +
      `(loại ${p.excluded.length} UTxO mang asset lạ), kế hoạch ≤ MAX_TX=${o.maxTx} giao dịch gom được ${p.total}. ` +
      `Không gửi thiếu — tăng MAX_TX/SWEEP_BATCH hoặc rút thêm về feeder.`,
    );
  }
  return p;
}
