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

/** Nhà dẫn xuất policy id `custody_seed` từ một hạt giống — `_reserve_layer2.ts::custodySeedPolicyId`. */
export type DeriveSeedPolicyId = (txHash: string, outputIndex: number) => Promise<string>;

/**
 * Cặp NFT kho Treasury custody cho khe #13-14 của `lamp_mint` — FAIL-CLOSED, không mặc định
 * cho `policy`, và ĐỐI CHỨNG với hạt giống trước khi cho đi tiếp.
 *
 * Vì sao nó là ĐẦU VÀO của bước genesis chứ không phải kết quả: `custody_seed` nướng một hạt
 * giống RIÊNG (luật S-MINT-2 cấm gộp giao dịch đúc custody NFT với policy mint khác), nên
 * `custody_seed` policy id KHÔNG suy ra được từ `genesis_ref` của lượt genesis. Mà `lamp_mint`
 * nướng nó vào policy-id, nên nó phải biết TRƯỚC giao dịch không-làm-lại-được ấy.
 *
 * ⚠ `custodySeed` và `derivePid` đều BẮT BUỘC, KHÔNG mặc định — và đó là toàn bộ điểm của bản
 * này. Bản trước chỉ kiểm ĐỊNH DẠNG của `RESERVE_KHO_NFT_POLICY`: nó trả lời "chuỗi này có 56
 * ký tự hex không", KHÔNG trả lời "chuỗi này có phải policy của hạt giống đang cầm không". Cách
 * hỏng thường gặp nhất ở đây — chép lại policy của một lượt chạy TRƯỚC trong khi
 * `CUSTODY_SEED_TX` đã đổi sang hạt giống mới — đi qua phép kiểm định dạng không sứt mẻ gì, và
 * hậu quả (`lamp_mint` cho Δ rót vào kho A, `reserve_draw` đòi NFT của kho B) chỉ lộ ra sau khi
 * giao dịch không-làm-lại-được đã lên chuỗi.
 *
 * Đối chứng làm được vì `custody_seed` khai đúng MỘT tham số là `OutputReference` — không vòng
 * nào cả. Nó chưa từng được viết chỉ vì `deriveCustody` là hàm hỏng cho tới 2026-09-14.
 *
 * `derivePid` truyền vào chứ không import: tệp này cố ý không kéo theo `_reserve_layer2.ts`
 * (tệp đó nạp `config.ts`, đọc env ngay lúc nạp module). Bên gọi thật truyền
 * `custodySeedPolicyId`; bài kiểm truyền một nhà dẫn xuất dựng tại chỗ.
 */
export async function reserveKhoParamsFromEnv(
  env: Record<string, string | undefined>,
  custodySeed: OutputRef,
  o: { derivePid: DeriveSeedPolicyId; defaultName: string },
): Promise<{ pid: string; name: string }> {
  const pid = norm(env.RESERVE_KHO_NFT_POLICY ?? "");
  const name = norm(env.RESERVE_KHO_NFT_NAME ?? o.defaultName);
  if (!/^[0-9a-f]{56}$/.test(pid)) {
    throw new Error(
      `RESERVE-KHO-001: chưa đặt RESERVE_KHO_NFT_POLICY (nhận "${pid}"). Đây là policy id của ` +
        `'custody_seed' áp trên HẠT GIỐNG CUSTODY — khe #13 của lamp_mint, đích đường ReserveDraw. ` +
        `Nó KHÔNG suy ra được từ genesis_ref của lượt genesis (custody_seed nướng hạt giống riêng, ` +
        `luật S-MINT-2), nên phải chọn hạt giống custody TRƯỚC bước genesis. Lấy bằng ` +
        `custodySeedPolicyId(txHash, idx) trong _reserve_layer2.ts. Bỏ trống là nướng một cặp kho ` +
        `sai vào policy-id: lamp_mint cho Δ rót vào kho A, reserve_draw đòi tiêu NFT của kho B, ` +
        `không tầng nào báo, và apply-param không sửa được sau khi gửi.`,
    );
  }
  if (!HEX.test(name) || name.length % 2 !== 0 || name.length > 64) {
    throw new Error(
      `RESERVE-KHO-002: RESERVE_KHO_NFT_NAME = "${name}" — cần hex độ dài chẵn, tối đa 32 byte. ` +
        `Đây là instance_id của instance custody đích (custody_seed luật S-PARAM-0 ép ` +
        `datum.instance_id == nft_name).\n` +
        // Cổng -004 dưới đây mới là chỗ nói ra giá trị bắt buộc, nhưng nó KHÔNG BAO GIỜ chạy
        // cho cách gõ sai phổ biến nhất: gõ thẳng chuỗi người đọc được thay vì hex của nó. Ca
        // đó chết ở đây, nên câu lỗi ở đây phải tự mang theo giá trị đúng.
        `  giá trị BẮT BUỘC = ${norm(o.defaultName)}\n` +
        `Khe này không có bậc tự do — bỏ hẳn RESERVE_KHO_NFT_NAME khỏi môi trường là cách chắc ` +
        `nhất. Lưu ý đây là HEX, không phải chuỗi thường: đặt \`lamp-reserve\` sẽ dừng ở đúng ` +
        `câu lỗi này.`,
    );
  }

  // ── CỔNG RESERVE-KHO-004 — khe #14 KHÔNG phải một lựa chọn ────────────────────
  //
  // Khe #14 là asset name của NFT kho mà đường ReserveDraw rót vào. Giá trị của nó bị ràng
  // buộc CHẾT bởi hai chỗ, không có bậc tự do nào:
  //
  //   `_reserve_layer2.ts::custodySeedDatum` gán cứng `instance_id: INSTANCE_ID`
  //   `custody_seed.ak:114` (S-PARAM-0) ép `seed_datum.instance_id == nft_name`
  //
  // ⇒ NFT kho mà bước L2a đúc ra CHẮC CHẮN mang asset name `INSTANCE_ID`. Nướng một giá trị
  // khác vào khe #14 là nướng một cái kho không bao giờ tồn tại.
  //
  // VÌ SAO ĐÂY LÀ CỔNG CHỨ KHÔNG PHẢI MẶC ĐỊNH. Bản trước đọc `RESERVE_KHO_NFT_NAME` rồi chỉ
  // kiểm ĐỊNH DẠNG — đúng cái lỗ mà `RESERVE-KHO-003` vừa vá cho khe #13, còn nguyên ở khe bên
  // cạnh. Một biến môi trường mà giá trị hợp lệ DUY NHẤT là giá trị mặc định thì nó không phải
  // một tuỳ chọn, nó là một cái bẫy: nó mời người vận hành gõ vào đó, và mọi thứ gõ vào đều sai.
  // Giữ biến lại nhưng chặn mọi giá trị khác, thay vì lặng lẽ nhận rồi hỏng ở bước không quay
  // lui được.
  //
  // ⚠ ĐÍNH CHÍNH lý do giữ. Bản đầu viết "runbook đang dùng" — đo lại thì SAI:
  // `grep -rn "RESERVE_KHO" --include=*.md` trên toàn kho trả đúng một dòng,
  // `Genesis/canonical-preprod-runbook.md`, và dòng đó nói `RESERVE_KHO_NFT_POLICY`.
  // `RESERVE_KHO_NFT_NAME` không xuất hiện trong bất kỳ tệp `.md` nào. Lý do giữ thật sự chỉ
  // còn một: khai ra giá trị ở môi trường là thứ người vận hành đọc lại được sau sự cố. Đó là
  // lý do YẾU HƠN, nên ghi ra để lần sau ai muốn bỏ hẳn biến này không phải đi bác một tiền đề
  // đã sai — bỏ biến thì bậc tự do bằng 0 và cổng dưới đây không còn việc gì để làm.
  //
  // GHI CHÚ cho người đọc sau: `Treasury/scripts/01_seed_custody.ts` có một đường sinh instance
  // KHÁC, ở đó `INSTANCE_ID` đọc được từ env. Đường đó KHÔNG phải đường L2a của kho này, và
  // cổng dưới đây cố ý so với `o.defaultName` — giá trị mà chính đường ống này sẽ dùng — chứ
  // không so với một hằng gõ lại. Bên gọi thật truyền `INSTANCE_ID` của `_reserve_layer2.ts`.
  if (name !== norm(o.defaultName)) {
    throw new Error(
      `RESERVE-KHO-004: RESERVE_KHO_NFT_NAME KHÔNG phải instance_id mà bước Lớp 2 sẽ đúc.\n` +
        `  RESERVE_KHO_NFT_NAME = ${name}\n` +
        `  giá trị BẮT BUỘC     = ${norm(o.defaultName)}\n` +
        `Khe #14 không có bậc tự do: custodySeedDatum() gán cứng instance_id, và custody_seed.ak ` +
        `luật S-PARAM-0 ép datum.instance_id == nft_name, nên NFT kho đúc ra chắc chắn mang tên ` +
        `${norm(o.defaultName)}. Nướng giá trị khác vào khe #14 là nướng một cái kho không bao giờ ` +
        `tồn tại: lamp_mint đòi A-DEST rót vào (pid, ${name}) trong khi thứ duy nhất được đúc là ` +
        `(pid, ${norm(o.defaultName)}) ⇒ đường ReserveDraw không rót được lượt nào, và apply-param ` +
        `nướng vào policy-id nên KHÔNG sửa được sau khi gửi.\n` +
        `Sửa: bỏ RESERVE_KHO_NFT_NAME khỏi môi trường, hoặc đặt đúng ${norm(o.defaultName)}.`,
    );
  }

  // ── CỔNG RESERVE-KHO-003 — ĐỐI CHỨNG, không phải kiểm định dạng ───────────────
  //
  // BA TRẠNG THÁI (khớp · lệch · không đọc được) đã xử XONG trước dòng này, nên phép so `!==`
  // dưới đây không rơi vào bẫy "hai vế cùng rỗng thì bằng nhau": vế env đã qua RESERVE-KHO-001
  // ở trên, vế dẫn xuất thì `derivePid` hoặc trả một hash thật hoặc ném. Viết ra vì nếu không,
  // người đọc sau tưởng chỗ này bỏ qua trạng thái mù — trong chính tệp lập luận về nó.
  const derived = norm(await o.derivePid(custodySeed.txHash, custodySeed.outputIndex));
  if (derived !== pid) {
    throw new Error(
      `RESERVE-KHO-003: RESERVE_KHO_NFT_POLICY KHÔNG phải policy của hạt giống custody đang cầm.\n` +
        `  hạt giống ${refKey(custodySeed)}  ⇒  ${derived}\n` +
        `  RESERVE_KHO_NFT_POLICY  =  ${pid}\n` +
        `Hai giá trị này là HAI MẶT của một sự thật, và phép kiểm định dạng ở trên không so được ` +
        `chúng: một policy chép lại từ lượt chạy TRƯỚC vẫn đủ 56 ký tự hex. Đi tiếp là nướng khe ` +
        `#13 của lamp_mint theo một kho KHÁC cái mà bước Lớp 2 sẽ đúc ⇒ lamp_mint cho Δ rót vào ` +
        `kho A, reserve_draw đòi tiêu NFT của kho B, không tầng nào báo, và apply-param nướng vào ` +
        `policy-id nên KHÔNG sửa được sau khi gửi.\n` +
        `Sửa: đặt RESERVE_KHO_NFT_POLICY=${derived} (policy của đúng hạt giống đang cầm), hoặc đổi ` +
        `CUSTODY_SEED_TX/CUSTODY_SEED_IDX về hạt giống đã sinh ra ${pid}.`,
    );
  }
  return { pid, name };
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

// ══ SEED-CHON-DONG — hạt giống custody phải SỐNG SÓT qua mọi bước trước L2a ═════
//
// VÌ SAO CẢ MỘT MỤC CHO MỘT PHÉP `includes`
//   Hạt giống custody được chốt TRƯỚC bước genesis và chỉ được tiêu ở bước L2a. Giữa hai mốc
//   đó có SÁU giao dịch, mỗi cái gọi `.complete()` và chạy chọn-đồng mặc định trên TOÀN BỘ
//   UTxO ví. `.collectFrom([...])` chỉ ghim input BẮT BUỘC; nó không cấm chọn-đồng kéo thêm.
//   Mọi giao dịch ở đây đều trả ra nhiều output kèm phí, nên chọn-đồng gần như chắc chắn phải
//   lấy thêm input — và không gì ngăn nó trúng hạt giống custody.
//
//   Hỏng ra sao: tiêu nhầm thì giao dịch VẪN hợp lệ, VẪN lên chuỗi, bước đó báo thành công.
//   Tới lượt L2a mới biết `custody_seed` áp trên UTxO ấy không còn gì để tiêu, và policy đó đã
//   nướng vào khe #13 của `lamp_mint` từ lâu ⇒ nhánh ReserveDraw của token đã đúc chết vĩnh
//   viễn. Đúng hình dạng khuyết tật `meter_nft_policy = 28 byte 0` của bản mồi mainnet.
//
// ĐO KẾT QUẢ, KHÔNG ĐO Ý ĐỊNH
//   Phép "loại hạt giống khỏi tập UTxO trước khi dựng" đo Ý ĐỊNH, và nó đúng cho tới lần thư
//   viện đổi cách chọn. Phép dưới đây đọc input THẬT của giao dịch đã dựng, nên nó vẫn đúng
//   sau khi thư viện đổi. Giá phải trả: phải gọi SAU `.complete()` và TRƯỚC `.submit()`.

/**
 * Bề mặt tối thiểu của một giao dịch đã dựng mà phép đo này cần.
 *
 * Khai theo HÌNH DẠNG chứ không import kiểu của lucid: tệp này cố ý không kéo theo
 * `_reserve_layer2.ts`/`config.ts` (chúng đọc env ngay lúc nạp module), và một giao diện hình
 * dạng thì bài kiểm dựng stub được mà không cần một giao dịch thật.
 */
export interface TxInputList {
  len(): number;
  get(i: number): { transaction_id(): { to_hex(): string }; index(): number | bigint };
}
export interface BuiltTx {
  toTransaction(): {
    body(): {
      inputs(): TxInputList;
      /**
       * TRƯỜNG RIÊNG, không nằm trong `inputs()`. Khai `| undefined` vì hàm dựng có thể chưa
       * đặt collateral (giao dịch không đính script), và `?` vì một bản thư viện cũ hơn có thể
       * không có accessor này — hai ca đó phải phân biệt được với "có collateral, rỗng".
       */
      collateral_inputs?(): TxInputList | undefined;
    };
  };
}

/** Đọc một danh sách input thành khoá `txHash#index`. Danh sách vắng mặt ⇒ mảng rỗng. */
function keysOf(list: TxInputList | undefined): string[] {
  if (!list) return [];
  const keys: string[] = [];
  for (let i = 0; i < list.len(); i++) {
    const ti = list.get(i);
    keys.push(`${norm(ti.transaction_id().to_hex())}#${Number(ti.index())}`);
  }
  return keys;
}

/** Khoá `txHash#index` của MỌI input CHI TIÊU trong một giao dịch đã dựng, theo đúng thứ tự. */
export function txInputKeys(tx: BuiltTx): string[] {
  return keysOf(tx.toTransaction().body().inputs());
}

/**
 * Khoá của MỌI input COLLATERAL — trường khác `inputs()`, và là một đường TIÊU thứ hai.
 *
 * Vì sao phải đọc riêng: `collateral_inputs` chỉ bị ledger nuốt khi giao dịch TRƯỢT PHA 2, tức
 * ở đúng nhánh thất bại mà không ai nhìn. Bốn bước được gác đều đính script Plutus nên đều mang
 * collateral, và bộ chọn collateral của thư viện quét TOÀN BỘ UTxO ví — nó không biết gì về hạt
 * giống custody. Một cổng chỉ đọc `inputs()` nói "không tiêu" cho một giao dịch đang cầm hạt
 * giống làm vật thế chấp.
 *
 * Đã tái hiện trên Emulator: `inputs() = [tx#1]` trong khi `collateral_inputs() = [tx#0]`, và
 * `tx#0` chính là hạt giống — cổng bản đầu im lặng.
 */
export function txCollateralKeys(tx: BuiltTx): string[] {
  const body = tx.toTransaction().body();
  return keysOf(body.collateral_inputs?.());
}

/**
 * CỔNG SEED-CHON-DONG-001 — giao dịch vừa dựng KHÔNG được tiêu hạt giống custody.
 *
 * Gọi ở MỌI bước giữa genesis và L2a, ngay sau `.complete()`. Bỏ sót một bước là bỏ ngỏ đúng
 * lớp hỏng này ở bước đó — cổng phải gác MỌI lối vào khái niệm, không phải lối đầu và lối cuối.
 *
 * @param buoc tên bước, để câu lỗi nói được hỏng ở đâu (`"Tx A (genesis)"`, `"21 vest"`…).
 */
export function assertSeedNotSpent(tx: BuiltTx, custody: OutputRef, buoc: string): void {
  const keys = txInputKeys(tx);
  const wanted = refKey(custody);

  // Danh sách RỖNG là trạng thái KHÔNG ĐO ĐƯỢC, không phải trạng thái sạch. Một giao dịch đã
  // `.complete()` luôn có ≥1 input, nên rỗng ở đây nghĩa là phép đọc đã hỏng — `BuiltTx` khai
  // theo hình dạng nên một đối tượng khác thoả hình dạng, hoặc một bản thư viện đổi chỗ chứa
  // input, đều biến cổng thành no-op mà mọi ca kiểm vẫn xanh (ca nào cũng đưa vào danh sách
  // không rỗng). Chính lý lẽ "đo KẾT QUẢ thì bền sau khi thư viện đổi" đặt cược vào đúng kịch
  // bản này, nên nhánh im lặng phải bị đóng.
  if (keys.length === 0) {
    throw new Error(
      `SEED-CHON-DONG-002: KHÔNG ĐỌC ĐƯỢC input của ${buoc} — danh sách input rỗng.\n` +
        `Một giao dịch đã \`.complete()\` luôn tiêu ít nhất một UTxO, nên đây là trạng thái MÙ, ` +
        `không phải trạng thái "không chạm hạt giống". Cho qua lúc này là nói "tôi không biết" ` +
        `bằng giọng của "ổn".\n` +
        `Nguyên nhân thường gặp: đối tượng truyền vào không phải giao dịch đã dựng, hoặc bản ` +
        `thư viện đã đổi bề mặt \`toTransaction().body().inputs()\`.`,
    );
  }

  // Collateral bị nuốt khi giao dịch trượt pha 2 ⇒ nó là đường TIÊU thứ hai. Câu lỗi tách
  // riêng vì cách sửa khác hẳn: chi tiêu thẳng thì gộp ADA cho chọn-đồng, còn collateral thì
  // phải cho ví một UTxO thuần ADA khác để bộ chọn collateral bám vào.
  const colKeys = txCollateralKeys(tx);
  if (colKeys.includes(wanted)) {
    throw new Error(
      `SEED-CHON-DONG-004: ${buoc} đã ghim HẠT GIỐNG CUSTODY ${wanted} làm COLLATERAL.\n` +
        `Giao dịch này không chi tiêu hạt giống, nên cổng đọc \`inputs()\` không thấy gì — nhưng ` +
        `collateral bị ledger NUỐT khi giao dịch trượt pha 2. Lúc đó hạt giống mất vĩnh viễn, ` +
        `policy \`custody_seed\` đã nướng vào khe #13 của \`lamp_mint\` không bao giờ đúc được ` +
        `nữa, và màn hình chỉ báo "giao dịch lỗi, chạy lại" — không một chữ nào về hạt giống.\n` +
        `Sửa: để trong ví một UTxO thuần ADA KHÁC đủ lớn cho collateral, hoặc tách hạt giống ` +
        `custody sang một địa chỉ khác trước khi chạy.\n` +
        `Collateral của ${buoc}: ${colKeys.join(", ")}`,
    );
  }

  if (keys.includes(wanted)) {
    throw new Error(
      `SEED-CHON-DONG-001: chọn-đồng đã kéo HẠT GIỐNG CUSTODY ${wanted} vào ${buoc}.\n` +
        `Bước này tiêu nó ⇒ policy \`custody_seed\` áp trên UTxO đó KHÔNG BAO GIỜ đúc được nữa, ` +
        `trong khi khe #13 của \`lamp_mint\` đã nướng chính policy đó. Bước này vẫn thành công, ` +
        `lỗi chỉ lộ ở bước đúc custody (L2a) — lúc đó không quay lui được.\n` +
        `Sửa: tách hạt giống custody khỏi ví trước khi chạy (gửi nó sang một địa chỉ khác), ` +
        `hoặc gộp thêm ADA vào các UTxO khác để chọn-đồng không cần chạm tới nó.\n` +
        `Input của ${buoc}: ${keys.join(", ")}`,
    );
  }
}

/** Hạt giống custody lấy từ đâu ra — để bên gọi IN RA, chứ không để nó tự đoán. */
export type SeedSource = "state" | "env";

/**
 * Một `OutputRef` đọc trong tệp trạng thái có ĐỌC ĐƯỢC không.
 *
 * Tách thành hàm riêng vì nó được dùng ở HAI nhánh ngược dấu nhau — nhánh ném khi hỏng và
 * nhánh nhận khi đọc được. Viết điều kiện hai lần là mở đường cho hai bản trôi khỏi nhau, và
 * lúc đó có một khoảng giá trị không rơi vào nhánh nào.
 */
function docDuocRef(r: OutputRef): boolean {
  return (
    TX_HASH.test(norm(r.txHash)) &&
    Number.isInteger(r.outputIndex) &&
    r.outputIndex >= 0
  );
}

/**
 * Hạt giống custody cho các bước SAU genesis: đọc từ tệp trạng thái, đối chiếu với env.
 *
 * BA TRẠNG THÁI, và không trạng thái nào được im:
 *   • state CÓ ghi  → đó là nguồn, vì nó là giá trị mà bước genesis ĐÃ dùng để nướng khe #13.
 *     env cũng đặt mà LỆCH ⇒ ném `SEED-CHON-DONG-003`: hai nguồn bất đồng là trạng thái mù,
 *     không phải trạng thái chọn-một-trong-hai.
 *   • state CHƯA ghi → lùi về env, và `custodySeedRefFromEnv` tự ném nếu env cũng trống. Đây là
 *     đường cho tệp trạng thái ghi TRƯỚC đợt vá này; bên gọi phải in ra `source` để người chạy
 *     thấy mình đang đứng trên đường lùi.
 *   • cả hai trống → ném, ở `custodySeedRefFromEnv`.
 *
 * Vì sao state là nguồn chứ không phải env: env là thứ người gõ lại ở MỖI bước, và gõ lại giữa
 * chừng thì không gì kêu. State là thứ bước genesis đã ghi ra, cùng lượt với việc nướng policy —
 * nó là nguồn THỨ HAI thật sự, không phải một bản chép của cùng một lần gõ.
 */
export function custodySeedRefFromState(
  fromState: OutputRef | undefined,
  env: Record<string, string | undefined>,
): { ref: OutputRef; source: SeedSource } {
  // Đo CẢ CẶP biến, không chỉ nửa đầu: `CUSTODY_SEED_TX` và `CUSTODY_SEED_IDX` cùng định danh
  // MỘT `OutputReference`. Chỉ đo nửa đầu thì người chỉ đặt `CUSTODY_SEED_IDX` (gõ sót dòng
  // kia, hoặc gõ sai tên biến còn lại) làm cổng đối chiếu -003 TẮT trong im lặng, và màn hình
  // vẫn in `(nguồn: state)` trông bình thường. Đặt lẻ một nửa phải rơi vào
  // `custodySeedRefFromEnv` để nó ném CUSTODY-SEED-001.
  const envSet =
    (env.CUSTODY_SEED_TX ?? "").trim() !== "" || (env.CUSTODY_SEED_IDX ?? "").trim() !== "";

  // Trạng thái thứ ba: state CÓ trường nhưng KHÔNG ĐỌC ĐƯỢC. Bản đầu gộp nó vào nhánh "state
  // chưa ghi" rồi lùi im lặng về env — fail-open, và nó vô hiệu hoá đúng cổng -003: phép đối
  // chiếu nằm BÊN TRONG khối state-đọc-được, nên state hỏng + env trỏ một hạt giống khác thì
  // không vế nào bất đồng với vế nào. "Chưa ghi" và "ghi hỏng" là hai việc khác nhau: cái đầu
  // là tệp trạng thái cũ (hợp lệ, có đường lùi), cái sau là dữ liệu đã hỏng.
  if (fromState !== undefined && fromState !== null && !docDuocRef(fromState)) {
    throw new Error(
      `SEED-CHON-DONG-005: tệp trạng thái CÓ trường hạt giống custody nhưng KHÔNG ĐỌC ĐƯỢC.\n` +
        `  reserve.custodyRef.txHash      = ${JSON.stringify(fromState.txHash)}\n` +
        `  reserve.custodyRef.outputIndex = ${JSON.stringify(fromState.outputIndex)}\n` +
        `Cần hash 64 ký tự hex và chỉ số nguyên >= 0. Đây KHÔNG phải ca "state chưa ghi" — ở ca ` +
        `đó trường vắng mặt và lùi về biến môi trường là đúng. Ở đây trường CÓ mặt và hỏng, nên ` +
        `lùi về env là đi tiếp bằng một giá trị không ai đối chiếu được: cổng SEED-CHON-DONG-003 ` +
        `chỉ so hai nguồn khi vế state đọc được, nên nó sẽ im đúng lúc cần kêu.\n` +
        `Sửa: khôi phục tệp trạng thái từ lượt genesis, hoặc chạy lại bước genesis. Đừng gõ tay ` +
        `giá trị vào env để đi tiếp — khe #13 đã nướng theo giá trị THẬT của lượt genesis.`,
    );
  }

  if (fromState && docDuocRef(fromState)) {
    const ref = { txHash: norm(fromState.txHash), outputIndex: fromState.outputIndex };
    if (envSet) {
      const fromEnv = custodySeedRefFromEnv(env);
      if (!sameRef(ref, fromEnv)) {
        throw new Error(
          `SEED-CHON-DONG-003: hạt giống custody trong tệp trạng thái LỆCH biến môi trường.\n` +
            `  state (bước genesis đã dùng) = ${refKey(ref)}\n` +
            `  CUSTODY_SEED_TX/IDX          = ${refKey(fromEnv)}\n` +
            `Khe #13 của lamp_mint đã nướng theo giá trị trong state, nên env mới là vế sai — ` +
            `nhưng cổng này KHÔNG tự chọn hộ: hai nguồn bất đồng nghĩa là một trong hai lượt gõ ` +
            `đã sai, và đi tiếp với vế nào cũng là đoán. Bỏ CUSTODY_SEED_TX/CUSTODY_SEED_IDX khỏi ` +
            `môi trường để dùng state, hoặc sửa chúng về ${refKey(ref)}.`,
        );
      }
    }
    return { ref, source: "state" };
  }
  return { ref: custodySeedRefFromEnv(env), source: "env" };
}
