// F1 đóng ở lượt genesis — phần THUẦN (`scripts/_genesisReservePlacement.ts`) và ba cổng đọc env
// mà đường mới đòi (`scripts/_reserve_layer2.ts`).
//
// F1: METER ở ví sau genesis + hạt giống custody ở cùng khoá ⇒ hai giao dịch rút trọn 9,63 tỷ
// Reserve về một script tuỳ chọn. Đường mới: Tx A0 đúc custody NFT vào instance thật (riêng vì
// `custody_seed.ak` S-MINT-2), Tx A đúc METER thẳng vào `reserve_draw` và auth vào `reserve_gate`.
//
// Mỗi ca âm dưới đây được dựng để PHÂN BIỆT hai bên đột biến: cùng một bộ output, chỉ đổi ĐÚNG
// một chỗ (địa chỉ của METER: script ↔ ví). Ca dương dùng nguyên bộ đó — nên gỡ phép kiểm ví
// trong `assertMarkerPlacement` thì ca "METER về ví" chuyển xanh, và ngược lại.
import { describe, it, expect } from "vitest";
import {
  credentialToAddress, keyHashToCredential, scriptHashToCredential,
} from "@lucid-evolution/lucid";
import {
  assertMarkerPlacement, assertReserveTotalMatchesCap, assertTxKeepsSeed, overLimits,
  paymentKind, txA0MarkerTargets, txAMarkerTargets, txPMarkerTargets, type PlacedOutput,
} from "../scripts/_genesisReservePlacement.js";
import * as L2 from "../scripts/_reserve_layer2.js";
import {
  DECIDED_FLOOR_OILDROP, RESERVE_FLOOR_ENV, carpAssetFromEnv,
  reserveFloorFromEnv, pointerSeedRefFromEnv, pointerDelayFromEnv, assertPointerSeedDistinct,
  POINTER_DELAY_ENV, POINTER_DELAY_PREPROD_MS, POINTER_DELAY_MAINNET_MS,
} from "../scripts/_reserve_layer2.js";

const scriptAddr = (b: string) => credentialToAddress("Preprod", scriptHashToCredential(b.repeat(28)));
const vkAddr = (b: string) => credentialToAddress("Preprod", keyHashToCredential(b.repeat(28)));

const ADDR = {
  ss: scriptAddr("11"), reg: scriptAddr("12"), tre: scriptAddr("13"), bcn: scriptAddr("14"),
  draw: scriptAddr("15"), gate: scriptAddr("16"), custody: scriptAddr("17"),
  wallet: vkAddr("60"),
};
const unit = (pidByte: string, name: string) => pidByte.repeat(28) + name;
const U = {
  thread: unit("a1", "535550504c59"), reg: unit("a2", "5245474953545259"),
  kho: unit("a3", "5452454153555259"), drop: unit("a4", "44524f50"),
  met: unit("a5", "4d45544552"), auth: unit("a6", "545245415355525950554c4c"),
  custody: unit("a7", "6c616d702d72657365727665"),
};

const targets = txAMarkerTargets({
  threadUnit: U.thread, ssAddr: ADDR.ss, regUnit: U.reg, regAddr: ADDR.reg,
  khoUnit: U.kho, treAddr: ADDR.tre, dropUnit: U.drop, beaconAddr: ADDR.bcn,
  metUnit: U.met, drawAddr: ADDR.draw, authUnit: U.auth, gateAddr: ADDR.gate,
});

/** Bộ output đúng của Tx A, kèm một output tiền thối về ví (chỉ lovelace). */
function goodTxA(over: Partial<Record<keyof typeof U, string>> = {}): PlacedOutput[] {
  const at = (k: keyof typeof U, d: string) => over[k] ?? d;
  return [
    { address: at("thread", ADDR.ss), assets: { lovelace: 2_000_000n, [U.thread]: 1n } },
    { address: at("reg", ADDR.reg), assets: { lovelace: 2_000_000n, [U.reg]: 1n } },
    { address: at("kho", ADDR.tre), assets: { lovelace: 2_000_000n, [U.kho]: 1n } },
    { address: at("met", ADDR.draw), assets: { lovelace: 2_000_000n, [U.met]: 1n } },
    { address: at("auth", ADDR.gate), assets: { lovelace: 2_000_000n, [U.auth]: 1n } },
    { address: at("drop", ADDR.bcn), assets: { lovelace: 2_000_000n, [U.drop]: 1n } },
    { address: ADDR.wallet, assets: { lovelace: 4_000_000_000n } },
  ];
}

describe("txAMarkerTargets — đích của sáu marker", () => {
  it("METER → reserve_draw, auth → reserve_gate; không đích nào là ví", () => {
    const byUnit = Object.fromEntries(targets.map((t) => [t.unit, t.address]));
    expect(byUnit[U.met]).toBe(ADDR.draw);
    expect(byUnit[U.auth]).toBe(ADDR.gate);
    expect(targets).toHaveLength(6);
    for (const t of targets) expect(paymentKind(t.address)).toBe("Script");
  });

  it("Tx A0: custody NFT → instance custody", () => {
    expect(txA0MarkerTargets(U.custody, ADDR.custody)).toEqual([
      expect.objectContaining({ unit: U.custody, address: ADDR.custody }),
    ]);
  });
});

describe("assertMarkerPlacement — cổng F1-PLACE trên output đã dựng", () => {
  it("bộ đúng: qua (tiền thối thuần ADA về ví là hợp lệ)", () => {
    expect(() => assertMarkerPlacement(goodTxA(), targets, "Tx A")).not.toThrow();
  });

  it("METER về VÍ (đúng hình dạng F1 của bản cũ) ⇒ F1-PLACE-003", () => {
    expect(() => assertMarkerPlacement(goodTxA({ met: ADDR.wallet }), targets, "Tx A"))
      .toThrow(/F1-PLACE-003/);
  });

  it("BẤT KỲ marker nào về ví ⇒ F1-PLACE-003 (auth, REGISTRY, custody)", () => {
    expect(() => assertMarkerPlacement(goodTxA({ auth: ADDR.wallet }), targets, "Tx A"))
      .toThrow(/F1-PLACE-003/);
    expect(() => assertMarkerPlacement(goodTxA({ reg: ADDR.wallet }), targets, "Tx A"))
      .toThrow(/F1-PLACE-003/);
    expect(() => assertMarkerPlacement(
      [{ address: ADDR.wallet, assets: { lovelace: 2_000_000n, [U.custody]: 1n } }],
      txA0MarkerTargets(U.custody, ADDR.custody), "Tx A0",
    )).toThrow(/F1-PLACE-003/);
  });

  it("token lạ cùng POLICY với marker mà về ví ⇒ F1-PLACE-003 (đo theo policy, không theo unit)", () => {
    const outs = goodTxA();
    outs[6] = { address: ADDR.wallet, assets: { lovelace: 1n, [U.met.slice(0, 56) + "ff"]: 1n } };
    expect(() => assertMarkerPlacement(outs, targets, "Tx A")).toThrow(/F1-PLACE-003/);
  });

  it("METER ở một SCRIPT khác reserve_draw ⇒ F1-PLACE-002", () => {
    expect(() => assertMarkerPlacement(goodTxA({ met: scriptAddr("99") }), targets, "Tx A"))
      .toThrow(/F1-PLACE-002/);
  });

  it("kế hoạch khai đích là ví ⇒ F1-PLACE-001, kể cả khi output khớp kế hoạch", () => {
    const bad = targets.map((t) => (t.unit === U.met ? { ...t, address: ADDR.wallet } : t));
    expect(() => assertMarkerPlacement(goodTxA({ met: ADDR.wallet }), bad, "Tx A"))
      .toThrow(/F1-PLACE-001/);
  });

  it("thiếu marker hoặc thừa bản ⇒ F1-PLACE-004", () => {
    const missing = goodTxA().filter((o) => !(U.met in o.assets));
    expect(() => assertMarkerPlacement(missing, targets, "Tx A")).toThrow(/F1-PLACE-004/);
    const dup = [...goodTxA(), { address: ADDR.draw, assets: { lovelace: 2_000_000n, [U.met]: 1n } }];
    expect(() => assertMarkerPlacement(dup, targets, "Tx A")).toThrow(/F1-PLACE-004/);
  });

  it("không có output ⇒ F1-PLACE-005 (mù, không phải sạch)", () => {
    expect(() => assertMarkerPlacement([], targets, "Tx A")).toThrow(/F1-PLACE-005/);
  });

  it("địa chỉ không đọc được ⇒ F1-PLACE-000", () => {
    expect(() => paymentKind("khong-phai-dia-chi")).toThrow(/F1-PLACE-000/);
  });
});

describe("assertTxKeepsSeed — Tx A0 không được tiêu hạt giống genesis", () => {
  const G = "ab".repeat(32) + "#0";
  it("không chạm ⇒ qua", () => {
    expect(() => assertTxKeepsSeed(["cd".repeat(32) + "#1"], [], G, "hạt giống genesis", "Tx A0")).not.toThrow();
  });
  it("ở input ⇒ F1-SEED-001", () => {
    expect(() => assertTxKeepsSeed([G], [], G, "hạt giống genesis", "Tx A0")).toThrow(/F1-SEED-001.*input/);
  });
  it("ở collateral ⇒ F1-SEED-001", () => {
    expect(() => assertTxKeepsSeed(["cd".repeat(32) + "#1"], [G], G, "hạt giống genesis", "Tx A0"))
      .toThrow(/F1-SEED-001.*collateral/);
  });
  it("input rỗng ⇒ F1-SEED-002", () => {
    expect(() => assertTxKeepsSeed([], [], G, "hạt giống genesis", "Tx A0")).toThrow(/F1-SEED-002/);
  });
});

describe("assertReserveTotalMatchesCap + overLimits", () => {
  it("total = cap ⇒ qua; lệch ⇒ RESERVE-CAP-001", () => {
    expect(() => assertReserveTotalMatchesCap(9_630_000_000_000_000n, 9_630_000_000_000_000n)).not.toThrow();
    expect(() => assertReserveTotalMatchesCap(9_630_000_000_000_001n, 9_630_000_000_000_000n))
      .toThrow(/RESERVE-CAP-001/);
  });
  it("overLimits nêu đúng vế vượt", () => {
    const l = { maxTxSize: 16_384, maxTxExMem: 17_500_000n, maxTxExSteps: 10_000_000_000n };
    expect(overLimits({ sizeBytes: 5_044, mem: 741_650n, steps: 225_784_027n }, l)).toEqual([]);
    expect(overLimits({ sizeBytes: 16_385, mem: 17_500_001n, steps: 1n }, l)).toHaveLength(2);
  });
});

describe("reserveFloorFromEnv — sàn BẮT BUỘC, không mặc định", () => {
  it("giá trị đã chốt = 1% trần Reserve = 96_300_000_000_000", () => {
    expect(DECIDED_FLOOR_OILDROP).toBe(96_300_000_000_000n);
  });
  it("đặt đúng giá trị đã chốt ⇒ nhãn production", () => {
    expect(reserveFloorFromEnv({ [RESERVE_FLOOR_ENV]: "96300000000000" }))
      .toEqual({ floorOildrop: 96_300_000_000_000n, floorSource: "production" });
  });
  it("giá trị khác (vd sàn diễn tập cũ) ⇒ nhãn demo", () => {
    expect(reserveFloorFromEnv({ [RESERVE_FLOOR_ENV]: "1000000000" }).floorSource).toBe("demo");
  });
  it("thiếu / rỗng ⇒ FLOOR-ENV-001", () => {
    expect(() => reserveFloorFromEnv({})).toThrow(/FLOOR-ENV-001/);
    expect(() => reserveFloorFromEnv({ [RESERVE_FLOOR_ENV]: "  " })).toThrow(/FLOOR-ENV-001/);
  });
  it("không phải số ⇒ FLOOR-ENV-002; ≤ 0 ⇒ 003; > trần ⇒ 004", () => {
    expect(() => reserveFloorFromEnv({ [RESERVE_FLOOR_ENV]: "1e9" })).toThrow(/FLOOR-ENV-002/);
    expect(() => reserveFloorFromEnv({ [RESERVE_FLOOR_ENV]: "0" })).toThrow(/FLOOR-ENV-003/);
    expect(() => reserveFloorFromEnv({ [RESERVE_FLOOR_ENV]: "9630000000000001" })).toThrow(/FLOOR-ENV-004/);
  });
});

// ── Con trỏ governance (Treasury/GovernancePointer.md v0.1 §Genesis) ────────────────────────
// Datum custody ghi policy NFT con trỏ, KHÔNG ghi hash governance ⇒ `GOVERNANCE_SCRIPT_HASH` bị gỡ
// khỏi đường genesis. Ca đầu ghim việc gỡ: export còn sống thì một bước nào đó có thể quay lại đọc
// biến cũ và ghi hash governance vào `governance_ref` — custody khi đó trỏ vào một con trỏ không có.
describe("con trỏ governance — biến genesis", () => {
  it("governanceScriptHashFromEnv ĐÃ GỠ (GOVERNANCE_SCRIPT_HASH không còn đường vào datum custody)", () => {
    expect("governanceScriptHashFromEnv" in L2).toBe(false);
  });

  const TX = "ab".repeat(32);
  it("POINTER_SEED_TX/IDX thiếu hoặc một nửa ⇒ POINTER-SEED-001", () => {
    expect(() => pointerSeedRefFromEnv({})).toThrow(/POINTER-SEED-001/);
    expect(() => pointerSeedRefFromEnv({ POINTER_SEED_TX: TX })).toThrow(/POINTER-SEED-001/);
    expect(() => pointerSeedRefFromEnv({ POINTER_SEED_IDX: "0" })).toThrow(/POINTER-SEED-001/);
    expect(() => pointerSeedRefFromEnv({ POINTER_SEED_TX: "ab".repeat(31), POINTER_SEED_IDX: "0" }))
      .toThrow(/POINTER-SEED-001/);
  });
  it("đủ hai nửa ⇒ outref chuẩn hoá chữ thường", () => {
    expect(pointerSeedRefFromEnv({ POINTER_SEED_TX: TX.toUpperCase(), POINTER_SEED_IDX: "3" }))
      .toEqual({ txHash: TX, outputIndex: 3 });
  });

  it("Mainnet ⇒ luôn 6 epoch (2_592_000_000 ms); thiếu biến hay khai đúng số đều ra cùng giá trị", () => {
    const want = { delayMs: 2_592_000_000n, source: "mainnet-decided" };
    expect(POINTER_DELAY_MAINNET_MS).toBe(2_592_000_000n);
    expect(pointerDelayFromEnv({}, "Mainnet")).toEqual(want);
    expect(pointerDelayFromEnv({ [POINTER_DELAY_ENV]: "  " }, "Mainnet")).toEqual(want);
    expect(pointerDelayFromEnv({ [POINTER_DELAY_ENV]: "2592000000" }, "Mainnet")).toEqual(want);
  });
  it("Mainnet khai số KHÁC giá trị đã chốt ⇒ POINTER-DELAY-001", () => {
    expect(() => pointerDelayFromEnv({ [POINTER_DELAY_ENV]: "86400000" }, "Mainnet"))
      .toThrow(/POINTER-DELAY-001/);
    expect(() => pointerDelayFromEnv({ [POINTER_DELAY_ENV]: "3600000" }, "Mainnet"))
      .toThrow(/POINTER-DELAY-001/);
  });
  it("Preprod chưa khai ⇒ 1 giờ, nhãn preprod-default; khai thì lấy giá trị khai", () => {
    expect(pointerDelayFromEnv({}, "Preprod")).toEqual({ delayMs: 3_600_000n, source: "preprod-default" });
    expect(POINTER_DELAY_PREPROD_MS).toBe(3_600_000n);
    expect(pointerDelayFromEnv({ [POINTER_DELAY_ENV]: "86400000" }, "Preprod"))
      .toEqual({ delayMs: 86_400_000n, source: "env" });
  });
  it("trễ không phải số ⇒ POINTER-DELAY-002; ≤ 0 ⇒ POINTER-DELAY-003", () => {
    expect(() => pointerDelayFromEnv({ [POINTER_DELAY_ENV]: "1h" }, "Preprod")).toThrow(/POINTER-DELAY-002/);
    expect(() => pointerDelayFromEnv({ [POINTER_DELAY_ENV]: "0" }, "Preprod")).toThrow(/POINTER-DELAY-003/);
  });

  // Hai bên đột biến: cùng một outref, chỉ đổi hạt giống so sánh. Gỡ phép so ⇒ hai ca "trùng" xanh.
  const P = { txHash: TX, outputIndex: 1 };
  const GEN = { label: "hạt giống genesis", ref: { txHash: "cd".repeat(32), outputIndex: 0 } };
  const CUS = { label: "hạt giống custody", ref: { txHash: "ef".repeat(32), outputIndex: 0 } };
  it("hạt giống con trỏ khác genesis + custody ⇒ qua (kể cả cùng tx, khác chỉ số)", () => {
    expect(() => assertPointerSeedDistinct(P, [GEN, CUS])).not.toThrow();
    expect(() => assertPointerSeedDistinct(P, [{ label: "x", ref: { txHash: TX, outputIndex: 0 } }])).not.toThrow();
  });
  it("TRÙNG hạt giống genesis ⇒ POINTER-SEED-002", () => {
    expect(() => assertPointerSeedDistinct(GEN.ref, [GEN, CUS])).toThrow(/POINTER-SEED-002.*hạt giống genesis/);
  });
  it("TRÙNG hạt giống custody (khác hoa/thường) ⇒ POINTER-SEED-002", () => {
    const up = { txHash: CUS.ref.txHash.toUpperCase(), outputIndex: 0 };
    expect(() => assertPointerSeedDistinct(up, [GEN, CUS])).toThrow(/POINTER-SEED-002.*hạt giống custody/);
  });

  // Tx P: NFT con trỏ phải ở Script(pointer_policy). Cùng bộ output, chỉ đổi địa chỉ của nó.
  const PTR_UNIT = unit("b1", "474f56504f494e544552");
  const PTR_ADDR = scriptAddr("b1");
  const txP = (addr: string): PlacedOutput[] => [
    { address: addr, assets: { lovelace: 2_000_000n, [PTR_UNIT]: 1n } },
    { address: ADDR.wallet, assets: { lovelace: 90_000_000n } },
  ];
  it("Tx P: GOVPOINTER → governance_pointer ⇒ qua", () => {
    expect(() => assertMarkerPlacement(txP(PTR_ADDR), txPMarkerTargets(PTR_UNIT, PTR_ADDR), "Tx P")).not.toThrow();
  });
  it("Tx P: GOVPOINTER về VÍ ⇒ F1-PLACE-003; ở script khác ⇒ F1-PLACE-002", () => {
    expect(() => assertMarkerPlacement(txP(ADDR.wallet), txPMarkerTargets(PTR_UNIT, PTR_ADDR), "Tx P"))
      .toThrow(/F1-PLACE-003/);
    expect(() => assertMarkerPlacement(txP(ADDR.custody), txPMarkerTargets(PTR_UNIT, PTR_ADDR), "Tx P"))
      .toThrow(/F1-PLACE-002/);
  });
});

describe("carpAssetFromEnv — datum custody, không placeholder", () => {
  it("thiếu CARP_POLICY_ID ⇒ ném (không có chế độ placeholder)", () => {
    expect(() => carpAssetFromEnv({ CARP_TOKEN_NAME: "43415250" })).toThrow(/CARP_POLICY_ID/);
  });
  it("đủ CARP ⇒ trả về đúng", () => {
    expect(carpAssetFromEnv({ CARP_POLICY_ID: "cc".repeat(28), CARP_TOKEN_NAME: "43415250" }))
      .toEqual({ policy: "cc".repeat(28), name: "43415250" });
  });
});
