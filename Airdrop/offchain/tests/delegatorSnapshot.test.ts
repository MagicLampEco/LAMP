// delegatorSnapshot.test.ts — kiểm 3 mảnh lõi builder Delegator v2:
//   verifyRegistration (chữ ký + khớp danh tính), dedupeFirstWins, accStakeWithMinRun (§1.5).
// NODE-FREE: keygen/sign qua WebCrypto subtle (global) — khớp verifyEd25519 của SDK.

import { describe, it, expect } from "vitest";
import {
  verifyRegistration,
  dedupeFirstWins,
  accStakeWithMinRun,
  type DelegatorRegistration,
  type StakeHistoryRow,
} from "../src/delegatorSnapshot.js";
import { pubkeyToStakeAddr } from "../src/delegatorCrypto.js";
import { bytesToHex } from "../src/merkle.js";

// WebCrypto + TextEncoder global (khai báo tối giản, node-free typing).
declare const crypto: {
  subtle: {
    generateKey(
      a: { name: string },
      ex: boolean,
      u: string[],
    ): Promise<{ publicKey: unknown; privateKey: unknown }>;
    exportKey(f: "raw", k: unknown): Promise<ArrayBuffer>;
    sign(a: { name: string }, k: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  };
};
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } };

// ── Helper: dựng 1 đăng ký THẬT (ký hợp lệ, stake_address suy đúng từ pubkey) ──

async function mintRegistration(
  overrides: Partial<DelegatorRegistration> = {},
  network = "Preview",
): Promise<DelegatorRegistration> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pubHex = bytesToHex(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
  const stakeAddr = pubkeyToStakeAddr(pubHex, network);
  const message = `MAGICLAMP TEST ${pubHex.slice(0, 8)}`;
  const msgBytes = new TextEncoder().encode(message);
  const messageHex = bytesToHex(msgBytes);
  const sigHex = bytesToHex(
    new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, msgBytes)),
  );

  return {
    version: "1.0",
    stake_address: stakeAddr,
    payment_address: `addr_test_payment_${pubHex.slice(0, 12)}`,
    epochs_active: [500, 501],
    acc_stake_lovelace: "0",
    current_pool_id: null,
    message,
    message_hex: messageHex,
    signature: sigHex,
    signing_pubkey: pubHex,
    signed_at: "2026-07-30T00:00:00.000Z",
    nonce: "deadbeef",
    network,
    signing_method: "cardano-signer-ed25519",
    ...overrides,
  };
}

// ── verifyRegistration ─────────────────────────────────────────────────────

describe("verifyRegistration", () => {
  it("chấp nhận đăng ký ký hợp lệ + pubkey khớp stake_address", async () => {
    const reg = await mintRegistration();
    const v = await verifyRegistration(reg);
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.derived_stake_address).toBe(reg.stake_address);
  });

  it("từ chối khi chữ ký bị sửa (một byte)", async () => {
    const reg = await mintRegistration();
    const flipped = reg.signature.slice(0, -2) + (reg.signature.endsWith("00") ? "01" : "00");
    const v = await verifyRegistration({ ...reg, signature: flipped });
    expect(v.ok).toBe(false);
    expect(v.reasons.some((r) => r.includes("Ed25519"))).toBe(true);
  });

  it("từ chối MẠO DANH: chữ ký hợp lệ nhưng khai stake_address của ví khác", async () => {
    const victim = await mintRegistration(); // stake_address nạn nhân (accStake cao)
    const attacker = await mintRegistration(); // key của kẻ tấn công
    const forged = { ...attacker, stake_address: victim.stake_address };
    const v = await verifyRegistration(forged);
    expect(v.ok).toBe(false);
    expect(v.reasons.some((r) => r.includes("KHÔNG khớp stake_address"))).toBe(true);
  });

  it("từ chối định dạng sai (pubkey không phải 64 hex)", async () => {
    const reg = await mintRegistration({ signing_pubkey: "xyz" });
    const v = await verifyRegistration(reg);
    expect(v.ok).toBe(false);
    expect(v.reasons.some((r) => r.includes("signing_pubkey"))).toBe(true);
  });
});

// ── dedupeFirstWins ────────────────────────────────────────────────────────

describe("dedupeFirstWins", () => {
  it("trùng stake_address → giữ bản ĐẦU, ghi xung đột", async () => {
    const first = await mintRegistration({ stake_address: "stake_test1aaa", payment_address: "addr_A" });
    const second = await mintRegistration({ stake_address: "stake_test1aaa", payment_address: "addr_B" });
    const { kept, conflicts } = dedupeFirstWins([first, second]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.payment_address).toBe("addr_A"); // bản đầu thắng
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("duplicate_stake");
    expect(conflicts[0]!.dropped.payment_address).toBe("addr_B");
  });

  it("2 stake KHÁC nhau nhưng CÙNG payment → bắt payment_collision", async () => {
    const a = await mintRegistration({ stake_address: "stake_test1aaa", payment_address: "addr_SAME" });
    const b = await mintRegistration({ stake_address: "stake_test1bbb", payment_address: "addr_SAME" });
    const { kept, conflicts } = dedupeFirstWins([a, b]);
    expect(kept).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("payment_collision");
  });

  it("không xung đột → giữ hết, đúng thứ tự", async () => {
    const a = await mintRegistration({ stake_address: "s1", payment_address: "p1" });
    const b = await mintRegistration({ stake_address: "s2", payment_address: "p2" });
    const { kept, conflicts } = dedupeFirstWins([a, b]);
    expect(kept.map((r) => r.stake_address)).toEqual(["s1", "s2"]);
    expect(conflicts).toEqual([]);
  });
});

// ── accStakeWithMinRun (§1.5) ──────────────────────────────────────────────

function h(epoch: number, amount: string, pool = "poolX"): StakeHistoryRow {
  return { active_epoch: epoch, amount, pool_id: pool };
}

describe("accStakeWithMinRun §1.5", () => {
  it("giữ đúng 1 epoch → accStake 0 → loại (chuỗi < N=2)", () => {
    const r = accStakeWithMinRun([h(500, "1000000")], { n: 2 });
    expect(r.accStake).toBe(0n);
    expect(r.countedEpochs).toEqual([]);
    expect(r.droppedEpochs).toEqual([500]);
    expect(r.runs[0]).toMatchObject({ length: 1, counted: false });
  });

  it("2 epoch liên tiếp → cộng cả hai", () => {
    const r = accStakeWithMinRun([h(500, "1000000"), h(501, "2000000")], { n: 2 });
    expect(r.accStake).toBe(3_000_000n);
    expect(r.countedEpochs).toEqual([500, 501]);
  });

  it("có KHOẢNG TRỐNG → tách chuỗi; chỉ chuỗi ≥N được tính", () => {
    // [500,501] chuỗi 2 (tính) · [503] chuỗi 1 (loại) · [505,506,507] chuỗi 3 (tính)
    const r = accStakeWithMinRun(
      [h(500, "10"), h(501, "10"), h(503, "99"), h(505, "10"), h(506, "10"), h(507, "10")],
      { n: 2 },
    );
    expect(r.accStake).toBe(50n); // 10+10 + 10+10+10, KHÔNG có 99
    expect(r.countedEpochs).toEqual([500, 501, 505, 506, 507]);
    expect(r.droppedEpochs).toEqual([503]);
  });

  it("ĐA POOL: đổi pool giữa các epoch liền kề vẫn liên tiếp (lỗ #2)", () => {
    const r = accStakeWithMinRun(
      [h(600, "5", "poolA"), h(601, "5", "poolB"), h(602, "5", "poolC")],
      { n: 2 },
    );
    expect(r.accStake).toBe(15n);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ start: 600, end: 602, length: 3, counted: true });
  });

  it("bỏ dòng stake ≤ 0 trước khi xét liên tiếp", () => {
    // epoch 501 stake 0 → 500 và 502 KHÔNG còn liền kề → mỗi cái chuỗi 1 → loại hết
    const r = accStakeWithMinRun([h(500, "10"), h(501, "0"), h(502, "10")], { n: 2 });
    expect(r.accStake).toBe(0n);
    expect(r.droppedEpochs).toEqual([500, 502]);
  });

  it("cửa sổ [eOpen, eCut) cắt epoch ngoài khoảng", () => {
    // window [501, 504): giữ 501,502,503 → chuỗi 3 (tính); 500 & 504 bị cắt
    const r = accStakeWithMinRun(
      [h(500, "9"), h(501, "10"), h(502, "10"), h(503, "10"), h(504, "9")],
      { n: 2, eOpen: 501, eCut: 504 },
    );
    expect(r.accStake).toBe(30n);
    expect(r.countedEpochs).toEqual([501, 502, 503]);
  });

  it("N=1 → mọi epoch có stake đều tính", () => {
    const r = accStakeWithMinRun([h(500, "10"), h(502, "10")], { n: 1 });
    expect(r.accStake).toBe(20n);
    expect(r.countedEpochs).toEqual([500, 502]);
  });

  it("trùng epoch KHÁC giá trị → ném (toàn vẹn nguồn)", () => {
    expect(() => accStakeWithMinRun([h(500, "10"), h(500, "20")], { n: 2 })).toThrow(/DELEG-RUN-002/);
  });

  it("trùng epoch CÙNG giá trị → bỏ qua, không ném", () => {
    const r = accStakeWithMinRun([h(500, "10"), h(500, "10"), h(501, "10")], { n: 2 });
    expect(r.accStake).toBe(20n);
  });

  it("cửa sổ rỗng eOpen ≥ eCut → ném", () => {
    expect(() => accStakeWithMinRun([h(500, "10")], { eOpen: 504, eCut: 504 })).toThrow(/DELEG-RUN-001/);
  });
});
