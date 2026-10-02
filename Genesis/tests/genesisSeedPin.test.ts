// Cổng GENESIS-SEED-001..003 + LAMP-PID-001..003 — ghim hạt giống genesis, so policy đã công bố.
//
// VÌ SAO BÀI NÀY TỒN TẠI
// Policy LAMP là hàm của `genesis_ref`. Nhà khác (két/kho Wakeme, MAGIC) nướng policy vào hash
// của họ TRƯỚC khi Tx A gửi. Đường tự chọn của `20_canonical_genesis.ts` lấy UTxO nhiều ADA nhất,
// và khi ví có vài UTxO bằng nhau thì thứ tự do nhà cung cấp trả ⇒ policy chạy khô ≠ policy gửi
// thật, không dòng nào kêu. Mỗi ca dưới đây có đầu vào phân biệt được hai phía của một đột biến:
// bỏ phép so ⇒ ca "lệch" xanh sai; bỏ nhánh `required` ⇒ ca "thiếu khi gửi" xanh sai.
import { describe, it, expect } from "vitest";
import { credentialToAddress, type UTxO } from "@lucid-evolution/lucid";
import {
  assertExpectedLampPid, findOwnedGenesisSeed, genesisSeedRefFromEnv, type OutputRef,
} from "../scripts/_custodySeedRef.js";

const TX_A = "1".repeat(64);
const PKH_A = "aa".repeat(28);
const PKH_B = "bb".repeat(28);
const PID_A = "cc".repeat(28);
const PID_B = "dd".repeat(28);

function utxoAt(ref: OutputRef, address: string): UTxO {
  return { txHash: ref.txHash, outputIndex: ref.outputIndex, address, assets: { lovelace: 5_000_000n } };
}
function lucidWith(utxos: UTxO[]) {
  return { utxosByOutRef: async (refs: OutputRef[]) =>
    utxos.filter((u) => refs.some((r) => r.txHash === u.txHash && r.outputIndex === u.outputIndex)) };
}

describe("GENESIS-SEED-001 — đọc GENESIS_SEED_TX/IDX", () => {
  it("cả hai trống ⇒ undefined (giữ đường tự chọn)", () => {
    expect(genesisSeedRefFromEnv({})).toBeUndefined();
    expect(genesisSeedRefFromEnv({ GENESIS_SEED_TX: " ", GENESIS_SEED_IDX: "" })).toBeUndefined();
  });
  it("đủ cả hai ⇒ outref, hash chuẩn hoá chữ thường", () => {
    expect(genesisSeedRefFromEnv({ GENESIS_SEED_TX: "AB".repeat(32), GENESIS_SEED_IDX: "0" }))
      .toEqual({ txHash: "ab".repeat(32), outputIndex: 0 });
  });
  it("đặt một nửa ⇒ ném (một nửa outref là một policy khác)", () => {
    expect(() => genesisSeedRefFromEnv({ GENESIS_SEED_TX: TX_A })).toThrow(/GENESIS-SEED-001/);
    expect(() => genesisSeedRefFromEnv({ GENESIS_SEED_IDX: "0" })).toThrow(/GENESIS-SEED-001/);
  });
  it("định dạng sai ⇒ ném", () => {
    expect(() => genesisSeedRefFromEnv({ GENESIS_SEED_TX: "xyz", GENESIS_SEED_IDX: "0" })).toThrow(/GENESIS-SEED-001/);
    expect(() => genesisSeedRefFromEnv({ GENESIS_SEED_TX: TX_A, GENESIS_SEED_IDX: "-1" })).toThrow(/GENESIS-SEED-001/);
  });
});

describe("GENESIS-SEED-002/003 — hạt giống ghim phải sống và thuộc khoá đang chạy", () => {
  const ref = { txHash: TX_A, outputIndex: 0 };
  const enterpriseA = credentialToAddress("Preprod", { type: "Key", hash: PKH_A });
  const enterpriseB = credentialToAddress("Preprod", { type: "Key", hash: PKH_B });

  it("còn sống ở enterprise của cùng khoá ⇒ trả đúng UTxO", async () => {
    const u = await findOwnedGenesisSeed(lucidWith([utxoAt(ref, enterpriseA)]), ref, PKH_A);
    expect(u.txHash).toBe(TX_A);
  });
  it("đã tiêu ⇒ ném GENESIS-SEED-002, không lùi về tự chọn", async () => {
    await expect(findOwnedGenesisSeed(lucidWith([]), ref, PKH_A)).rejects.toThrow(/GENESIS-SEED-002/);
  });
  it("khoá khác ⇒ ném GENESIS-SEED-003", async () => {
    await expect(findOwnedGenesisSeed(lucidWith([utxoAt(ref, enterpriseB)]), ref, PKH_A))
      .rejects.toThrow(/GENESIS-SEED-003/);
  });
});

describe("LAMP-PID-001..003 — policy dựng ra phải trùng policy đã công bố", () => {
  it("khớp (không phân biệt hoa thường) ⇒ im", () => {
    expect(() => assertExpectedLampPid(PID_A, { EXPECTED_LAMP_PID: PID_A.toUpperCase() }, true)).not.toThrow();
  });
  it("lệch ⇒ ném LAMP-PID-003", () => {
    expect(() => assertExpectedLampPid(PID_A, { EXPECTED_LAMP_PID: PID_B })).toThrow(/LAMP-PID-003/);
  });
  it("định dạng sai ⇒ ném LAMP-PID-002", () => {
    expect(() => assertExpectedLampPid(PID_A, { EXPECTED_LAMP_PID: "cc" })).toThrow(/LAMP-PID-002/);
  });
  it("thiếu khi KHÔNG bắt buộc (chạy khô) ⇒ im", () => {
    expect(() => assertExpectedLampPid(PID_A, {}, false)).not.toThrow();
  });
  it("thiếu khi bắt buộc (ghim + gửi thật) ⇒ ném LAMP-PID-001", () => {
    expect(() => assertExpectedLampPid(PID_A, {}, true)).toThrow(/LAMP-PID-001/);
  });
});
