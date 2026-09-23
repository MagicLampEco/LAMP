// Distribution/offchain/src/pots.ts — SỔ 18 POT, danh sách ĐÓNG.
//
// ── Vì sao tệp này tồn tại ────────────────────────────────────────────────────
// Mỗi pot được triển khai thành MỘT CỤM `Distribution` v3 độc lập: ba validator
// (`beacon` · `claim_account` · `treasury`) nhận các one-shot NFT policy làm apply-param,
// mỗi policy sinh từ một genesis ref riêng ⟹ mỗi pot có script hash riêng, địa chỉ kho
// riêng, và value trong kho đó = đúng ngân sách của pot. Đó là trần cứng VẬT LÝ: không
// mệnh đề nào phải đếm hộ, vì tài sản của pot khác không nằm trong cùng một UTxO.
//
// Cái mà sổ này chặn là một lỗi KHÔNG tự kêu: gõ sai `POT` một chữ thì đường tệp trạng
// thái vẫn hợp lệ, `loadDeployed()` vẫn báo "chưa triển khai", và lượt chạy tiếp theo
// dựng một cụm THỨ HAI cho cùng một pot thay vì mở lại cụm đã có. Danh sách đóng biến
// cái đó thành một lỗi ném ra ngay ở dòng đầu.
//
// ── Nguồn của các con số ──────────────────────────────────────────────────────
// `Papers/pot-catalog.md` §1 "Bảng 18 pot" là NGUỒN. Tệp này là bản chép CÓ NHÃN, và nó
// không được phép già đi trong im lặng: `Distribution/tests/pots.test.ts` đọc lại chính
// tệp markdown đó, tự phân tách bảng, rồi đối chiếu từng dòng. Sổ lệch nguồn ⟹ bộ kiểm đỏ.
// Chép lúc: 2026-09-23.

/** Mã pot — danh sách ĐÓNG, đúng 18 phần tử, khớp thứ tự bảng ở `Papers/pot-catalog.md` §1. */
export type PotId =
  | "reserve"
  | "treasury"
  | "development"
  | "platform"
  | "app"
  | "wakeme"
  | "referrer"
  | "phoenix-treasury"
  | "foundation"
  | "aladin-contract"
  | "greensun-tech"
  | "partnership"
  | "early-tiger-deleg"
  | "airdrop"
  | "srcl"
  | "join-lampnet"
  | "redback"
  | "liquidity";

export interface Pot {
  /** Số thứ tự trong bảng nguồn (1..18) — để đối chiếu được với `Papers/pot-catalog.md`. */
  readonly index: number;
  readonly id: PotId;
  /** Tên như bảng nguồn viết, dùng khi in ra cho người đọc. */
  readonly label: string;
  /** Ngân sách theo ĐƠN VỊ CỦA BẢNG NGUỒN: nghìn LAMP. Giữ nguyên đơn vị nguồn để đối chiếu. */
  readonly thousandLamp: number;
}

/**
 * 18 pot, thứ tự đúng bảng nguồn.
 *
 * Đơn vị `thousandLamp` cố ý KHÔNG đổi sang oildrop ở đây: bảng nguồn viết bằng nghìn LAMP,
 * nên bản chép giữ nguyên đơn vị nguồn thì phép đối chiếu là so hai con số giống hệt nhau,
 * không phải so qua một phép nhân có thể sai. Đổi sang oildrop là việc của `potBudgetOildrop()`.
 */
export const POTS: readonly Pot[] = [
  { index: 1,  id: "reserve",           label: "Reserve",                       thousandLamp: 9_630_000 },
  { index: 2,  id: "treasury",          label: "Treasury",                      thousandLamp:   964_000 },
  { index: 3,  id: "development",       label: "Development",                   thousandLamp: 2_718_000 },
  { index: 4,  id: "platform",          label: "Platform",                      thousandLamp: 3_141_000 },
  { index: 5,  id: "app",               label: "App",                           thousandLamp: 1_618_000 },
  { index: 6,  id: "wakeme",            label: "Wakeme",                        thousandLamp: 1_001_000 },
  { index: 7,  id: "referrer",          label: "Referrer",                      thousandLamp:   343_000 },
  { index: 8,  id: "phoenix-treasury",  label: "PhoenixKey (Phoenix Treasury)", thousandLamp:   142_857 },
  { index: 9,  id: "foundation",        label: "MagicLamp Foundation",          thousandLamp: 1_296_000 },
  { index: 10, id: "aladin-contract",   label: "Aladin Contract",               thousandLamp: 6_000_000 },
  { index: 11, id: "greensun-tech",     label: "GreenSun Tech",                 thousandLamp: 6_000_000 },
  { index: 12, id: "partnership",       label: "Partnership",                   thousandLamp:   284_000 },
  { index: 13, id: "early-tiger-deleg", label: "Early TIGER Deleg (ETD)",       thousandLamp:    12_000 },
  { index: 14, id: "airdrop",           label: "Airdrop",                       thousandLamp:   120_000 },
  { index: 15, id: "srcl",              label: "SRCL",                          thousandLamp:   360_000 },
  { index: 16, id: "join-lampnet",      label: "Join LampNet",                  thousandLamp: 1_461_000 },
  { index: 17, id: "redback",           label: "RedBack",                       thousandLamp:    21_143 },
  { index: 18, id: "liquidity",         label: "Liquidity",                     thousandLamp:   888_000 },
] as const;

/** Mọi mã pot, để in ra trong thông báo lỗi và để lặp khi triển khai hàng loạt. */
export const POT_IDS: readonly PotId[] = POTS.map((p) => p.id);

/** Trần cung LAMP, theo nghìn LAMP. Bằng tổng 18 pot — `assertPotCatalog()` ép điều đó. */
export const TOTAL_THOUSAND_LAMP = 36_000_000;

/**
 * Pot 1 (Reserve) KHÔNG đi qua engine Capped Drop — nó ở rổ Reserve, nhả bởi module `Reserve/`
 * (`Allocation/README.md:52`). Nên khi triển khai hàng loạt thì bỏ nó ra, chứ không phải quên nó.
 */
export const POT_IDS_CAPPED_DROP: readonly PotId[] = POT_IDS.filter((id) => id !== "reserve");

/** 1 LAMP = 10^6 oildrop. Nguồn: cung mainnet đo được 1_000_000_000_000 oildrop = 1.000.000 LAMP. */
const OILDROP_PER_LAMP = 1_000_000n;

/**
 * Tra một pot theo mã. Ném khi mã không có trong danh sách ĐÓNG.
 *
 * Ném chứ không trả `undefined`: người gọi duy nhất là đường dựng tên tệp trạng thái và đường
 * dựng tham số triển khai, và cả hai đều chạy tiếp êm ru với một giá trị rỗng — rồi hỏng ở một
 * chỗ cách đó vài bước, với một câu báo lỗi nói về UTxO chứ không nói về cái mã gõ sai.
 */
export function potById(id: string): Pot {
  const found = POTS.find((p) => p.id === id);
  if (!found) {
    throw new Error(
      `POT-001: '${id}' không phải mã pot. Danh sách ĐÓNG, đúng 18 mã: ${POT_IDS.join(" · ")}. ` +
        `Nguồn của danh sách: Papers/pot-catalog.md §1.`,
    );
  }
  return found;
}

/** Ngân sách của một pot, quy ra oildrop — đây là con số đi vào value của kho cụm đó. */
export function potBudgetOildrop(id: PotId): bigint {
  return BigInt(potById(id).thousandLamp) * 1000n * OILDROP_PER_LAMP;
}

/**
 * Soát tính toàn vẹn của chính sổ này, KHÔNG đọc tệp nguồn.
 *
 * Phép này bắt được lỗi sửa tay trong tệp này (trùng mã, thiếu dòng, số thứ tự trôi, tổng lệch).
 * Nó KHÔNG bắt được ca cả tệp này lẫn niềm tin của người sửa cùng lệch khỏi bảng nguồn — phép
 * bắt ca đó là `Distribution/tests/pots.test.ts`, nơi đọc lại `Papers/pot-catalog.md`. Hai phép
 * đo hai đại lượng khác nhau; đừng đọc phép này thành "sổ đã khớp nguồn".
 */
export function assertPotCatalog(): void {
  if (POTS.length !== 18) {
    throw new Error(`POT-002: sổ có ${POTS.length} pot, bảng nguồn có 18.`);
  }

  const seen = new Set<string>();
  for (const p of POTS) {
    if (seen.has(p.id)) throw new Error(`POT-003: mã pot '${p.id}' xuất hiện hai lần.`);
    seen.add(p.id);
  }

  POTS.forEach((p, i) => {
    if (p.index !== i + 1) {
      throw new Error(`POT-004: pot '${p.id}' mang index ${p.index} nhưng đứng thứ ${i + 1}.`);
    }
  });

  const sum = POTS.reduce((acc, p) => acc + p.thousandLamp, 0);
  if (sum !== TOTAL_THOUSAND_LAMP) {
    throw new Error(
      `POT-005: tổng 18 pot = ${sum} nghìn LAMP, trần cung = ${TOTAL_THOUSAND_LAMP} nghìn LAMP. ` +
        `Lệch ${sum - TOTAL_THOUSAND_LAMP}.`,
    );
  }
}
