// lampPolicies — SỔ POLICY LAMP/tLAMP theo mạng. **NƠI GIỮ DUY NHẤT của policy id testnet.**
//
// VÌ SAO CÓ TỆP NÀY (nguyên nhân gốc, không phải tiện tay gom):
//   Trên Preprod có HAI policy tLAMP cùng được gọi là "canonical" trong tài liệu:
//   `7a1a7aed…` (marker neo bằng native-sig ví deploy) và `d9c09230…` (marker one-shot theo
//   genesis_ref). Không tệp nào trong repo nói cái nào thay cái nào, nên mỗi nhà đọc phải một
//   bản khác nhau rồi gõ cứng giá trị mình gặp trước. Bản sao kiểu đó chết IM LẶNG: nó không
//   sai cú pháp, không đỏ test, chỉ trỏ vào một token khác.
//
//   Chỗ này giữ GIÁ TRỊ + TRẠNG THÁI. Trạng thái mới là phần mà một hằng số trần không mang
//   được: "bản này đã bị thay bởi bản nào" là thứ duy nhất cứu được người đọc sau.
//
// VÌ SAO KHÔNG ĐẶT Ở `.env`:
//   `.env` bị `.gitignore` chặn ⇒ người clone kho về KHÔNG thấy gì, và quy ước nội bộ cấm agent
//   đọc `.env` của project con. Cơ chế "ai đọc phải cũng biết" sẽ chết đúng ở chỗ nó cần sống.
//   Nguồn phải là tệp ĐƯỢC GIT THEO DÕI và IMPORT ĐƯỢC.
//
// CÁCH DÙNG — đọc bằng hàm, đừng đọc bằng mắt rồi chép:
//   import { activeLampPolicyId } from "@magiclamp/genesis-sdk";
//   const pid = activeLampPolicyId("preprod");   // ném nếu chưa có bản ACTIVE
//
// ⚠ KHÔNG SỬA `policyId` của một bản ghi đã lên chuỗi. Định danh on-chain là bất biến lịch sử.
//   Thay bản mới = THÊM một bản ghi + đặt `supersededBy` ở bản cũ. Không ghi đè.

import { LAMP_MAINNET, type LampNetwork } from "./deployed.js";

export type { LampNetwork };

/** Vòng đời một policy trong sổ. */
export type PolicyStatus =
  /** Đang là bản canonical của mạng đó. Mỗi mạng nhiều nhất MỘT bản ACTIVE. */
  | "ACTIVE"
  /** Đã bị một bản khác thay. Vẫn có token trên chuỗi, nhưng KHÔNG được dùng cho tích hợp mới. */
  | "SUPERSEDED"
  /** Đã chốt sẽ đúc, CHƯA đúc ⇒ chưa có policy id. Đọc ra phải NÉM, không được trả rỗng. */
  | "PENDING-MINT";

/** Cách bốn khe marker của `lamp_mint` được neo — quyết định policy có đúc lại được không. */
export type MintAnchor =
  /** Marker đúc dưới `scriptFromNative({type:"sig"})` ⇒ MỘT khoá đúc lại được bao nhiêu lần tuỳ ý. */
  | "native-sig-markers"
  /** Marker đúc dưới `oneshot_nft.ak` (genesis_ref + asset_name) ⇒ hạt giống tiêu rồi là hết. */
  | "oneshot-markers"
  /** Không có marker registry: WHO-gate là danh sách pkh nướng sẵn vào tham số (bản mainnet 8 tham số). */
  | "baked-pkh-list";

export interface LampPolicyRecord {
  /** Khoá tra cứu, duy nhất toàn sổ. Đặt theo `<mạng>-<cách neo>-<số tham số>`, KHÔNG theo trạng thái
   *  (trạng thái đổi, khoá thì không được đổi — đổi khoá là làm gãy mọi `supersededBy` trỏ tới nó). */
  id: string;
  network: LampNetwork;
  /** Asset name (hex). `4c414d50` = "LAMP", `744c414d50` = "tLAMP". */
  assetName: string;
  /** `null` ⇔ `status === "PENDING-MINT"`. Mọi giá trị khác phải là 56 ký tự hex thường. */
  policyId: string | null;
  status: PolicyStatus;
  /** Số tham số apply-param của `lamp_mint` đã dùng. Đổi số này ⇒ policy id KHÁC. */
  mintParamCount: 8 | 12 | 14;
  anchor: MintAnchor;
  /** Một câu nói rõ hệ quả của cách neo, để người đọc không phải suy. */
  anchorNote: string;
  /** `id` của bản ghi đã thay bản này. `null` khi chưa bị thay. */
  supersededBy: string | null;
  /** Ngày ghi/ cập nhật bản ghi (YYYY-MM-DD). */
  recordedAt: string;
  /** Con trỏ kiểm được: `tệp:dòng`, tx hash, tệp trạng thái. Không có thì đừng ghi bản ghi. */
  evidence: string[];
  /** Thứ phải đọc trước khi tích hợp. */
  caveats: string[];
}

/**
 * tLAMP đúc bởi `canonical_mint.ts` — policy id GIỐNG NHAU trên Preprod và Preview.
 * Giống nhau KHÔNG phải trùng hợp: cả bốn khe marker đều là policy của
 * `scriptFromNative({type:"sig", keyHash: pkh_ví_deploy})`, mà native-sig chỉ phụ thuộc khoá
 * ⇒ mạng nào cũng ra cùng một giá trị. Chính tính chất làm nó "tiện" là tính chất làm nó hỏng.
 * Khai MỘT LẦN ở đây, hai bản ghi bên dưới cùng trỏ vào — không gõ lại chuỗi lần thứ hai.
 */
const NATIVE_SIG_TLAMP_POLICY_ID =
  "7a1a7aed5ec47acc37b6fa82695c1219bf76895b505b01161367adf9";

const NATIVE_SIG_ANCHOR_NOTE =
  "Bốn khe marker (thread/registry/kho/meter) đều trỏ vào policy native-sig của ví deploy " +
  "(`Genesis/scripts/canonical_mint.ts:109-123`). Native-sig KHÔNG one-shot ⇒ người giữ MỘT khoá " +
  "đúc lại SUPPLY NFT lượt hai ⇒ dựng SupplyState thứ hai với `dist_minted = 0` ⇒ đúc lại trọn cap; " +
  "và đúc MET giữ ở ví ⇒ nhánh ReserveDraw thoả mà không validator nào chạy. Hệ quả ghi nguyên văn " +
  "ở `Genesis/scripts/_guards.ts:52-56` (`CONSEQUENCE_REMINTABLE_MARKERS`).";

/** Bảng tra CHÍNH. Thứ tự trong mảng không mang nghĩa — tra bằng `id` hoặc bằng `network`. */
export const LAMP_POLICY_REGISTRY: readonly LampPolicyRecord[] = [
  // ── MAINNET ────────────────────────────────────────────────────────────────
  {
    // Giá trị lấy TỪ `LAMP_MAINNET`, không gõ lại: `deployed.ts` vẫn là nơi giữ bản ghi mainnet
    // đầy đủ (mintParams + provenance). Sổ này chỉ thêm TRẠNG THÁI cho nó.
    id: "mainnet-baked-pkh-8param",
    network: "mainnet",
    assetName: LAMP_MAINNET.assetName,
    policyId: LAMP_MAINNET.policyId,
    status: "ACTIVE",
    mintParamCount: LAMP_MAINNET.mintParamCount,
    anchor: "baked-pkh-list",
    anchorNote:
      "WHO-gate = danh sách pkh nướng sẵn + ngưỡng chữ ký, KHÔNG đọc registry. " +
      "Chi tiết + toàn bộ tham số: `Genesis/offchain/src/deployed.ts` khối `LAMP_MAINNET`.",
    supersededBy: null,
    recordedAt: "2026-09-11",
    evidence: [
      "Genesis/offchain/src/deployed.ts:61-123 (bản ghi đầy đủ, provenance byteMatch)",
      "tx genesis mainnet `db0610c2…` (deployed.ts:57)",
    ],
    caveats: [
      "Bản MỒI. Sẽ bị thay bởi policy uỷ quyền OrgDID — policy id SẼ KHÁC. Đừng nhúng cứng.",
      "Nhánh ReserveDraw chết vĩnh viễn: `meter_nft_policy` = 28 byte 0 (deployed.ts:92-93).",
    ],
  },

  // ── PREPROD ────────────────────────────────────────────────────────────────
  {
    id: "preprod-native-sig-12param",
    network: "preprod",
    assetName: "744c414d50",
    policyId: NATIVE_SIG_TLAMP_POLICY_ID,
    status: "SUPERSEDED",
    mintParamCount: 12,
    anchor: "native-sig-markers",
    anchorNote: NATIVE_SIG_ANCHOR_NOTE,
    supersededBy: "preprod-oneshot-12param",
    recordedAt: "2026-09-11",
    evidence: [
      "Faucet/deployed-artifacts.md:15-19 (policy id + câu khai native-sig, không one-shot)",
      "Faucet/scripts/deployed-faucet.preprod.json:6",
      "Genesis/scripts/canonical_mint.ts:109-123 (đường đúc: native marker + lamp_mint 12 tham số)",
    ],
    caveats: [
      "ĐANG CÓ HẠ NGUỒN GÕ CỨNG giá trị này (CarpetMint). Đổi sang bản mới là việc DI TRÚ có " +
        "lịch, không phải việc sửa một dòng — bản cũ vẫn còn token trên chuỗi và vẫn tiêu được.",
      "`mintParamCount: 12` là SUY từ đường đúc (`canonical_mint.ts` truyền 12 giá trị), CHƯA " +
        "đối chiếu byte với bytecode trên chuỗi. Cần chắc thì đọc ngược `/script_info` rồi dựng lại.",
      "Ba tệp `Faucet/scripts/deployed-faucet*.json` từng khai bản này là 'registry-gate + A-DEST' " +
        "trống trơn. Validator ĐÚNG là registry-gate, nhưng câu đó bỏ mất vế quyết định: marker " +
        "neo bằng native-sig ⇒ cổng WHO có thật mà trần 36 tỷ thì không.",
    ],
  },
  {
    id: "preprod-oneshot-12param",
    network: "preprod",
    assetName: "744c414d50",
    policyId: "d9c09230079b810ab5ed92e8db4c190d42efc42db6aac028656f7e07",
    status: "SUPERSEDED",
    mintParamCount: 12,
    anchor: "oneshot-markers",
    anchorNote:
      "Marker đúc bằng `oneshot_nft.ak` neo `genesis_ref` = `525b80f4…e301#1`; hạt giống đã tiêu ⇒ " +
      "lượt đúc SUPPLY NFT thứ hai bị chặn (bằng chứng phủ định ghi trong " +
      "`Genesis/scripts/canonical-v2-state.json` khối `oneshotProof`).",
    supersededBy: "preprod-oneshot-14param",
    recordedAt: "2026-09-11",
    evidence: [
      "Genesis/scripts/canonical-v2-state.json (`wiring.lampPid`, `tx.*`, `oneshotProof.blocked`)",
      "Genesis/canonical-preprod-runbook.md:148",
      "Genesis/mainnet-deploy-plan.md:149",
    ],
    caveats: [
      "Sinh từ bản `lamp_mint` **12 tham số**. Mã hôm nay là **14** " +
        "(`Genesis/onchain/validators/lamp_mint.ak:9`, `:60`) ⇒ dựng lại từ mã hiện tại ra policy " +
        "id KHÁC. Không có đường 'build lại cho khớp' — tham số nằm TRONG policy id.",
      "Cổng APPLY-001 (`Genesis/offchain/src/applyGate.ts:25`) sẽ ném nếu ai chạy lại đường 12 " +
        "tham số trên blueprint 14 — đó là hành vi ĐÚNG, đừng nới cổng để 'chạy cho xong'.",
    ],
  },
  {
    id: "preprod-oneshot-14param",
    network: "preprod",
    assetName: "744c414d50",
    policyId: null,
    status: "PENDING-MINT",
    mintParamCount: 14,
    anchor: "oneshot-markers",
    anchorNote:
      "Bản sẽ đúc lại theo đường registry-gate với `lamp_mint` 14 tham số hiện hành " +
      "(`Genesis/onchain/validators/lamp_mint.ak`). Marker one-shot theo `genesis_ref` mới.",
    supersededBy: null,
    recordedAt: "2026-09-11",
    evidence: [
      "Chưa có tx. Bản ghi này tồn tại ĐỂ ĐỌC RA LÀ NÉM — xem `activeLampPolicyId`.",
    ],
    caveats: [
      "CHƯA ĐÚC ⇒ chưa có policy id. Mọi chỗ cần giá trị phải DỪNG, không được đệm rỗng.",
      "Sau khi đúc: điền `policyId`, đổi `status` → `ACTIVE`, và ĐỂ NGUYÊN `id`. Đổi `id` làm " +
        "gãy mọi `supersededBy` đang trỏ tới nó mà không dòng nào kêu.",
    ],
  },

  // ── PREVIEW ────────────────────────────────────────────────────────────────
  {
    id: "preview-native-sig-12param",
    network: "preview",
    assetName: "744c414d50",
    policyId: NATIVE_SIG_TLAMP_POLICY_ID,
    status: "SUPERSEDED",
    mintParamCount: 12,
    anchor: "native-sig-markers",
    anchorNote: NATIVE_SIG_ANCHOR_NOTE,
    supersededBy: "preview-oneshot-14param",
    recordedAt: "2026-09-11",
    evidence: [
      "Faucet/scripts/deployed-faucet.preview.json:6",
      "Faucet/deployed-artifacts.md:18-19 (vì sao TRÙNG policy id với Preprod)",
    ],
    caveats: [
      "TRÙNG policy id với bản ghi `preprod-native-sig-12param` — cùng một giá trị, hai mạng. " +
        "Đó là TRIỆU CHỨNG của neo native-sig, không phải tính năng: policy id không còn phân " +
        "biệt được mạng nào, nên một giao dịch dựng nhầm mạng vẫn 'trông đúng'.",
      "Mạng Preview còn nhiều thread/beacon từ các lượt genesis cũ (native-sig đúc lại được). " +
        "Xem `Faucet/deployed-artifacts.md:44-45`.",
    ],
  },
  {
    id: "preview-oneshot-14param",
    network: "preview",
    assetName: "744c414d50",
    policyId: null,
    status: "PENDING-MINT",
    mintParamCount: 14,
    anchor: "oneshot-markers",
    anchorNote:
      "Bản sẽ đúc lại theo đường registry-gate 14 tham số, marker one-shot theo `genesis_ref` mới.",
    supersededBy: null,
    recordedAt: "2026-09-11",
    evidence: ["Chưa có tx."],
    caveats: [
      "CHƯA ĐÚC ⇒ chưa có policy id. Đọc ra là NÉM.",
      "Sau khi đúc: điền `policyId`, đổi `status` → `ACTIVE`, ĐỂ NGUYÊN `id`.",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ĐỌC — fail-closed
//
// Ba trạng thái phải phân biệt được, và trạng thái thứ ba KHÔNG được trả về giá trị:
//   • khớp            → trả policy id.
//   • lệch            → bản ghi có thật nhưng KHÔNG phải thứ bên gọi xin (đã bị thay) ⇒ NÉM.
//   • KHÔNG ĐỌC ĐƯỢC  → thiếu bản ghi / rỗng / sai hình dạng / mạng chưa có bản ACTIVE ⇒ NÉM.
//
// Trả `""` hay `undefined` ở nhánh thứ ba là dựng một cái vỏ im lặng: chuỗi rỗng đi tiếp vào
// `toUnit(policyId, name)` rồi ra một unit trông hợp lệ, và tài sản rót vào một policy không ai
// giữ. LAMP không burn ⇒ sai là không sửa được.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN GIẢ DẠNG — mang asset name "LAMP"/"tLAMP" nhưng KHÔNG do `lamp_mint` đúc
//
// Vì sao chúng không nằm trong `LAMP_POLICY_REGISTRY`: mọi trường của bản ghi kia
// (`mintParamCount`, `anchor`) giả định token do `lamp_mint` sinh ra. Nhét một token
// không-phải-LAMP vào đó là nói dối bằng kiểu dữ liệu — nó sẽ đọc như một bản LAMP hợp lệ.
//
// Vì sao vẫn phải khai ở đây: một sổ "nguồn duy nhất" mà IM LẶNG về một token đang sống trên
// chuỗi với đúng cái tên ấy thì nó không phải nguồn duy nhất — người tra một policy id không
// thấy gì và kết luận "không liên quan", trong khi thứ họ đang cầm là một token 72 tỷ.
// ─────────────────────────────────────────────────────────────────────────────

export interface LookalikePolicyRecord {
  policyId: string;
  network: LampNetwork;
  assetName: string;
  /** Vì sao nó KHÔNG phải LAMP, và điều gì đã xảy ra với nó. */
  whatItActuallyIs: string;
  evidence: string[];
}

export const NON_LAMP_LOOKALIKE_POLICIES: readonly LookalikePolicyRecord[] = [
  {
    policyId: "28e916b097be13ed955330f00710bd93e2ea74bbc89aa5f5cd0f12b4",
    network: "preprod",
    assetName: "744c414d50",
    whatItActuallyIs:
      "Token diễn tập đời đầu, đúc bằng một chính sách chữ-ký-đơn của ví triển khai — KHÔNG đi " +
      "qua `lamp_mint`, nên KHÔNG có SupplyState, KHÔNG có cổng WHO, và KHÔNG có trần nào. " +
      "Hệ quả đã xảy ra thật chứ không phải rủi ro lý thuyết: cung đang là 72.000.000.000.000.000 " +
      "oildrop = 72 tỷ LAMP, tức GẤP ĐÔI trần 36 tỷ. LAMP không burn ⇒ con số đó vĩnh viễn. " +
      "Lượt đưa về trần từng được phát lệnh nhưng chết ở cổng kiểm biến môi trường trước khi chạm " +
      "chuỗi — và một lượt chết ở đó không để lại dấu vết nào, nên nó đọc y hệt một lượt đã xong.",
    evidence: [
      "Blockfrost preprod /assets/28e916b0…744c414d50 (2026-09-11): quantity 72000000000000000, mint_or_burn_count 2",
      "Distribution/scripts/live-deploy-preview.md:19 (khai 'Native sig (ví deploy)')",
      "Faucet/deployed-artifacts.md:103 (đã đánh dấu bỏ)",
    ],
  },
] as const;

/**
 * Tra một policy id bất kỳ xem nó có phải token giả dạng đã biết không.
 *
 * Dùng ở nhánh lỗi: người tra một policy id lạ phải nhận được câu "đây là cái gì", không phải
 * câu "không tìm thấy". "Không tìm thấy" là phát biểu về vùng quét, không phải về policy.
 */
export function lookalikePolicy(policyId: string): LookalikePolicyRecord | null {
  const needle = policyId.trim().toLowerCase();
  return NON_LAMP_LOOKALIKE_POLICIES.find((r) => r.policyId === needle) ?? null;
}

/** Mã lỗi của sổ policy. Tên gợi nhớ, không ký hiệu trơ. */
export const LAMP_POLICY_ERRORS = {
  MISSING_RECORD: "TLAMP-SRC-001-MISSING-RECORD",
  POLICY_ID_EMPTY: "TLAMP-SRC-002-POLICY-ID-EMPTY",
  POLICY_ID_MALFORMED: "TLAMP-SRC-003-POLICY-ID-MALFORMED",
  SUPERSEDED: "TLAMP-SRC-004-SUPERSEDED",
  NO_ACTIVE_RECORD: "TLAMP-SRC-005-NO-ACTIVE-RECORD",
  AMBIGUOUS_ACTIVE: "TLAMP-SRC-006-AMBIGUOUS-ACTIVE",
} as const;

/** Lỗi của sổ policy — mang mã tra được, để chỗ gọi phân biệt được bốn nguyên nhân. */
export class LampPolicySourceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LampPolicySourceError";
    this.code = code;
  }
}

const POLICY_ID_SHAPE = /^[0-9a-f]{56}$/;

/** Tra một bản ghi theo `id`. Ném khi không có — KHÔNG trả `undefined`. */
export function lampPolicyRecord(id: string): LampPolicyRecord {
  const found = LAMP_POLICY_REGISTRY.find((r) => r.id === id);
  if (!found) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.MISSING_RECORD,
      `không có bản ghi policy nào mang id "${id}". Sổ hiện có: ` +
        `${LAMP_POLICY_REGISTRY.map((r) => r.id).join(", ")}. ` +
        `Nguồn duy nhất: Genesis/offchain/src/lampPolicies.ts — đừng gõ tay policy id.`,
    );
  }
  return found;
}

/**
 * Ép hình dạng policy id. Tách riêng để MỌI đường đọc dùng CÙNG một phép kiểm — hai bản kiểm
 * cạnh nhau là cách một bản lỏng hơn bản kia mà không ai giải thích được vì sao.
 *
 * Xuất ra ngoài có chủ ý: nhánh "sai hình dạng" chỉ dựng được bằng một bản ghi hỏng, mà sổ thật
 * thì không có bản ghi hỏng nào (đúng như mong muốn). Không có seam này thì nhánh đó không có
 * bài kiểm nào, và "đã được ghim" trở thành một câu không đo được.
 */
export function readPolicyIdOf(record: LampPolicyRecord): string {
  const pid = record.policyId;
  if (pid === null || pid === undefined || pid.trim() === "") {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.POLICY_ID_EMPTY,
      `bản ghi "${record.id}" (${record.network}) chưa có policy id — trạng thái ` +
        `${record.status}. Chưa đúc thì KHÔNG có giá trị để đọc; đừng đệm rỗng, đừng suy từ ` +
        `mạng khác (policy id phụ thuộc apply-param ⇒ mỗi mạng một giá trị khác).`,
    );
  }
  if (!POLICY_ID_SHAPE.test(pid)) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.POLICY_ID_MALFORMED,
      `bản ghi "${record.id}" có policyId sai hình dạng: cần đúng 56 ký tự hex thường ` +
        `(28 byte script hash), nhận được ${pid.length} ký tự "${pid}".`,
    );
  }
  return pid;
}

/**
 * Policy id ĐANG hiệu lực của một mạng.
 *
 * Ném khi: mạng không có bản ghi nào · không bản nào `ACTIVE` (kèm tên bản đang chờ đúc) ·
 * có nhiều hơn một bản `ACTIVE` (sổ tự mâu thuẫn — đó là trạng thái KHÔNG ĐỌC ĐƯỢC, không
 * phải chỗ để đoán) · policy id rỗng hoặc sai hình dạng.
 */
export function activeLampPolicyId(network: LampNetwork): string {
  return selectActivePolicyId(LAMP_POLICY_REGISTRY, network);
}

/**
 * Lõi của `activeLampPolicyId`, nhận bảng tra làm tham số.
 *
 * Xuất ra ngoài có chủ ý (cùng lý do với `readPolicyIdOf`): hai nhánh "không bản nào ACTIVE" và
 * "nhiều hơn một bản ACTIVE" chỉ dựng được bằng một bảng tra bịa ra. Đây là seam ĐỌC, không phải
 * đường ghi — nó không cho ai thêm bản ghi vào sổ thật.
 */
export function selectActivePolicyId(
  registry: readonly LampPolicyRecord[],
  network: LampNetwork,
): string {
  const ofNetwork = registry.filter((r) => r.network === network);
  if (ofNetwork.length === 0) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.MISSING_RECORD,
      `sổ không có bản ghi nào cho mạng "${network}".`,
    );
  }
  const active = ofNetwork.filter((r) => r.status === "ACTIVE");
  if (active.length > 1) {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.AMBIGUOUS_ACTIVE,
      `mạng "${network}" có ${active.length} bản ACTIVE (${active.map((r) => r.id).join(", ")}). ` +
        `Mỗi mạng nhiều nhất MỘT bản canonical — sổ đang tự mâu thuẫn, sửa sổ trước khi dựng tx.`,
    );
  }
  const one = active[0];
  if (!one) {
    const pending = ofNetwork.filter((r) => r.status === "PENDING-MINT").map((r) => r.id);
    const superseded = ofNetwork.filter((r) => r.status === "SUPERSEDED").map((r) => r.id);
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.NO_ACTIVE_RECORD,
      `mạng "${network}" chưa có bản ACTIVE. Đang chờ đúc: ` +
        `${pending.length ? pending.join(", ") : "(không có)"}. ` +
        `Bản đã bị thay: ${superseded.length ? superseded.join(", ") : "(không có)"}. ` +
        `Cần giá trị lịch sử thì gọi historicalLampPolicyId("<id>") và tự chịu trách nhiệm — ` +
        `đừng để đường ACTIVE rơi ngược về bản cũ.`,
    );
  }
  return readPolicyIdOf(one);
}

/**
 * Policy id của MỘT bản ghi cụ thể, kể cả bản đã bị thay.
 *
 * Dùng cho việc đọc lịch sử và di trú (quét số dư dưới policy cũ). Đường này CỐ Ý bắt gọi bằng
 * `id` chứ không bằng mạng: xin một bản đã chết thì phải gõ tên nó ra, và gõ ra thì có vết.
 */
export function historicalLampPolicyId(id: string): string {
  return readPolicyIdOf(lampPolicyRecord(id));
}

/**
 * Giống `historicalLampPolicyId` nhưng TỪ CHỐI bản đã bị thay — dùng khi chỗ gọi tự tin mình
 * đang cầm id của bản còn hiệu lực. Đây là nhánh "lệch": bản ghi đọc được, nhưng không phải
 * thứ bên gọi xin.
 */
export function lampPolicyIdRequireActive(id: string): string {
  const record = lampPolicyRecord(id);
  if (record.status === "SUPERSEDED") {
    throw new LampPolicySourceError(
      LAMP_POLICY_ERRORS.SUPERSEDED,
      `bản ghi "${record.id}" đã bị thay` +
        `${record.supersededBy ? ` bởi "${record.supersededBy}"` : ""}. ` +
        `Chỗ gọi xin bản ACTIVE ⇒ từ chối. Dùng activeLampPolicyId("${record.network}") để lấy ` +
        `bản đang hiệu lực, hoặc historicalLampPolicyId("${record.id}") nếu THẬT SỰ cần bản cũ.`,
    );
  }
  // PENDING-MINT KHÔNG đi qua nhánh trên có chủ ý: nó không phải "bản cũ", nó là "chưa có giá
  // trị". Hai nguyên nhân khác nhau thì phải ra hai mã khác nhau, không thì người đọc lỗi đi
  // tìm bản thay thế cho một thứ chưa từng tồn tại. Nó rơi xuống readPolicyIdOf ⇒ 002.
  return readPolicyIdOf(record);
}
