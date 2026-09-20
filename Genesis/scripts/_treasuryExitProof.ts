// Cổng "kho phải có LỐI RA trước khi nhận LAMP" — sổ `Genesis/treasury-exit-proof.json`.
//
// VÌ SAO CÓ TỆP NÀY, nói bằng chuyện đã xảy ra chứ không bằng nguyên tắc:
//   Trên Preprod, 10 tỷ tLAMP đã vào ĐÚNG địa chỉ kho và vẫn nằm NGOÀI sổ kho — chúng đáp
//   xuống thành một UTxO riêng không mang NFT kho, trong khi nhánh chi trả đòi đúng một input
//   MANG NFT đó. Không giao dịch nào chi được số ấy ra. Rót đúng địa chỉ không phải rót vào sổ.
//   Và LAMP KHÔNG burn (`Treasury/CONTRACT.md §5`), nên "nằm chết" ở đây nghĩa là chết hẳn.
//
//   Cái đắt không phải lỗi dựng giao dịch. Cái đắt là KHÔNG AI BIẾT lối ra chưa từng chạy:
//   nhánh gộp lại (`Refill`) có mã, có bài kiểm, và tới hôm nay vẫn chưa có một lượt nào trên
//   chuỗi. Một nhánh chưa chạy lần nào thì bài kiểm của nó chỉ chứng minh mã khớp với điều
//   người viết TƯỞNG validator đòi.
//
// RÀNG BUỘC ĐƯỢC GHIM: không nạp LAMP vào kho khi chưa có bằng chứng tài sản RA được.
//
// ⚠️ CỔNG NÀY ĐO GÌ, VÀ KHÔNG ĐO GÌ — đọc trước khi tin màu xanh của nó:
//   ĐO:      trong sổ có một dòng bằng chứng đã ghi cho mạng này và cho ĐÚNG địa chỉ kho này.
//   KHÔNG ĐO: dòng đó có đúng với chuỗi hay không. Nó là bản chép có nhãn (mã giao dịch +
//             ngày), không phải một lượt truy vấn. Cổng chạy được khi không có mạng là có chủ
//             ý — nó đứng ở đường dựng giao dịch, nơi không phải lúc nào cũng gọi ra ngoài
//             được. Đối chiếu thật bằng `explorerTx(txHash)` của dòng đó.
//   Nói ra vì một cổng không tự khai phạm vi của nó sẽ bị đọc thành cổng mạnh hơn nó.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXIT_PROOF_LEDGER = join(HERE, "..", "treasury-exit-proof.json");

/** Một lượt chi ra khỏi kho đã xảy ra thật, ghi lại để lượt nạp sau dựa vào. */
export interface ExitProof {
  /** Mã giao dịch của lượt CHI RA (không phải lượt nạp vào). */
  txHash: string;
  /** Ngày đo, dạng YYYY-MM-DD. */
  date: string;
  /** Nhánh nào đã chạy: "Redeem" | "Refill+Redeem" | tên nhánh khác. */
  branch: string;
  /** Địa chỉ kho lúc đó — đổi apply-param là đổi địa chỉ, nên bằng chứng cũ hết giá trị. */
  treasuryAddress: string;
}

export type ExitProofLedger = Record<string, ExitProof | null>;

/** Ba trạng thái phân biệt được, và trạng thái mù phải kêu TO HƠN trạng thái thiếu. */
export type ExitProofStatus =
  | { state: "proven"; proof: ExitProof }
  | { state: "not-proven"; network: string }
  | { state: "unmeasurable"; reason: string };

const REQUIRED_FIELDS = ["txHash", "date", "branch", "treasuryAddress"] as const;

/**
 * Đọc sổ và trả về MỘT trong ba trạng thái. Không ném — hàm này là phép ĐO;
 * việc quyết định chặn hay không thuộc `assertTreasuryHasExit`.
 */
export function measureExitProof(
  network: string,
  ledgerPath: string = EXIT_PROOF_LEDGER,
): ExitProofStatus {
  let raw: string;
  try {
    raw = readFileSync(ledgerPath, "utf8");
  } catch (e) {
    return {
      state: "unmeasurable",
      reason: `không đọc được sổ ${ledgerPath}: ${e instanceof Error ? e.message : e}`,
    };
  }

  let ledger: unknown;
  try {
    ledger = JSON.parse(raw);
  } catch (e) {
    return {
      state: "unmeasurable",
      reason: `sổ ${ledgerPath} không phải JSON hợp lệ: ${e instanceof Error ? e.message : e}`,
    };
  }

  if (typeof ledger !== "object" || ledger === null || Array.isArray(ledger)) {
    return { state: "unmeasurable", reason: `sổ ${ledgerPath} phải là một đối tượng theo mạng.` };
  }

  // Mạng KHÔNG có khoá trong sổ ≠ mạng có khoá với giá trị null. Cái đầu là sổ chưa biết mạng
  // này tồn tại (mù); cái sau là một lời khai có chủ ý rằng lối ra chưa chạy. Gộp hai cái làm
  // một là để một mạng mới gõ sai tên đi qua dưới nhãn "chưa chạy" — nghe vô hại, và sai.
  if (!(network in (ledger as Record<string, unknown>))) {
    return {
      state: "unmeasurable",
      reason:
        `sổ ${ledgerPath} KHÔNG có khoá cho mạng "${network}". ` +
        `Thiếu khoá khác với khoá giá trị null: thiếu khoá nghĩa là không đo được, ` +
        `null nghĩa là đã đo và lối ra chưa chạy.`,
    };
  }

  const entry = (ledger as Record<string, unknown>)[network];
  if (entry === null) return { state: "not-proven", network };

  if (typeof entry !== "object" || Array.isArray(entry)) {
    return { state: "unmeasurable", reason: `mục "${network}" trong ${ledgerPath} sai hình dạng.` };
  }

  const rec = entry as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter(
    (k) => typeof rec[k] !== "string" || (rec[k] as string).length === 0,
  );
  if (missing.length > 0) {
    return {
      state: "unmeasurable",
      reason: `mục "${network}" thiếu hoặc rỗng ở trường: ${missing.join(", ")}.`,
    };
  }

  return { state: "proven", proof: rec as unknown as ExitProof };
}

/**
 * Trần cho lượt nạp MỒI, tính bằng oildrop (1 LAMP = 1e6 oildrop) ⇒ 1 LAMP.
 *
 * VÌ SAO PHẢI CÓ MỘT TRẦN chứ không chặn sạch: cổng đòi bằng chứng chi ra, mà muốn chi ra thì
 * trong kho phải có gì đó. Chặn sạch là dựng một vòng không lối vào — và một cổng không thể
 * thoả được thì người bị chặn sẽ gỡ nó, chứ không đi làm điều nó muốn.
 *
 * 1 LAMP là con số chọn theo tiêu chí "mất cũng được": nó đủ để chạy trọn một lượt chi ra
 * thật, và LAMP không burn nên nếu lượt đó hỏng thì đây đúng là lượng nằm chết vĩnh viễn.
 */
export const BOOTSTRAP_CEILING_OILDROP = 1_000_000n;

/**
 * Cổng fail-closed cho MỌI đường nạp LAMP vào kho.
 *
 * Ném ở cả hai trạng thái xấu — nhưng với hai câu KHÁC NHAU, vì người vận hành phải làm hai
 * việc khác nhau: "chưa chạy lối ra" thì đi chạy nó; "không đo được" thì đi sửa sổ.
 *
 * `treasuryAddress` bắt buộc: bằng chứng gắn với MỘT địa chỉ kho. Đổi apply-param là đổi địa
 * chỉ, và một lượt chi ra ở kho CŨ không nói gì về kho mới — đó đúng là kiểu bằng chứng già đi
 * lặng lẽ mà không dòng nào báo.
 *
 * `amountOildrop` ≤ `BOOTSTRAP_CEILING_OILDROP` thì lượt nạp được đi qua trạng thái "chưa có
 * lối ra" — nhưng KHÔNG đi qua trạng thái "không đo được": mù thì vẫn là mù, dù nạp ít.
 * Lượt mồi in một dòng cảnh báo qua `warn`, mặc định là `console.warn`.
 */
export function assertTreasuryHasExit(
  network: string,
  treasuryAddress: string,
  amountOildrop: bigint,
  ledgerPath: string = EXIT_PROOF_LEDGER,
  warn: (msg: string) => void = console.warn,
): void {
  const result = measureExitProof(network, ledgerPath);

  if (result.state === "unmeasurable") {
    throw new Error(
      `CHẶN (TRE-EXIT-002): KHÔNG ĐO ĐƯỢC lối ra của kho — ${result.reason}\n` +
      `  Đây là trạng thái MÙ, nặng hơn "chưa có lối ra": cổng không biết nó đang cho qua cái gì.\n` +
      `  Sửa sổ ${ledgerPath} rồi chạy lại. Đừng gỡ cổng.`,
    );
  }

  if (result.state === "not-proven") {
    if (amountOildrop <= BOOTSTRAP_CEILING_OILDROP) {
      warn(
        `⚠️ LƯỢT NẠP MỒI (${amountOildrop} oildrop ≤ trần ${BOOTSTRAP_CEILING_OILDROP}).\n` +
        `   Trên ${network} chưa có bằng chứng nào rằng tài sản RA được khỏi kho.\n` +
        `   Lượt này chỉ có MỘT mục đích hợp lệ: chạy thử lối ra. Nạp xong mà không chi ra\n` +
        `   ngay thì số này nằm chết — LAMP không burn (Treasury/CONTRACT.md §5).\n` +
        `   Chi ra xong: ghi txHash vào ${ledgerPath} khoá "${network}", rồi mới nạp lượng thật.`,
      );
      return;
    }
    throw new Error(
      `CHẶN (TRE-EXIT-001): chưa có bằng chứng tài sản RA được khỏi kho trên ${network}.\n` +
      `  Lượng đang nạp ${amountOildrop} oildrop VƯỢT trần mồi ${BOOTSTRAP_CEILING_OILDROP}.\n` +
      `  LAMP không burn (Treasury/CONTRACT.md §5) ⇒ nạp vào mà không ra được là mất hẳn.\n` +
      `  Đường gỡ: chạy một lượt chi ra thật trên ${network}, rồi ghi mã giao dịch vào\n` +
      `  ${ledgerPath} dưới khoá "${network}" (txHash · date · branch · treasuryAddress).\n` +
      `  Kho vừa dựng lại và chưa có gì trong đó: nạp một lượng NHỎ trước, chi ra, ghi sổ,\n` +
      `  rồi mới nạp lượng thật. Thứ tự đó là toàn bộ nội dung của cổng này.`,
    );
  }

  if (result.proof.treasuryAddress !== treasuryAddress) {
    throw new Error(
      `CHẶN (TRE-EXIT-003): bằng chứng lối ra trên ${network} thuộc về một ĐỊA CHỈ KHO KHÁC.\n` +
      `  đã ghi : ${result.proof.treasuryAddress}\n` +
      `  đang nạp: ${treasuryAddress}\n` +
      `  Đổi apply-param là đổi địa chỉ kho. Một lượt chi ra ở kho cũ không chứng minh gì về\n` +
      `  kho mới — chạy lại lối ra trên địa chỉ đang dùng rồi ghi đè mục "${network}".`,
    );
  }
}
