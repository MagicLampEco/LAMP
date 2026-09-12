// _custodySeedRef.ts — hạt giống custody: ĐỌC TỪ NGOÀI, và đối chiếu TRƯỚC bước không quay lui.
//
// VÌ SAO TỆP NÀY TỒN TẠI
//   Khe #13 của `lamp_mint` (`reserve_kho_nft_policy`) là policy id của `custody_seed` áp trên
//   MỘT UTxO hạt giống cụ thể, và nó NƯỚNG VÀO POLICY-ID lúc apply-param. Nghĩa là hạt giống
//   custody phải được chốt TRƯỚC bước genesis, và bước đúc custody (L2a) phải tiêu ĐÚNG cái
//   UTxO đó — không phải "một UTxO nào cũng được".
//
//   Bản trước để `24_reserve_layer2_init.ts` TỰ CHỌN hạt giống custody bằng một phép chọn
//   "UTxO nhiều ADA nhất còn rảnh". Chọn trúng thì mọi thứ chạy; chọn trượt thì `custody_seed`
//   ra một policy id KHÁC khe #13 đã nướng, và policy trong khe đó KHÔNG BAO GIỜ đúc được nữa
//   (hạt giống của nó không ai tiêu, hoặc đã tiêu vào việc khác) ⇒ nhánh `ReserveDraw` của
//   token vừa đúc chết vĩnh viễn, y hệt khuyết tật `meter_nft_policy = 28 byte 0` của bản mồi
//   mainnet. Không cổng nào kêu: cả hai lượt đúc đều thành công, chỉ hai validator canh hai
//   cái kho khác nhau.
//
// VÌ SAO KHÔNG DỰA VÀO CỔNG ĐÃ CÓ
//   `offchain/src/reserveKhoPair.ts::assertReserveKhoPair` (APPLY-003) bắt ĐÚNG lớp lỗi này,
//   nhưng nó chạy bên trong `deriveReserveWiring()`, tức ở bước **L2b** — SAU khi L2a đã đúc
//   custody NFT one-shot lên chuỗi. Cổng đặt sau bước không quay lui được thì nó không còn là
//   cổng, nó là bản cáo phó. Cổng ở đây là cùng phép đo, đặt TRƯỚC mọi lời gọi dựng giao dịch,
//   và nói về đúng hai vế đang so (pid vừa dẫn xuất ↔ cặp đã nướng vào lamp_mint), không nói
//   về `reserve_draw`.
//
// BA TRẠNG THÁI, KHÔNG PHẢI HAI
//   khớp · lệch · KHÔNG ĐỌC ĐƯỢC. Trạng thái thứ ba phải NÉM: một phép so `===` trần trả về
//   `true` khi HAI VẾ CÙNG RỖNG, và "hai chỗ chưa điền" là đúng ca nguy hiểm nhất — cổng im
//   lặng lúc đó là nói "tôi không biết" bằng giọng "ổn".

import type { KhoNftPair } from "../offchain/src/reserveKhoPair.js";

/** Một `OutputReference`: hash giao dịch + chỉ số output. */
export interface OutputRef {
  txHash: string;
  outputIndex: number;
}

const TX_HASH = /^[0-9a-f]{64}$/;
const HEX = /^[0-9a-f]+$/;
const UINT = /^[0-9]+$/;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** `txHash#index` — khuôn DUY NHẤT để so một UTxO với một `OutputRef` trong toàn bộ đường ống. */
export function refKey(r: OutputRef): string {
  return `${norm(r.txHash)}#${r.outputIndex}`;
}

/** Hai `OutputRef` có trỏ cùng một UTxO không. */
export function sameRef(a: OutputRef, b: OutputRef): boolean {
  return refKey(a) === refKey(b);
}

/**
 * Đọc hạt giống custody từ biến môi trường. FAIL-CLOSED ở mọi hình dạng không đọc được.
 *
 * KHÔNG có mặc định cho `CUSTODY_SEED_IDX`. `0` là một mặc định *có vẻ* hợp lý và sai đúng một
 * nửa số lần: chỉ số lệch ⇒ `custody_seed` ra một policy id khác ⇒ khe #13 của `lamp_mint` trỏ
 * một kho không ai đúc được. Bắt gõ ra là rẻ; đoán hộ là không sửa được sau khi gửi.
 */
export function custodySeedRefFromEnv(
  env: Record<string, string | undefined> = process.env,
): OutputRef {
  const tx = norm(env.CUSTODY_SEED_TX ?? "");
  const idxRaw = (env.CUSTODY_SEED_IDX ?? "").trim();
  if (!TX_HASH.test(tx)) {
    throw new Error(
      `CUSTODY-SEED-001: CUSTODY_SEED_TX = "${env.CUSTODY_SEED_TX ?? ""}" — cần hash giao dịch ` +
        `64 ký tự hex. Đây là UTxO hạt giống của \`custody_seed\`, tức khe #13 ` +
        `\`reserve_kho_nft_policy\` đã nướng vào policy-id của \`lamp_mint\`. Nó phải được CHỐT ` +
        `từ trước và truyền vào, KHÔNG được để script tự chọn: chọn trượt là nhánh ReserveDraw ` +
        `của token vừa đúc chết vĩnh viễn, và apply-param không sửa được sau khi gửi.`,
    );
  }
  if (!UINT.test(idxRaw)) {
    throw new Error(
      `CUSTODY-SEED-001: CUSTODY_SEED_IDX = "${env.CUSTODY_SEED_IDX ?? ""}" — cần số nguyên ` +
        `không âm. KHÔNG có mặc định: chỉ số là một nửa của \`OutputReference\`, lệch một đơn vị ` +
        `là ra một policy id khác mà không dòng nào kêu.`,
    );
  }
  return { txHash: tx, outputIndex: Number(idxRaw) };
}

/**
 * Một cặp NFT kho có ĐỌC ĐƯỢC không. Trả về lý do không đọc được, hoặc `undefined`.
 *
 * Chép có nhãn từ `offchain/src/reserveKhoPair.ts::khongDocDuoc` (không export được ở đó, và
 * `Genesis/offchain/src/**` không thuộc phạm vi sửa của đợt này). Cùng phép đo, khác câu chữ:
 * cổng bên đó kể chuyện `lamp_mint` ↔ `reserve_draw`, cổng này kể chuyện hạt giống ↔ khe #13.
 */
function khongDocDuoc(p: KhoNftPair | undefined, nhan: string): string | undefined {
  if (p === undefined || p === null) return `${nhan} KHÔNG có (undefined)`;
  const policy = norm(p.policy ?? "");
  const name = norm(p.name ?? "");
  if (policy === "") return `${nhan}.policy rỗng`;
  if (name === "") return `${nhan}.name rỗng`;
  if (!HEX.test(policy) || policy.length !== 56) {
    return `${nhan}.policy = "${p.policy}" — cần policy id 28 byte (56 ký tự hex)`;
  }
  if (!HEX.test(name) || name.length % 2 !== 0 || name.length > 64) {
    return `${nhan}.name = "${p.name}" — cần asset name hex độ dài chẵn, tối đa 32 byte (64 ký tự)`;
  }
  return undefined;
}

/**
 * CỔNG CUSTODY-REF-001 — cặp `(custody_seed pid, instance_id)` vừa dẫn xuất từ hạt giống phải
 * TRÙNG cặp đã nướng vào `lamp_mint` khe #13-14.
 *
 * PHẢI gọi TRƯỚC mọi lời gọi dựng giao dịch của bước Lớp 2. Sau khi L2a gửi thì custody NFT
 * one-shot đã tiêu hạt giống: không lượt chạy nào lấy lại được cặp đúng nữa.
 *
 * @param danXuat cặp tính từ hạt giống custody đang cầm — `(cust.custodySeedPid, INSTANCE_ID)`.
 * @param daNuong cặp đã nướng vào policy-id — `(wiring.reserveKhoPid, wiring.reserveKhoName)`.
 */
export function assertCustodyKhoPair(
  danXuat: KhoNftPair | undefined,
  daNuong: KhoNftPair | undefined,
): void {
  const loi =
    khongDocDuoc(danXuat, "cặp dẫn xuất từ hạt giống custody") ??
    khongDocDuoc(daNuong, "lamp_mint.reserve_kho_nft (#13-14)");
  if (loi) {
    throw new Error(
      `CUSTODY-REF-001: KHÔNG ĐỌC ĐƯỢC cặp NFT kho — ${loi}. Đây là trạng thái MÙ, không phải ` +
        `trạng thái khớp: một phép so \`===\` trần trả về "bằng nhau" khi cả hai vế cùng rỗng, ` +
        `và hai chỗ chưa điền là đúng ca nguy hiểm nhất ở đây. Đặt CUSTODY_SEED_TX/IDX đúng hạt ` +
        `giống đã dùng để tính khe #13, và chạy lại từ một state có reserveKhoPid/reserveKhoName.`,
    );
  }
  const a = danXuat as KhoNftPair;
  const b = daNuong as KhoNftPair;
  if (norm(a.policy) !== norm(b.policy) || norm(a.name) !== norm(b.name)) {
    throw new Error(
      `CUSTODY-REF-001: cặp NFT kho LỆCH — hạt giống custody đang cầm KHÔNG sinh ra cặp đã nướng ` +
        `vào lamp_mint.\n` +
        `  dẫn xuất từ hạt giống      = (${norm(a.policy)}, ${norm(a.name)})\n` +
        `  lamp_mint #13-14 (đã nướng) = (${norm(b.policy)}, ${norm(b.name)})\n` +
        `Đi tiếp là đúc custody NFT bằng MỘT hạt giống khác cái đã tính khe #13 ⇒ policy trong ` +
        `khe đó không bao giờ đúc được nữa ⇒ nhánh ReserveDraw của token vừa đúc chết VĨNH VIỄN ` +
        `(đúng hình dạng khuyết tật meter_nft_policy = 28 byte 0 của bản mồi mainnet). ` +
        `apply-param nướng vào policy-id nên KHÔNG có đường sửa sau khi gửi. Đặt CUSTODY_SEED_TX/` +
        `CUSTODY_SEED_IDX về đúng hạt giống đã dùng lúc chạy 20_canonical_genesis.ts.`,
    );
  }
}

/**
 * CỔNG SEED-002 — một hạt giống one-shot khác KHÔNG được trùng hạt giống custody.
 *
 * Giữa lúc chọn hạt giống custody và lúc L2a tiêu nó có nhiều giao dịch, mỗi cái có
 * coin-selection tự do trên ví. Trùng nhau còn bị chặn bởi một luật on-chain nữa:
 * `Treasury/onchain/validators/custody_seed.ak` luật S-MINT-2 ép
 * `list.length(assets.policies(tx.mint)) == 1`, nên giao dịch đúc custody không mang được
 * policy đúc nào khác — hai hạt giống KHÔNG gộp làm một được, kể cả khi muốn.
 */
export function assertSeedNotCustody(
  ungVien: OutputRef,
  custody: OutputRef,
  nhan: string,
): void {
  if (sameRef(ungVien, custody)) {
    throw new Error(
      `SEED-002: ${nhan} trùng hạt giống custody (${refKey(custody)}). Một UTxO chỉ tiêu được ` +
        `MỘT lần trong lịch sử chuỗi: tiêu nó ở đây thì bước đúc custody NFT không còn gì để ` +
        `tiêu, và policy \`custody_seed\` đã nướng vào khe #13 của lamp_mint không bao giờ đúc ` +
        `được ⇒ nhánh ReserveDraw chết vĩnh viễn. Luật S-MINT-2 của custody_seed.ak cũng cấm gộp ` +
        `hai lượt đúc vào một giao dịch, nên không có đường "dùng chung" nào. Tách thêm một UTxO ` +
        `rồi chạy lại.`,
    );
  }
}
