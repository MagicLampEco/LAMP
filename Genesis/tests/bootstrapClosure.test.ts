// Công cụ đóng policy LAMP bản mồi (`Genesis/scripts/bootstrap_closure.ts`) — phần thuần.
//
// Bốn chốt được ghim ở đây: cổng Mainnet, phép tái dựng policy-id mainnet từ blueprint đóng băng,
// mã hoá datum SupplyState khớp đúng byte trên chain, và phép tính lượng đúc nốt.
// Bài tái dựng cần `aiken build` trong Genesis/bootstrap-closure/onchain (plutus.json gitignored) —
// thiếu thì bài ĐỎ kèm lời nhắc, không tự bỏ qua.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validatorToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";
import {
  parseArgs, assertNetworkAllowed, parseCaps, frozenCaps, closureDelta, supplyStateFromCbor,
  supplyStateToCbor, readFrozenBlueprint, assertFrozenReproducesMainnet, applyFrozen, mainnetMintParams,
  FROZEN_CONSTANTS_PATH, MAINNET_FLAG,
} from "../scripts/_bootstrapClosure.js";
import { LAMP_MAINNET, type DeployedLamp } from "../offchain/src/deployed.js";

// Datum SupplyState đang nằm trên mainnet tại db0610c2…#0 (koios address_utxos, 2026-09-27).
const MAINNET_SUPPLY_DATUM = "d8799f1b000000e8d4a51000001b005daf6012ba20001b0022366f192fe000ff";

describe("cổng mạng", () => {
  it("--network bắt buộc, lệnh lạ bị từ chối", () => {
    expect(() => parseArgs(["close-mint"])).toThrow(/CLOSE-ARG-003/);
    expect(() => parseArgs(["burn", "--network", "Preprod"])).toThrow(/CLOSE-ARG-001/);
    expect(() => parseArgs(["close-mint", "--network", "Preprod", "--yes"])).toThrow(/CLOSE-ARG-002/);
  });
  it("Mainnet không cờ ⇒ ném; có cờ ⇒ qua", () => {
    for (const c of ["close-mint", "close-lock", "verify-closed"]) {
      expect(() => assertNetworkAllowed(parseArgs([c, "--network", "Mainnet"]))).toThrow(/CLOSE-NET-002/);
      expect(() => assertNetworkAllowed(parseArgs([c, "--network", "Mainnet", MAINNET_FLAG]))).not.toThrow();
    }
  });
  it("bootstrap trên Mainnet bị cấm kể cả có cờ", () => {
    expect(() => assertNetworkAllowed(parseArgs(["bootstrap", "--network", "Mainnet", MAINNET_FLAG]))).toThrow(/CLOSE-NET-001/);
  });
  it("testnet không cần cờ", () => {
    expect(() => assertNetworkAllowed(parseArgs(["bootstrap", "--network", "Preprod"]))).not.toThrow();
  });
});

describe("trần đọc từ mã đóng băng", () => {
  it("khớp hằng 457f312", () => {
    expect(frozenCaps()).toEqual({
      distCap: 26_370_000_000_000_000n, reserveCap: 9_630_000_000_000_000n, totalCap: 36_000_000_000_000_000n,
    });
  });
  it("thiếu hằng ⇒ ném", () => {
    const t = readFileSync(FROZEN_CONSTANTS_PATH, "utf8").replace("pub const dist_cap_oil", "pub const x");
    expect(() => parseCaps(t)).toThrow(/CLOSE-CAP-001/);
  });
  it("dist + reserve ≠ total ⇒ ném", () => {
    const t = readFileSync(FROZEN_CONSTANTS_PATH, "utf8").replace("26_370_000_000_000_000", "26_370_000_000_000_001");
    expect(() => parseCaps(t)).toThrow(/CLOSE-CAP-002/);
  });
});

describe("SupplyState + lượng đúc nốt", () => {
  const caps = frozenCaps();
  it("giải đúng datum mainnet và mã hoá lại ra ĐÚNG byte trên chain", () => {
    const s = supplyStateFromCbor(MAINNET_SUPPLY_DATUM);
    expect(s).toEqual({ distMinted: 1_000_000_000_000n, reserveMinted: 0n, distCap: caps.distCap, reserveCap: caps.reserveCap });
    expect(supplyStateToCbor(s)).toBe(MAINNET_SUPPLY_DATUM);
  });
  it("datum sai hình dạng ⇒ ném", () => {
    expect(() => supplyStateFromCbor("d8799f0102ff")).toThrow(/CLOSE-DATUM-001/);
  });
  it("Δ mainnet = dist_cap − 1e12", () => {
    expect(closureDelta(supplyStateFromCbor(MAINNET_SUPPLY_DATUM), caps)).toBe(26_369_000_000_000_000n);
  });
  it("đã đóng ⇒ ném, trần lệch ⇒ ném", () => {
    const base = supplyStateFromCbor(MAINNET_SUPPLY_DATUM);
    expect(() => closureDelta({ ...base, distMinted: caps.distCap }, caps)).toThrow(/CLOSE-STATE-004/);
    expect(() => closureDelta({ ...base, distCap: caps.distCap + 1n }, caps)).toThrow(/CLOSE-STATE-001/);
    expect(() => closureDelta({ ...base, distMinted: -1n }, caps)).toThrow(/CLOSE-STATE-002/);
  });
});

describe("tái dựng mã mainnet từ blueprint đóng băng", () => {
  const bp = readFrozenBlueprint();
  it("lamp_mint + 8 tham số deployed.ts ⇒ 55d3e01b…", () => {
    expect(assertFrozenReproducesMainnet(bp, LAMP_MAINNET)).toBe("55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0");
  });
  it("lệch một byte tham số ⇒ ném (phép kiểm phân biệt được)", () => {
    const bad: DeployedLamp = {
      ...LAMP_MAINNET,
      mintParams: LAMP_MAINNET.mintParams.map((p) => p.name === "meter_nft_name" ? { ...p, cborHex: "434d4555" } : p),
    };
    expect(() => assertFrozenReproducesMainnet(bp, bad)).toThrow(/CLOSE-REBUILD-001/);
  });
  it("supply_state và dist_treasury ra đúng hash mainnet", () => {
    const p = mainnetMintParams(LAMP_MAINNET);
    const ss = applyFrozen(bp, "supply_state.supply_state.spend", [LAMP_MAINNET.policyId, p.threadNftPolicy, p.tokenName]);
    const kho = applyFrozen(bp, "dist_treasury.dist_treasury.spend", [p.distAuthority[0]]);
    expect(validatorToScriptHash({ type: "PlutusV3", script: ss })).toBe(LAMP_MAINNET.supplyStateHash);
    expect(validatorToScriptHash({ type: "PlutusV3", script: kho })).toBe(LAMP_MAINNET.khoHash);
  });
  it("lock_vault dựng từ blueprint đóng băng ra đúng địa chỉ ghi ở LAMP_MAINNET.closure", () => {
    const lock = applyFrozen(bp, "lock_vault.lock_vault.spend", []);
    expect(validatorToAddress("Mainnet", { type: "PlutusV3", script: lock })).toBe(LAMP_MAINNET.closure!.lockVaultAddress);
  });
});
