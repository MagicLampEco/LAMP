// epochWindow — khoảng hiệu lực cho MỌI giao dịch của đường biểu quyết v2.
//
// On-chain: `onchain/lib/magiclamp/governance/util.ak ▸ get_epoch_bounded` đòi CẢ HAI biên
// validity range hữu hạn VÀ `(lo − window_origin_ms) / ms_per_epoch == (hi − window_origin_ms) /
// ms_per_epoch` (chia sàn). Mọi nhánh governance/tally/vote/nullifier đều gọi nó (`SPEC.md`
// §v2.8 `R-EPOCH-BOUNDED`). Gốc cửa sổ `window_origin_ms` là tham số CUỐI của các validator đó
// (Specs/Window/CONTRACT.md v1.0) — mọi hàm dưới đây nhận nó TƯỜNG MINH, không suy từ mạng.
//
// Phép chia `(t − o) / m` ở đây là BẢN CHÉP CÓ NHÃN của `Utils/src/index.ts ▸ windowOf`/
// `windowBounds` (chép 2026-10-02). Không import thẳng được: `tsconfig.json` của gói này ép
// `rootDir: ".."` (= `Governance/`) nên import xuyên sang `Utils/` ném TS6059. Bản gốc ở Utils
// có vector kiểm của spec §3 (`Utils/tests/windowOrigin.test.ts`); bài của gói này
// (`tests/ledgerAndNames.test.ts`) dùng gốc Mainnet thật để bắt cả bản quên trừ gốc.
//
// Vì sao phải biết SLOT: ledger đổi `validFrom/validTo` ra SỐ SLOT (Lucid làm tròn XUỐNG), rồi
// script đọc lại thời điểm = đầu slot. Nếu đầu kỷ nguyên không trùng ranh giới slot (Emulator
// đặt `zeroTime = Date.now()`), làm tròn xuống có thể kéo `lo` sang kỷ nguyên TRƯỚC — script
// thấy hai biên khác kỷ nguyên và bác. Hàm dưới trả về hai mốc ĐÃ căn slot, nên phép làm tròn
// của Lucid là phép đồng nhất và điều builder kiểm chính là điều script thấy.
//
// Thuần: nhận `nowMs`, không đọc đồng hồ.

import { floorDiv } from "./tallyMath.js";

export interface SlotConfig {
  zeroTime: number;
  zeroSlot: number;
  slotLength: number;
}

/** Trần TTL mặc định — cùng giá trị `Faucet/offchain/src/epochWindow.ts ▸ WINDOW_TTL_MS` (1 giờ). */
export const WINDOW_TTL_MS = 3_600_000;
/** Độ rộng tối thiểu để ký + gửi kịp. Biên an toàn off-chain, không phải hằng on-chain. */
export const MIN_WINDOW_MS = 60_000;

/** util.ak ▸ get_epoch — cửa sổ của một mốc ms: `(ms − windowOriginMs) / msPerEpoch` (chia sàn). */
export function epochOf(ms: number, msPerEpoch: bigint, windowOriginMs: bigint): bigint {
  if (!(msPerEpoch > 0n)) throw new Error(`GOV-WINDOW-000: msPerEpoch phải > 0, nhận ${msPerEpoch}`);
  if (typeof windowOriginMs !== "bigint" || windowOriginMs < 0n) {
    throw new Error(
      `GOV-WINDOW-007: windowOriginMs phải là bigint ≥ 0, nhận ${String(windowOriginMs)}. Thiếu nó thì cửa sổ ` +
      `bị chia từ gốc Unix — lưới cũ mà mọi validator có tham số \`window_origin_ms\` đã bỏ (Specs/Window/CONTRACT.md v1.0).`,
    );
  }
  if (!Number.isSafeInteger(ms)) throw new Error(`GOV-WINDOW-000: mốc thời gian phải là số nguyên an toàn, nhận ${ms}`);
  if (BigInt(ms) < windowOriginMs) {
    throw new Error(
      `GOV-WINDOW-008: mốc ${ms} trước windowOriginMs ${windowOriginMs} — không rơi vào cửa sổ nào (WIN-ORIGIN-1). ` +
      `Aiken chia cắt về 0 nên on-chain sẽ ra một nhãn sai trông hợp lệ; không tính ở đây.`,
    );
  }
  return floorDiv(BigInt(ms) - windowOriginMs, msPerEpoch);
}

function assertSlotConfig(s: SlotConfig): SlotConfig {
  if (
    s === null || typeof s !== "object" ||
    !Number.isSafeInteger(s.zeroTime) || !Number.isSafeInteger(s.zeroSlot) ||
    !Number.isSafeInteger(s.slotLength) || s.slotLength <= 0
  ) {
    throw new Error(`GOV-WINDOW-003: slotConfig sai hình dạng ${JSON.stringify(s)}`);
  }
  return s;
}

function slotFloorMs(t: number, s: SlotConfig): number {
  return s.zeroTime + Math.floor((t - s.zeroTime) / s.slotLength) * s.slotLength;
}

function slotCeilMs(t: number, s: SlotConfig): number {
  return s.zeroTime + Math.ceil((t - s.zeroTime) / s.slotLength) * s.slotLength;
}

export interface EpochWindow {
  loMs: number;
  hiMs: number;
  /** `e` mà validator sẽ tính — hai biên cùng kỷ nguyên này. */
  epoch: bigint;
}

/**
 * Khoảng hiệu lực gói trong ĐÚNG MỘT kỷ nguyên (cửa sổ tính từ `windowOriginMs`) chứa `nowMs`, hai biên căn slot.
 *   lo = đầu slot chứa `now`, nhưng không sớm hơn slot đầu tiên nằm trọn trong kỷ nguyên;
 *   hi = đầu slot chứa min(cuối kỷ nguyên − 1ms, now + ttl).
 * Còn ít hơn `minWindowMs` ⇒ ném `GOV-WINDOW-001` (chờ kỷ nguyên sau, KHÔNG tự nới sang đó).
 */
export function boundedEpochWindow(
  nowMs: number,
  msPerEpoch: bigint,
  windowOriginMs: bigint,
  slotConfig: SlotConfig,
  ttlMs: number = WINDOW_TTL_MS,
  minWindowMs: number = MIN_WINDOW_MS,
): EpochWindow {
  const s = assertSlotConfig(slotConfig);
  const epoch = epochOf(nowMs, msPerEpoch, windowOriginMs);
  const epochStart = Number(windowOriginMs + epoch * msPerEpoch);
  const epochLast = Number(windowOriginMs + (epoch + 1n) * msPerEpoch) - 1;
  let loMs = slotFloorMs(nowMs, s);
  if (loMs < epochStart) {
    loMs = slotCeilMs(epochStart, s);
    if (loMs > nowMs) {
      throw new Error(
        `GOV-WINDOW-002: now=${nowMs} nằm trong slot vắt qua đầu kỷ nguyên ${epoch} — chờ tới ${loMs} rồi dựng lại.`,
      );
    }
  }
  const hiMs = slotFloorMs(Math.min(epochLast, nowMs + ttlMs), s);
  if (hiMs - loMs < minWindowMs) {
    throw new Error(
      `GOV-WINDOW-001: chỉ còn ${hiMs - loMs}ms (< ${minWindowMs}ms) tới hết kỷ nguyên ${epoch} — ` +
      `chờ kỷ nguyên sau, KHÔNG tự nới hi. now=${nowMs}, msPerEpoch=${msPerEpoch}, windowOriginMs=${windowOriginMs}.`,
    );
  }
  if (epochOf(loMs, msPerEpoch, windowOriginMs) !== epoch || epochOf(hiMs, msPerEpoch, windowOriginMs) !== epoch) {
    throw new Error(`GOV-WINDOW-004: khoảng [${loMs}, ${hiMs}] không nằm trọn kỷ nguyên ${epoch} — lỗi nội bộ, không gửi`);
  }
  return { loMs, hiMs, epoch };
}

/** Kiểm một khoảng DO NGƯỜI GỌI ĐƯA (không tự tính) có thoả `get_epoch_bounded` không. */
export function assertBoundedWindow(loMs: number, hiMs: number, msPerEpoch: bigint, windowOriginMs: bigint): bigint {
  if (!(hiMs > loMs)) throw new Error(`GOV-WINDOW-005: hi (${hiMs}) phải > lo (${loMs})`);
  const a = epochOf(loMs, msPerEpoch, windowOriginMs);
  const b = epochOf(hiMs, msPerEpoch, windowOriginMs);
  if (a !== b) {
    throw new Error(
      `GOV-WINDOW-006: khoảng hiệu lực vắt hai kỷ nguyên (${a} → ${b}) — util.get_epoch_bounded on-chain sẽ bác`,
    );
  }
  return a;
}
