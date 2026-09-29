// anchorView — đọc anchor TAAD theo VỊ TRÍ trường, phía off-chain.
//
// BẢN CHÉP CÓ NHÃN của `onchain/lib/magiclamp/governance/anchor_view.ak ▸ anchor_view` +
// `anchor_active_and_signed` (đọc 2026-09-29, gov-v2 @ 46a3a36; bản Aiken đó lại là bản chép của
// PhoenixKeyDID/Wakeme `anchor_view.ak` @ 4512fe6). Chỉ số trường:
//   1 entity_type · 2 controller_pkh · 5 status · 7 parent_did · 13 depth · 14 device_pkh ·
//   15 aux_device_pkhs · 16 wakeme_vault_policy · 17 last_active_ms. Tối thiểu 17 trường.
//
// Khác bản on-chain ở MỘT chỗ, có chủ ý: on-chain trả `None` (giao dịch trượt, mất phí), còn đây
// NÉM lỗi có mã ngay khi dựng — builder biết trước anchor không qua cổng A-PERSON thì không dựng.

import { Constr, Data } from "@lucid-evolution/lucid";

export interface AnchorView {
  controller_pkh: string;
  status_active: boolean;
  device_pkh: string;
  aux_device_pkhs: string[];
  entity_person: boolean;
  parent_none: boolean;
  depth: bigint;
}

const MIN_FIELDS = 17;

function bytesAt(fs: Data[], i: number, ctx: string): string {
  const v = fs[i];
  if (typeof v !== "string") throw new Error(`GOV-ANCHOR-002: anchor trường ${i} (${ctx}) phải là ByteArray`);
  return v;
}

function constrIndexAt(fs: Data[], i: number): number {
  const v = fs[i];
  return v instanceof Constr ? v.index : -1;
}

/** anchor_view.ak ▸ anchor_view — datum không đọc được ⇒ ném `GOV-ANCHOR-001/002`. */
export function decodeAnchorView(datumCbor: string): AnchorView {
  const d = Data.from(datumCbor);
  if (!(d instanceof Constr) || d.index !== 0) throw new Error("GOV-ANCHOR-001: anchor datum phải là Constr 0");
  const fs = d.fields;
  if (fs.length < MIN_FIELDS) throw new Error(`GOV-ANCHOR-001: anchor datum phải có ≥ ${MIN_FIELDS} trường, nhận ${fs.length}`);
  const aux = fs[15];
  if (!Array.isArray(aux) || !aux.every((x) => typeof x === "string")) {
    throw new Error("GOV-ANCHOR-002: anchor trường 15 (aux_device_pkhs) phải là List<ByteArray>");
  }
  const depth = fs[13];
  return {
    controller_pkh: bytesAt(fs, 2, "controller_pkh"),
    status_active: constrIndexAt(fs, 5) === 0,
    device_pkh: bytesAt(fs, 14, "device_pkh"),
    aux_device_pkhs: aux as string[],
    entity_person: constrIndexAt(fs, 1) === 0,
    parent_none: constrIndexAt(fs, 7) === 1,
    // on-chain đọc lỏng: sai kiểu ⇒ −1 ⇒ cổng depth == 0 bác. Giữ đúng nghĩa đó.
    depth: typeof depth === "bigint" ? depth : -1n,
  };
}

/**
 * Cổng A-PERSON + chọn khoá ký. Trả `[controller_pkh, device]` phải có trong `extra_signatories`.
 * `deviceSigner` (tuỳ chọn) = `device_pkh` hoặc một `aux_device_pkhs`; mặc định `device_pkh`.
 */
export function requiredSigners(v: AnchorView, deviceSigner?: string): [string, string] {
  if (!v.status_active) throw new Error("GOV-ANCHOR-010: anchor không Active — cổng WHO on-chain sẽ bác");
  if (!v.entity_person) throw new Error("GOV-ANCHOR-011: anchor không phải entity Person — chỉ DID Person gốc là cử tri (A-PERSON)");
  if (!v.parent_none) throw new Error("GOV-ANCHOR-012: anchor có parent_did — DID con không phải cử tri (A-PERSON)");
  if (v.depth !== 0n) throw new Error(`GOV-ANCHOR-013: anchor depth ${v.depth} ≠ 0 (A-PERSON)`);
  const dev = deviceSigner ?? v.device_pkh;
  if (dev !== v.device_pkh && !v.aux_device_pkhs.includes(dev)) {
    throw new Error(`GOV-ANCHOR-014: khoá thiết bị ${dev} không phải device_pkh cũng không thuộc aux_device_pkhs của anchor`);
  }
  return [v.controller_pkh, dev];
}
