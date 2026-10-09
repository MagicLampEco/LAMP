// Máy chủ vòi v1 — phần thuần `handleFaucetBuild` + `parseServerEnv` của `server/faucetBuild.ts`.
// Không mạng: `build` là hàm giả. Đường Koios + Lucid thật nằm trong `main()` và KHÔNG được bài
// này ghim (cần mạng Preprod); builder thì được `faucetV1.test.ts` ghim trên Emulator.
import { credentialToAddress, keyHashToCredential, scriptHashToCredential } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import { FaucetV1Error, type FaucetV1Code } from "../offchain/src/faucetV1.js";
import { handleFaucetBuild, parseServerEnv, type BuildFn } from "../server/faucetBuild.js";

const OK_ADDR = credentialToAddress("Preprod", keyHashToCredential("cd".repeat(28)));
const SCRIPT_ADDR = credentialToAddress("Preprod", scriptHashToCredential("ef".repeat(28)));
const quiet = () => {};

function spy(impl: BuildFn): BuildFn & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (a: string) => { calls.push(a); return impl(a); }) as BuildFn & { calls: string[] };
  f.calls = calls;
  return f;
}
const throwing = (code: FaucetV1Code) => spy(async () => { throw new FaucetV1Error(code, "x"); });

describe("handleFaucetBuild", () => {
  it("200 {tx_cbor_hex} và builder nhận đúng địa chỉ đã cắt khoảng trắng", async () => {
    const b = spy(async () => "84a400");
    const r = await handleFaucetBuild({ address: ` ${OK_ADDR} ` }, b, quiet);
    expect(r).toEqual({ status: 200, body: { tx_cbor_hex: "84a400" } });
    expect(b.calls).toEqual([OK_ADDR]);
  });

  it.each<[string, unknown]>([
    ["null", null], ["mảng", [OK_ADDR]], ["chuỗi", OK_ADDR],
  ])("body %s ⇒ 400 FAUCET-BAD-REQUEST, builder không được gọi", async (_n, body) => {
    const b = spy(async () => "x");
    const r = await handleFaucetBuild(body, b, quiet);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("FAUCET-BAD-REQUEST");
    expect(b.calls).toHaveLength(0);
  });

  it.each<[string, unknown]>([
    ["thiếu address", {}], ["address số", { address: 7 }], ["địa chỉ script", { address: SCRIPT_ADDR }],
    ["mainnet", { address: credentialToAddress("Mainnet", keyHashToCredential("cd".repeat(28))) }],
  ])("%s ⇒ 400 FAUCET-ADDR TRƯỚC mọi lời gọi builder", async (_n, body) => {
    const b = spy(async () => "x");
    const r = await handleFaucetBuild(body, b, quiet);
    expect(r).toMatchObject({ status: 400, body: { code: "FAUCET-ADDR" } });
    expect(b.calls).toHaveLength(0);
  });

  it.each<[FaucetV1Code, number]>([
    ["FAUCET-ADDR", 400], ["FAUCET-NO-ADA", 422], ["FAUCET-EMPTY", 503],
  ])("builder ném %s ⇒ HTTP %i, message của builder đi nguyên ra", async (code, status) => {
    const r = await handleFaucetBuild({ address: OK_ADDR }, throwing(code), quiet);
    expect(r).toEqual({ status, body: { code, message: `${code}: x` } });
  });

  it("FAUCET-CONFIG và lỗi lạ ⇒ 500 FAUCET-INTERNAL, chỉ lộ mã tham chiếu, log có cùng mã", async () => {
    for (const b of [throwing("FAUCET-CONFIG"), spy(async () => { throw new Error("koios 429 /internal/path"); })]) {
      const logged: string[] = [];
      const r = await handleFaucetBuild({ address: OK_ADDR }, b, (m) => logged.push(m));
      expect(r.status).toBe(500);
      expect(r.body.code).toBe("FAUCET-INTERNAL");
      expect(r.body.message).not.toMatch(/koios|internal|FAUCET-CONFIG/);
      const ref = /Mã tham chiếu: ([0-9a-f]{8})/.exec(r.body.message!)?.[1];
      expect(ref).toBeDefined();
      expect(logged.join("\n")).toContain(`ref=${ref}`);
    }
  });
});

describe("parseServerEnv — không khởi động sai mạng/sai cấu hình", () => {
  const good = { NETWORK: "Preprod", POOL_ADDRESS: SCRIPT_ADDR, FAUCET_REF_UTXO: `${"ab".repeat(32)}#0` };
  it("cấu hình đúng ⇒ đọc được, PORT mặc định 8787", () => {
    expect(parseServerEnv(good)).toEqual({
      network: "Preprod", poolAddress: SCRIPT_ADDR, refOutRef: { txHash: "ab".repeat(32), outputIndex: 0 }, port: 8787,
    });
  });
  it.each<[string, Record<string, string | undefined>, string]>([
    ["NETWORK thiếu", { ...good, NETWORK: undefined }, "FAUCET-SERVER-001"],
    ["NETWORK=Preview", { ...good, NETWORK: "Preview" }, "FAUCET-SERVER-001"],
    ["NETWORK=Mainnet", { ...good, NETWORK: "Mainnet" }, "FAUCET-SERVER-001"],
    ["POOL_ADDRESS ví khoá", { ...good, POOL_ADDRESS: OK_ADDR }, "FAUCET-SERVER-002"],
    ["POOL_ADDRESS rác", { ...good, POOL_ADDRESS: "x" }, "FAUCET-SERVER-002"],
    ["FAUCET_REF_UTXO thiếu #", { ...good, FAUCET_REF_UTXO: "ab".repeat(32) }, "FAUCET-SERVER-003"],
    ["PORT rác", { ...good, PORT: "abc" }, "FAUCET-SERVER-004"],
  ])("%s ⇒ %s", (_n, env, code) => {
    expect(() => parseServerEnv(env)).toThrow(code);
  });
});
