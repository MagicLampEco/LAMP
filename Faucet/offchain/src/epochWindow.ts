// epochWindow.ts — nhãn epoch và cửa sổ hiệu lực, dạng THUẦN (nhận `nowMs`, không đọc đồng hồ).
//
// Phép tính cửa sổ KHÔNG còn chép ở đây: gọi `windowBounds` của `@magiclamp/utils` (nguồn duy nhất,
// Specs/Window/CONTRACT.md v1.0 WIN-ORIGIN-4). Tệp này chỉ giữ phần riêng của Faucet: mốc `nowMs`
// thuần, kẹp nhãn trong cửa sổ hiện tại (Issue #76), và hằng `WINDOW_TTL_MS` mà
// `Genesis/tests/windowTtlSync.test.ts` đối chiếu. `Faucet/scripts/*.ts` lẫn `Faucet/tests/*.test.ts`
// đều trỏ về đúng một tệp này.
//
import { windowBounds } from "@magiclamp/utils";

// LỖ ĐÃ CÓ, ĐỂ LẦN SAU KHÔNG DỰNG LẠI (chép nguyên từ nguồn — xem Issue #76)
// Bản cũ trong Faucet suy nhãn epoch từ `now − 90s` (hoặc `now − 60s`) rồi CHIA LUÔN, không
// kẹp trong cửa sổ hiện tại. 60–90 giây ĐẦU mỗi epoch, phép chia đó trả về nhãn epoch TRƯỚC.
// Nhãn sai đó bị ghi vào `start_epoch` (Reserve, BẤT BIẾN theo Luật 7 `reserve_draw.ak`) hoặc
// `last_epoch` (Reserve/Faucet account) — không sửa lại được sau khi đã ghi.

// ─────────────────────────────────────────────────────────────────────────
// GỐC CỬA SỔ — Specs/Window/CONTRACT.md v1.0 (WIN-ORIGIN-1..4).
// Cửa sổ = `(t − windowOriginMs) / msPerEpoch`, KHÔNG phải `t / msPerEpoch` (lưới Unix cũ mà mọi
// validator có tham số `window_origin_ms` đã bỏ). Mọi hàm dưới đây nhận `windowOriginMs`
// TƯỜNG MINH (không suy từ mạng — test dùng `Preview`, mạng không có gốc). Phép tính nằm ở MỘT
// nơi, `Utils/src/index.ts` ▸ `windowBounds`; tệp này chỉ đổi number ↔ bigint và thêm phần
// riêng của Faucet (lùi `lo`, kẹp TTL). Giá trị gốc của mạng lấy từ `windowOriginMs(network)`
// của `@magiclamp/utils` ở tầng script (Preview ném lỗi).
// ─────────────────────────────────────────────────────────────────────────

/** Kiểm đầu vào số học cửa sổ, ném lỗi có mã thay vì trả nhãn vô nghĩa. */
function assertWindowInputs(fn: string, nowMs: number, msPerEpoch: number, windowOriginMs: number): void {
  if (!(msPerEpoch > 0)) {
    throw new Error(`${fn}: msPerEpoch phải > 0, nhận ${msPerEpoch}`);
  }
  if (typeof windowOriginMs !== "number" || !Number.isFinite(windowOriginMs) || windowOriginMs < 0) {
    throw new Error(
      `FAUCET-WINDOW-002: ${fn}: windowOriginMs phải là số hữu hạn ≥ 0, nhận ${String(windowOriginMs)}. ` +
      `Thiếu nó thì cửa sổ bị chia từ gốc Unix — lưới cũ (Specs/Window/CONTRACT.md v1.0). Lấy từ ` +
      `\`windowOriginMs(network)\` của @magiclamp/utils.`,
    );
  }
  if (nowMs < windowOriginMs) {
    throw new Error(
      `FAUCET-WINDOW-003: ${fn}: nowMs ${nowMs} trước windowOriginMs ${windowOriginMs} — không rơi ` +
      `vào cửa sổ nào (WIN-ORIGIN-1). Thường là giờ giả/giờ nhỏ trên mạng có gốc cửa sổ thật.`,
    );
  }
}

/** Cửa sổ chứa `nowMs` (ms, number) — bọc `Utils ▸ windowBounds`. */
function boundsAt(
  nowMs: number, msPerEpoch: number, windowOriginMs: number,
): { epoch: bigint; startMs: number; endMs: number } {
  const b = windowBounds(BigInt(Math.floor(nowMs)), BigInt(windowOriginMs), BigInt(msPerEpoch));
  return { epoch: b.epoch, startMs: Number(b.startMs), endMs: Number(b.endMs) };
}

/** Nhãn cửa sổ của một mốc: `(nowMs − windowOriginMs) / msPerEpoch`. KHÔNG lùi trước khi chia — lùi ở đây chỉ đặt sai nhãn. */
export function epochAt(nowMs: number, msPerEpoch: number, windowOriginMs: number): bigint {
  assertWindowInputs("epochAt", nowMs, msPerEpoch, windowOriginMs);
  return boundsAt(nowMs, msPerEpoch, windowOriginMs).epoch;
}

/**
 * Cửa sổ hiệu lực cho một giao dịch chạy tại `nowMs`. Ba mệnh đề, cả ba đều phải đúng:
 *   · `lo` và `hi` cùng một cửa sổ  — `reserve_draw` Luật 2b ép `(hi − o) / mspe == t`;
 *   · `hi > lo`                     — khoảng không rỗng;
 *   · `lo ≤ nowMs ≤ hi`             — khoảng CHỨA thời điểm gửi.
 */
export function windowAt(
  nowMs: number,
  msPerEpoch: number,
  windowOriginMs: number,
): { loMs: number; hiMs: number; t: bigint } {
  assertWindowInputs("windowAt", nowMs, msPerEpoch, windowOriginMs);
  const { epoch: t, startMs: windowStart, endMs: windowEnd } = boundsAt(nowMs, msPerEpoch, windowOriginMs);
  // Lùi 60 s cho lệch đồng hồ node/máy dựng, nhưng KẸP trong epoch.
  const loMs = Math.max(nowMs - 60_000, windowStart);
  // Đầu trên = cái SỚM hơn của hết-epoch-trừ-1-ms và `now + WINDOW_TTL_MS`. Không kẹp thì với
  // epoch 5 ngày đầu trên tới gần 5 ngày sau `now`, vượt chân trời dự báo của node (~1,5 ngày)
  // ⇒ PastHorizon — lỗi `demo_reserve_draw_resume.ts` từng gặp (dòng đầu tệp đó).
  const hiMs = Math.min(windowEnd, nowMs + WINDOW_TTL_MS);
  return { loMs, hiMs, t };
}

/** Trần TTL — PHẢI khớp `Genesis/scripts/_epochWindow.ts` ▸ `WINDOW_TTL_MS` (chép 2026-09-17); `Genesis/tests/windowTtlSync.test.ts` đỏ khi lệch. */
export const WINDOW_TTL_MS = 3_600_000;

// ─────────────────────────────────────────────────────────────────────────
// PINNED WINDOW — nghĩa vụ off-chain riêng của Faucet v3 (`util.get_epoch_pinned`).
// KHÔNG gộp vào `windowAt` ở trên: `windowAt` phục vụ chung cả Reserve draw (script
// `demo_reserve_*.ts` trong CHÍNH thư mục này) lẫn Faucet, và nó lùi `lo` tới 60s cho lệch
// đồng hồ — hợp lý khi cửa sổ dài 5 ngày. Pinned window của Faucet v3 có yêu cầu THÊM mà
// `windowAt` không có: nghĩa vụ builder ở `Faucet/CONTRACT.md` §5 đòi `lo = now_ms` (KHÔNG
// lùi) và NÉM lỗi có mã khi phần bucket còn lại ngắn hơn TTL tối thiểu — thay vì lặng lẽ trả
// về một cửa sổ rất hẹp như `windowAt` vẫn làm. Sửa `windowAt` để thêm hành vi này sẽ đổi luôn
// cách Reserve demo tính cửa sổ, ngoài phạm vi bản vá này.
// ─────────────────────────────────────────────────────────────────────────

/** Trần dưới của cửa sổ pinned — build/ký/gửi tx cần tối thiểu chừng này để không hết hạn
 *  giữa chừng. Không phải hằng on-chain, chỉ là biên an toàn offchain. */
export const MIN_PINNED_WINDOW_MS = 60_000;

/**
 * Cửa sổ hiệu lực PINNED — dùng cho MỌI redeemer đòi `util.get_epoch_pinned` (hai cận hữu hạn,
 * CÙNG một bucket `ms_per_epoch`): `PoolRedeemer::ClaimOpen/ClaimAgain`, `AccountRedeemer::
 * Use/TopUp`, `FaucetNftRedeemer::MintPool`. KHÔNG dùng cho `AccountRedeemer::ReclaimIdle`
 * (nhánh đó cố ý đọc cận dưới qua `util.get_epoch`, xem `reclaimBuilder.ts`).
 *
 * `lo = nowMs` (KHÔNG lùi cho lệch đồng hồ — khác `windowAt`).
 * `hi = min(nowMs + ttlMs, cuối bucket − 1ms)`.
 * Phần bucket còn lại ngắn hơn `minWindowMs` → NÉM lỗi có mã, không tự nới `hi` sang bucket
 * sau, không ngủ chờ (đó là quyết định của caller, không phải của hàm thuần này).
 */
export function pinnedEpochWindow(
  nowMs: number,
  msPerEpoch: number,
  windowOriginMs: number,
  ttlMs: number = WINDOW_TTL_MS,
  minWindowMs: number = MIN_PINNED_WINDOW_MS,
): { loMs: number; hiMs: number; epoch: bigint } {
  assertWindowInputs("pinnedEpochWindow", nowMs, msPerEpoch, windowOriginMs);
  const { epoch, endMs: bucketEndMs } = boundsAt(nowMs, msPerEpoch, windowOriginMs);
  const loMs = nowMs;
  const hiMs = Math.min(nowMs + ttlMs, bucketEndMs);
  if (hiMs - loMs < minWindowMs) {
    throw new Error(
      `FAUCET-WINDOW-001: chỉ còn ${hiMs - loMs}ms tới hết bucket ${epoch} (< ${minWindowMs}ms ` +
      `tối thiểu) — chờ sang bucket sau, KHÔNG tự nới hi. now=${nowMs}, msPerEpoch=${msPerEpoch}, windowOriginMs=${windowOriginMs}.`,
    );
  }
  return { loMs, hiMs, epoch };
}
