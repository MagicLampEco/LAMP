// _genesisReservePlacement.ts — phần THUẦN của việc đóng F1 ngay ở lượt genesis.
//
// F1 LÀ GÌ
//   Nhánh `ReserveDraw` của `lamp_mint` chỉ đòi: đúng 1 input mang METER, đúng 1 input mang NFT
//   kho Reserve (policy `custody_seed`, khe #13-14), và Δ tại script đang giữ NFT kho ≥ δ. Nó
//   KHÔNG ghim script nào giữ NFT kho (`custody_seed` chỉ ép `!is_vk`). Bản cũ để METER ở VÍ sau
//   genesis và hạt giống custody ở cùng khoá ⇒ hai giao dịch là rút trọn 9,63 tỷ Reserve về một
//   script tuỳ chọn.
//
// ĐÓNG BẰNG CÁCH NÀO — VÀ CHỖ KHÔNG GỘP ĐƯỢC
//   · METER đúc THẲNG vào `reserve_draw` kèm `ReserveState` trong Tx A. Từ lúc sinh, tiêu METER
//     = chạy `reserve_draw.ak`, và Luật 10 ghim NFT kho vào ĐÚNG `custody_script_hash` — đích tuỳ
//     ý bị chặn, kể cả khi ai đó đúc NFT kho vào một script lạ.
//   · auth NFT (`reserve_auth`) đúc trong CÙNG Tx A, `genesis_ref` = hạt giống genesis, đặt ở
//     `reserve_gate`. `reserve_draw` nướng `authPid` vào hash, nên địa chỉ `reserve_draw` chỉ
//     biết được khi hạt giống auth đã chốt — dùng chính hạt giống genesis là cách chốt nó mà
//     không thêm UTxO nào phải giữ sống. `reserve_auth` không cấm policy đúc khác trong cùng tx.
//   · custody NFT KHÔNG vào Tx A được: `Treasury/onchain/validators/custody_seed.ak` luật
//     S-MINT-2 `expect list.length(assets.policies(tx.mint)) == 1`. Đổi luật đó là đổi bytes
//     `custody_seed` ⇒ đổi khe #13 ⇒ đổi policy tLAMP đã công bố — cấm. Nên custody đi giao
//     dịch RIÊNG (Tx A0), gửi TRƯỚC Tx A: Tx A0 không phụ thuộc output nào của Tx A (datum của
//     nó chỉ cần `lampPid`, tính trước được từ hạt giống genesis). Gửi trước thì không có thời
//     điểm nào hạt giống custody còn sống trong khi METER đã tồn tại.
//
// Tệp này KHÔNG chạm mạng, KHÔNG đọc env, KHÔNG nạp `config.ts` — bài kiểm nạp được trực tiếp
// (`Genesis/tests/genesisReservePlacement.test.ts`).
import { getAddressDetails } from "@lucid-evolution/lucid";

/** Một output đã dựng, đủ để đo đích của marker. */
export interface PlacedOutput {
  address: string;
  assets: Record<string, bigint>;
}

/** Đích bắt buộc của MỘT marker: unit (policy + tên hex) phải nằm đúng một bản, ở đúng địa chỉ. */
export interface MarkerTarget {
  label: string;
  unit: string;
  address: string;
}

/** Bề mặt wiring mà Tx A cần để đặt sáu marker — khai theo hình dạng, không import kiểu. */
export interface TxATargetInput {
  threadUnit: string; ssAddr: string;
  regUnit: string; regAddr: string;
  khoUnit: string; treAddr: string;
  dropUnit: string; beaconAddr: string;
  metUnit: string; drawAddr: string;
  authUnit: string; gateAddr: string;
}

/**
 * Sáu marker của Tx A và đích của từng cái. METER → `reserve_draw`, auth → `reserve_gate`: đây
 * là hai dòng đóng F1. Không marker nào có đích là một ví.
 */
export function txAMarkerTargets(w: TxATargetInput): MarkerTarget[] {
  return [
    { label: "SUPPLY → supply_state", unit: w.threadUnit, address: w.ssAddr },
    { label: "REGISTRY → Script(regPid)", unit: w.regUnit, address: w.regAddr },
    { label: "TREASURY → kho A-DEST", unit: w.khoUnit, address: w.treAddr },
    { label: "DROP → beacon", unit: w.dropUnit, address: w.beaconAddr },
    { label: "METER → reserve_draw", unit: w.metUnit, address: w.drawAddr },
    { label: "TREASURYPULL (auth) → reserve_gate", unit: w.authUnit, address: w.gateAddr },
  ];
}

/** Marker duy nhất của Tx A0: custody NFT → instance custody thật (địa chỉ base của `custody`). */
export function txA0MarkerTargets(custodyNftUnit: string, custodyAddr: string): MarkerTarget[] {
  return [{ label: "custody NFT (lamp-reserve) → custody", unit: custodyNftUnit, address: custodyAddr }];
}

/**
 * Marker duy nhất của Tx P: NFT con trỏ governance (`GOVPOINTER`) → `Script(pointer_policy)`
 * (GovernancePointer.md v0.1 §Genesis). Ở ví thì không validator nào gác lượt đổi con trỏ, và
 * `governance_pointer.ak` P-MINT-OUT cũng từ chối — đo ở đây để biết TRƯỚC khi gửi.
 */
export function txPMarkerTargets(pointerUnit: string, pointerAddr: string): MarkerTarget[] {
  return [{ label: "GOVPOINTER → governance_pointer", unit: pointerUnit, address: pointerAddr }];
}

/** Loại payment credential của một địa chỉ. Không đọc được ⇒ ném: trạng thái mù không được coi là "script". */
export function paymentKind(address: string): "Key" | "Script" {
  let t: string | undefined;
  try {
    t = getAddressDetails(address).paymentCredential?.type;
  } catch (e) {
    throw new Error(
      `F1-PLACE-000: không đọc được payment credential của ${address} ` +
        `(${e instanceof Error ? e.message : String(e)}). Không đo được thì không cho qua.`,
    );
  }
  if (t !== "Key" && t !== "Script") {
    throw new Error(`F1-PLACE-000: địa chỉ ${address} không có payment credential đọc được.`);
  }
  return t;
}

const policyOf = (unit: string) => unit.slice(0, 56);

/**
 * CỔNG F1-PLACE — đo đích marker trên output THẬT của giao dịch đã dựng (không đo ý định).
 *
 * - F1-PLACE-001: đích khai trong kế hoạch là một ví (payment Key) — kế hoạch sai, chưa cần dựng.
 * - F1-PLACE-002: marker có mặt ở một output KHÁC đích đã khai.
 * - F1-PLACE-003: một output về ví mang token thuộc policy của BẤT KỲ marker nào — đúng hình
 *   dạng F1. Đo theo POLICY chứ không theo unit, để một tên lạ dưới cùng policy cũng bị bắt.
 * - F1-PLACE-004: marker không có đúng một bản (thiếu, thừa, hoặc qty ≠ 1).
 * - F1-PLACE-005: danh sách output rỗng — trạng thái mù, không phải trạng thái sạch.
 */
export function assertMarkerPlacement(
  outputs: readonly PlacedOutput[],
  targets: readonly MarkerTarget[],
  step: string,
): void {
  if (outputs.length === 0) {
    throw new Error(`F1-PLACE-005: ${step} không có output nào đọc được — không đo được đích marker.`);
  }
  if (targets.length === 0) {
    throw new Error(`F1-PLACE-005: ${step} không khai marker nào — phép đo đích không có gì để đo.`);
  }
  for (const t of targets) {
    if (paymentKind(t.address) === "Key") {
      throw new Error(
        `F1-PLACE-001: ${step} khai đích của ${t.label} là VÍ ${t.address}. Marker ở ví thì tiêu ` +
          `nó không kích validator nào — đúng lỗ F1. Đích phải là một script.`,
      );
    }
  }
  const markerPolicies = new Set(targets.map((t) => policyOf(t.unit)));
  for (const o of outputs) {
    if (paymentKind(o.address) !== "Key") continue;
    const hit = Object.keys(o.assets).filter((u) => u !== "lovelace" && markerPolicies.has(policyOf(u)));
    if (hit.length > 0) {
      throw new Error(
        `F1-PLACE-003: ${step} gửi token marker về VÍ ${o.address}: ${hit.join(", ")}. ` +
          `Marker ở ví = tiêu không cần validator nào ⇒ lỗ F1 mở lại. DỪNG, không gửi.`,
      );
    }
  }
  for (const t of targets) {
    const holders = outputs.filter((o) => (o.assets[t.unit] ?? 0n) !== 0n);
    const total = holders.reduce((s, o) => s + (o.assets[t.unit] ?? 0n), 0n);
    if (holders.length !== 1 || total !== 1n) {
      throw new Error(
        `F1-PLACE-004: ${step} — ${t.label} có ${holders.length} output, tổng ${total} (cần đúng 1 ` +
          `output, qty 1).`,
      );
    }
    if (holders[0]!.address !== t.address) {
      throw new Error(
        `F1-PLACE-002: ${step} — ${t.label} nằm ở ${holders[0]!.address}, KHÁC đích đã khai ` +
          `${t.address}.`,
      );
    }
  }
}

/**
 * CỔNG F1-SEED-001 — giao dịch vừa dựng KHÔNG được tiêu (kể cả làm collateral) một hạt giống mà
 * bước SAU còn cần. Dùng cho Tx A0 với hạt giống genesis: Tx A0 có chọn-đồng tự do, và tiêu hạt
 * giống genesis ở đó là giết policy tLAMP đã công bố.
 *
 * Nhận khoá đã đọc (`txInputKeys`/`txCollateralKeys` ở `_custodySeedRef.ts`) để thuần.
 * Danh sách input rỗng ⇒ ném: một giao dịch đã dựng luôn có input, rỗng là phép đọc hỏng.
 */
export function assertTxKeepsSeed(
  inputKeys: readonly string[],
  collateralKeys: readonly string[],
  seedKey: string,
  seedLabel: string,
  step: string,
): void {
  if (inputKeys.length === 0) {
    throw new Error(`F1-SEED-002: không đọc được input của ${step} — trạng thái mù, không cho qua.`);
  }
  if (inputKeys.includes(seedKey) || collateralKeys.includes(seedKey)) {
    throw new Error(
      `F1-SEED-001: ${step} kéo ${seedLabel} ${seedKey} vào ` +
        `${inputKeys.includes(seedKey) ? "input" : "collateral"}. Bước sau cần đúng UTxO này; tiêu ` +
        `nó ở đây là không làm lại được. Tách hạt giống khỏi ví (enterprise) hoặc thêm UTxO thuần ADA.`,
    );
  }
}

/**
 * CỔNG RESERVE-CAP-001 bản thuần — `total_oildrop` ghi vào `ReserveState` lúc sinh PHẢI bằng
 * `reserve_cap` của `SupplyState` sinh CÙNG giao dịch. Cả hai bất biến vĩnh viễn từ lúc sinh
 * (`reserve_draw.ak` Luật 7 / Luật 1b), và trần mỗi epoch = total/1000.
 */
export function assertReserveTotalMatchesCap(reserveTotal: bigint, reserveCap: bigint): void {
  if (reserveTotal !== reserveCap) {
    throw new Error(
      `RESERVE-CAP-001: total_oildrop sắp ghi (${reserveTotal}) KHÁC reserve_cap của SupplyState ` +
        `sinh cùng giao dịch (${reserveCap}). Cả hai bất biến từ lúc sinh ⇒ sai ở đây là sai vĩnh viễn.`,
    );
  }
}

/** Ngân sách giao dịch đo được, và trần của mạng. */
export interface TxBudget { sizeBytes: number; mem: bigint; steps: bigint }
export interface TxLimits { maxTxSize: number; maxTxExMem: bigint; maxTxExSteps: bigint }

/**
 * So ngân sách với trần. Trả danh sách vế vượt (rỗng = vừa). Không ném: bên gọi quyết ném hay
 * in phương án — ở lượt chạy khô, một con số vượt trần là THÔNG TIN cần in ra đủ, không phải
 * một lần dừng giữa chừng giấu mất các số còn lại.
 */
export function overLimits(b: TxBudget, l: TxLimits): string[] {
  const out: string[] = [];
  if (b.sizeBytes > l.maxTxSize) out.push(`cỡ ${b.sizeBytes} > ${l.maxTxSize} byte`);
  if (b.mem > l.maxTxExMem) out.push(`mem ${b.mem} > ${l.maxTxExMem}`);
  if (b.steps > l.maxTxExSteps) out.push(`steps ${b.steps} > ${l.maxTxExSteps}`);
  return out;
}
