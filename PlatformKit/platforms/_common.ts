// PlatformKit platforms — tiện ích chung cho các config cụ thể.
//
// asciiToHex: encode chuỗi ASCII → hex trần (Plutus bytes). Dùng cho platform_id,
// instance_id, asset name, governance_ref placeholder. Production: governance_ref là
// script hash THẬT (28-byte hex) — KHÔNG dùng asciiToHex cho hash thật.

/** Encode chuỗi ASCII → hex trần lowercase (mỗi ký tự 1 byte). */
export function asciiToHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0xff) throw new Error(`asciiToHex: ký tự ngoài ASCII '${s[i]}' (code ${code})`);
    out += code.toString(16).padStart(2, "0");
  }
  return out;
}

/** Pad/độ một chuỗi hex (đã hex) thành 28-byte (56 hex char) — placeholder script hash.
 *  CHỈ dùng cho placeholder dev; production thay bằng hash thật. */
export function padHash28(seedHex: string): string {
  const h = seedHex.toLowerCase().replace(/[^0-9a-f]/g, "");
  return (h + "0".repeat(56)).slice(0, 56);
}

// ── Asset keys chuẩn hệ sinh thái (placeholder policy cho dev) ────────────────
// ADA = (policy "", name ""). LAMP/MAGIC policy THẬT điền sau khi deploy (Distribution
// ghi LAMP_POLICY_ID; MAGIC vault ghi MAGIC policy). Ở đây để placeholder rõ ràng.

/** ADA (lovelace) — policy & name rỗng. */
export const ADA = { policy: "", name: "" } as const;

/** Asset name LAMP/MAGIC (hex của ASCII). Policy điền runtime. */
export const LAMP_NAME = asciiToHex("LAMP");   // "4c414d50"
export const MAGIC_NAME = asciiToHex("MAGIC");  // "4d41474943"

/** Dựng AssetKey LAMP từ policy thật (deploy-time). */
export function lampAsset(policy: string): { policy: string; name: string } {
  return { policy: policy.toLowerCase(), name: LAMP_NAME };
}

/** Dựng AssetKey MAGIC từ policy thật (deploy-time). */
export function magicAsset(policy: string): { policy: string; name: string } {
  return { policy: policy.toLowerCase(), name: MAGIC_NAME };
}
