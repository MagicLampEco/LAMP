// votedLedger — sổ `TallyDatum.voted_root` phía off-chain (Governance v2, `SPEC.md` §v2.8 `R-BOOK-MPF`).
//
// On-chain chỉ giữ GỐC 32 byte của một Merkle Patricia Forestry: khoá = `did_commit`, giá trị =
// `nullifier` của phiếu ĐƯỢC CỘNG. Hai chỗ đọc bằng chứng:
//   · `tally.ak ▸ book_root_after` — `SumBatch.insert_proofs`: MỘT bằng chứng CHÈN cho mỗi phiếu,
//     đúng thứ tự `collect_votes` (= thứ tự INPUT của giao dịch), mỗi cái ứng trạng thái sổ ngay
//     TRƯỚC lần chèn đó; `mpf.insert` tự `fail` khi khoá đã có.
//   · `vote.ak ▸ ConsumeForTally.book_proof` — bằng chứng THÀNH VIÊN `(did_commit → nullifier)`
//     trong sổ của Tally OUTPUT (tức SAU khi chèn trọn lô).
//
// NGUỒN TẬP KHOÁ: mỗi lượt SumBatch đã lên chuỗi tiêu một tập UTxO phiếu; `(did_commit,
// nullifier)` của các phiếu đó LÀ các lá của sổ. Người gọi (indexer) đưa danh sách đó vào;
// module này dựng lại cây và ĐỐI CHIẾU gốc với datum — lệch ⇒ `GOV-LEDGER-001`, không dựng tiếp.
//
// Bằng chứng do chính thư viện JS `@aiken-lang/merkle-patricia-forestry` 1.3.1 sinh (không tự viết
// MPF), và mỗi bằng chứng được TỰ KIỂM bằng đúng phép on-chain làm trước khi trả ra.
// Môi trường chạy: thư viện dùng `Buffer` ⇒ chỉ Node.

import { Trie, type Proof } from "@aiken-lang/merkle-patricia-forestry";

import { HASH32_BYTES } from "./datum.js";
import type { MpfProof, MpfProofStep } from "./types.js";

/** Gốc sổ RỖNG — `mpf.root(mpf.empty)` = null_hash 32 byte 0x00 (neo: `mpf_fixtures.ak ▸ root_a0`). */
export const VOTED_ROOT_EMPTY = "00".repeat(32);

/** Một lá của sổ. */
export interface VotedEntry {
  /** hex, ≥ 1 byte (on-chain không ép độ dài khoá; datum phiếu của SDK ép 32 byte). */
  didCommit: string;
  /** hex, đúng 32 byte. */
  nullifier: string;
}

function assertKey(key: unknown, ctx: string): string {
  if (typeof key !== "string" || !/^([0-9a-f]{2})+$/.test(key)) {
    throw new Error(`GOV-LEDGER-010: ${ctx} phải là hex thường khác rỗng độ dài chẵn, nhận '${String(key)}'`);
  }
  return key;
}

function assertValue(v: unknown, ctx: string): string {
  if (typeof v !== "string" || !/^[0-9a-f]*$/.test(v) || v.length !== 2 * HASH32_BYTES) {
    throw new Error(`GOV-LEDGER-011: ${ctx} phải là hex thường đúng ${HASH32_BYTES} byte, nhận '${String(v)}'`);
  }
  return v;
}

function rootHexOf(hash: Buffer | null | undefined): string {
  return hash == null ? VOTED_ROOT_EMPTY : hash.toString("hex");
}

/** `Proof.toJSON()` của thư viện → `MpfProof` có kiểu. Hình dạng lạ ⇒ ném. */
export function proofFromLibrary(steps: unknown): MpfProof {
  if (!Array.isArray(steps)) throw new Error("GOV-LEDGER-020: Proof.toJSON() không trả mảng");
  const hex = (v: unknown, n: number | null, ctx: string): string => {
    if (typeof v !== "string" || !/^([0-9a-f]{2})*$/.test(v) || (n !== null && v.length !== 2 * n)) {
      throw new Error(`GOV-LEDGER-021: ${ctx} từ thư viện MPF sai hình dạng (${String(v)})`);
    }
    return v;
  };
  const nat = (v: unknown, ctx: string): bigint => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(`GOV-LEDGER-022: ${ctx} từ thư viện MPF không phải số tự nhiên (${String(v)})`);
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
        throw new Error(`GOV-LEDGER-023: bước bằng chứng loại lạ '${String(s?.type)}' ở step[${i}]`);
    }
  });
}

/** Kết quả dự kiến của MỘT lượt SumBatch. */
export interface BatchInsertPlan {
  /** Các lá, ĐÚNG thứ tự chèn (= thứ tự input). */
  entries: VotedEntry[];
  /** `SumBatch.insert_proofs` — phần tử i ứng sổ ngay TRƯỚC lần chèn thứ i. */
  insertProofs: MpfProof[];
  /** `ConsumeForTally.book_proof` của phiếu thứ i — thành viên trong sổ SAU cả lô. */
  membershipProofs: MpfProof[];
  rootBefore: string;
  rootAfter: string;
  /** Sổ sau lô (sổ gốc không bị sửa). */
  next: VotedLedger;
}

/** Sổ BẤT BIẾN: mọi phép chèn trả sổ MỚI. */
export class VotedLedger {
  private constructor(private readonly trie: Trie, private readonly map: ReadonlyMap<string, string>) {}

  /** Dựng sổ từ tập lá. Cùng một `didCommit` hai lần ⇒ ném (on-chain `mpf.insert` cũng bác). */
  static async fromEntries(entries: readonly VotedEntry[]): Promise<VotedLedger> {
    if (!Array.isArray(entries)) throw new Error("GOV-LEDGER-014: entries phải là mảng VotedEntry");
    const map = new Map<string, string>();
    entries.forEach((e, i) => {
      const k = assertKey(e?.didCommit, `entries[${i}].didCommit`);
      const v = assertValue(e?.nullifier, `entries[${i}].nullifier`);
      if (map.has(k)) {
        throw new Error(`GOV-LEDGER-002: did_commit ${k} xuất hiện hai lần — một DID chỉ được đếm một lần (R-BOOK-MPF)`);
      }
      map.set(k, v);
    });
    const trie = new Trie();
    // Thứ tự chèn không đổi gốc (MPF chính tắc theo tập lá); sắp xếp để hai lần dựng đi một đường.
    for (const k of [...map.keys()].sort()) {
      await trie.insert(Buffer.from(k, "hex"), Buffer.from(map.get(k)!, "hex"));
    }
    return new VotedLedger(trie, map);
  }

  static async empty(): Promise<VotedLedger> {
    return VotedLedger.fromEntries([]);
  }

  /** Dựng rồi đối chiếu với `voted_root` trên datum — lệch ⇒ `GOV-LEDGER-001`. */
  static async rebuild(entries: readonly VotedEntry[], expectedRoot: string): Promise<VotedLedger> {
    const l = await VotedLedger.fromEntries(entries);
    l.assertRoot(expectedRoot);
    return l;
  }

  get root(): string {
    return rootHexOf(this.trie.hash);
  }

  get size(): number {
    return this.map.size;
  }

  entries(): VotedEntry[] {
    return [...this.map.keys()].sort().map((k) => ({ didCommit: k, nullifier: this.map.get(k)! }));
  }

  has(didCommit: string): boolean {
    return this.map.has(assertKey(didCommit, "didCommit"));
  }

  assertRoot(expectedRoot: string): void {
    const want = typeof expectedRoot === "string" ? expectedRoot.toLowerCase() : String(expectedRoot);
    if (this.root !== want) {
      throw new Error(
        `GOV-LEDGER-001: gốc sổ dựng lại ${this.root} (${this.size} lá) ≠ voted_root trên datum ${want}. ` +
        `Danh sách phiếu đã gom thiếu hoặc thừa — KHÔNG dựng giao dịch trên sổ lệch.`,
      );
    }
  }

  /**
   * Kế hoạch chèn MỘT LÔ theo đúng thứ tự `entries` (phải là thứ tự input của giao dịch). Khoá
   * đã có trong sổ hoặc trùng trong lô ⇒ `GOV-LEDGER-003`.
   */
  async planBatchInsert(entries: readonly VotedEntry[]): Promise<BatchInsertPlan> {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("GOV-LEDGER-015: lô chèn phải có ≥ 1 lá (SumBatch đòi ≥ 1 phiếu)");
    }
    const clean = entries.map((e, i) => ({
      didCommit: assertKey(e?.didCommit, `batch[${i}].didCommit`),
      nullifier: assertValue(e?.nullifier, `batch[${i}].nullifier`),
    }));
    let cur: VotedLedger = this;
    const insertProofs: MpfProof[] = [];
    for (const e of clean) {
      if (cur.map.has(e.didCommit)) {
        throw new Error(`GOV-LEDGER-003: did_commit ${e.didCommit} đã có trong sổ (hoặc trùng trong lô) — mpf.insert on-chain sẽ bác`);
      }
      const next = await VotedLedger.fromEntries([...cur.entries(), e]);
      // Bằng chứng chèn = bằng chứng thành viên của khoá trong sổ SAU lần chèn: on-chain
      // `mpf.insert` tính gốc-không-có-khoá (phải = gốc trước) và gốc-có-khoá (= gốc sau).
      const p = await next.trie.prove(Buffer.from(e.didCommit, "hex"));
      selfCheck(p, e.didCommit, cur.root, next.root);
      insertProofs.push(proofFromLibrary(p.toJSON()));
      cur = next;
    }
    const membershipProofs: MpfProof[] = [];
    for (const e of clean) membershipProofs.push(await cur.proveMembership(e.didCommit));
    return { entries: clean, insertProofs, membershipProofs, rootBefore: this.root, rootAfter: cur.root, next: cur };
  }

  /** Bằng chứng `(did_commit → nullifier)` CÓ TRONG sổ này (dùng cho `ConsumeForTally`). */
  async proveMembership(didCommit: string): Promise<MpfProof> {
    const k = assertKey(didCommit, "didCommit");
    if (!this.map.has(k)) throw new Error(`GOV-LEDGER-004: did_commit ${k} KHÔNG có trong sổ`);
    const p = await this.trie.prove(Buffer.from(k, "hex"));
    const inc = rootHexOf(p.verify(true, undefined));
    if (inc !== this.root) {
      throw new Error(`GOV-LEDGER-005: bằng chứng thành viên cho ${k} tự kiểm lệch — including ${inc} ≠ gốc ${this.root}`);
    }
    return proofFromLibrary(p.toJSON());
  }
}

/** Tự kiểm bằng CÙNG phép on-chain làm: loại khoá ra `without`, gộp khoá vào ra `withKey`. */
function selfCheck(p: Proof, key: string, without: string, withKey: string): void {
  // Tham số thứ hai của `verify` khai trong `.d.ts` 1.3.1 nhưng thân hàm không dùng.
  const ex = rootHexOf(p.verify(false, undefined));
  const inc = rootHexOf(p.verify(true, undefined));
  if (ex !== without || inc !== withKey) {
    throw new Error(
      `GOV-LEDGER-006: bằng chứng chèn cho ${key} tự kiểm lệch — excluding ${ex} (mong ${without}), including ${inc} (mong ${withKey})`,
    );
  }
}
