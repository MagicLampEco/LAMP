// Vòi pot development (`_devPotPayouts.ts`). Mỗi cổng một ca ĐỎ; đầu vào chỉ khác ca xanh ở đúng
// chỗ cổng đó soát.
import { describe, it, expect } from "vitest";
import { credentialToAddress, keyHashToCredential, scriptHashToCredential } from "@lucid-evolution/lucid";

import {
  parseDevPotPayouts, parseDevPotLedger, planDevPotPayouts, devPotLedgerLines,
  DEVPOT_PAYOUTS_SCHEMA, DEVPOT_MAX_BATCH, DEVPOT_DEFAULT_CAP_OILDROP,
} from "../scripts/_devPotPayouts.js";

const h = (c: string) => c.repeat(56);
const keyAddr = (c: string, net: "Preprod" | "Mainnet" = "Preprod") => credentialToAddress(net, keyHashToCredential(h(c)));
const row = (c: string, oildrop = "100000000") => ({ address: keyAddr(c), oildrop, ref: `t-${c}` });
const file = (payouts: unknown[], over: Record<string, unknown> = {}) =>
  ({ schema: DEVPOT_PAYOUTS_SCHEMA, network: "Preprod", payouts, ...over });
const codeOf = (f: () => unknown): string => {
  try { f(); } catch (e) { return String((e as Error).message).split(":")[0]!; }
  return "KHÔNG NÉM";
};

describe("parseDevPotPayouts — ca xanh", () => {
  it("đọc đúng lô hai ví, giữ credential làm khoá sổ", () => {
    const out = parseDevPotPayouts(file([row("a"), row("b", "5")]), "Preprod");
    expect(out.map((p) => [p.credHash, p.oildrop, p.ref])).toEqual([[h("a"), 100000000n, "t-a"], [h("b"), 5n, "t-b"]]);
  });
  it("suất đúng bằng trần thì nhận", () => {
    expect(parseDevPotPayouts(file([row("a", DEVPOT_DEFAULT_CAP_OILDROP.toString())]), "Preprod")).toHaveLength(1);
  });
});

describe("parseDevPotPayouts — mỗi cổng một ca đỏ", () => {
  it("DEVPOT-PAY-002 chạy trên Mainnet", () => {
    expect(codeOf(() => parseDevPotPayouts(file([row("a")], { network: "Mainnet" }), "Mainnet"))).toBe("DEVPOT-PAY-002");
  });
  it("DEVPOT-PAY-001 sai schema", () => {
    expect(codeOf(() => parseDevPotPayouts(file([row("a")], { schema: "x/1" }), "Preprod"))).toBe("DEVPOT-PAY-001");
  });
  it("DEVPOT-PAY-002 tệp cho mạng khác", () => {
    expect(codeOf(() => parseDevPotPayouts(file([row("a")], { network: "Preview" }), "Preprod"))).toBe("DEVPOT-PAY-002");
  });
  it("DEVPOT-PAY-003 rỗng", () => {
    expect(codeOf(() => parseDevPotPayouts(file([]), "Preprod"))).toBe("DEVPOT-PAY-003");
  });
  it("DEVPOT-PAY-003 quá trần lô", () => {
    const many = Array.from({ length: DEVPOT_MAX_BATCH + 1 }, (_, i) => ({
      address: credentialToAddress("Preprod", keyHashToCredential(i.toString(16).padStart(56, "0"))),
      oildrop: "1", ref: `r${i}`,
    }));
    expect(codeOf(() => parseDevPotPayouts(file(many), "Preprod"))).toBe("DEVPOT-PAY-003");
  });
  it("DEVPOT-PAY-004 thiếu ref", () => {
    expect(codeOf(() => parseDevPotPayouts(file([{ ...row("a"), ref: "" }]), "Preprod"))).toBe("DEVPOT-PAY-004");
  });
  it("DEVPOT-PAY-005 ví script", () => {
    const r = { ...row("a"), address: credentialToAddress("Preprod", scriptHashToCredential(h("e"))) };
    expect(codeOf(() => parseDevPotPayouts(file([r]), "Preprod"))).toBe("DEVPOT-PAY-005");
  });
  it("DEVPOT-PAY-005 ví mainnet", () => {
    expect(codeOf(() => parseDevPotPayouts(file([{ ...row("a"), address: keyAddr("a", "Mainnet") }]), "Preprod")))
      .toBe("DEVPOT-PAY-005");
  });
  it("DEVPOT-PAY-006 số không nguyên dương", () => {
    expect(codeOf(() => parseDevPotPayouts(file([row("a", "0")]), "Preprod"))).toBe("DEVPOT-PAY-006");
  });
  it("DEVPOT-PAY-006 vượt trần một đơn vị", () => {
    const over = (DEVPOT_DEFAULT_CAP_OILDROP + 1n).toString();
    expect(codeOf(() => parseDevPotPayouts(file([row("a", over)]), "Preprod"))).toBe("DEVPOT-PAY-006");
  });
  it("DEVPOT-PAY-007 trùng ví trong lô", () => {
    expect(codeOf(() => parseDevPotPayouts(file([row("a"), { ...row("a"), ref: "khác" }]), "Preprod"))).toBe("DEVPOT-PAY-007");
  });
});

describe("sổ đã chi", () => {
  const paid = parseDevPotPayouts(file([row("a")]), "Preprod");
  const text = devPotLedgerLines(paid, "ff".repeat(32), new Date("2026-10-04T00:00:00Z"));

  it("ví đã có trong sổ bị bỏ qua, ví mới vẫn chi; tổng chỉ tính ví mới", () => {
    const plan = planDevPotPayouts(parseDevPotPayouts(file([row("a"), row("b", "7")]), "Preprod"), parseDevPotLedger(text));
    expect(plan.toPay.map((p) => p.credHash)).toEqual([h("b")]);
    expect(plan.alreadyPaid.map((x) => x.line.tx)).toEqual(["ff".repeat(32)]);
    expect(plan.total).toBe(7n);
  });
  it("sổ rỗng ⇒ chi cả lô", () => {
    expect(planDevPotPayouts(paid, parseDevPotLedger("")).toPay).toHaveLength(1);
  });
  it("DEVPOT-LEDGER-001 dòng sổ hỏng thì ném, không bỏ qua", () => {
    expect(codeOf(() => parseDevPotLedger(text + "{hỏng\n"))).toBe("DEVPOT-LEDGER-001");
    expect(codeOf(() => parseDevPotLedger('{"credHash":"ab","tx":"x"}\n'))).toBe("DEVPOT-LEDGER-001");
  });
});
