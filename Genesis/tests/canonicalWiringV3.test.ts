// Đường genesis CANONICAL (`Genesis/scripts/`) phải dựng lớp Distribution theo đúng v3
// "Capped Drop" mà validator trên nhánh chính đang khai.
//
// VÌ SAO BÀI NÀY TỒN TẠI: validator Distribution lên v3 (PR #90/#91) nhưng đường canonical đứng
// yên ở v2, và không gì trong bộ kiểm cũ kêu:
//   · `treasury.treasury.spend` lên 8 tham số (`beacon_nft_policy` ở khe cuối), `deriveWiring`
//     vẫn áp 7 ⇒ `v2_wiring_dry.ts` ném APPLY-001 — nhưng chỉ ai CHẠY nó mới thấy;
//   · `TreasuryDatum` lên 3 trường (`total_redeemed`), `treasuryDatum()` vẫn gõ tay 2 ⇒ Tx A bị
//     `treasury_nft.ak` từ chối (`expect td: TreasuryDatum = d`);
//   · beacon genesis vẫn mang datum v2 `[epoch, kind, drop_value]` — `beacon_nft.ak` KHÔNG kiểm
//     datum lúc đúc nên Tx A qua, rồi lượt post đầu tiên chết và DROP NFT kẹt tại chỗ.
//
// ⚠ Nhóm bài wiring ĐỌC `Genesis/onchain/plutus.json` + `Distribution/onchain/plutus.json` —
// artefact `aiken build`, bị .gitignore. Thiếu thì nhóm đó ĐỎ với câu "KHÔNG ĐO ĐƯỢC", không
// bỏ qua rồi báo xanh.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Data, applyParamsToScript, validatorToScriptHash, type Validator,
} from "@lucid-evolution/lucid";
import {
  deriveWiring, treasuryDatum, genesisBeaconDatum,
  canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, MS_PER_EPOCH,
} from "../scripts/_canonical_v2.js";
import {
  decodeTreasuryDatum, decodeBeaconDatum, treasuryDatumToCbor,
} from "../../Distribution/offchain/src/datum.js";
import {
  RATE_ROOT_GENESIS, RATE_ROOT_MIN, RATE_ROOT_MAX, TRIM_NUM_GENESIS, TRIM_DEN_GENESIS,
} from "../../Distribution/offchain/src/constants.js";
import { planBeacon } from "../../Distribution/scripts/e2ePlan.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GENESIS_BP = resolve(ROOT, "Genesis/onchain/plutus.json");
const DIST_BP = resolve(ROOT, "Distribution/onchain/plutus.json");
const haveBlueprints = existsSync(GENESIS_BP) && existsSync(DIST_BP);

// Giá trị MẪU, cùng bộ với `v2_wiring_dry.ts` — hình dạng đúng, không phải hạt giống thật.
const SAMPLE_TX = "0".repeat(63) + "1";
const SAMPLE_PKH = "0".repeat(55) + "1";
const SAMPLE_RESERVE_KHO_PID = "0".repeat(55) + "2";
const RESERVE_KHO_NAME = "6c616d702d72657365727665"; // "lamp-reserve"
const TOKEN_NAME = "744c414d50";                      // "tLAMP"
const HEX56 = /^[0-9a-f]{56}$/;

function sampleWiring() {
  return deriveWiring({
    genesisTxHash: SAMPLE_TX, genesisIndex: 0, pkh: SAMPLE_PKH, tokenName: TOKEN_NAME,
    reserveKhoPid: SAMPLE_RESERVE_KHO_PID, reserveKhoName: RESERVE_KHO_NAME,
    network: "Preprod",
  });
}

interface BpValidator { title: string; compiledCode: string; parameters?: { title: string }[] }
const distValidators = (): BpValidator[] =>
  (JSON.parse(readFileSync(DIST_BP, "utf8")) as { validators: BpValidator[] }).validators;

function requireBlueprints(): void {
  if (!haveBlueprints) {
    throw new Error(
      `KHÔNG ĐO ĐƯỢC: thiếu ${existsSync(GENESIS_BP) ? "" : GENESIS_BP + " "}` +
      `${existsSync(DIST_BP) ? "" : DIST_BP} — chạy 'aiken build' trong Genesis/onchain và ` +
      `Distribution/onchain rồi chạy lại.`,
    );
  }
}

describe("deriveWiring — lớp Distribution v3", () => {
  it("không ném (cổng APPLY-001/002 im) và mọi hash là 56 hex", async () => {
    requireBlueprints();
    const { wiring } = await sampleWiring();
    expect(wiring.treHash).toMatch(HEX56);
    expect(wiring.claimHash).toMatch(HEX56);
    expect(wiring.beaconHash).toMatch(HEX56);
    expect(wiring.accountPid).toMatch(HEX56);
    expect(wiring.markers.beaconPid).toMatch(HEX56);
  });

  // Phép dựng lại ĐỘC LẬP: áp tham số theo TÊN mà blueprint khai, không theo mảng mà
  // `deriveWiring` gõ. Sai THỨ TỰ hai tham số cùng kiểu (vd hoán `beacon_nft_policy` với
  // `account_nft_policy`) không làm cổng đếm-số APPLY-001 kêu — nhưng làm hash lệch ở đây.
  it("hash treasury / claim_account / beacon khớp phép áp tham số theo TÊN blueprint", async () => {
    requireBlueprints();
    const { wiring } = await sampleWiring();
    const byName: Record<string, unknown> = {
      committee: canonicalCommittee(SAMPLE_PKH),
      threshold: CANONICAL_COMMITTEE_THRESHOLD,
      ms_per_epoch: MS_PER_EPOCH,
      lamp_policy: wiring.lampPid,
      lamp_name: TOKEN_NAME,
      beacon_nft_policy: wiring.markers.beaconPid,
      treasury_nft_policy: wiring.markers.khoPid,
      account_nft_policy: wiring.accountPid,
      claim_account_hash: wiring.claimHash,
    };
    const vs = distValidators();
    const rebuild = (title: string): string => {
      const v = vs.find((x) => x.title === title);
      if (!v || !Array.isArray(v.parameters)) throw new Error(`blueprint thiếu '${title}'`);
      const params = v.parameters.map((p) => {
        if (!(p.title in byName)) throw new Error(`'${title}' khai tham số lạ '${p.title}'`);
        return byName[p.title];
      });
      return validatorToScriptHash({
        type: "PlutusV3", script: applyParamsToScript(v.compiledCode, params as never),
      } as Validator);
    };
    expect(rebuild("treasury.treasury.spend")).toBe(wiring.treHash);
    expect(rebuild("claim_account.claim_account.spend")).toBe(wiring.claimHash);
    expect(rebuild("beacon.beacon.spend")).toBe(wiring.beaconHash);
  });

  it("treasury v3 khai 8 tham số, beacon_nft_policy ở KHE CUỐI", () => {
    requireBlueprints();
    const t = distValidators().find((x) => x.title === "treasury.treasury.spend");
    const names = (t?.parameters ?? []).map((p) => p.title);
    expect(names).toHaveLength(8);
    expect(names[7]).toBe("beacon_nft_policy");
  });
});

describe("treasuryDatum — TreasuryDatum v3 (3 trường)", () => {
  it("giải mã được bằng decoder SDK, mở sổ với nợ 0 và total_redeemed 0", () => {
    const d = decodeTreasuryDatum(Data.from(treasuryDatum(SAMPLE_PKH)));
    expect(d.committee_hash).toBe(SAMPLE_PKH);
    expect(d.outstanding_entitlement).toBe(0n);
    expect(d.total_redeemed).toBe(0n);
  });

  it("trùng từng byte với treasuryDatumToCbor của SDK", () => {
    expect(treasuryDatum(SAMPLE_PKH)).toBe(treasuryDatumToCbor({
      committee_hash: SAMPLE_PKH, outstanding_entitlement: 0n, total_redeemed: 0n,
    }));
  });
});

describe("genesisBeaconDatum — BeaconDatum v3 lúc sinh", () => {
  const EPOCH = 4_200n;

  it("giải mã được bằng decoder SDK v3, đúng giá trị genesis của 03_genesis.ts", () => {
    const b = decodeBeaconDatum(Data.from(genesisBeaconDatum(EPOCH)));
    expect(b).toEqual({
      epoch: EPOCH, kind: "DropParam", index: 0n, rate_root: RATE_ROOT_GENESIS,
      trim_num: TRIM_NUM_GENESIS, trim_den: TRIM_DEN_GENESIS, speed_policies: [],
    });
    // C-BCN-5b: w ngoài biên thì lượt post đầu không có đường hợp lệ nào.
    expect(b.rate_root >= RATE_ROOT_MIN && b.rate_root <= RATE_ROOT_MAX).toBe(true);
  });

  it("lượt post đầu tiên có đường hợp lệ: chỉ số mới = w · Δepoch (C-BCN-6)", () => {
    const b = decodeBeaconDatum(Data.from(genesisBeaconDatum(EPOCH)));
    const plan = planBeacon({
      onChain: b, window: { loMs: 0n, hiMs: 0n, epoch: EPOCH + 1n },
      rateRoot: RATE_ROOT_GENESIS, msPerEpoch: MS_PER_EPOCH,
    });
    expect(plan.action).toBe("post");
    if (plan.action === "post") expect(plan.params.newBeacon.index).toBe(RATE_ROOT_GENESIS);
  });
});

// `28_beacon_grant_redeem.ts` gọi `main()` ngay khi import (cần ví + mạng), nên không nạp được
// trong bài kiểm. Hai phép thay thế rẻ: (1) soi mã (đã bỏ chú thích) không còn khái niệm v2;
// (2) mọi tên nó import từ Distribution PHẢI là export có thật — đúng lớp lỗi đã làm nó gãy
// (`D_GENESIS` bị gỡ khỏi SDK mà tệp vẫn import).
describe("28_beacon_grant_redeem.ts + 20_canonical_genesis.ts — không còn ngữ nghĩa v2", () => {
  const SCRIPTS = resolve(ROOT, "Genesis/scripts");
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const file of ["28_beacon_grant_redeem.ts", "20_canonical_genesis.ts"]) {
    it(`${file}: mã không còn D_GENESIS / drop_value / currentDropValue`, () => {
      const code = stripComments(readFileSync(resolve(SCRIPTS, file), "utf8"));
      expect(code).not.toMatch(/\bD_GENESIS\b/);
      expect(code).not.toMatch(/\bdrop_value\b/);
      expect(code).not.toMatch(/\bcurrentDropValue\b/);
    });
  }

  {
    const file = "28_beacon_grant_redeem.ts";
    it(`${file}: mọi tên import từ Distribution là export có thật`, async () => {
      const src = readFileSync(resolve(SCRIPTS, file), "utf8");
      const re = /import\s*\{([^}]*)\}\s*from\s*"(\.\.\/\.\.\/Distribution\/[^"]+)"/g;
      const checked: string[] = [];
      for (const m of src.matchAll(re)) {
        const mod = (await import(resolve(SCRIPTS, m[2]!))) as Record<string, unknown>;
        for (const raw of m[1]!.split(",")) {
          const name = raw.trim().split(/\s+as\s+/)[0]!.trim();
          if (!name || name.startsWith("type ")) continue;
          expect(mod[name], `${m[2]} ▸ ${name}`).toBeDefined();
          checked.push(name);
        }
      }
      // Tệp nào cũng import ít nhất một tên — 0 nghĩa là regex hụt, không phải "sạch".
      expect(checked.length).toBeGreaterThan(0);
    });
  }

  it("28: mọi lượt buildClaimTx mang beacon làm reference input (C-CLAIM-8)", () => {
    const code = stripComments(readFileSync(resolve(SCRIPTS, "28_beacon_grant_redeem.ts"), "utf8"));
    const calls = code.split("buildClaimTx(").length - 1;
    const withBeacon = (code.match(/beacon:\s*\{\s*utxo:\s*beaconUtxo,\s*datum:\s*beaconLive\s*\}/g) ?? []).length;
    expect(calls).toBe(2);
    expect(withBeacon).toBe(calls);
  });
});
