// Tệp định danh deploy `deployments/<mạng>.json` — bài kiểm cho bộ sinh + bộ kiểm.
//
// Mỗi ca âm tính (đột biến ⇒ NÉM đúng mã) đi kèm đối chứng dương: CÙNG đầu vào bỏ đột biến thì qua.
// Không có đối chứng, một ca âm tính xanh không phân biệt được "chốt bắt đúng" với "đầu vào hỏng
// từ trước vì lý do khác".

import { describe, it, expect, beforeAll } from "vitest";
import { getAddressDetails } from "@lucid-evolution/lucid";
import {
  DEPLOYMENTS_NETWORKS,
  DEPLOYMENT_ROLES,
  DEPLOYMENT_STATUSES,
  DEPLOY_MANIFEST_ERRORS,
  DeploymentsManifestError,
  MANIFEST_KEYS,
  CLOCK_KEYS,
  RECORD_KEYS,
  buildDeployments,
  decodeShelleyAddress,
  parsePreprodWiring,
  serializeDeployments,
  validateDeployments,
  type DeploymentRecord,
  type DeploymentsManifest,
} from "../offchain/src/deploymentsManifest.js";
import { activeLampPolicyId, LAMP_POLICY_REGISTRY } from "../offchain/src/lampPolicies.js";
import { LAMP_MAINNET } from "../offchain/src/deployed.js";

/** Gốc kho, tương đối theo cwd của vitest = `Genesis/offchain` (nơi có vitest.config) — cùng quy ước
 *  với `envGuards.test.ts`. Sai đường thì `readFileSync` ném ENOENT: đỏ ồn ào, không xanh im lặng. */
const REPO = "../..";

/** `node:fs` nạp ĐỘNG qua một chuỗi kiểu `string`: tsconfig của offchain không nạp @types/node, nên
 *  import tĩnh `node:fs` / `node:path` / `import.meta.url` chỉ thêm lỗi cho `tsc --noEmit` (đúng loại
 *  lỗi các tệp kiểm cũ đang mang). Kiểu khai tay dưới đây là phần duy nhất tệp này dùng. */
type NodeFs = { readFileSync(p: string, enc: "utf8"): string; existsSync(p: string): boolean };
const NODE_FS: string = "node:fs";
let fs: NodeFs;
beforeAll(async () => {
  fs = (await import(NODE_FS)) as NodeFs;
});

const committedText = (net: string): string => fs.readFileSync(`${REPO}/deployments/${net}.json`, "utf8");
const committed = (net: string): DeploymentsManifest => JSON.parse(committedText(net)) as DeploymentsManifest;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DeploymentsManifestError) return e.code;
    return `KHÔNG-PHẢI-DeploymentsManifestError: ${String(e)}`;
  }
  return "KHÔNG NÉM";
};

const byId = (m: DeploymentsManifest, id: string): DeploymentRecord => {
  const r = m.records.find((x) => x.id === id);
  if (r === undefined) throw new Error(`bài kiểm: không có bản ghi ${id}`);
  return r;
};
const sortRecords = (m: DeploymentsManifest): void => {
  m.records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

const PREPROD_CLUSTER = "preprod-oneshot-14param-final";

// ─── (1) đầu ra sinh trùng byte tệp commit ────────────────────────────────────
describe("(1) tệp commit = đầu ra sinh, từng byte", () => {
  for (const net of DEPLOYMENTS_NETWORKS) {
    it(`${net}.json khớp buildDeployments("${net}")`, () => {
      expect(serializeDeployments(buildDeployments(net))).toBe(committedText(net));
    });
  }
  it("sinh hai lần ra cùng byte (không có trường thời gian / thứ tự ngẫu nhiên)", () => {
    for (const net of DEPLOYMENTS_NETWORKS) {
      expect(serializeDeployments(buildDeployments(net))).toBe(serializeDeployments(buildDeployments(net)));
    }
  });
});

// ─── (2) khớp luật schema ────────────────────────────────────────────────────
describe("(2) schema", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadSchema = (): any => JSON.parse(fs.readFileSync(`${REPO}/deployments/schema.json`, "utf8"));

  it("tệp commit qua validateDeployments", () => {
    for (const net of DEPLOYMENTS_NETWORKS) expect(() => validateDeployments(committed(net))).not.toThrow();
  });
  it("schema.json và mã cùng một tập role / status / khoá (chống lệch hai nơi)", () => {
    const schema = loadSchema();
    const recordSchema = schema.$defs.record;
    expect(recordSchema.properties.role.enum).toEqual([...DEPLOYMENT_ROLES]);
    expect(recordSchema.properties.status.enum).toEqual([...DEPLOYMENT_STATUSES]);
    expect(schema.required).toEqual([...MANIFEST_KEYS]);
    expect(schema.properties.clock.required).toEqual([...CLOCK_KEYS]);
    expect(recordSchema.required).toEqual(RECORD_KEYS.filter((k) => k !== "mintClosed"));
    expect(Object.keys(recordSchema.properties)).toEqual([...RECORD_KEYS]);
    expect(schema.properties.network.enum).toEqual([...DEPLOYMENTS_NETWORKS].sort());
  });
  it("additionalProperties: false ở gốc, clock, record", () => {
    const schema = loadSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.clock.additionalProperties).toBe(false);
    expect(schema.$defs.record.additionalProperties).toBe(false);
  });
  it("khoá lạ ⇒ 001; đối chứng: bỏ khoá lạ thì qua", () => {
    const m = clone(committed("preprod"));
    expect(() => validateDeployments(m)).not.toThrow();
    (m.records[0] as unknown as Record<string, unknown>).extra = "x";
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.SHAPE);
  });
  it("mọi evidence file: trỏ tệp có thật trong kho", () => {
    for (const net of DEPLOYMENTS_NETWORKS) {
      for (const r of committed(net).records) {
        for (const ev of r.evidence.filter((e) => e.startsWith("file:"))) {
          expect(fs.existsSync(`${REPO}/${ev.slice(5)}`), `${r.id}: ${ev}`).toBe(true);
        }
      }
    }
  });
});

// ─── (3) bech32 ↔ scriptHash ─────────────────────────────────────────────────
describe("(3) địa chỉ giải ra payment credential == scriptHash", () => {
  it("bộ giải riêng và lucid (getAddressDetails) cho cùng credential, và == scriptHash khi có", () => {
    let both = 0;
    for (const net of DEPLOYMENTS_NETWORKS) {
      for (const r of committed(net).records) {
        if (r.address === null) continue;
        const mine = decodeShelleyAddress(r.address);
        const lucid = getAddressDetails(r.address);
        expect(lucid.paymentCredential?.type, r.id).toBe("Script");
        expect(mine.paymentCredential, r.id).toBe(lucid.paymentCredential?.hash);
        expect(mine.hrp === "addr_test", r.id).toBe(net !== "mainnet");
        if (r.scriptHash !== null) {
          expect(mine.paymentCredential, r.id).toBe(r.scriptHash);
          both++;
        }
      }
    }
    // mainnet 2 (supply-state, distribution-treasury) + preprod 6 (supply-state, registry,
    // distribution-treasury, beacon, governance-pointer, treasury-custody)
    expect(both).toBe(8);
  });
  it("vector độc lập: LAMP_MAINNET.supplyStateAddress ↔ supplyStateHash", () => {
    expect(decodeShelleyAddress(LAMP_MAINNET.supplyStateAddress).paymentCredential).toBe(LAMP_MAINNET.supplyStateHash);
  });
});

// ─── (4) ≤ 1 ACTIVE mỗi (role, cluster) ──────────────────────────────────────
describe("(4) ≤1 ACTIVE mỗi (role, cluster)", () => {
  it("tệp commit", () => {
    for (const net of DEPLOYMENTS_NETWORKS) {
      const seen = new Set<string>();
      for (const r of committed(net).records.filter((x) => x.status === "ACTIVE")) {
        const k = `${r.role}|${r.cluster}`;
        expect(seen.has(k), `${net}: ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });
});

// ─── (5) supersededBy không treo, không vòng ─────────────────────────────────
describe("(5) chuỗi supersededBy", () => {
  it("tệp commit: mọi đích có thật, cùng role, chuỗi kết thúc ở bản không bị thay", () => {
    for (const net of DEPLOYMENTS_NETWORKS) {
      const m = committed(net);
      const ids = new Map(m.records.map((r) => [r.id, r]));
      for (const r of m.records) {
        let cur = r;
        const path = [cur.id];
        while (cur.supersededBy !== null) {
          const next = ids.get(cur.supersededBy);
          expect(next, `${net}: ${cur.id} → ${cur.supersededBy}`).toBeDefined();
          expect(next!.role).toBe(cur.role);
          expect(path.includes(next!.id), `vòng: ${path.join(" → ")}`).toBe(false);
          path.push(next!.id);
          cur = next!;
        }
        expect(cur.status === "SUPERSEDED").toBe(false);
      }
    }
  });
  it("preprod: chuỗi lamp-token đi từ native-sig tới bản ACTIVE", () => {
    const m = committed("preprod");
    let cur = byId(m, "preprod-native-sig-12param/lamp-token");
    const path = [cur.id];
    while (cur.supersededBy !== null) {
      cur = byId(m, cur.supersededBy);
      path.push(cur.id);
    }
    expect(path).toEqual([
      "preprod-native-sig-12param/lamp-token",
      "preprod-oneshot-12param/lamp-token",
      "preprod-oneshot-14param/lamp-token",
      "preprod-oneshot-14param-v3/lamp-token",
      "preprod-oneshot-14param-v4/lamp-token",
      `${PREPROD_CLUSTER}/lamp-token`,
    ]);
    expect(cur.status).toBe("ACTIVE");
  });
  it("đích treo ⇒ 002; đối chứng: đích có thật thì qua", () => {
    const m = clone(committed("preprod"));
    expect(() => validateDeployments(m)).not.toThrow();
    byId(m, "preprod-oneshot-14param-v4/lamp-token").supersededBy = "preprod-khong-co/lamp-token";
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.SUPERSEDE);
  });
  it("vòng ⇒ 002; đối chứng: bỏ vòng thì qua", () => {
    const m = clone(committed("preprod"));
    expect(() => validateDeployments(m)).not.toThrow();
    const fin = byId(m, `${PREPROD_CLUSTER}/lamp-token`);
    // bản ACTIVE đổi thành SUPERSEDED trỏ ngược về v4 ⇒ v4 → final → v4
    fin.status = "SUPERSEDED";
    fin.supersededBy = "preprod-oneshot-14param-v4/lamp-token";
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.SUPERSEDE);
  });
  it("SUPERSEDED mà supersededBy null ⇒ 002; đối chứng: trạng thái ACTIVE với null thì qua", () => {
    const m = clone(committed("mainnet"));
    expect(() => validateDeployments(m)).not.toThrow();
    byId(m, "mainnet-baked-pkh-8param/supply-state").status = "SUPERSEDED";
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.SUPERSEDE);
  });
});

// ─── (6) lamp-token ACTIVE == sổ policy ──────────────────────────────────────
describe("(6) lamp-token ACTIVE == activeLampPolicyId", () => {
  it("mainnet + preprod: đúng một bản, đúng giá trị; preview: không bản nào (sổ chưa có ACTIVE)", () => {
    for (const net of DEPLOYMENTS_NETWORKS) {
      const act = committed(net).records.filter((r) => r.role === "lamp-token" && r.status === "ACTIVE");
      const hasActive = LAMP_POLICY_REGISTRY.some((r) => r.network === net && r.status === "ACTIVE");
      if (hasActive) {
        expect(act.map((r) => r.policyId)).toEqual([activeLampPolicyId(net)]);
      } else {
        expect(act).toEqual([]);
      }
    }
    expect(LAMP_POLICY_REGISTRY.some((r) => r.network === "preview" && r.status === "ACTIVE")).toBe(false);
  });
  it("mainnet lamp-token mang mintClosed: true vì LAMP_MAINNET.closure có mặt", () => {
    expect(LAMP_MAINNET.closure).toBeDefined();
    expect(byId(committed("mainnet"), "mainnet-baked-pkh-8param/lamp-token").mintClosed).toBe(true);
  });
  it("policy ACTIVE lệch sổ ⇒ 007; đối chứng: giá trị sổ thì qua", () => {
    const m = clone(committed("preprod"));
    expect(() => validateDeployments(m)).not.toThrow();
    byId(m, `${PREPROD_CLUSTER}/lamp-token`).policyId = "53bc12ade5ee24d43750b9560f152a54b48b804fab34dab810fb8743";
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.LAMP_REGISTRY_MISMATCH);
  });
  it("gỡ mintClosed khỏi mainnet ⇒ 007; đối chứng: giữ nguyên thì qua", () => {
    const m = clone(committed("mainnet"));
    expect(() => validateDeployments(m)).not.toThrow();
    delete byId(m, "mainnet-baked-pkh-8param/lamp-token").mintClosed;
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.LAMP_REGISTRY_MISMATCH);
  });
});

// ─── (7) đột biến bắt buộc ───────────────────────────────────────────────────
describe("(7) đột biến ⇒ validateDeployments NÉM đúng mã", () => {
  it("thêm một ACTIVE trùng (role, cluster) ⇒ 006; đối chứng: bản thêm mang cluster khác thì qua", () => {
    const base = clone(committed("preprod"));
    const dup = { ...clone(byId(base, `${PREPROD_CLUSTER}/supply-state`)), id: `${PREPROD_CLUSTER}/supply-state-2` };

    const control = clone(base);
    control.records.push({ ...clone(dup), cluster: "preprod-other-cluster" });
    sortRecords(control);
    expect(() => validateDeployments(control)).not.toThrow();

    const mutant = clone(base);
    mutant.records.push(clone(dup));
    sortRecords(mutant);
    expect(codeOf(() => validateDeployments(mutant))).toBe(DEPLOY_MANIFEST_ERRORS.DUPLICATE_ACTIVE);
  });

  it("sửa MỘT ký tự address ⇒ 004 (checksum); đối chứng: address gốc thì qua", () => {
    const m = clone(committed("preprod"));
    const r = byId(m, `${PREPROD_CLUSTER}/supply-state`);
    expect(() => validateDeployments(m)).not.toThrow();
    const a = r.address!;
    const last = a[a.length - 1]!;
    r.address = a.slice(0, -1) + (last === "q" ? "p" : "q");
    expect(r.address).not.toBe(a);
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID);
  });

  it("address hợp lệ của script KHÁC ⇒ 005; đối chứng: address đúng thì qua", () => {
    const m = clone(committed("preprod"));
    expect(() => validateDeployments(m)).not.toThrow();
    const beaconAddr = byId(m, `${PREPROD_CLUSTER}/beacon`).address;
    byId(m, `${PREPROD_CLUSTER}/supply-state`).address = beaconAddr;
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.ADDRESS_HASH_MISMATCH);
  });

  it("address mainnet trong tệp preprod ⇒ 004; đối chứng: address testnet thì qua", () => {
    const m = clone(committed("preprod"));
    expect(() => validateDeployments(m)).not.toThrow();
    const r = byId(m, `${PREPROD_CLUSTER}/supply-state`);
    r.address = LAMP_MAINNET.supplyStateAddress;
    r.scriptHash = LAMP_MAINNET.supplyStateHash;
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.ADDRESS_INVALID);
  });

  it("PENDING mang hash ⇒ 003; đối chứng: PENDING với policyId null thì qua", () => {
    const m = clone(committed("preview"));
    const p = byId(m, "preview-oneshot-14param/lamp-token");
    expect(p.status).toBe("PENDING");
    expect(() => validateDeployments(m)).not.toThrow();
    p.policyId = "493002cc03004e3e14fd607cfba59312bd946e478e69d6ab431ccfac";
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.PENDING_HAS_ID);
  });

  it("records không sắp theo id ⇒ 008; đối chứng: sắp lại thì qua", () => {
    const m = clone(committed("mainnet"));
    m.records.reverse();
    expect(codeOf(() => validateDeployments(m))).toBe(DEPLOY_MANIFEST_ERRORS.ID_ORDER);
    sortRecords(m);
    expect(() => validateDeployments(m)).not.toThrow();
  });
});

// ─── nguồn wiring: hình dạng lạ ⇒ NÉM ────────────────────────────────────────
describe("nguồn wiring Preprod", () => {
  const rawText = (): string => fs.readFileSync(`${REPO}/Genesis/deployed/${PREPROD_CLUSTER}.wiring.json`, "utf8");
  it("tệp nguồn qua parsePreprodWiring", () => {
    expect(() => parsePreprodWiring(JSON.parse(rawText()))).not.toThrow();
  });
  it("policy marker sai hình dạng ⇒ 010; đối chứng ở ca trên", () => {
    const bad = JSON.parse(rawText());
    bad.markers.threadPid = "XYZ";
    expect(codeOf(() => parsePreprodWiring(bad))).toBe(DEPLOY_MANIFEST_ERRORS.SOURCE_INVALID);
  });
  it("không chứa trường trạng thái sống / khoá vận hành trần (minted, floorOildrop, custodyRef, pkh)", () => {
    const text = rawText();
    for (const k of ["\"minted\"", "\"floorOildrop\"", "\"custodyRef\"", "\"pkh\""]) expect(text).not.toContain(k);
  });
});
