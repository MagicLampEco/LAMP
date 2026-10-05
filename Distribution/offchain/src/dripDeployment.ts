// dripDeployment — chọn bytecode két drip theo BẢN GHI TRIỂN KHAI, và kiểm hash đã áp tham số.
//
// Vì sao có tệp này: `Distribution/drip-pot/onchain/plutus.json` là artefact `aiken build`, bị
// .gitignore chặn, và nó luôn là bản của mã ở HEAD. Két v0.2 đang chạy Preprod (CONTRACT v0.3 §10)
// được áp trên bytecode v0.2; dựng lại nó từ plutus.json của v0.3 ra một địa chỉ KHÁC, im lặng — và
// mọi lượt `claim`/`status` sau đó nhìn vào một két rỗng. Nên:
//   • v0.2: bytecode ĐÓNG BĂNG ở `Distribution/drip-pot/deployed/drip_pot-v0.2.blueprint.json`
//     (được git theo dõi), bản ghi ở `deployed/deployments.json`. Hash chưa áp của bytecode và hash
//     sau khi áp phải khớp bản ghi — lệch ⇒ NÉM.
//   • v0.3: bytecode từ `onchain/plutus.json` (aiken build ở HEAD). Có bản ghi thì kiểm như trên;
//     chưa có bản ghi (chưa triển khai) thì trả `deployment: null` — bên gọi in hash ra để ghi.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyParamsToScript, validatorToScriptHash, type Validator } from "@lucid-evolution/lucid";

import { dripParamList, dripParamListV02, type DripParams, type DripParamsV02 } from "./dripPot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DRIP_DEPLOYED_DIR = resolve(__dirname, "../../drip-pot/deployed");
export const DRIP_CURRENT_BLUEPRINT = resolve(__dirname, "../../drip-pot/onchain/plutus.json");
const SPEND_TITLE = "drip_pot.drip_pot.spend";

export type DripVersion = "v0.2" | "v0.3";
export const DRIP_PARAM_COUNT: Record<DripVersion, number> = { "v0.2": 8, "v0.3": 10 };

export interface DripDeployment {
  id: string;
  network: string;
  campaign: string;
  contractVersion: DripVersion;
  /** Tên tệp blueprint đóng băng trong `deployed/` (bắt buộc với v0.2). */
  blueprint?: string;
  unappliedHash: string;
  appliedHash: string;
  address: string;
  evidence: string[];
}

const HEX28 = /^[0-9a-f]{56}$/;

function fail(code: string, msg: string): never {
  throw new Error(`${code}: ${msg}`);
}

/** Đọc + ép hình dạng `deployments.json`. Hình dạng lạ ⇒ NÉM, không bỏ qua bản ghi. */
export function readDripDeployments(dir: string = DRIP_DEPLOYED_DIR): DripDeployment[] {
  const path = resolve(dir, "deployments.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail("DRIP-DEPLOY-001", `không đọc được bản ghi triển khai ${path} — ${(e as Error).message}.`);
  }
  const r = raw as { schema?: unknown; deployments?: unknown };
  if (r.schema !== "drip-pot-deployments/1" || !Array.isArray(r.deployments)) {
    fail("DRIP-DEPLOY-001", `${path}: schema phải là 'drip-pot-deployments/1' với mảng 'deployments'.`);
  }
  return r.deployments.map((d, i) => {
    const x = d as Partial<DripDeployment>;
    const ok = typeof x.id === "string" && typeof x.network === "string" && typeof x.campaign === "string"
      && (x.contractVersion === "v0.2" || x.contractVersion === "v0.3")
      && typeof x.unappliedHash === "string" && HEX28.test(x.unappliedHash)
      && typeof x.appliedHash === "string" && HEX28.test(x.appliedHash)
      && typeof x.address === "string" && Array.isArray(x.evidence)
      && (x.blueprint === undefined || typeof x.blueprint === "string");
    if (!ok) fail("DRIP-DEPLOY-001", `${path}: bản ghi #${i} sai hình dạng.`);
    return x as DripDeployment;
  });
}

/** compiledCode CHƯA áp tham số từ một tệp blueprint, ép đúng tiêu đề + số tham số + (tuỳ chọn) hash. */
export function readDripCode(path: string, version: DripVersion, expectUnappliedHash?: string): string {
  let bp: { validators?: unknown; compiledCode?: unknown; title?: unknown; parameters?: unknown };
  try {
    bp = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail("DRIP-DEPLOY-002", `không đọc được blueprint ${path} — ${(e as Error).message}` +
      (version === "v0.3" ? " (artefact 'aiken build' trong Distribution/drip-pot/onchain/)." : "."));
  }
  // Hai hình dạng: blueprint aiken đầy đủ (`validators[]`) hoặc tệp đóng băng (một validator phẳng).
  const entry = Array.isArray(bp.validators)
    ? (bp.validators as { title: string; compiledCode: string; parameters?: unknown[] }[]).find((v) => v.title === SPEND_TITLE)
    : bp.title === SPEND_TITLE ? bp as { compiledCode: string; parameters?: unknown[] } : undefined;
  if (!entry || typeof entry.compiledCode !== "string") fail("DRIP-DEPLOY-002", `${path} không có '${SPEND_TITLE}'.`);
  if (!Array.isArray(entry.parameters) || entry.parameters.length !== DRIP_PARAM_COUNT[version]) {
    fail("DRIP-DEPLOY-003",
      `${path} khai ${Array.isArray(entry.parameters) ? entry.parameters.length : "?"} tham số, ` +
      `két ${version} có ${DRIP_PARAM_COUNT[version]}. Blueprint không thuộc phiên bản này.`);
  }
  if (expectUnappliedHash !== undefined) {
    const h = validatorToScriptHash({ type: "PlutusV3", script: entry.compiledCode });
    if (h !== expectUnappliedHash) {
      fail("DRIP-DEPLOY-004", `hash chưa áp tham số của ${path} = ${h}, bản ghi triển khai ghi ${expectUnappliedHash}.`);
    }
  }
  return entry.compiledCode;
}

export interface ResolvedDrip {
  version: DripVersion;
  script: Validator;
  hash: string;
  /** Bản ghi đã khớp; `null` = phiên bản này chưa triển khai trên (network, campaign). */
  deployment: DripDeployment | null;
}

/**
 * Dựng két từ đủ tham số, chọn bytecode theo phiên bản + bản ghi triển khai.
 * v0.2 bắt buộc có bản ghi (bytecode v0.2 chỉ còn ở tệp đóng băng); hash áp tham số lệch bản
 * ghi ⇒ NÉM DRIP-DEPLOY-005 — tham số đang dùng không phải tham số đã triển khai.
 */
export function resolveDripScript(o: {
  version: DripVersion;
  network: string;
  campaign: string;
  params: DripParamsV02 | DripParams;
  deployedDir?: string;
  currentBlueprint?: string;
}): ResolvedDrip {
  const dir = o.deployedDir ?? DRIP_DEPLOYED_DIR;
  const matches = readDripDeployments(dir).filter((d) =>
    d.network === o.network && d.campaign === o.campaign && d.contractVersion === o.version);
  if (matches.length > 1) {
    fail("DRIP-DEPLOY-006", `${matches.length} bản ghi cho (${o.network}, ${o.campaign}, ${o.version}): ${matches.map((d) => d.id).join(", ")}.`);
  }
  const deployment = matches[0] ?? null;

  let code: string;
  let params: unknown[];
  if (o.version === "v0.2") {
    if (!deployment?.blueprint) {
      fail("DRIP-DEPLOY-007", `không có bản ghi v0.2 kèm blueprint đóng băng cho (${o.network}, ${o.campaign}) — ` +
        `bytecode v0.2 không còn ở plutus.json của HEAD.`);
    }
    code = readDripCode(resolve(dir, deployment.blueprint), "v0.2", deployment.unappliedHash);
    params = dripParamListV02(o.params);
  } else {
    if (!("returnScript" in o.params)) fail("DRIP-DEPLOY-008", "két v0.3 cần return_script + treasury_nft_policy.");
    code = readDripCode(
      deployment?.blueprint ? resolve(dir, deployment.blueprint) : (o.currentBlueprint ?? DRIP_CURRENT_BLUEPRINT),
      "v0.3", deployment?.unappliedHash);
    params = dripParamList(o.params as DripParams);
  }
  const script: Validator = { type: "PlutusV3", script: applyParamsToScript(code, params as never) };
  const hash = validatorToScriptHash(script);
  if (deployment && hash !== deployment.appliedHash) {
    fail("DRIP-DEPLOY-005",
      `két ${o.version} dựng từ tham số hiện tại có hash ${hash}, bản ghi '${deployment.id}' ghi ` +
      `${deployment.appliedHash}. Tham số (committee, lamp policy, gốc cửa sổ, N…) không phải tham số đã triển khai — DỪNG.`);
  }
  if (o.version === "v0.3" && (o.params as DripParams).returnScript === hash) {
    fail("DRIP-DEPLOY-008", `return_script == hash chính két (${hash}) — DP-PARAM từ chối.`);
  }
  return { version: o.version, script, hash, deployment };
}
