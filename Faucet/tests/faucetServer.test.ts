// Máy chủ vòi v1 — phần thuần `handleFaucetBuild` + `handleRequest` + `parseServerEnv` của
// `server/faucetBuild.ts`, và tệp script commit sẵn `server/faucet_v1.preprod.json`.
// Không mạng: `build` là hàm giả.
//
// CHỐT BÀI KIỂM NÀY KHÔNG GHIM ĐƯỢC:
//   • `main()` (Koios thật, socket, đọc tệp theo `import.meta.url` của bản dist) — cần mạng
//     Preprod; được kiểm bằng chạy khói bản dựng, không bằng vitest;
//   • builder trên validator thật — `faucetV1.test.ts` ghim trên Emulator (kể cả đường đính
//     inline đúng tệp commit sẵn này).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { credentialToAddress, keyHashToCredential, scriptHashToCredential } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import {
  FAUCET_V1_PREPROD_TLAMP, FaucetV1Error, faucetV1CommittedScript, faucetV1ValidatorFromCommitted, type FaucetV1Code,
} from "../offchain/src/faucetV1.js";
import { handleFaucetBuild, handleRequest, parseServerEnv, type App, type BuildFn } from "../server/faucetBuild.js";

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
  const good = { NETWORK: "Preprod", POOL_ADDRESS: SCRIPT_ADDR, FAUCET_COMMIT: "4b2011e" };
  it("tối thiểu ⇒ không ref UTxO, base rỗng, 127.0.0.1:8187", () => {
    expect(parseServerEnv(good)).toEqual({
      network: "Preprod", poolAddress: SCRIPT_ADDR, refOutRef: null, port: 8187, host: "127.0.0.1", basePath: "", commit: "4b2011e",
    });
  });
  it("đủ biến ⇒ ref UTxO đọc được, base bỏ '/' cuối", () => {
    expect(parseServerEnv({ ...good, FAUCET_REF_UTXO: `${"AB".repeat(32)}#3`, PORT: "18187", FAUCET_BASE_PATH: "/lampfaucet/preprod/" }))
      .toMatchObject({ refOutRef: { txHash: "ab".repeat(32), outputIndex: 3 }, port: 18187, basePath: "/lampfaucet/preprod" });
    expect(parseServerEnv({ ...good, FAUCET_REF_UTXO: "  ", FAUCET_BASE_PATH: "/" })).toMatchObject({ refOutRef: null, basePath: "" });
  });
  it.each<[string, Record<string, string | undefined>, string]>([
    ["NETWORK thiếu", { ...good, NETWORK: undefined }, "FAUCET-SERVER-001"],
    ["NETWORK=Preview", { ...good, NETWORK: "Preview" }, "FAUCET-SERVER-001"],
    ["NETWORK=Mainnet", { ...good, NETWORK: "Mainnet" }, "FAUCET-SERVER-001"],
    ["POOL_ADDRESS ví khoá", { ...good, POOL_ADDRESS: OK_ADDR }, "FAUCET-SERVER-002"],
    ["POOL_ADDRESS rác", { ...good, POOL_ADDRESS: "x" }, "FAUCET-SERVER-002"],
    ["FAUCET_REF_UTXO thiếu #", { ...good, FAUCET_REF_UTXO: "ab".repeat(32) }, "FAUCET-SERVER-003"],
    ["PORT rác", { ...good, PORT: "abc" }, "FAUCET-SERVER-004"],
    ["FAUCET_BASE_PATH không có '/' đầu", { ...good, FAUCET_BASE_PATH: "lampfaucet/preprod" }, "FAUCET-SERVER-007"],
    ["FAUCET_BASE_PATH có '?'", { ...good, FAUCET_BASE_PATH: "/a?b" }, "FAUCET-SERVER-007"],
    ["FAUCET_COMMIT thiếu", { ...good, FAUCET_COMMIT: undefined }, "FAUCET-SERVER-008"],
  ])("%s ⇒ %s", (_n, env, code) => {
    expect(() => parseServerEnv(env)).toThrow(code);
  });
});

describe("handleRequest — định tuyến có/không tiền tố", () => {
  const health = {
    commit: "4b2011e", network: "Preprod" as const, script_address: SCRIPT_ADDR, script_hash: "ef".repeat(28), ref_utxo: null,
  };
  const app = (basePath: string, b: BuildFn = async () => "84a400"): App => ({ basePath, build: b, health, log: quiet });
  const body = (v: unknown) => async () => v;
  const never = async (): Promise<unknown> => { throw new Error("body không được đọc ở nhánh này"); };

  it.each<[string, string, string]>([
    ["base rỗng", "", ""],
    ["base Cloudflare (tiền tố KHÔNG bị cắt)", "/lampfaucet/preprod", "/lampfaucet/preprod"],
  ])("%s: POST build 200, GET health 200 đúng hình dạng, có query vẫn khớp", async (_n, base, prefix) => {
    const b = spy(async () => "84a400");
    expect(await handleRequest("POST", `${prefix}/faucet/build?x=1`, body({ address: OK_ADDR }), app(base, b)))
      .toEqual({ status: 200, body: { tx_cbor_hex: "84a400" } });
    expect(b.calls).toEqual([OK_ADDR]);
    const h = await handleRequest("GET", `${prefix}/health`, never, app(base));
    expect(h).toEqual({ status: 200, body: health });
    expect(Object.keys(h.body).sort()).toEqual(["commit", "network", "ref_utxo", "script_address", "script_hash"]);
  });

  it("base đặt ⇒ đường KHÔNG tiền tố là 404; base rỗng ⇒ đường CÓ tiền tố là 404", async () => {
    for (const [base, url] of [
      ["/lampfaucet/preprod", "/faucet/build"], ["/lampfaucet/preprod", "/health"],
      ["/lampfaucet/preprod", "/lampfaucet/faucet/build"], ["/lampfaucet/preprod", "/lampfaucet/preprod/faucet/build/"],
      ["", "/lampfaucet/preprod/faucet/build"], ["", "/lampfaucet/preprod/health"], ["", "/"],
    ] as const) {
      const b = spy(async () => "x");
      const r = await handleRequest("POST", url, never, app(base, b));
      expect(r, `${base} ${url}`).toMatchObject({ status: 404, body: { code: "FAUCET-NOT-FOUND" } });
      expect(b.calls).toHaveLength(0);
    }
  });

  it("sai phương thức ⇒ 405, body không bị đọc; body hỏng ⇒ 400 BAD-REQUEST", async () => {
    expect(await handleRequest("GET", "/p/faucet/build", never, app("/p"))).toMatchObject({ status: 405, body: { code: "FAUCET-METHOD" } });
    expect(await handleRequest("POST", "/p/health", never, app("/p"))).toMatchObject({ status: 405, body: { code: "FAUCET-METHOD" } });
    const bad = async () => { throw new SyntaxError("Unexpected token"); };
    expect(await handleRequest("POST", "/p/faucet/build", bad, app("/p"))).toMatchObject({ status: 400, body: { code: "FAUCET-BAD-REQUEST" } });
  });

  it("health có ref UTxO ⇒ trả đúng chuỗi outref", async () => {
    const a = { ...app(""), health: { ...health, ref_utxo: `${"ab".repeat(32)}#0` } };
    expect((await handleRequest("GET", "/health", never, a)).body.ref_utxo).toBe(`${"ab".repeat(32)}#0`);
  });
});

describe("script commit sẵn server/faucet_v1.preprod.json", () => {
  const committed = JSON.parse(readFileSync(resolve(process.cwd(), "../server/faucet_v1.preprod.json"), "utf8"));
  const blueprint = JSON.parse(readFileSync(resolve(process.cwd(), "../onchain/plutus.json"), "utf8"));
  const PREPROD_POOL = "addr_test1wp67savr7r5wmccslrfrpaknyr0dt2fqwc06nexzx6yn26sypk9ka";

  it("== script áp tham số từ blueprint hiện tại (đỏ ⇒ chạy 34_faucet_v1.ts STEP=export-script rồi commit)", () => {
    expect(committed).toEqual(faucetV1CommittedScript(blueprint, FAUCET_V1_PREPROD_TLAMP));
  });

  it("đọc lại như máy chủ: hash tính lại = 75e87583… = credential pool Preprod đang sống", () => {
    expect(faucetV1ValidatorFromCommitted(committed, PREPROD_POOL).scriptHash)
      .toBe("75e87583f0e8ede310f8d230f6d320ded5a920761fa9e4c23689356a");
  });

  it("sửa tệp hoặc trỏ sai pool ⇒ FAUCET-CONFIG (máy chủ không khởi động)", () => {
    const code = (f: () => unknown) => { try { f(); return "OK"; } catch (e) { return e instanceof FaucetV1Error ? e.code : String(e); } };
    // Đổi 1 byte cuối compiled_code mà giữ script_hash ⇒ hash tính lại lệch.
    const last = committed.compiled_code.slice(-2) === "01" ? "02" : "01";
    const tampered = { ...committed, compiled_code: committed.compiled_code.slice(0, -2) + last };
    expect(code(() => faucetV1ValidatorFromCommitted(tampered, PREPROD_POOL))).toBe("FAUCET-CONFIG");
    expect(code(() => faucetV1ValidatorFromCommitted(committed, SCRIPT_ADDR))).toBe("FAUCET-CONFIG");
    expect(code(() => faucetV1ValidatorFromCommitted({ ...committed, policy: "00".repeat(28) }, PREPROD_POOL))).toBe("FAUCET-CONFIG");
    expect(code(() => faucetV1ValidatorFromCommitted({ ...committed, script_hash: undefined }, PREPROD_POOL))).toBe("FAUCET-CONFIG");
    expect(code(() => faucetV1ValidatorFromCommitted([], PREPROD_POOL))).toBe("FAUCET-CONFIG");
  });
});
