// registrations_io.ts — nạp danh sách đăng ký delegator từ đĩa (dùng chung
// verify_delegator.ts + build_delegator_snapshot.ts). Phía scripts nên được dùng
// node:fs; logic THUẦN vẫn nằm ở offchain/src/delegatorSnapshot.ts.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { DelegatorRegistration } from "../offchain/src/delegatorSnapshot.js";

/**
 * Nạp đăng ký từ:
 *   - file JSON là MẢNG đăng ký, hoặc
 *   - file JSON là MỘT đăng ký (đầu ra delegator_register.ts), hoặc
 *   - thư mục chứa nhiều *.json (mỗi file 1 đăng ký hoặc 1 mảng).
 * Trả về mảng phẳng. Kèm `source` mỗi bản ghi để log xung đột chỉ ra được file.
 */
export function loadRegistrations(
  path: string,
): { reg: DelegatorRegistration; source: string }[] {
  const abs = resolve(process.cwd(), path);
  const st = statSync(abs); // ném nếu không tồn tại (fail-closed)
  const out: { reg: DelegatorRegistration; source: string }[] = [];

  const ingest = (raw: string, source: string): void => {
    const parsed = JSON.parse(raw) as DelegatorRegistration | DelegatorRegistration[];
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const reg of arr) out.push({ reg, source });
  };

  if (st.isDirectory()) {
    const files = readdirSync(abs)
      .filter((f) => f.endsWith(".json"))
      .sort(); // tất định theo tên file
    for (const f of files) ingest(readFileSync(join(abs, f), "utf8"), f);
  } else {
    ingest(readFileSync(abs, "utf8"), path);
  }
  return out;
}

/** Sắp xếp tất định "first" cho dedupe first-wins: ký sớm nhất thắng (tie → nonce). */
export function sortByEarliestSigned(
  items: { reg: DelegatorRegistration; source: string }[],
): { reg: DelegatorRegistration; source: string }[] {
  return [...items].sort((a, b) => {
    const ta = a.reg.signed_at ?? "";
    const tb = b.reg.signed_at ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    const na = a.reg.nonce ?? "";
    const nb = b.reg.nonce ?? "";
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
}
