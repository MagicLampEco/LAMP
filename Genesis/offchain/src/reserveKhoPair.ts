// reserveKhoPair — cổng APPLY-003: ép `reserve_draw.kho_nft_*` TRÙNG `lamp_mint.reserve_kho_nft_*`.
//
// ⚠ VÌ SAO CỔNG NÀY TỒN TẠI (đọc trước khi nới):
// Hai validator canh CÙNG một cái kho, bằng HAI cặp tham số nướng RIÊNG:
//
//   `Genesis/onchain/validators/lamp_mint.ak` — chữ ký `validator lamp_mint(`:
//       khe #13-14 `reserve_kho_nft_policy` / `reserve_kho_nft_name`
//   `Reserve/onchain/validators/reserve_draw.ak` — chữ ký `validator reserve_draw(`:
//       khe  #6-7  `kho_nft_policy` / `kho_nft_name`
//
// Cả hai phải là `(seed_policy, instance_id)` của ĐÚNG MỘT instance `custody`. Lệch một byte
// thì mỗi validator canh một cái kho khác nhau và **cả hai vẫn xanh** — khoá ba tầng đứt ở
// tầng nối dây, không tầng nào báo. Cổng `assertParamCount` (APPLY-001) KHÔNG bắt được ca
// này: số tham số vẫn đủ, chỉ GIÁ TRỊ ở hai khe là khác nhau.
//
// ⚠ ĐỪNG nhầm cặp này với `kho_nft_policy`/`kho_nft_name` khe #9-10 của `lamp_mint` — cặp
// #9-10 trỏ kho **Distribution** (`Distribution/onchain/validators/treasury.ak`), đọc qua
// REFERENCE input ở nhánh `DistributionVest`. Cặp #13-14 trỏ kho **Treasury custody**
// (`Treasury/onchain/validators/custody.ak`), phải là SPEND input ở nhánh `ReserveDraw`.
// Hai kho THẬT SỰ KHÁC NHAU (`lamp_mint.ak` mục "kho_nft và reserve_kho_nft trỏ vào HAI kho
// KHÁC NHAU"). Vì thế mọi trường ở tầng TypeScript đều mang tiền tố `dist…` / `reserveKho…`:
// tên trùng nhau chính là thứ đã che chỗ nối dây này.
//
// Cổng là FAIL-CLOSED ở CẢ BA trạng thái, không chỉ hai:
//   · khớp      → im lặng
//   · lệch      → ném APPLY-003
//   · KHÔNG ĐỌC ĐƯỢC (thiếu / rỗng / sai hình dạng hex) → ném APPLY-003, KHÔNG cho qua.
// Trạng thái thứ ba là trạng thái mù; cho qua nó là nói "tôi không biết" bằng giọng "ổn".

/**
 * Một cái kho được định danh bằng NFT: `(policy id one-shot, asset name)`.
 *
 * Với instance `custody` thì đây đúng là `(custody_seed policy id, instance_id)` —
 * `custody_seed.ak` luật S-PARAM-0 ép `datum.instance_id == nft_name`, nên `name` ở đây
 * cũng chính là `instance_id` của instance đích.
 */
export interface KhoNftPair {
  /** Policy id NFT kho — 28 byte (56 ký tự hex). */
  policy: string;
  /** Asset name NFT kho (hex, 1..32 byte). */
  name: string;
}

const HEX = /^[0-9a-f]+$/;

/** Chuẩn hoá để so sánh: hex KHÔNG phân biệt hoa thường, nhưng bytes thì phải khớp tuyệt đối. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Một cặp có ĐỌC ĐƯỢC không. Trả về lý do KHÔNG đọc được, hoặc `undefined` khi đọc được.
 *
 * Không gộp vào phép so sánh: "hai cặp đều rỗng" so ra BẰNG NHAU, và đó đúng là ca nguy hiểm
 * nhất — hai chỗ chưa điền thì cổng nào chỉ so bằng cũng im lặng cho qua.
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

/** Hai cặp có cùng bytes không (sau chuẩn hoá hoa/thường). */
function bang(a: KhoNftPair, b: KhoNftPair): boolean {
  return norm(a.policy) === norm(b.policy) && norm(a.name) === norm(b.name);
}

/**
 * Ném APPLY-003 khi cặp kho nướng vào `lamp_mint` (#13-14) KHÁC cặp sắp nướng vào
 * `reserve_draw` (#6-7), hoặc khi một trong hai không đọc được.
 *
 * PHẢI gọi TRƯỚC `applyParamsToScript`. Sau khi apply thì tham số đã nằm trong bytecode và
 * script hash / policy id đã chốt — không sửa được, và LAMP không burn được
 * (`Treasury/CONTRACT.md §5`), nên rót vào một kho không ai ghi sổ là kẹt vĩnh viễn.
 *
 * @param lampMint    cặp `reserve_kho_nft_policy`/`reserve_kho_nft_name` đã (hoặc sắp) nướng
 *                    vào `lamp_mint` khe #13-14.
 * @param reserveDraw cặp `kho_nft_policy`/`kho_nft_name` sắp nướng vào `reserve_draw` khe #6-7.
 */
export function assertReserveKhoPair(
  lampMint: KhoNftPair | undefined,
  reserveDraw: KhoNftPair | undefined,
): void {
  const loi =
    khongDocDuoc(lampMint, "lamp_mint.reserve_kho_nft (#13-14)") ??
    khongDocDuoc(reserveDraw, "reserve_draw.kho_nft (#6-7)");
  if (loi) {
    throw new Error(
      `APPLY-003: không ĐỌC ĐƯỢC cặp NFT kho — ${loi}. Cổng này ép hai validator canh CÙNG ` +
      `một instance custody; không đọc được một vế thì nó không đo được gì, và cho qua lúc đó ` +
      `là nói "tôi không biết" bằng giọng "ổn". Truyền (custody_seed policy id, instance_id) ` +
      `của instance custody đích cho CẢ HAI vế.`,
    );
  }
  // Sau cổng hình dạng, cả hai chắc chắn khác `undefined`.
  const a = lampMint as KhoNftPair;
  const b = reserveDraw as KhoNftPair;
  if (!bang(a, b)) {
    throw new Error(
      `APPLY-003: cặp NFT kho LỆCH giữa hai validator.\n` +
      `  lamp_mint.reserve_kho_nft (#13-14) = (${norm(a.policy)}, ${norm(a.name)})\n` +
      `  reserve_draw.kho_nft      (#6-7)   = (${norm(b.policy)}, ${norm(b.name)})\n` +
      `Hai cặp này PHẢI là (custody_seed policy id, instance_id) của ĐÚNG MỘT instance custody. ` +
      `Lệch thì mỗi validator canh một cái kho khác nhau và CẢ HAI VẪN XANH: lamp_mint cho Δ ` +
      `rót vào kho A, reserve_draw đòi tiêu NFT của kho B ⇒ nhánh ReserveDraw đóng câm, hoặc ` +
      `tệ hơn, Δ vào SÂN một kho mà không validator nào ghi vào SỔ. Số tham số vẫn đủ nên ` +
      `APPLY-001 không thấy gì — đây là chỗ DUY NHẤT bắt được ca này.`,
    );
  }
}

// ── Danh sách tham số apply-param, dựng Ở MỘT CHỖ ────────────────────────────
//
// Vì sao hai hàm dưới đây tồn tại thay vì để mỗi script tự gõ mảng: thứ tự tham số nướng
// thẳng vào policy-id / script hash, và truyền sai thứ tự KHÔNG báo lỗi — `applyParamsToScript`
// trả về một định danh khác, im lặng. Gõ mảng ở mỗi script nghĩa là thứ tự ấy sống ở nhiều
// bản sao, mỗi bản chết im lặng theo kiểu riêng. Ở đây nó có ĐÚNG MỘT nguồn, và nguồn đó
// nạp được trong bài kiểm mà không cần .env, không cần ví, không cần mạng.

/** Tham số `validator lamp_mint(` — 14 khe, đúng thứ tự chữ ký on-chain. */
export interface LampMintParamValues {
  /** #1-2 thread NFT one-shot của SupplyState. */
  threadNftPolicy: string;
  threadNftName: string;
  /** #3 asset name LAMP/tLAMP (hex). */
  tokenName: string;
  /** #4-5 cap hai đường, tính bằng oildrop. */
  distCap: bigint;
  reserveCap: bigint;
  /** #6-7 registry NFT (WHO-gate, đọc qua reference input). */
  registryNftPolicy: string;
  registryNftName: string;
  /** #8 token_tag của LAMP trong bảng registry. */
  tokenTag: string;
  /** #9-10 kho **Distribution** (A-DEST đường DistributionVest) — KHÔNG phải kho Reserve. */
  distKhoNftPolicy: string;
  distKhoNftName: string;
  /** #11-12 meter NFT = reserve thread NFT (gate nhịp đường ReserveDraw). */
  meterNftPolicy: string;
  meterNftName: string;
  /** #13-14 kho **Treasury custody** (A-DEST đường ReserveDraw). Khớp `reserve_draw.kho_nft`. */
  reserveKhoNft: KhoNftPair;
}

/**
 * Dựng danh sách 14 tham số cho `lamp_mint.lamp_mint.mint`.
 *
 * Cổng hình dạng chạy tại đây: cặp #13-14 không đọc được thì DỪNG. Cặp này không có chỗ nào
 * khác kiểm hộ — `assertParamCount` chỉ đếm, và một chuỗi rỗng vẫn là một tham số hợp lệ với
 * `applyParamsToScript`.
 */
export function lampMintParamList(p: LampMintParamValues): unknown[] {
  const loi = khongDocDuoc(p.reserveKhoNft, "lamp_mint.reserve_kho_nft (#13-14)");
  if (loi) {
    throw new Error(
      `APPLY-003: không dựng được danh sách tham số lamp_mint — ${loi}. Hai khe #13-14 là ` +
      `(custody_seed policy id, instance_id) của instance custody mà đường ReserveDraw rót vào. ` +
      `Chúng nướng vào policy-id, nên chọn sai một lần là đúc ra một token khác và không sửa được: ` +
      `phải biết hạt giống custody TRƯỚC khi đúc lamp_mint.`,
    );
  }
  return [
    p.threadNftPolicy, p.threadNftName,            // #1-2
    p.tokenName,                                    // #3
    p.distCap, p.reserveCap,                        // #4-5
    p.registryNftPolicy, p.registryNftName,         // #6-7
    p.tokenTag,                                     // #8
    p.distKhoNftPolicy, p.distKhoNftName,           // #9-10  kho DISTRIBUTION
    p.meterNftPolicy, p.meterNftName,               // #11-12
    norm(p.reserveKhoNft.policy),                   // #13    kho TREASURY CUSTODY
    norm(p.reserveKhoNft.name),                     // #14
  ];
}

/** Tham số `validator reserve_draw(` — 12 khe, đúng thứ tự chữ ký on-chain. */
export interface ReserveDrawParamValues {
  /** #1-2 LAMP — đo Δ mint. */
  lampPolicy: string;
  tokenName: string;
  /** #3-4 reserve thread NFT = meter NFT của `lamp_mint` (#11-12). */
  reserveThreadPolicy: string;
  reserveThreadName: string;
  /** #5 mẫu số quy đổi epoch. */
  msPerEpoch: bigint;
  /** #6-7 NFT định danh kho custody. PHẢI trùng `lamp_mint` #13-14 — cổng APPLY-003. */
  khoNft: KhoNftPair;
  /** #8-9 auth NFT Treasury-pull. */
  treasuryAuthPolicy: string;
  treasuryAuthName: string;
  /** #10 script hash `reserve_gate` — auth NFT phải được tiêu TỪ đây. */
  gateScriptHash: string;
  /** #11 script hash `custody` — UTxO mang kho NFT phải nằm ở đúng credential này. */
  custodyScriptHash: string;

  /**
   * #12 pot Reserve theo thiết kế (oildrop). PHẢI trùng khe #5 `reserve_cap` của `lamp_mint`.
   *
   * `reserve_draw` Luật 1b ép `s.total_oildrop == reserve_cap` ở MỌI lượt rút, nên một giá trị
   * sai ở đây không hỏng lúc apply — nó hỏng ở lượt rút đầu tiên, khi script hash đã chốt và
   * MET đã nằm dưới validator. Vế đối chiếu của nó KHÔNG nằm ở tầng này: cổng RESERVE-CAP-001
   * (`Genesis/scripts/24_reserve_layer2_init.ts`) so `RESERVE_TOTAL` với `reserve_cap` ĐỌC TỪ
   * SupplyState trên chuỗi — tức so với chính con số `lamp_mint` đã nướng — trước khi ghi
   * `total_oildrop`. Hai cổng khép kín vòng: #12 ↔ `total_oildrop` (Luật 1b, on-chain) ↔
   * `SupplyState.reserve_cap` (RESERVE-CAP-001, off-chain) ↔ `lamp_mint` #5.
   */
  reserveCap: bigint;

  /**
   * Cặp #13-14 ĐÃ nướng vào `lamp_mint` — vế đối chiếu, KHÔNG đi vào danh sách tham số.
   *
   * Bắt buộc, không có mặc định: không có nó thì cổng APPLY-003 mất vế so sánh và việc "ép
   * hai chỗ khớp nhau" quay về một lời hứa bằng chữ.
   */
  lampMintReserveKhoNft: KhoNftPair;
}

/**
 * Dựng danh sách 12 tham số cho `reserve_draw.reserve_draw.spend`, SAU khi ép cặp kho khớp
 * với `lamp_mint` (#13-14) và ép `reserve_cap` (#12) là một giá trị sống.
 *
 * Thứ tự gọi có nghĩa: cổng chạy TRƯỚC khi mảng được dựng, nên không có đường nào lấy được
 * danh sách tham số của một cặp lệch.
 */
export function reserveDrawParamList(p: ReserveDrawParamValues): unknown[] {
  assertReserveKhoPair(p.lampMintReserveKhoNft, p.khoNft);
  if (typeof p.reserveCap !== "bigint" || p.reserveCap <= 0n) {
    throw new Error(
      `RESERVE-CAP-002: reserve_draw.reserve_cap (#12) = ${String(p.reserveCap)} — cần bigint ` +
      `DƯƠNG. Luật 1b ép \`s.total_oildrop == reserve_cap\` ở mọi lượt rút, mà \`total_oildrop\` ` +
      `là trường BẤT BIẾN của ReserveState. Sàn 0 hay thiếu ở đây không hỏng lúc apply — nó ` +
      `hỏng ở lượt rút đầu tiên, khi script hash đã chốt và MET đã nằm dưới validator. Truyền ` +
      `đúng \`reserve_cap\` đã nướng vào lamp_mint khe #5.`,
    );
  }
  return [
    p.lampPolicy, p.tokenName,                              // #1-2
    p.reserveThreadPolicy, p.reserveThreadName,             // #3-4
    p.msPerEpoch,                                            // #5
    norm(p.khoNft.policy), norm(p.khoNft.name),             // #6-7
    p.treasuryAuthPolicy, p.treasuryAuthName,               // #8-9
    p.gateScriptHash,                                        // #10
    p.custodyScriptHash,                                     // #11
    p.reserveCap,                                            // #12
  ];
}
