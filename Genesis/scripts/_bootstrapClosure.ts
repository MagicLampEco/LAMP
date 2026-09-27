// _bootstrapClosure.ts — phần THUẦN của công cụ đóng policy LAMP bản mồi (`bootstrap_closure.ts`).
//
// Tách khỏi runner vì `config.ts` ném ngay lúc import khi chưa có khoá (`SECRETS-001`) — một
// cổng không bài kiểm nào import được là một cổng sẽ trôi. Mọi thứ ở đây kiểm được ở mọi máy:
// cổng mạng, hằng số trần đọc từ mã đóng băng, mã hoá datum, phép tính lượng đúc nốt, và phép
// tái dựng policy-id mainnet từ blueprint đóng băng.
//
// Việc của công cụ (chủ dự án đã chọn): đóng vĩnh viễn policy `55d3e01b…` bằng hai giao dịch
//   tx1 `close-mint` — đúc nốt `dist_cap - dist_minted` vào kho `dist_dest` ⇒ dist_minted == dist_cap
//   tx2 `close-lock` — chuyển TOÀN BỘ LAMP trong kho sang `lock_vault` (spend luôn False)
// Sau hai bước: DistributionVest hết quota (A1 `s2.dist_minted <= s2.dist_cap`), ReserveDraw chết
// sẵn (meter_nft_policy = 28 byte 0), và mọi LAMP nằm ở một script không tiêu được.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Constr, Data, applyParamsToScript, mintingPolicyToId } from "@lucid-evolution/lucid";
import type { DeployedLamp } from "../offchain/src/deployed.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Dự án aiken đóng băng — bản sao nguyên văn mã đang chạy mainnet (xem README cạnh nó). */
export const FROZEN_ONCHAIN_DIR = resolve(HERE, "../bootstrap-closure/onchain");
export const FROZEN_BLUEPRINT_PATH = resolve(FROZEN_ONCHAIN_DIR, "plutus.json");
export const FROZEN_CONSTANTS_PATH = resolve(FROZEN_ONCHAIN_DIR, "lib/magiclamp/genesis/constants.ak");

/** Nhãn token của bản mồi mainnet: "LAMP". Diễn tập Preprod dùng CÙNG nhãn để cùng hình dạng. */
export const CLOSURE_TOKEN_NAME = "4c414d50";
/** Tên thread NFT — `constants.supply_name` trong mã đóng băng ("SUPPLY"). */
export const SUPPLY_NFT_NAME = "535550504c59";
/** meter_nft_policy của bản mồi: 28 byte 0, không có tiền ảnh ⇒ ReserveDraw chết. */
export const DEAD_METER_POLICY = "00".repeat(28);
/** meter_nft_name của bản mồi: "MET". */
export const METER_NAME = "4d4554";
/** Lượng đúc lúc mồi trên mainnet (1.000.000 LAMP = 1e12 oildrop), tái tạo trên testnet. */
export const BOOTSTRAP_MINT_OIL = 1_000_000_000_000n;

/** Cờ bắt buộc để công cụ chịu chạy trên Mainnet. Không có ⇒ ném lỗi trước mọi lời gọi mạng. */
export const MAINNET_FLAG = "--confirm-mainnet-closure";

export type ClosureNetwork = "Preprod" | "Preview" | "Mainnet";
export type ClosureCommand = "bootstrap" | "close-mint" | "close-lock" | "verify-closed";
export const COMMANDS: readonly ClosureCommand[] = ["bootstrap", "close-mint", "close-lock", "verify-closed"];

// ── Cổng mạng ────────────────────────────────────────────────────────────────

export interface CliArgs {
  command: ClosureCommand;
  network: ClosureNetwork;
  mainnetConfirmed: boolean;
}

/**
 * Đọc dòng lệnh. `--network` BẮT BUỘC — không có mạng mặc định, vì mặc định là cách một lệnh
 * gõ thiếu chạy nhầm mạng.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const rest = [...argv];
  const command = rest.shift();
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`CLOSE-ARG-001: lệnh phải là một trong ${COMMANDS.join(" | ")}, nhận "${command ?? ""}".`);
  }
  let network: string | undefined;
  let mainnetConfirmed = false;
  while (rest.length) {
    const a = rest.shift()!;
    if (a === "--network") network = rest.shift();
    else if (a === MAINNET_FLAG) mainnetConfirmed = true;
    else throw new Error(`CLOSE-ARG-002: đối số lạ "${a}".`);
  }
  if (network !== "Preprod" && network !== "Preview" && network !== "Mainnet") {
    throw new Error(`CLOSE-ARG-003: --network phải là Preprod | Preview | Mainnet, nhận "${network ?? ""}".`);
  }
  return { command: command as ClosureCommand, network, mainnetConfirmed };
}

/**
 * Cổng Mainnet. Chạy TRƯỚC khi nạp ví hay gọi nhà cung cấp.
 *  · `bootstrap` trên Mainnet: cấm tuyệt đối — mainnet đã có trạng thái thật, dựng lại là tạo
 *    một policy thứ hai.
 *  · mọi lệnh khác trên Mainnet: đòi `MAINNET_FLAG`. Có cờ mà thiếu SUBMIT=true thì chỉ dựng
 *    giao dịch, không gửi (cổng SUBMIT chung của thư mục này).
 */
export function assertNetworkAllowed(args: CliArgs): void {
  if (args.network !== "Mainnet") return;
  if (args.command === "bootstrap") {
    throw new Error(
      "CLOSE-NET-001: `bootstrap` KHÔNG chạy trên Mainnet. Nó dựng một policy mới từ đầu; mainnet " +
        "đã có trạng thái thật ở policy 55d3e01b…, và một policy thứ hai là một token khác.",
    );
  }
  if (!args.mainnetConfirmed) {
    throw new Error(
      `CLOSE-NET-002: từ chối Mainnet. Lệnh này đóng VĨNH VIỄN policy LAMP bản mồi — không quay ` +
        `lui được. Muốn chạy thật phải thêm ${MAINNET_FLAG} VÀ đặt SUBMIT=true; thiếu SUBMIT thì ` +
        `chỉ dựng giao dịch, không gửi.`,
    );
  }
}

// ── Hằng số trần: SINH từ mã đóng băng, không gõ tay ──────────────────────────

export interface Caps { distCap: bigint; reserveCap: bigint; totalCap: bigint }

/** Đọc `dist_cap_oil` / `reserve_cap_oil` / `total_cap_oil` từ `constants.ak`. Thiếu ⇒ ném. */
export function parseCaps(constantsAk: string): Caps {
  const read = (name: string): bigint => {
    const m = constantsAk.match(new RegExp(`pub const ${name}\\s*:\\s*Int\\s*=\\s*([0-9_]+)`));
    if (!m) throw new Error(`CLOSE-CAP-001: không thấy hằng ${name} trong constants.ak đóng băng.`);
    return BigInt(m[1].replace(/_/g, ""));
  };
  const caps = { distCap: read("dist_cap_oil"), reserveCap: read("reserve_cap_oil"), totalCap: read("total_cap_oil") };
  if (caps.distCap + caps.reserveCap !== caps.totalCap) {
    throw new Error(`CLOSE-CAP-002: dist_cap + reserve_cap ≠ total_cap trong mã đóng băng.`);
  }
  return caps;
}

export function frozenCaps(): Caps {
  return parseCaps(readFileSync(FROZEN_CONSTANTS_PATH, "utf8"));
}

// ── SupplyState 4 trường ─────────────────────────────────────────────────────

export interface SupplyState { distMinted: bigint; reserveMinted: bigint; distCap: bigint; reserveCap: bigint }

export function supplyStateToCbor(s: SupplyState): string {
  return Data.to(new Constr(0, [s.distMinted, s.reserveMinted, s.distCap, s.reserveCap]));
}

/** Giải datum SupplyState. Hình dạng lạ ⇒ ném, không đoán. */
export function supplyStateFromCbor(cbor: string): SupplyState {
  const d = Data.from(cbor);
  if (!(d instanceof Constr) || d.index !== 0 || d.fields.length !== 4 ||
      !d.fields.every((f) => typeof f === "bigint")) {
    throw new Error(`CLOSE-DATUM-001: datum SupplyState sai hình dạng: ${cbor}`);
  }
  const [distMinted, reserveMinted, distCap, reserveCap] = d.fields as bigint[];
  return { distMinted, reserveMinted, distCap, reserveCap };
}

/**
 * Lượng phải đúc ở tx1. Các điều kiện ở đây là chính các `expect` của `lamp_mint` @457f312 mà
 * đầu vào phải thoả — kiểm trước để hỏng ở máy mình, không hỏng ở nút mạng.
 */
export function closureDelta(s: SupplyState, caps: Caps): bigint {
  if (s.distCap !== caps.distCap || s.reserveCap !== caps.reserveCap) {
    throw new Error(`CLOSE-STATE-001: trần trong datum khác hằng mã (datum ${s.distCap}/${s.reserveCap}).`);
  }
  if (s.distMinted < 0n || s.reserveMinted < 0n) throw new Error(`CLOSE-STATE-002: bộ đếm âm trong datum.`);
  if (s.distMinted > s.distCap) throw new Error(`CLOSE-STATE-003: dist_minted vượt trần — trạng thái không hợp lệ.`);
  const delta = s.distCap - s.distMinted;
  if (delta === 0n) throw new Error(`CLOSE-STATE-004: dist_minted đã bằng dist_cap — tx1 đã chạy rồi.`);
  return delta;
}

// ── Tham số apply-param ──────────────────────────────────────────────────────

export interface MintParams {
  threadNftPolicy: string;
  threadNftName: string;
  tokenName: string;
  distAuthority: string[];
  authThreshold: bigint;
  distDest: string;
  meterNftPolicy: string;
  meterNftName: string;
}

/** Thứ tự apply-param của `lamp_mint` @457f312. */
export function mintParamsData(p: MintParams): Data[] {
  return [p.threadNftPolicy, p.threadNftName, p.tokenName, p.distAuthority, p.authThreshold,
    p.distDest, p.meterNftPolicy, p.meterNftName];
}

/**
 * 8 tham số mainnet đọc từ `deployed.ts` (nguồn DUY NHẤT, đọc ngược từ bytecode trên chain).
 * Thứ tự và tên phải khớp đúng — lệch ⇒ ném.
 */
export function mainnetMintParams(dep: DeployedLamp): MintParams {
  const want = ["thread_nft_policy", "thread_nft_name", "token_name", "dist_authority",
    "auth_threshold", "dist_dest", "meter_nft_policy", "meter_nft_name"];
  const got = dep.mintParams.map((p) => p.name);
  if (got.join(",") !== want.join(",")) {
    throw new Error(`CLOSE-PARAM-001: deployed.ts mintParams sai thứ tự/tên: ${got.join(",")}`);
  }
  const v = dep.mintParams.map((p) => Data.from(p.cborHex));
  const bytes = (i: number): string => {
    if (typeof v[i] !== "string") throw new Error(`CLOSE-PARAM-002: ${want[i]} không phải bytes.`);
    return v[i] as string;
  };
  const auth = v[3];
  if (!Array.isArray(auth) || !auth.every((x) => typeof x === "string")) {
    throw new Error(`CLOSE-PARAM-002: dist_authority không phải danh sách bytes.`);
  }
  if (typeof v[4] !== "bigint") throw new Error(`CLOSE-PARAM-002: auth_threshold không phải số.`);
  return {
    threadNftPolicy: bytes(0), threadNftName: bytes(1), tokenName: bytes(2),
    distAuthority: auth as string[], authThreshold: v[4] as bigint, distDest: bytes(5),
    meterNftPolicy: bytes(6), meterNftName: bytes(7),
  };
}

// ── Blueprint đóng băng ──────────────────────────────────────────────────────

interface BlueprintValidator { title: string; compiledCode: string; hash: string; parameters?: unknown[] }

export function readFrozenBlueprint(path = FROZEN_BLUEPRINT_PATH): BlueprintValidator[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `CLOSE-BP-001: chưa có ${path}. Chạy \`aiken build\` trong Genesis/bootstrap-closure/onchain ` +
        `(aiken v1.1.21, cần TTY) trước.`,
    );
  }
  return JSON.parse(raw).validators as BlueprintValidator[];
}

/** compiledCode CHƯA áp tham số + số tham số blueprint khai. Tên không có ⇒ ném. */
export function frozenCode(bp: BlueprintValidator[], title: string, expectParams: number): string {
  const v = bp.find((x) => x.title === title);
  if (!v) throw new Error(`CLOSE-BP-002: blueprint đóng băng không có ${title}.`);
  const n = (v.parameters ?? []).length;
  if (n !== expectParams) {
    throw new Error(`CLOSE-BP-003: ${title} khai ${n} tham số, công cụ truyền ${expectParams}.`);
  }
  return v.compiledCode;
}

export function applyFrozen(bp: BlueprintValidator[], title: string, params: Data[]): string {
  return applyParamsToScript(frozenCode(bp, title, params.length), params as never);
}

/**
 * Phép kiểm TÁI DỰNG: áp 8 tham số mainnet (từ deployed.ts) vào blueprint đóng băng phải ra đúng
 * policy-id đang chạy mainnet. Chạy ở MỌI lệnh, MỌI mạng: nó chứng minh mã mà lượt diễn tập đang
 * dùng chính là mã đang chạy mainnet. Lệch ⇒ ném, không chạy tiếp.
 */
export function assertFrozenReproducesMainnet(bp: BlueprintValidator[], dep: DeployedLamp): string {
  const script = applyFrozen(bp, "lamp_mint.lamp_mint.mint", mintParamsData(mainnetMintParams(dep)));
  const pid = mintingPolicyToId({ type: "PlutusV3", script });
  if (pid !== dep.policyId) {
    throw new Error(
      `CLOSE-REBUILD-001: blueprint đóng băng + 8 tham số deployed.ts ra ${pid}, không phải ${dep.policyId}. ` +
        `Mã đang dùng KHÔNG phải mã đang chạy mainnet — dừng.`,
    );
  }
  return pid;
}
