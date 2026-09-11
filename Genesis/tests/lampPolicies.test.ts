// Sổ policy LAMP/tLAMP — bài kiểm cho đường ĐỌC fail-closed.
//
// Ba trạng thái phải phân biệt được, và bài kiểm phải có ca ÂM TÍNH cho cả ba:
//   • khớp            — bản ACTIVE, policy id đúng hình dạng ⇒ trả giá trị.
//   • lệch            — bản ghi đọc được nhưng đã bị thay ⇒ NÉM TLAMP-SRC-004.
//   • KHÔNG ĐỌC ĐƯỢC  — thiếu bản ghi / rỗng / sai hình dạng / mạng chưa có ACTIVE / sổ tự mâu
//                       thuẫn ⇒ NÉM 001/002/003/005/006, KHÔNG được trả giá trị trông hợp lệ.

import { describe, it, expect } from "vitest";
import {
  LAMP_POLICY_REGISTRY,
  LAMP_POLICY_ERRORS,
  LampPolicySourceError,
  activeLampPolicyId,
  selectActivePolicyId,
  historicalLampPolicyId,
  lampPolicyIdRequireActive,
  lampPolicyRecord,
  readPolicyIdOf,
  type LampPolicyRecord,
} from "../offchain/src/lampPolicies.js";

/** Khuôn để bịa bản ghi hỏng — sổ thật không có bản hỏng nào, nên nhánh đó phải dựng bằng tay. */
const base: LampPolicyRecord = {
  id: "test-record",
  network: "preprod",
  assetName: "744c414d50",
  policyId: "d9c09230079b810ab5ed92e8db4c190d42efc42db6aac028656f7e07",
  status: "ACTIVE",
  mintParamCount: 14,
  anchor: "oneshot-markers",
  anchorNote: "bản bịa cho bài kiểm",
  supersededBy: null,
  recordedAt: "2026-09-11",
  evidence: [],
  caveats: [],
};

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof LampPolicySourceError) return e.code;
    return `KHÔNG-PHẢI-LampPolicySourceError: ${String(e)}`;
  }
  return "KHÔNG NÉM";
};

// ─── khớp ────────────────────────────────────────────────────────────────────
describe("khớp — bản ACTIVE đọc ra được", () => {
  it("mainnet có đúng một bản ACTIVE và trả về policy id 56 hex", () => {
    const pid = activeLampPolicyId("mainnet");
    expect(pid).toMatch(/^[0-9a-f]{56}$/);
    expect(pid).toBe("55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0");
  });

  it("bản mainnet KHÔNG chép giá trị — nó trỏ về LAMP_MAINNET ở deployed.ts", async () => {
    const { LAMP_MAINNET } = await import("../offchain/src/deployed.js");
    expect(activeLampPolicyId("mainnet")).toBe(LAMP_MAINNET.policyId);
  });

  it("historicalLampPolicyId đọc được bản ĐÃ BỊ THAY khi gọi đích danh", () => {
    expect(historicalLampPolicyId("preprod-native-sig-12param")).toBe(
      "7a1a7aed5ec47acc37b6fa82695c1219bf76895b505b01161367adf9",
    );
  });
});

// ─── lệch ────────────────────────────────────────────────────────────────────
describe("lệch — bản ghi đọc được nhưng không phải thứ bên gọi xin", () => {
  it("xin ACTIVE mà bản ghi SUPERSEDED ⇒ TLAMP-SRC-004, không trả giá trị", () => {
    expect(codeOf(() => lampPolicyIdRequireActive("preprod-native-sig-12param"))).toBe(
      LAMP_POLICY_ERRORS.SUPERSEDED,
    );
  });

  it("thông điệp phải CHỈ RA bản thay thế, không chỉ nói 'đã cũ'", () => {
    let msg = "";
    try {
      lampPolicyIdRequireActive("preprod-oneshot-12param");
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toContain("preprod-oneshot-14param");
  });

  it("PENDING-MINT KHÔNG được gộp vào mã SUPERSEDED — 'chưa có giá trị' khác 'đã bị thay', " +
    "gộp mã là bắt người đọc đi tìm bản thay thế cho thứ chưa từng tồn tại", () => {
    expect(codeOf(() => lampPolicyIdRequireActive("preprod-oneshot-14param"))).toBe(
      LAMP_POLICY_ERRORS.POLICY_ID_EMPTY,
    );
  });
});

// ─── KHÔNG ĐỌC ĐƯỢC ──────────────────────────────────────────────────────────
describe("KHÔNG ĐỌC ĐƯỢC — phải ném, tuyệt đối không trả chuỗi trông hợp lệ", () => {
  it("không có bản ghi mang id đó ⇒ TLAMP-SRC-001", () => {
    expect(codeOf(() => lampPolicyRecord("khong-ton-tai"))).toBe(
      LAMP_POLICY_ERRORS.MISSING_RECORD,
    );
  });

  it("policyId = null (chưa đúc) ⇒ TLAMP-SRC-002", () => {
    expect(codeOf(() => historicalLampPolicyId("preprod-oneshot-14param"))).toBe(
      LAMP_POLICY_ERRORS.POLICY_ID_EMPTY,
    );
  });

  it("policyId là chuỗi rỗng / toàn khoảng trắng ⇒ TLAMP-SRC-002 (không phải 003)", () => {
    expect(codeOf(() => readPolicyIdOf({ ...base, policyId: "" }))).toBe(
      LAMP_POLICY_ERRORS.POLICY_ID_EMPTY,
    );
    expect(codeOf(() => readPolicyIdOf({ ...base, policyId: "   " }))).toBe(
      LAMP_POLICY_ERRORS.POLICY_ID_EMPTY,
    );
  });

  it("policyId sai hình dạng ⇒ TLAMP-SRC-003 (ngắn, dài, hex hoa, ký tự lạ)", () => {
    const malformed = [
      "d9c09230", // cụt
      `${base.policyId}00`, // 58 ký tự
      (base.policyId as string).toUpperCase(), // hex HOA — Cardano dùng hex thường
      "zz".repeat(28), // không phải hex
    ];
    for (const pid of malformed) {
      expect(codeOf(() => readPolicyIdOf({ ...base, policyId: pid }))).toBe(
        LAMP_POLICY_ERRORS.POLICY_ID_MALFORMED,
      );
    }
  });

  it("mạng chưa có bản ACTIVE nào ⇒ TLAMP-SRC-005, KHÔNG rơi ngược về bản SUPERSEDED", () => {
    expect(codeOf(() => activeLampPolicyId("preprod"))).toBe(
      LAMP_POLICY_ERRORS.NO_ACTIVE_RECORD,
    );
    expect(codeOf(() => activeLampPolicyId("preview"))).toBe(
      LAMP_POLICY_ERRORS.NO_ACTIVE_RECORD,
    );
  });

  it("TLAMP-SRC-005 phải NÊU TÊN bản đang chờ đúc — người đọc cần biết chờ cái gì", () => {
    let msg = "";
    try {
      activeLampPolicyId("preprod");
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toContain("preprod-oneshot-14param");
  });

  it("sổ tự mâu thuẫn (2 bản ACTIVE cùng mạng) ⇒ TLAMP-SRC-006, không chọn bừa bản đầu", () => {
    const conflicting: LampPolicyRecord[] = [
      { ...base, id: "a-active" },
      { ...base, id: "b-active", policyId: "7a1a7aed5ec47acc37b6fa82695c1219bf76895b505b01161367adf9" },
    ];
    expect(codeOf(() => selectActivePolicyId(conflicting, "preprod"))).toBe(
      LAMP_POLICY_ERRORS.AMBIGUOUS_ACTIVE,
    );
  });

  it("mạng không có bản ghi nào trong bảng ⇒ TLAMP-SRC-001", () => {
    expect(codeOf(() => selectActivePolicyId([], "preprod"))).toBe(
      LAMP_POLICY_ERRORS.MISSING_RECORD,
    );
  });
});

// ─── bất biến của chính cuốn sổ ──────────────────────────────────────────────
describe("bất biến của sổ", () => {
  it("id là duy nhất — trùng id làm mọi supersededBy trỏ vào chỗ nhập nhằng", () => {
    const ids = LAMP_POLICY_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mọi supersededBy phải trỏ tới một id CÓ THẬT trong sổ", () => {
    const ids = new Set(LAMP_POLICY_REGISTRY.map((r) => r.id));
    for (const r of LAMP_POLICY_REGISTRY) {
      if (r.supersededBy !== null) expect(ids.has(r.supersededBy)).toBe(true);
    }
  });

  it("PENDING-MINT ⇔ policyId null — không được có bản ghi nửa vời", () => {
    for (const r of LAMP_POLICY_REGISTRY) {
      expect(r.policyId === null).toBe(r.status === "PENDING-MINT");
    }
  });

  it("mọi policyId có giá trị đều đúng 56 hex thường", () => {
    for (const r of LAMP_POLICY_REGISTRY) {
      if (r.policyId !== null) expect(r.policyId).toMatch(/^[0-9a-f]{56}$/);
    }
  });

  it("mỗi mạng nhiều nhất MỘT bản ACTIVE", () => {
    for (const net of ["mainnet", "preprod", "preview"] as const) {
      const active = LAMP_POLICY_REGISTRY.filter((r) => r.network === net && r.status === "ACTIVE");
      expect(active.length).toBeLessThanOrEqual(1);
    }
  });

  it("bản SUPERSEDED phải nói nó bị thay bởi ai — im lặng là dạng hỏng tệ nhất", () => {
    for (const r of LAMP_POLICY_REGISTRY) {
      if (r.status === "SUPERSEDED") expect(r.supersededBy).not.toBeNull();
    }
  });

  it("hai bản native-sig của Preprod và Preview TRÙNG policy id — đó là triệu chứng, " +
    "và sổ phải giữ nguyên nó chứ không được 'sửa cho khác nhau'", () => {
    const pre = lampPolicyRecord("preprod-native-sig-12param").policyId;
    const pv = lampPolicyRecord("preview-native-sig-12param").policyId;
    expect(pre).toBe(pv);
  });
});
