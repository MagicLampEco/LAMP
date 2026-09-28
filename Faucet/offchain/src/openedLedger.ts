// openedLedger — sổ `PoolDatum.opened_root` phía off-chain (Faucet v3.1, INV-ONE-ACCT).
//
// On-chain chỉ giữ 32 byte GỐC của một Merkle Patricia Forestry; tập khoá nằm off-chain và
// người dựng tx phải nộp bằng chứng cho mỗi lượt chèn (`ClaimOpen`) / xoá (`Reclaim`). Module
// này dựng lại tập khoá, kiểm gốc dựng lại khớp datum, và sinh bằng chứng bằng CHÍNH thư viện
// JS của aiken-lang (`@aiken-lang/merkle-patricia-forestry`) — không tự viết MPF.
//
// NGUỒN TẬP KHOÁ: khoá sổ = `blake2b_224(did_name)` (28 byte) = đúng phần đuôi asset name ACCT
// NFT ("ACCT" ‖ khoá, xem `ledger.did_key` / `acctName`). Nên tập khoá dựng lại được từ DANH
// SÁCH ACCT NFT đang sống dưới policy `faucet_nft`, không cần lưu trạng thái riêng. Người gọi
// truyền `did_name` hoặc asset name ACCT của từng account đang có ở địa chỉ account.
//
// KHÔNG TỰ TIẾP TỤC KHI LỆCH: gốc dựng lại ≠ `opened_root` trên datum ⇒ ném `FAUCET-LEDGER-001`.
// Lệch nghĩa là danh sách account đầu vào thiếu/thừa (chỉ mục chưa đồng bộ, lọc nhầm địa chỉ,
// đọc ở một khối cũ) — dựng tx trên đó thì bằng chứng chắc chắn trượt on-chain và mất phí,
// hoặc tệ hơn là người gọi "sửa" bằng cách đoán tập khoá.
//
// Môi trường chạy: thư viện MPF dùng `Buffer` và `node:assert` ⇒ module này chạy trên Node.

import { Trie, type Proof } from "@aiken-lang/merkle-patricia-forestry";

import { ACCT_NFT_NAME, acctName } from "./constants.js";
import type { MpfProof, MpfProofStep } from "./types.js";

/** Độ dài khoá sổ = digest blake2b-224. */
export const LEDGER_KEY_BYTES = 28;

/** Giá trị lá của sổ = bytes RỖNG (sổ là một TẬP HỢP khoá). Khớp `ledger.did_leaf_value`. */
export const LEDGER_LEAF_VALUE_HEX = "";

/**
 * Gốc của sổ RỖNG, hex 32 byte.
 *
 * Thư viện JS KHÔNG xuất hằng này: trie rỗng của nó có `hash === null` (và `Proof.verify`
 * trả `null` cho gốc rỗng), còn bên trong nó thay `null` bằng `NULL_HASH = Buffer.alloc(32)`
 * khi băm nút. On-chain `empty_opened_root() = mpf.root(mpf.empty)` = `null_hash` của thư
 * viện Aiken. Hằng dưới đây là cầu nối `null` → bytes, và nó được KIỂM BẰNG THỰC THI ở hai
 * phía: ca vitest `openedLedger.test.ts` ghim `new Trie().hash === null`, và bài Aiken
 * `ledger_parity_empty_root` (`onchain/validators/ledger_parity.ak`) `expect
 * empty_opened_root() == #"00…00"` — thư viện nào đổi cách biểu diễn gốc rỗng thì một trong
 * hai bài đỏ.
 */
export const OPENED_ROOT_EMPTY = "00".repeat(32);

/** Một account đang sống, nhận diện bằng `did_name` (hex) HOẶC asset name ACCT NFT (hex). */
export type LiveAccountRef = { didName: string } | { acctAssetName: string };

/** Khoá sổ của một DID = `blake2b_224(did_name)` hex (28 byte). Khớp `ledger.did_key`. */
export function didKey(didName: string): string {
  return acctName(didName).slice(ACCT_NFT_NAME.length);
}

/** Khoá sổ lấy từ asset name ACCT NFT ("ACCT" ‖ khoá, đúng 32 byte). Hình dạng khác ⇒ ném. */
export function didKeyFromAcctAssetName(assetName: string): string {
  const hex = typeof assetName === "string" ? assetName.toLowerCase() : "";
  if (!/^[0-9a-f]*$/.test(hex) || hex.length !== 2 * (ACCT_NFT_NAME.length / 2 + LEDGER_KEY_BYTES)) {
    throw new Error(
      `FAUCET-LEDGER-010: asset name ACCT phải là hex đúng ${ACCT_NFT_NAME.length / 2 + LEDGER_KEY_BYTES} byte, nhận '${String(assetName)}'`,
    );
  }
  if (!hex.startsWith(ACCT_NFT_NAME)) {
    throw new Error(`FAUCET-LEDGER-011: asset name '${hex}' không mang tiền tố ACCT (${ACCT_NFT_NAME})`);
  }
  return hex.slice(ACCT_NFT_NAME.length);
}

function keyOfRef(ref: LiveAccountRef): string {
  if (ref !== null && typeof ref === "object" && "didName" in ref && !("acctAssetName" in ref)) {
    return didKey(ref.didName);
  }
  if (ref !== null && typeof ref === "object" && "acctAssetName" in ref && !("didName" in ref)) {
    return didKeyFromAcctAssetName(ref.acctAssetName);
  }
  throw new Error(`FAUCET-LEDGER-012: LiveAccountRef phải có ĐÚNG MỘT trong didName | acctAssetName, nhận ${JSON.stringify(ref)}`);
}

function assertKeyHex(key: string): string {
  if (typeof key !== "string" || !/^[0-9a-f]*$/.test(key) || key.length !== 2 * LEDGER_KEY_BYTES) {
    throw new Error(`FAUCET-LEDGER-013: khoá sổ phải là hex thường đúng ${LEDGER_KEY_BYTES} byte, nhận '${String(key)}'`);
  }
  return key;
}

function rootHexOf(hash: Buffer | null | undefined): string {
  return hash == null ? OPENED_ROOT_EMPTY : hash.toString("hex");
}

/** Bằng chứng của thư viện JS (`Proof.toJSON()`) → `MpfProof` có kiểu. Hình dạng lạ ⇒ ném. */
function proofFromLibrary(steps: unknown): MpfProof {
  if (!Array.isArray(steps)) throw new Error("FAUCET-LEDGER-020: Proof.toJSON() không trả mảng");
  const hex = (v: unknown, n: number | null, ctx: string): string => {
    if (typeof v !== "string" || !/^([0-9a-f]{2})*$/.test(v) || (n !== null && v.length !== 2 * n)) {
      throw new Error(`FAUCET-LEDGER-021: ${ctx} từ thư viện MPF không đúng hình dạng (${String(v)})`);
    }
    return v;
  };
  const nat = (v: unknown, ctx: string): bigint => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(`FAUCET-LEDGER-022: ${ctx} từ thư viện MPF không phải số tự nhiên (${String(v)})`);
    }
    return BigInt(v);
  };
  return steps.map((s: any, i: number): MpfProofStep => {
    switch (s?.type) {
      case "branch":
        return { kind: "Branch", skip: nat(s.skip, `step[${i}].skip`), neighbors: hex(s.neighbors, 128, `step[${i}].neighbors`) };
      case "fork":
        return {
          kind: "Fork", skip: nat(s.skip, `step[${i}].skip`),
          neighbor: {
            nibble: nat(s.neighbor?.nibble, `step[${i}].neighbor.nibble`),
            prefix: hex(s.neighbor?.prefix, null, `step[${i}].neighbor.prefix`),
            root: hex(s.neighbor?.root, 32, `step[${i}].neighbor.root`),
          },
        };
      case "leaf":
        return {
          kind: "Leaf", skip: nat(s.skip, `step[${i}].skip`),
          key: hex(s.neighbor?.key, 32, `step[${i}].neighbor.key`),
          value: hex(s.neighbor?.value, 32, `step[${i}].neighbor.value`),
        };
      default:
        throw new Error(`FAUCET-LEDGER-023: bước bằng chứng loại lạ '${String(s?.type)}' ở step[${i}]`);
    }
  });
}

/** Kết quả một lượt chèn/xoá dự kiến: bằng chứng nộp on-chain + hai gốc + sổ SAU lượt đó. */
export interface LedgerTransition {
  /** Khoá sổ (hex 28 byte) vừa chèn/xoá. */
  key: string;
  /** Bằng chứng đưa vào redeemer `ClaimOpen`/`Reclaim`. */
  proof: MpfProof;
  /** Gốc TRƯỚC — phải bằng `opened_root` trên datum pool input. */
  rootBefore: string;
  /** Gốc SAU — đặt vào `opened_root` của datum pool output. */
  rootAfter: string;
  /** Sổ sau lượt này (bất biến: sổ gốc KHÔNG bị sửa). */
  next: OpenedLedger;
}

/**
 * Sổ `opened_root` BẤT BIẾN: mọi phép chèn/xoá trả về sổ MỚI, sổ gọi không đổi. Dựng bằng
 * `fromKeys` / `fromLiveAccounts`; dùng `rebuild` khi có sẵn gốc để đối chiếu.
 */
export class OpenedLedger {
  private constructor(
    private readonly trie: Trie,
    private readonly keySet: ReadonlySet<string>,
  ) {}

  /** Dựng sổ từ tập khoá hex (28 byte). Khoá TRÙNG ⇒ ném: hai ACCT NFT cùng một DID đang sống
   *  là INV-ONE-ACCT đã vỡ, không có gốc nào "đúng" để dựng. */
  static async fromKeys(keys: Iterable<string>): Promise<OpenedLedger> {
    const set = new Set<string>();
    for (const k of keys) {
      const key = assertKeyHex(k);
      if (set.has(key)) {
        throw new Error(`FAUCET-LEDGER-002: khoá ${key} xuất hiện hai lần — hai account cùng một DID đang sống (INV-ONE-ACCT vỡ)`);
      }
      set.add(key);
    }
    const trie = new Trie();
    // Thứ tự chèn không ảnh hưởng gốc (MPF là cấu trúc chính tắc theo tập khoá); sắp xếp chỉ
    // để hai lần dựng cùng một tập đi đúng một đường, dễ đối chiếu khi gỡ lỗi.
    for (const key of [...set].sort()) {
      await trie.insert(Buffer.from(key, "hex"), Buffer.alloc(0));
    }
    return new OpenedLedger(trie, set);
  }

  /** Dựng sổ từ danh sách account đang sống (did_name hoặc asset name ACCT). */
  static async fromLiveAccounts(accounts: readonly LiveAccountRef[]): Promise<OpenedLedger> {
    if (!Array.isArray(accounts)) throw new Error("FAUCET-LEDGER-014: danh sách account đang sống phải là mảng");
    return OpenedLedger.fromKeys(accounts.map(keyOfRef));
  }

  /** Dựng sổ rồi ĐỐI CHIẾU với `opened_root` trên datum — lệch ⇒ ném `FAUCET-LEDGER-001`. */
  static async rebuild(accounts: readonly LiveAccountRef[], expectedRoot: string): Promise<OpenedLedger> {
    const ledger = await OpenedLedger.fromLiveAccounts(accounts);
    ledger.assertRoot(expectedRoot);
    return ledger;
  }

  /** Sổ rỗng — trạng thái bắt buộc lúc `MintPool` (C-MP-8). */
  static async empty(): Promise<OpenedLedger> {
    return OpenedLedger.fromKeys([]);
  }

  /** Gốc hiện tại (hex 32 byte). */
  get root(): string {
    return rootHexOf(this.trie.hash);
  }

  get size(): number {
    return this.keySet.size;
  }

  /** Khoá hiện có, đã sắp xếp. */
  keys(): string[] {
    return [...this.keySet].sort();
  }

  hasKey(key: string): boolean {
    return this.keySet.has(assertKeyHex(key));
  }

  hasDid(didName: string): boolean {
    return this.keySet.has(didKey(didName));
  }

  /** Ném `FAUCET-LEDGER-001` nếu gốc dựng lại ≠ gốc mong đợi (thường là `opened_root` datum). */
  assertRoot(expectedRoot: string): void {
    const want = typeof expectedRoot === "string" ? expectedRoot.toLowerCase() : String(expectedRoot);
    if (this.root !== want) {
      throw new Error(
        `FAUCET-LEDGER-001: gốc sổ dựng lại ${this.root} (${this.size} khoá) ≠ opened_root trên datum ${want}. ` +
        `Danh sách account đang sống thiếu hoặc thừa — KHÔNG dựng tx trên sổ lệch; đồng bộ lại danh sách ACCT NFT.`,
      );
    }
  }

  /** Lượt CHÈN khoá của `didName` (ClaimOpen). DID đã có trong sổ ⇒ ném `FAUCET-LEDGER-003`. */
  async planInsert(didName: string): Promise<LedgerTransition> {
    return this.planInsertKey(didKey(didName));
  }

  async planInsertKey(rawKey: string): Promise<LedgerTransition> {
    const key = assertKeyHex(rawKey);
    if (this.keySet.has(key)) {
      throw new Error(`FAUCET-LEDGER-003: khoá ${key} đã có trong sổ — DID này đang có account, không mở thêm được`);
    }
    const next = await OpenedLedger.fromKeys([...this.keySet, key]);
    // Bằng chứng chèn = bằng chứng THÀNH VIÊN của khoá trong sổ SAU khi chèn: on-chain
    // `mpf.insert` tính gốc-không-có-khoá từ nó (phải = gốc trước) và gốc-có-khoá (= gốc sau).
    const libProof = await next.trie.prove(Buffer.from(key, "hex"));
    this.selfCheck(libProof, key, this.root, next.root);
    return { key, proof: proofFromLibrary(libProof.toJSON()), rootBefore: this.root, rootAfter: next.root, next };
  }

  /** Lượt XOÁ khoá của `didName` (Reclaim). DID chưa có trong sổ ⇒ ném `FAUCET-LEDGER-004`. */
  async planDelete(didName: string): Promise<LedgerTransition> {
    return this.planDeleteKey(didKey(didName));
  }

  async planDeleteKey(rawKey: string): Promise<LedgerTransition> {
    const key = assertKeyHex(rawKey);
    if (!this.keySet.has(key)) {
      throw new Error(`FAUCET-LEDGER-004: khoá ${key} KHÔNG có trong sổ — không có account nào của DID này để thu hồi`);
    }
    const libProof = await this.trie.prove(Buffer.from(key, "hex"));
    const next = await OpenedLedger.fromKeys([...this.keySet].filter((k) => k !== key));
    this.selfCheck(libProof, key, next.root, this.root);
    return { key, proof: proofFromLibrary(libProof.toJSON()), rootBefore: this.root, rootAfter: next.root, next };
  }

  /** Tự kiểm bằng CÙNG phép on-chain làm: loại khoá khỏi bằng chứng ra `without`, gộp khoá vào
   *  ra `withKey`. Lệch nghĩa là thư viện và sổ không nói cùng một chuyện ⇒ ném, không nộp. */
  private selfCheck(libProof: Proof, key: string, without: string, withKey: string): void {
    // Tham số thứ hai của `verify` khai trong `.d.ts` 1.3.1 nhưng thân hàm không dùng.
    const ex = rootHexOf(libProof.verify(false, undefined));
    const inc = rootHexOf(libProof.verify(true, undefined));
    if (ex !== without || inc !== withKey) {
      throw new Error(
        `FAUCET-LEDGER-005: bằng chứng cho khoá ${key} tự kiểm lệch — excluding ${ex} (mong ${without}), ` +
        `including ${inc} (mong ${withKey})`,
      );
    }
  }
}

/** Nguồn sổ cho builder: sổ đã dựng, hoặc danh sách account đang sống để builder tự dựng. */
export type OpenedLedgerSource = OpenedLedger | readonly LiveAccountRef[];

/** Dựng (nếu cần) và ĐỐI CHIẾU sổ với `opened_root` trên datum — lệch ⇒ `FAUCET-LEDGER-001`. */
export async function resolveOpenedLedger(source: OpenedLedgerSource, expectedRoot: string): Promise<OpenedLedger> {
  if (source instanceof OpenedLedger) {
    source.assertRoot(expectedRoot);
    return source;
  }
  if (Array.isArray(source)) return OpenedLedger.rebuild(source, expectedRoot);
  throw new Error("FAUCET-LEDGER-015: openedLedger phải là OpenedLedger hoặc mảng LiveAccountRef");
}
