// Sổ `opened_root` phía off-chain (Faucet v3.1, INV-ONE-ACCT) — dựng lại, đối chiếu gốc, sinh
// bằng chứng chèn/xoá, và PARITY với on-chain.
//
// PARITY: `PARITY_STEPS` dưới đây là bộ số được ghim Y NGUYÊN ở bài Aiken
// `onchain/validators/ledger_parity.ak`. Ở đây ta ép SDK sinh ra ĐÚNG bộ số đó; bên kia ép
// `mpf.insert`/`mpf.delete` on-chain nhận chính các bằng chứng này và ra đúng các gốc này. Một
// phía đổi cách băm / cách mã hoá / cách dựng khoá ⇒ một trong hai bộ kiểm đỏ.

import { describe, it, expect } from "vitest";
import { Data } from "@lucid-evolution/lucid";
import { Trie } from "@aiken-lang/merkle-patricia-forestry";

import {
  OpenedLedger, OPENED_ROOT_EMPTY, LEDGER_KEY_BYTES, didKey, didKeyFromAcctAssetName,
  resolveOpenedLedger,
} from "../offchain/src/openedLedger.js";
import { acctName } from "../offchain/src/constants.js";
import { encodeMpfProof, decodeMpfProof } from "../offchain/src/datum.js";
import type { MpfProof } from "../offchain/src/types.js";

const A = "a11ce0";
const B = "b0b0b0";
const C = "c0ffee";
const D = "d1d00b";   // chung hai nibble đầu của ĐƯỜNG ĐI ("d0") với B ⇒ bằng chứng sâu 2 bước

const LEAF_VALUE_HASH = "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8";

const R0 = "0000000000000000000000000000000000000000000000000000000000000000";
const R1 = "d17aaecb43b2f5229b3b163921eafc6f2c1af10ff102b6cd277869014038fd48";
const R2 = "39aee9a9c9492c009a88558975464e83350db686ecb198c4278d5085f966d305";
const R3 = "30f653bc7ab7e3a6b81cd15919b3e0149639c4da99a30b92780f1180642795b8";
const R4 = "867a1716015707e1fc42e0084ec7eba77a62e26c483d3582ee10f74fc5b5c5ef";
const R5 = "01e416575100d4079f95da707328e093e8bfb6f0f7e97de9f055368444f71de3";
const R6 = "fc4b3b12c97d2bb3afecf0554c67f6e866f2e46eeec7506efd208fa1b930ff4f";

const LEAF_A = { kind: "Leaf" as const, skip: 0n, key: "15d3c3ce67a0f09819f3b25fb056035b067ac44b4c2232f82c08ab47e824ca29", value: LEAF_VALUE_HASH };
const LEAF_B_SKIP1 = { kind: "Leaf" as const, skip: 1n, key: "d0e16cfe782fcdebb70870590cf6f601a6ad9896850983ebeb559a12f77c8749", value: LEAF_VALUE_HASH };
const LEAF_D_SKIP1 = { kind: "Leaf" as const, skip: 1n, key: "d020c99f467e8a5a000c6d0d55012ca281381969c7e8212e9a2c3a2229328ca3", value: LEAF_VALUE_HASH };
const BRANCH_C = {
  kind: "Branch" as const, skip: 0n,
  neighbors: "f8dc35465d8fb8b0d20910b018dd9e7031bb59133ae0c2ec69098ad2619eae4585c09af929492a871e4fae32d9d5c36e352471cd659bcdb61de08f1722acc3b10eb923b0cbd24df54401d998531feead35a47a99f4deed205de4af81120f9761804336a4123bb891ac3e26cce26e39ee47e9e79ae2110965962b571f46786c40",
};
const BRANCH_B_IN_R4 = {
  kind: "Branch" as const, skip: 0n,
  neighbors: "f8dc35465d8fb8b0d20910b018dd9e7031bb59133ae0c2ec69098ad2619eae4585c09af929492a871e4fae32d9d5c36e352471cd659bcdb61de08f1722acc3b10eb923b0cbd24df54401d998531feead35a47a99f4deed205de4af81120f9761e9cbc5bc6a89e89ce8523ee14a0bcdd7a1c48ed253bc25519842a3a218835844",
};
const FORK_A_IN_R3 = {
  kind: "Fork" as const, skip: 0n,
  neighbor: { nibble: 13n, prefix: "00", root: "b183c6e6a3f0804d71b7ab4e85fdeef4296a9538359387bd88a21980e4f1ade8" },
};

interface ParityStep { op: "insert" | "delete"; before: string[]; did: string; rootBefore: string; rootAfter: string; proof: MpfProof }

const PARITY_STEPS: ParityStep[] = [
  { op: "insert", before: [], did: A, rootBefore: R0, rootAfter: R1, proof: [] },
  { op: "insert", before: [A], did: B, rootBefore: R1, rootAfter: R2, proof: [LEAF_A] },
  { op: "insert", before: [A, B], did: D, rootBefore: R2, rootAfter: R3, proof: [LEAF_A, LEAF_B_SKIP1] },
  { op: "insert", before: [A, B, D], did: C, rootBefore: R3, rootAfter: R4, proof: [BRANCH_C] },
  { op: "delete", before: [A, B, D, C], did: B, rootBefore: R4, rootAfter: R5, proof: [BRANCH_B_IN_R4, LEAF_D_SKIP1] },
  { op: "insert", before: [A, D, C], did: B, rootBefore: R5, rootAfter: R4, proof: [BRANCH_B_IN_R4, LEAF_D_SKIP1] },
  { op: "delete", before: [A, B, D], did: A, rootBefore: R3, rootAfter: R6, proof: [FORK_A_IN_R3] },
  { op: "delete", before: [A], did: A, rootBefore: R1, rootAfter: R0, proof: [] },
];

const refs = (dids: string[]) => dids.map((didName) => ({ didName }));

describe("gốc rỗng — cầu nối null → 32 byte", () => {
  it("thư viện JS biểu diễn trie rỗng bằng hash === null (nên SDK phải tự giữ hằng OPENED_ROOT_EMPTY)", () => {
    const t = new Trie();
    expect(t.hash).toBeNull();
    expect(t.isEmpty()).toBe(true);
  });
  it("OPENED_ROOT_EMPTY = 32 byte 0 = gốc sổ rỗng của SDK (bài Aiken `ledger_parity_empty_root` ghim phía on-chain)", async () => {
    expect(OPENED_ROOT_EMPTY).toBe(R0);
    expect((await OpenedLedger.empty()).root).toBe(R0);
  });
});

describe("PARITY với on-chain (ledger_parity.ak) — SDK sinh ĐÚNG gốc + bằng chứng đã ghim", () => {
  for (const s of PARITY_STEPS) {
    it(`${s.op} ${s.did} vào sổ {${s.before.join(",")}} (${s.proof.length} bước)`, async () => {
      const ledger = await OpenedLedger.fromLiveAccounts(refs(s.before));
      expect(ledger.root).toBe(s.rootBefore);
      const t = s.op === "insert" ? await ledger.planInsert(s.did) : await ledger.planDelete(s.did);
      expect(t.rootBefore).toBe(s.rootBefore);
      expect(t.rootAfter).toBe(s.rootAfter);
      expect(t.proof).toEqual(s.proof);
      expect(t.next.root).toBe(s.rootAfter);
      // sổ gốc KHÔNG bị sửa.
      expect(ledger.root).toBe(s.rootBefore);
    });
  }

  it("vector đủ yêu cầu: ≥3 khoá, có bằng chứng sâu > 1 bước, phủ đủ Branch · Fork · Leaf", () => {
    const maxKeys = Math.max(...PARITY_STEPS.map((s) => s.before.length + (s.op === "insert" ? 1 : 0)));
    expect(maxKeys).toBeGreaterThanOrEqual(3);
    expect(PARITY_STEPS.some((s) => s.proof.length > 1)).toBe(true);
    const kinds = new Set(PARITY_STEPS.flatMap((s) => s.proof.map((p) => p.kind)));
    expect([...kinds].sort()).toEqual(["Branch", "Fork", "Leaf"]);
  });

  it("bộ mã hoá Proof → Data khớp CBOR của chính thư viện (`Proof.toCBOR`)", async () => {
    for (const s of PARITY_STEPS) {
      if (s.proof.length === 0) continue;
      const set = s.op === "insert" ? [...s.before, s.did] : s.before;
      const t = new Trie();
      for (const d of set) await t.insert(Buffer.from(didKey(d), "hex"), Buffer.alloc(0));
      const libCbor = (await t.prove(Buffer.from(didKey(s.did), "hex"))).toCBOR().toString("hex");
      // Giải mã CBOR của thư viện bằng bộ giải mã SDK ⇒ ra đúng bằng chứng SDK sinh.
      expect(decodeMpfProof(Data.from(libCbor))).toEqual(s.proof);
      // Và CBOR SDK mã hoá TRÙNG TỪNG BYTE với CBOR thư viện (kể cả cách chẻ 128 byte
      // `neighbors` thành hai khúc 64 byte mà Plutus đòi).
      expect(Data.to(encodeMpfProof(s.proof))).toBe(libCbor);
    }
  });
});

describe("dựng lại + đối chiếu gốc", () => {
  it("did_name và asset name ACCT cho CÙNG khoá, CÙNG gốc; thứ tự đầu vào không ảnh hưởng", async () => {
    expect(didKey(A)).toBe(acctName(A).slice(8));
    expect(didKey(A)).toHaveLength(2 * LEDGER_KEY_BYTES);
    expect(didKeyFromAcctAssetName(acctName(B))).toBe(didKey(B));
    const byName = await OpenedLedger.fromLiveAccounts(refs([A, B, C]));
    const byAsset = await OpenedLedger.fromLiveAccounts([C, A, B].map((d) => ({ acctAssetName: acctName(d) })));
    expect(byAsset.root).toBe(byName.root);
  });

  it("gốc dựng lại lệch datum ⇒ FAUCET-LEDGER-001 (thiếu, thừa, hay gốc lạ đều ném)", async () => {
    await expect(OpenedLedger.rebuild(refs([A, B]), R3)).rejects.toThrow(/FAUCET-LEDGER-001/);   // thiếu D
    await expect(OpenedLedger.rebuild(refs([A, B, D, C]), R3)).rejects.toThrow(/FAUCET-LEDGER-001/); // thừa C
    await expect(resolveOpenedLedger(refs([A]), "ff".repeat(32))).rejects.toThrow(/FAUCET-LEDGER-001/);
    const ok = await OpenedLedger.rebuild(refs([D, B, A]), R3);
    expect(ok.root).toBe(R3);
    const same = await OpenedLedger.fromLiveAccounts(refs([A]));
    expect(() => same.assertRoot(R0)).toThrow(/FAUCET-LEDGER-001/);
  });

  it("hai account cùng một DID đang sống ⇒ FAUCET-LEDGER-002 (INV-ONE-ACCT đã vỡ, không có gốc đúng)", async () => {
    await expect(OpenedLedger.fromLiveAccounts([{ didName: A }, { acctAssetName: acctName(A) }]))
      .rejects.toThrow(/FAUCET-LEDGER-002/);
  });

  it("chèn khoá đã có ⇒ FAUCET-LEDGER-003; xoá khoá không có ⇒ FAUCET-LEDGER-004", async () => {
    const l = await OpenedLedger.fromLiveAccounts(refs([A, B]));
    await expect(l.planInsert(A)).rejects.toThrow(/FAUCET-LEDGER-003/);
    await expect(l.planDelete(C)).rejects.toThrow(/FAUCET-LEDGER-004/);
  });

  it("asset name ACCT hình dạng lạ ⇒ NÉM, không đoán", async () => {
    expect(() => didKeyFromAcctAssetName("41434354" + "00".repeat(27))).toThrow(/FAUCET-LEDGER-010/);
    expect(() => didKeyFromAcctAssetName("504f4f4c" + "00".repeat(28))).toThrow(/FAUCET-LEDGER-011/);
    await expect(OpenedLedger.fromLiveAccounts([{} as never])).rejects.toThrow(/FAUCET-LEDGER-012/);
    await expect(OpenedLedger.fromKeys(["zz"])).rejects.toThrow(/FAUCET-LEDGER-013/);
  });

  it("mở → thu hồi → mở lại cùng DID: trở về ĐÚNG gốc, bằng chứng lặp lại y hệt", async () => {
    const base = await OpenedLedger.fromLiveAccounts(refs([A, D, C]));
    const open1 = await base.planInsert(B);
    const recl = await open1.next.planDelete(B);
    const open2 = await recl.next.planInsert(B);
    expect(recl.rootAfter).toBe(base.root);
    expect(open2.rootAfter).toBe(open1.rootAfter);
    expect(open2.proof).toEqual(open1.proof);
  });
});
