// Cổng đọc danh sách cấp ETD (`_etdGrants.ts`). Mỗi cổng có một ca ĐỎ riêng; đầu vào chỉ khác ca
// xanh ở đúng chỗ cổng đó soát — gỡ cổng nào thì đúng ca của cổng đó đổi màu.
import { describe, it, expect } from "vitest";
import {
  credentialToAddress, credentialToRewardAddress, keyHashToCredential, scriptHashToCredential,
} from "@lucid-evolution/lucid";

import {
  parseEtdGrants, planEtdGrants, ETD_GRANTS_SCHEMA, ETD_POT_ID, type EtdGrant,
} from "../scripts/_etdGrants.js";
import { potBudgetOildrop } from "../../Distribution/offchain/src/pots.js";

const h = (c: string) => c.repeat(56);
const payAddr = (pkh: string, net: "Preprod" | "Mainnet" = "Preprod") =>
  credentialToAddress(net, keyHashToCredential(pkh));
const stakeAddr = (skh: string, net: "Preprod" | "Mainnet" = "Preprod") =>
  credentialToRewardAddress(net, keyHashToCredential(skh));

const row = (i: string, e = "1000000000") => ({
  stake_address: stakeAddr(h(i)),
  payment_address: payAddr(h(String.fromCharCode(i.charCodeAt(0) + 1))),
  entitlement_oildrop: e,
});

const file = (grants: unknown[], over: Record<string, unknown> = {}) => ({
  schema: ETD_GRANTS_SCHEMA, network: "Preprod", pot: ETD_POT_ID, grants, ...over,
});

const codeOf = (f: () => unknown): string => {
  try { f(); } catch (e) { return String((e as Error).message).split(":")[0]!; }
  return "KHÔNG NÉM";
};

describe("parseEtdGrants — ca xanh", () => {
  it("đọc đúng owner = payment key-hash và E", () => {
    const g = parseEtdGrants(file([row("a"), row("c", "5")]), "Preprod");
    expect(g).toHaveLength(2);
    expect(g[0]!.ownerPkh).toBe(h("b"));
    expect(g[1]!.entitlementOildrop).toBe(5n);
  });

  it("tổng đúng bằng ngân sách pot vẫn qua", () => {
    const budget = potBudgetOildrop(ETD_POT_ID);
    expect(parseEtdGrants(file([row("a", String(budget))]), "Preprod")).toHaveLength(1);
  });
});

describe("parseEtdGrants — mỗi cổng một ca đỏ", () => {
  it("ETD-GRANT-001 schema lạ", () => {
    expect(codeOf(() => parseEtdGrants(file([row("a")], { schema: "etd-registry/1" }), "Preprod"))).toBe("ETD-GRANT-001");
  });
  it("ETD-GRANT-002 khác mạng", () => {
    expect(codeOf(() => parseEtdGrants(file([row("a")]), "Mainnet"))).toBe("ETD-GRANT-002");
  });
  it("ETD-GRANT-003 sai pot", () => {
    expect(codeOf(() => parseEtdGrants(file([row("a")], { pot: "airdrop" }), "Preprod"))).toBe("ETD-GRANT-003");
  });
  it("ETD-GRANT-004 danh sách rỗng", () => {
    expect(codeOf(() => parseEtdGrants(file([]), "Preprod"))).toBe("ETD-GRANT-004");
  });
  it("ETD-GRANT-005 ví nhận là ví script (Phoenix vault) — chặn từ lúc đọc", () => {
    const r = { ...row("a"), payment_address: credentialToAddress("Preprod", scriptHashToCredential(h("e"))) };
    expect(codeOf(() => parseEtdGrants(file([r]), "Preprod"))).toBe("ETD-GRANT-005");
  });
  it("ETD-GRANT-005 ví nhận khác mạng", () => {
    const r = { ...row("a"), payment_address: payAddr(h("b"), "Mainnet") };
    expect(codeOf(() => parseEtdGrants(file([r]), "Preprod"))).toBe("ETD-GRANT-005");
  });
  it("ETD-GRANT-006 stake_address là địa chỉ thanh toán", () => {
    const r = { ...row("a"), stake_address: payAddr(h("a")) };
    expect(codeOf(() => parseEtdGrants(file([r]), "Preprod"))).toBe("ETD-GRANT-006");
  });
  it("ETD-GRANT-007 hai dòng cùng ví nhận", () => {
    const r2 = { ...row("c"), payment_address: row("a").payment_address };
    expect(codeOf(() => parseEtdGrants(file([row("a"), r2]), "Preprod"))).toBe("ETD-GRANT-007");
  });
  it("ETD-GRANT-008 hai dòng cùng stake key", () => {
    const r2 = { ...row("c"), stake_address: row("a").stake_address };
    expect(codeOf(() => parseEtdGrants(file([row("a"), r2]), "Preprod"))).toBe("ETD-GRANT-008");
  });
  it("ETD-GRANT-009 E bằng 0 hoặc không phải số", () => {
    expect(codeOf(() => parseEtdGrants(file([row("a", "0")]), "Preprod"))).toBe("ETD-GRANT-009");
    expect(codeOf(() => parseEtdGrants(file([row("a", "1e9")]), "Preprod"))).toBe("ETD-GRANT-009");
  });
  it("ETD-GRANT-010 tổng vượt ngân sách pot một oildrop", () => {
    const budget = potBudgetOildrop(ETD_POT_ID);
    expect(codeOf(() => parseEtdGrants(file([row("a", String(budget)), row("c", "1")]), "Preprod")))
      .toBe("ETD-GRANT-010");
  });
});

describe("planEtdGrants", () => {
  const g = (i: string, e: bigint): EtdGrant => ({
    stakeAddress: "s", paymentAddress: "p", ownerPkh: h(i), entitlementOildrop: e,
  });
  it("chia đúng ba nhóm: chưa có · đã cấp đúng E · lệch", () => {
    const existing = new Map([
      [h("b"), [{ ref: "x#0", entitlement: 5n }]],
      [h("c"), [{ ref: "y#0", entitlement: 9n }]],
      [h("d"), [{ ref: "z#0", entitlement: 5n }, { ref: "z#1", entitlement: 5n }]],
    ]);
    const p = planEtdGrants([g("a", 5n), g("b", 5n), g("c", 5n), g("d", 5n)], existing);
    expect(p.toGrant.map((x) => x.ownerPkh)).toEqual([h("a")]);
    expect(p.done.map((x) => x.ownerPkh)).toEqual([h("b")]);
    expect(p.conflicts.map((x) => x.grant.ownerPkh)).toEqual([h("c"), h("d")]);
  });
});
