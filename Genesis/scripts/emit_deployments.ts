// emit_deployments — ghi `deployments/<mạng>.json` từ nguồn trong kho (không mạng, không ví, không .env).
//
//   tsx emit_deployments.ts           # sinh lại cả ba tệp
//   tsx emit_deployments.ts --check   # so từng byte với tệp đã commit; lệch ⇒ in tệp lệch, mã thoát 1
//
// Mọi logic nằm ở `Genesis/offchain/src/deploymentsManifest.ts` (`buildDeployments`); tệp này chỉ
// đọc/ghi đĩa. `--check` là thứ CI và bài kiểm dựa vào: nó đỏ khi ai sửa nguồn mà quên sinh lại,
// hoặc sửa tay tệp sinh ra.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPLOYMENTS_NETWORKS,
  DEPLOY_MANIFEST_ERRORS,
  buildDeployments,
  serializeDeployments,
} from "../offchain/src/deploymentsManifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEPLOYMENTS_DIR = resolve(REPO_ROOT, "deployments");

function main(argv: string[]): number {
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    console.error(`đối số lạ: ${unknown.join(" ")} (chỉ nhận --check)`);
    return 2;
  }
  const check = argv.includes("--check");
  const drift: string[] = [];
  for (const net of DEPLOYMENTS_NETWORKS) {
    const path = resolve(DEPLOYMENTS_DIR, `${net}.json`);
    const rel = relative(REPO_ROOT, path);
    const text = serializeDeployments(buildDeployments(net));
    if (check) {
      const committed = existsSync(path) ? readFileSync(path) : null;
      if (committed === null) drift.push(`${rel} (thiếu tệp)`);
      else if (!committed.equals(Buffer.from(text, "utf8"))) drift.push(rel);
      else console.log(`khớp  ${rel}`);
    } else {
      mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
      writeFileSync(path, text);
      console.log(`đã ghi ${rel} (${Buffer.byteLength(text)} byte)`);
    }
  }
  if (drift.length > 0) {
    console.error(
      `${DEPLOY_MANIFEST_ERRORS.CHECK_DRIFT}: tệp sinh lệch nguồn — chạy \`npm run deployments\` ở Genesis/scripts rồi commit:\n` +
        drift.map((d) => `  lệch  ${d}`).join("\n"),
    );
    return 1;
  }
  if (check) console.log(`deployments --check: ${DEPLOYMENTS_NETWORKS.length}/${DEPLOYMENTS_NETWORKS.length} tệp khớp nguồn`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
