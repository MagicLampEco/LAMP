// Vitest — danh sách apply-param của `custody` phải KHỚP blueprint, và cổng phải chặn khi lệch.
//
// VÌ SAO BỘ KIỂM NÀY TỒN TẠI: `custody.ak` thêm hai khe `lamp_policy`/`token_name` cùng
// nhánh MigrateIn (`Treasury/onchain/validators/custody.ak:89-95`), nhưng
// `Treasury/scripts/config.ts` còn áp BA khe cũ. `applyParamsToScript` không ném khi thiếu
// tham số — nó áp một phần rồi trả về một script hash hợp lệ và SAI, tức một địa chỉ kho
// khác. LAMP rót vào đó không rút ra được, và LAMP KHÔNG burn (`Treasury/CONTRACT.md §5`).
//
// Bài kiểm đọc số khe TỪ blueprint thật, không gõ tay con số 5: gõ tay thì lúc validator lên
// sáu khe, bài kiểm vẫn xanh trong khi nó đang canh một con số đã chết.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  custodyParamList, custodyTokenName, resolveLampPolicy, PLACEHOLDER_LAMP_POLICY,
  CUSTODY_TITLE, CUSTODY_SEED_TITLE,
} from "../scripts/custodyParams.js";
import { declaredParamCount, assertParamCountFromBlueprint } from "../../Genesis/offchain/src/applyGate.js";
import { LAMP_NAME, TLAMP_NAME } from "../../Genesis/offchain/src/constants.js";

const PLUTUS_JSON = resolve(process.cwd(), "../onchain/plutus.json");
const BLUEPRINT = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));

const SAMPLE = {
  proposalPolicy: "11".repeat(28),
  seedPolicy: "22".repeat(28),
  msPerEpoch: 432_000_000n,
  lampPolicy: "33".repeat(28),
  tokenName: TLAMP_NAME,
};

describe("custodyParamList — khớp ĐÚNG số khe blueprint khai", () => {
  it("blueprint khai đúng 5 khe cho custody (đọc từ plutus.json, không gõ tay)", () => {
    expect(declaredParamCount(BLUEPRINT, CUSTODY_TITLE, "Treasury", 5)).toBe(5);
  });

  it("danh sách dựng ra đi qua cổng đếm khe mà không ném", () => {
    const params = custodyParamList(SAMPLE);
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, CUSTODY_TITLE, "Treasury", params.length))
      .not.toThrow();
  });

  it("thứ tự khe khớp thứ tự blueprint khai", () => {
    const declared = (BLUEPRINT.validators as { title: string; parameters?: { title?: string }[] }[])
      .find((v) => v.title === CUSTODY_TITLE)!.parameters!.map((p) => p.title);
    expect(declared).toEqual([
      "proposal_policy", "seed_policy", "ms_per_epoch", "lamp_policy", "token_name",
    ]);
    expect(custodyParamList(SAMPLE)).toEqual([
      SAMPLE.proposalPolicy, SAMPLE.seedPolicy, SAMPLE.msPerEpoch, SAMPLE.lampPolicy, SAMPLE.tokenName,
    ]);
  });

  it("custody_seed vẫn đúng MỘT khe (genesis_ref)", () => {
    expect(declaredParamCount(BLUEPRINT, CUSTODY_SEED_TITLE, "Treasury", 1)).toBe(1);
  });
});

describe("ca ÂM TÍNH — danh sách BA khe cũ phải bị chặn", () => {
  // Đây chính là hình dạng mã trước bản vá. Nếu ca này xanh thì cổng không canh gì.
  it("áp 3 tham số vào custody (khai 5) → APPLY-001", () => {
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, CUSTODY_TITLE, "Treasury", 3))
      .toThrow(/APPLY-001/);
  });

  it("áp 4 tham số (quên token_name) cũng bị chặn — không chỉ chặn ca thiếu 2", () => {
    expect(() => assertParamCountFromBlueprint(BLUEPRINT, CUSTODY_TITLE, "Treasury", 4))
      .toThrow(/APPLY-001/);
  });
});

describe("custodyTokenName — nhãn token theo mạng, lấy từ nguồn duy nhất", () => {
  it("Mainnet → LAMP; Preview/Preprod → tLAMP", () => {
    expect(custodyTokenName("Mainnet")).toBe(LAMP_NAME);
    expect(custodyTokenName("Preview")).toBe(TLAMP_NAME);
    expect(custodyTokenName("Preprod")).toBe(TLAMP_NAME);
  });

  it("hai cực KHÁC nhau — nếu bằng nhau thì ca trên không đo gì", () => {
    expect(custodyTokenName("Mainnet")).not.toBe(custodyTokenName("Preprod"));
  });
});

describe("resolveLampPolicy — ba nguồn, và placeholder tự khai là placeholder", () => {
  it("có LAMP_POLICY_ID hợp lệ → dùng nó, source = env", () => {
    const r = resolveLampPolicy("Preview", { LAMP_POLICY_ID: "ab".repeat(28) });
    expect(r.policy).toBe("ab".repeat(28));
    expect(r.source).toBe("env");
  });

  it("LAMP_POLICY_ID sai hình dạng → NÉM, không im lặng rơi về placeholder", () => {
    expect(() => resolveLampPolicy("Preview", { LAMP_POLICY_ID: "khong-phai-hex" }))
      .toThrow(/LAMP_POLICY_ID/);
  });

  it("Mainnet không có env → lấy bản ACTIVE trong sổ policy, source = registry", () => {
    const r = resolveLampPolicy("Mainnet", {});
    expect(r.source).toBe("registry");
    expect(r.policy).toMatch(/^[0-9a-f]{56}$/);
  });

  it("Preview không có env + sổ chưa có bản ACTIVE → placeholder, và NÓI RÕ vì sao", () => {
    const r = resolveLampPolicy("Preview", {});
    expect(r.source).toBe("placeholder");
    expect(r.policy).toBe(PLACEHOLDER_LAMP_POLICY);
    // Placeholder không được im: lý do phải mang mã lỗi tra được của sổ policy.
    expect(r.reason).toMatch(/TLAMP-SRC-00/);
  });

  it("placeholder KHÁC mọi giá trị thật — hai cực phân biệt được", () => {
    const dev = resolveLampPolicy("Preview", {});
    const that = resolveLampPolicy("Mainnet", {});
    expect(dev.policy).not.toBe(that.policy);
    expect(dev.source).not.toBe(that.source);
  });
});
