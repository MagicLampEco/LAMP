// delegatorSnapshot.ts — LÕI THUẦN cho builder Delegator v2 (KHÔNG I/O, không mạng).
//
// Ba mảnh chặn-đường của builder cũ, gộp lại + tách khỏi mạng để TEST được:
//   1. verifyRegistration — chữ ký Ed25519 hợp lệ + pubkey suy ra ĐÚNG stake_address
//      khai báo (vá lỗ mạo danh: kẻ khai stake_address nạn nhân + payment của mình).
//   2. dedupeFirstWins — 1 stake_address chỉ tính 1 lần; bản ĐẦU thắng (first-wins:
//      last-wins cho kẻ tấn công chuyển hướng payment về sau, không hồi phục được).
//   3. accStakeWithMinRun — §1.5: chỉ cộng accStake các epoch nằm trong chuỗi giữ
//      delegation ≥ N epoch LIÊN TIẾP (mọi pool). Ví giữ đúng 1 epoch → accStake 0 → loại.
//
// CLI (verify_delegator.ts / build_delegator_snapshot.ts) chỉ fetch Blockfrost rồi
// gọi vào đây. Đầu ra nối thẳng vào delegator_entitlement.buildDelegatorEntitlements.

import { getAddressDetails } from "@lucid-evolution/lucid";
import { verifyEd25519, pubkeyToStakeAddr } from "./delegatorCrypto.js";

// ── Types ────────────────────────────────────────────────────────────────

/** 1 đăng ký delegator (khớp scripts/delegator_register.ts::DelegatorRegistration). */
export interface DelegatorRegistration {
  version: string;
  stake_address: string;
  payment_address: string;
  epochs_active: number[];
  acc_stake_lovelace: string;
  current_pool_id: string | null;
  message: string;
  message_hex: string;
  signature: string;
  signing_pubkey: string;
  signed_at: string;
  nonce: string;
  network: string;
  signing_method: string;
}

/** 1 dòng lịch sử stake từ Blockfrost /accounts/{stake}/history. */
export interface StakeHistoryRow {
  active_epoch: number;
  amount: string; // active stake (lovelace), string BigInt-safe
  pool_id: string | null;
}

// ── 0. Ràng buộc chữ ký ↔ payload (nguồn DÙNG CHUNG cho cả Delegator và SPO) ─
//
// Chữ ký Ed25519 chỉ chứng minh "người này từng ký MỘT chuỗi nào đó". Nó KHÔNG
// chứng minh chuỗi đó nói gì. Nếu pipeline đọc `payment_address` từ JSON mà không
// đối chiếu với chuỗi đã ký, thì: lấy đăng ký công khai của nạn nhân → sửa MỖI
// `payment_address` → giữ nguyên message_hex + signature + pubkey → mọi lớp kiểm
// chữ ký/pubkey/lịch sử stake đều qua → toàn bộ phần LAMP của nạn nhân chảy về ví
// kẻ sửa tệp. Đây là lỗ đã vá cho SPO (`verify_registration.ts` CHECK 5b) — đặt
// ở đây để hai nhánh dùng CHUNG một cài đặt, không vá lệch lần nữa.

// Khai báo tối giản như `delegatorCrypto.ts`: module này node-free, không kéo @types/node.
declare const TextDecoder: {
  new (label: string, opts: { fatal: boolean }): { decode(b: Uint8Array): string };
};

/** hex → chuỗi UTF-8. Ném lỗi nếu không phải hex chẵn byte. */
export function hexToUtf8(hex: string): string {
  const h = (hex ?? "").trim().toLowerCase();
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-f]+$/.test(h)) {
    throw new Error(`không phải chuỗi hex chẵn byte: ${hex}`);
  }
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Đọc giá trị của dòng `Label: <value>` trong message đã ký (nhãn không chứa ký tự regex). */
export function messageField(message: string, label: string): string | null {
  const m = message.match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
  return m ? m[1]!.trim() : null;
}

/**
 * Trường nào của payload KHÔNG khớp message ĐÃ KÝ. Rỗng = chữ ký phủ trọn payload.
 *
 * `signedMessage` PHẢI là chuỗi giải từ `message_hex` (thứ thật sự được ký), KHÔNG
 * phải trường `message` trong JSON — trường đó không nằm trong chữ ký, kẻ tấn công
 * sửa được để nó "khớp" payload đã sửa.
 */
export function boundFieldMismatches(
  signedMessage: string,
  bound: [label: string, value: string][],
): string[] {
  return bound.filter(([l, v]) => messageField(signedMessage, l) !== v).map(([l]) => l);
}

/** Các cặp (nhãn trong message, giá trị payload) mà chữ ký delegator PHẢI phủ. */
export function delegatorBoundFields(reg: DelegatorRegistration): [string, string][] {
  return [
    ["Stake Address", reg.stake_address],
    ["Payment Address", reg.payment_address],
    ["Network", reg.network],
    ["Nonce", reg.nonce],
    ["Epochs", `[${(reg.epochs_active ?? []).join(", ")}]`],
    ["Acc Stake", `${reg.acc_stake_lovelace} lovelace·epoch`],
  ];
}

// ── 1. verify chữ ký + khớp danh tính ──────────────────────────────────────

export interface RegistrationVerdict {
  ok: boolean;
  /** stake_address suy từ signing_pubkey (để đối chiếu / chẩn đoán). null nếu pubkey hỏng. */
  derived_stake_address: string | null;
  /** Lý do TỪ CHỐI (rỗng khi ok). Con người đọc được. */
  reasons: string[];
}

/**
 * Verify MỘT đăng ký — thuần crypto, KHÔNG chạm mạng.
 *   (a) định dạng: signature 128 hex, signing_pubkey 64 hex.
 *   (b) chữ ký Ed25519 khớp message_hex + signing_pubkey.
 *   (c) pubkeyToStakeAddr(signing_pubkey) === stake_address khai báo (chống mạo danh).
 *   (d) payment_address parse được VÀ payment-credential là KEY, không phải SCRIPT
 *       (spec §3.2): owner[28] trong leaf là hash trần, script-addr sinh cùng leaf với
 *       key-addr ⇒ validator ép VerificationKey, lá script không bao giờ claim được.
 *       Loại tại đây để người đăng ký còn kịp khai lại địa chỉ.
 *   (e) chữ ký RÀNG BUỘC payload — mọi trường pipeline dùng phải nằm TRONG message
 *       đã ký (giải từ `message_hex`). Không có (e) thì (b) chỉ chứng minh "từng ký
 *       một chuỗi nào đó": sửa payment_address trong tệp JSON vẫn qua hết (a)-(d).
 * FAIL-CLOSED: bất kỳ điều kiện nào trượt → ok=false, KHÔNG nửa vời.
 * Async vì verify Ed25519 chạy qua WebCrypto subtle (node-free).
 */
export async function verifyRegistration(
  reg: DelegatorRegistration,
): Promise<RegistrationVerdict> {
  const reasons: string[] = [];

  const sig = (reg.signature ?? "").trim().toLowerCase();
  const pub = (reg.signing_pubkey ?? "").trim().toLowerCase();

  if (!/^[0-9a-f]{128}$/.test(sig)) reasons.push("signature không phải 128 hex");
  if (!/^[0-9a-f]{64}$/.test(pub)) reasons.push("signing_pubkey không phải 64 hex");
  if (!reg.message_hex || !/^[0-9a-f]+$/.test(reg.message_hex))
    reasons.push("message_hex trống hoặc không phải hex");

  // Không đủ định dạng để chạy crypto → dừng fail-closed sớm.
  if (reasons.length > 0) return { ok: false, derived_stake_address: null, reasons };

  if (!(await verifyEd25519(reg.message_hex, sig, pub))) {
    reasons.push("chữ ký Ed25519 KHÔNG khớp message/pubkey");
  }

  let derived: string | null = null;
  try {
    derived = pubkeyToStakeAddr(pub, reg.network);
  } catch {
    reasons.push("không suy được stake address từ pubkey");
  }
  if (derived !== null && derived !== reg.stake_address) {
    reasons.push(
      `pubkey KHÔNG khớp stake_address khai báo (khai ${reg.stake_address}, suy ${derived})`,
    );
  }

  // (d) payment_address phải là địa chỉ KEY (spec §3.2 — cấm script-hash).
  try {
    const pd = getAddressDetails(reg.payment_address ?? "").paymentCredential;
    if (!pd) {
      reasons.push("payment_address không có payment credential");
    } else if (pd.type === "Script") {
      reasons.push(
        "payment_address là địa chỉ SCRIPT — owner phải là payment KEY-hash (spec §3.2); " +
          "lá script không claim được, khai lại bằng địa chỉ ví thường",
      );
    }
  } catch {
    reasons.push(`payment_address không phân giải được: ${reg.payment_address}`);
  }

  // (e) chữ ký ràng buộc payload. Nguồn sự thật = chuỗi GIẢI TỪ `message_hex` (thứ
  // được ký), KHÔNG phải `reg.message` — trường đó nằm ngoài chữ ký.
  let signedMessage: string | null = null;
  try {
    signedMessage = hexToUtf8(reg.message_hex);
  } catch {
    reasons.push("message_hex không giải được thành văn bản UTF-8");
  }
  if (signedMessage !== null) {
    const unbound = boundFieldMismatches(signedMessage, delegatorBoundFields(reg));
    if (unbound.length > 0) {
      reasons.push(
        `chữ ký KHÔNG phủ payload — trường lệch message đã ký: ${unbound.join(", ")}`,
      );
    }
    // `message` chỉ để người đọc; lệch với bản đã ký là dấu hiệu tệp bị sửa tay.
    if (reg.message !== undefined && reg.message !== signedMessage) {
      reasons.push("trường `message` khác nội dung thật trong message_hex (tệp đã bị sửa)");
    }
  }

  return { ok: reasons.length === 0, derived_stake_address: derived, reasons };
}

// ── 2. dedupe first-wins (theo stake_address) ──────────────────────────────

export interface DedupeConflict {
  key: string;
  /** loại xung đột: cùng stake_address, hoặc cùng payment_address khác stake. */
  kind: "duplicate_stake" | "payment_collision";
  kept: DelegatorRegistration;
  dropped: DelegatorRegistration;
}

export interface DedupeResult {
  kept: DelegatorRegistration[];
  conflicts: DedupeConflict[];
}

/**
 * Dedupe FIRST-WINS trên stake_address, giữ nguyên thứ tự đầu vào cho bản thắng.
 * Đồng thời bắt payment_address COLLISION giữa các stake_address KHÁC nhau —
 * buildDelegatorEntitlements sẽ ném khi 2 owner (payment) trùng, nên chặn sớm ở đây
 * cho dễ chẩn đoán (drop bản đến sau, ghi xung đột).
 *
 * "Bản đầu thắng" = bản xuất hiện SỚM nhất trong mảng đầu vào. Người gọi nên nạp
 * đăng ký theo thứ tự tất định (vd thời điểm ký / tên file) để first-wins tái lập được.
 */
export function dedupeFirstWins(regs: DelegatorRegistration[]): DedupeResult {
  const kept: DelegatorRegistration[] = [];
  const conflicts: DedupeConflict[] = [];
  const byStake = new Map<string, DelegatorRegistration>();
  const byPayment = new Map<string, DelegatorRegistration>();

  for (const reg of regs) {
    const stake = reg.stake_address;
    const payment = reg.payment_address;

    const priorStake = byStake.get(stake);
    if (priorStake) {
      conflicts.push({ key: stake, kind: "duplicate_stake", kept: priorStake, dropped: reg });
      continue;
    }
    const priorPayment = byPayment.get(payment);
    if (priorPayment) {
      conflicts.push({ key: payment, kind: "payment_collision", kept: priorPayment, dropped: reg });
      continue;
    }
    byStake.set(stake, reg);
    byPayment.set(payment, reg);
    kept.push(reg);
  }
  return { kept, conflicts };
}

// ── 3. accStake với ràng buộc chuỗi ≥N epoch liên tiếp (§1.5) ───────────────

export interface MinRunResult {
  /** Tổng lovelace·epoch chỉ cộng các epoch nằm trong chuỗi ≥N liên tiếp. */
  accStake: bigint;
  /** Các epoch được TÍNH (thuộc chuỗi đủ dài), tăng dần. */
  countedEpochs: number[];
  /** Các epoch có stake > 0 nhưng bị LOẠI (chuỗi ngắn < N). */
  droppedEpochs: number[];
  /** Các chuỗi liên tiếp tìm thấy (để minh bạch kiểm toán). */
  runs: { start: number; end: number; length: number; counted: boolean }[];
}

export interface MinRunOpts {
  /** Số epoch liên tiếp tối thiểu để được tính (mặc định 2). */
  n?: number;
  /** Cửa sổ [eOpen, eCut) — chỉ xét epoch trong khoảng nửa-mở này. Bỏ qua → xét tất cả. */
  eOpen?: number;
  eCut?: number;
}

/**
 * §1.5 — accStake giữ-≥N-epoch-liên-tiếp qua MỌI pool.
 *
 * Đầu vào = lịch sử stake thô (mọi pool, mọi epoch). Bước:
 *   1. Lọc dòng stake > 0; nếu có cửa sổ, chỉ giữ epoch ∈ [eOpen, eCut).
 *   2. Gộp về map epoch→lovelace (mỗi epoch 1 giá trị active stake). Trùng epoch cùng
 *      giá trị → bỏ qua; trùng epoch KHÁC giá trị → ném (nguồn lỗi, fail-closed).
 *   3. Chia thành các chuỗi tối đa epoch LIÊN TIẾP (epoch kế = epoch trước + 1).
 *   4. Chỉ cộng lovelace của epoch thuộc chuỗi độ dài ≥ N.
 *
 * pool_id KHÔNG ảnh hưởng tính liên tiếp: đổi pool giữa các epoch vẫn là "giữ delegation"
 * (lỗ #2 — đa pool). Chỉ cần epoch liền kề và stake > 0.
 */
export function accStakeWithMinRun(
  history: StakeHistoryRow[],
  opts: MinRunOpts = {},
): MinRunResult {
  const n = opts.n ?? 2;
  if (n < 1) throw new Error("DELEG-RUN-000: N phải ≥ 1");
  const hasWindow = opts.eOpen !== undefined || opts.eCut !== undefined;
  const eOpen = opts.eOpen ?? Number.NEGATIVE_INFINITY;
  const eCut = opts.eCut ?? Number.POSITIVE_INFINITY;
  if (hasWindow && opts.eOpen !== undefined && opts.eCut !== undefined && opts.eOpen >= opts.eCut) {
    throw new Error(`DELEG-RUN-001: cửa sổ rỗng [${opts.eOpen}, ${opts.eCut})`);
  }

  // Bước 1–2: map epoch → lovelace (đã lọc stake>0 + cửa sổ).
  const perEpoch = new Map<number, bigint>();
  for (const row of history) {
    const amt = BigInt(row.amount);
    if (amt <= 0n) continue;
    const e = row.active_epoch;
    if (e < eOpen || e >= eCut) continue; // [eOpen, eCut)
    const prior = perEpoch.get(e);
    if (prior !== undefined) {
      if (prior !== amt) {
        throw new Error(
          `DELEG-RUN-002: epoch ${e} có 2 giá trị active stake khác nhau ` +
          `(${prior} vs ${amt}) — lỗi toàn vẹn nguồn lịch sử`,
        );
      }
      continue; // trùng y hệt → bỏ qua
    }
    perEpoch.set(e, amt);
  }

  const epochs = [...perEpoch.keys()].sort((a, b) => a - b);

  // Bước 3: chia thành chuỗi liên tiếp.
  const runs: { start: number; end: number; length: number; counted: boolean }[] = [];
  const countedEpochs: number[] = [];
  const droppedEpochs: number[] = [];
  let accStake = 0n;

  let i = 0;
  while (i < epochs.length) {
    let j = i;
    while (j + 1 < epochs.length && epochs[j + 1]! === epochs[j]! + 1) j++;
    const run = epochs.slice(i, j + 1);
    const counted = run.length >= n;
    runs.push({ start: run[0]!, end: run[run.length - 1]!, length: run.length, counted });
    for (const e of run) {
      if (counted) {
        accStake += perEpoch.get(e)!;
        countedEpochs.push(e);
      } else {
        droppedEpochs.push(e);
      }
    }
    i = j + 1;
  }

  return { accStake, countedEpochs, droppedEpochs, runs };
}

// ── Lõi tính accStake per-registration (join stake→payment + §1.5) ──────────

/** 1 đăng ký (đã verify + dedupe) kèm lịch sử stake đã fetch. */
export interface RegWithHistory {
  stake_address: string;
  payment_address: string;
  history: StakeHistoryRow[];
}

export interface PerRegDetail {
  stake_address: string;
  payment_address: string;
  accStake: bigint;
  counted: number[];
  dropped: number[];
  runs: { start: number; end: number; length: number; counted: boolean }[];
}

export interface DelegatorAccResult {
  /** Đủ điều kiện (accStake > 0), owner = payment_address — nạp buildDelegatorEntitlements. */
  eligible: { payment_address: string; acc_stake_lovelace: bigint }[];
  /** accStake = 0 (không có chuỗi ≥N) → loại khỏi phân bổ. */
  zeroAcc: { stake_address: string; payment_address: string }[];
  /** Chi tiết mỗi đăng ký (minh bạch kiểm toán). */
  perReg: PerRegDetail[];
}

/**
 * Áp §1.5 cho từng đăng ký (đa pool qua history đã fetch) rồi JOIN owner = payment_address.
 * THUẦN, tất định — CLI chỉ fetch history rồi gọi vào đây. Kết quả `eligible` nạp thẳng
 * buildDelegatorEntitlements (owner = payment ⇒ leaf trả được — vá lỗ #1).
 */
export function accStakePerRegistration(
  regs: RegWithHistory[],
  opts: MinRunOpts = {},
): DelegatorAccResult {
  const eligible: { payment_address: string; acc_stake_lovelace: bigint }[] = [];
  const zeroAcc: { stake_address: string; payment_address: string }[] = [];
  const perReg: PerRegDetail[] = [];

  for (const r of regs) {
    const mr = accStakeWithMinRun(r.history, opts);
    perReg.push({
      stake_address: r.stake_address,
      payment_address: r.payment_address,
      accStake: mr.accStake,
      counted: mr.countedEpochs,
      dropped: mr.droppedEpochs,
      runs: mr.runs,
    });
    if (mr.accStake > 0n) {
      eligible.push({ payment_address: r.payment_address, acc_stake_lovelace: mr.accStake });
    } else {
      zeroAcc.push({ stake_address: r.stake_address, payment_address: r.payment_address });
    }
  }
  return { eligible, zeroAcc, perReg };
}
