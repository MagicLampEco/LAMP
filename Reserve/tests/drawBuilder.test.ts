// Reserve drawBuilder — cổng fail-fast của đường rút, test OFFLINE (không provider, không mạng).
//
// Ba cổng dưới đây canh đúng LỚP LỖI đã gây sự cố "Δ chết ngoài sổ": Reserve nhả Δ bằng MINT,
// bản cũ rót Δ vào ĐỊA CHỈ kho bằng `.pay.ToAddress(...)` ⇒ UTxO KHÔNG datum ⇒ Δ nằm trong SÂN
// kho và ngoài SỔ kho, không giao dịch nào tiêu lại được. Đóng băng ngoài sổ = ĐỐT, chỉ khác
// tên, trong khi LAMP KHÔNG đốt (`Treasury/CONTRACT.md §5`).
//
//   RDB-003  custodyUtxo mang ĐÚNG 1 kho NFT           (gương Luật 9  của reserve_draw.ak)
//   RDB-004  custodyUtxo ở ĐÚNG script hash custody    (gương Luật 10)
//   RDB-005  value kho ra == vào ⊕ Δ, lovelace chỉ tăng (gương C-MIG-7 của custody.ak)
//
// Cả ba ném TRƯỚC khi builder đụng `p.lucid`, nên `lucid: {} as any` là đủ — đó cũng chính là
// khẳng định mà mấy bài dưới đây kiểm: cổng phải chặn trước khi tốn một lệnh mạng nào.

import { describe, it, expect } from "vitest";
import {
  Constr, Data, toUnit, credentialToAddress, keyHashToCredential, scriptHashToCredential,
} from "@lucid-evolution/lucid";
import type { Assets, UTxO } from "@lucid-evolution/lucid";
import { buildDrawTx, type DrawParams } from "../offchain/src/drawBuilder.js";
import { reserveStateToCbor } from "../offchain/src/datum.js";

// ── Fixtures ───────────────────────────────────────────────────────────
const LAMP_POLICY = "33".repeat(28);
const TOKEN_NAME = "744c414d50";              // "tLAMP"
const THREAD_POLICY = "55".repeat(28);
const THREAD_NAME = "524553";                 // "RES"
const KHO_POLICY = "22".repeat(28);
const KHO_NAME = "435553";                    // "CUS"
const CUSTODY_HASH = "77".repeat(28);
const OTHER_HASH = "88".repeat(28);
const GATE_HASH = "66".repeat(28);

const lampUnit = toUnit(LAMP_POLICY, TOKEN_NAME);
const threadUnit = toUnit(THREAD_POLICY, THREAD_NAME);
const khoUnit = toUnit(KHO_POLICY, KHO_NAME);

const custodyAddr = credentialToAddress("Preview", scriptHashToCredential(CUSTODY_HASH));
const otherAddr = credentialToAddress("Preview", scriptHashToCredential(OTHER_HASH));
const gateAddr = credentialToAddress("Preview", scriptHashToCredential(GATE_HASH));

const MS_PER_EPOCH = 432_000_000;
const EPOCH = 100n;
const TOTAL = 9_630_000_000_000_000n;
const DELTA = TOTAL / 1000n;                  // = trần epoch, mặc định của builder

function custodyUtxo(over: { assets?: Assets; address?: string } = {}): UTxO {
  return {
    txHash: "ab".repeat(32),
    outputIndex: 0,
    address: over.address ?? custodyAddr,
    assets: over.assets ?? { lovelace: 2_000_000n, [khoUnit]: 1n },
    datum: Data.to(new Constr(0, [])),   // nội dung không dùng ở ba cổng này
  };
}

function params(over: Partial<DrawParams> = {}): DrawParams {
  const custody = over.custodyUtxo ?? custodyUtxo();
  return {
    lucid: {} as never,
    reserveUtxo: {
      txHash: "cd".repeat(32), outputIndex: 0,
      address: credentialToAddress("Preview", scriptHashToCredential("99".repeat(28))),
      assets: { lovelace: 2_000_000n, [threadUnit]: 1n },
      datum: reserveStateToCbor({
        start_epoch: 1n, total_oildrop: TOTAL, drawn_oildrop: 0n, last_epoch: 0n,
      }),
    },
    reserveScript: { type: "PlutusV3", script: "00" } as never,
    // KHÔNG truyền `reserveAddress`: địa chỉ recreate lấy từ `reserveUtxo.address`
    // (Luật 7, `reserve_draw.ak:159`). Bản cũ của bộ kiểm này truyền "addr_test1reserve"
    // trong khi `reserveUtxo.address` là một địa chỉ script Preview khác hẳn — hai nguồn
    // lệch nhau suốt mà không ca nào đỏ, vì không ca nào đọc tới địa chỉ recreate.
    reserveThreadPolicyId: THREAD_POLICY,
    reserveThreadName: THREAD_NAME,
    tokenName: TOKEN_NAME,

    supplyUtxo: {
      txHash: "ef".repeat(32), outputIndex: 0, address: "addr_test1supply",
      assets: { lovelace: 2_000_000n },
    },
    supplyStateScript: { type: "PlutusV3", script: "00" } as never,
    supplyStateAddress: "addr_test1supply",
    supplyStateOutDatumCbor: "d87980",
    supplyStateOutValue: { lovelace: 2_000_000n },
    supplyStateRedeemerCbor: "d87980",

    treasuryAuthUtxo: {
      txHash: "12".repeat(32), outputIndex: 0, address: gateAddr,
      assets: { lovelace: 2_000_000n },
    },
    gateScriptHash: GATE_HASH,

    tlampPolicy: { type: "PlutusV3", script: "00" } as never,
    tlampPolicyId: LAMP_POLICY,
    reserveDrawRedeemerCbor: "d87981",

    custodyUtxo: custody,
    custodyScript: { type: "PlutusV3", script: "00" } as never,
    reserveKhoNftPolicyId: KHO_POLICY,
    reserveKhoNftName: KHO_NAME,
    custodyScriptHash: CUSTODY_HASH,
    custodyRedeemerCbor: "d87983",
    custodyOutDatumCbor: "d87980",
    custodyOutValue: {
      ...(custody.assets),
      [lampUnit]: (custody.assets[lampUnit] ?? 0n) + DELTA,
    },

    epoch: EPOCH,
    validFromUnixMs: Number(EPOCH) * MS_PER_EPOCH + 1000,
    validToUnixMs: Number(EPOCH) * MS_PER_EPOCH + 90_000,
    ...over,
  };
}

// Không có `reserveDest` nữa — đích là một DÒNG SỔ, không phải một ĐỊA CHỈ.
describe("DrawParams — hình dạng hợp đồng", () => {
  it("KHÔNG còn trường reserveDest (đích không phải một địa chỉ)", () => {
    expect("reserveDest" in params()).toBe(false);
  });
  it("CÓ đủ bộ trường kho: utxo + script + NFT + hash + redeemer + datum ra + value ra", () => {
    const p = params() as unknown as Record<string, unknown>;
    for (const k of [
      "custodyUtxo", "custodyScript", "reserveKhoNftPolicyId", "reserveKhoNftName",
      "custodyScriptHash", "custodyRedeemerCbor", "custodyOutDatumCbor", "custodyOutValue",
    ]) expect(p[k], k).toBeDefined();
  });
});

// ══ RDB-003 — gương Luật 9 ══════════════════════════════════════════════
describe("RDB-003 — kho UTxO phải mang ĐÚNG 1 kho NFT", () => {
  it("ĐỎ: kho UTxO KHÔNG mang kho NFT", async () => {
    const cust = custodyUtxo({ assets: { lovelace: 2_000_000n } });
    await expect(buildDrawTx(params({ custodyUtxo: cust, custodyOutValue: { lovelace: 2_000_000n, [lampUnit]: DELTA } })))
      .rejects.toThrow(/RDB-003/);
  });

  it("ĐỎ: kho UTxO mang 2 kho NFT (one-shot vỡ → chọn được cái parked thấp)", async () => {
    const cust = custodyUtxo({ assets: { lovelace: 2_000_000n, [khoUnit]: 2n } });
    await expect(buildDrawTx(params({ custodyUtxo: cust, custodyOutValue: { lovelace: 2_000_000n, [khoUnit]: 2n, [lampUnit]: DELTA } })))
      .rejects.toThrow(/RDB-003/);
  });

  it("XANH ở cổng này: mang đúng 1 kho NFT → KHÔNG ném RDB-003", async () => {
    let msg = "";
    try { await buildDrawTx(params()); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/RDB-003/);
  });
});

// ══ RDB-004 — gương Luật 10 ═════════════════════════════════════════════
// "Bị tiêu" chỉ kích validator ĐANG GIỮ nó. Kho NFT ở script khác ⇒ cái chạy không phải
// `custody` ⇒ KHÔNG AI ghi Δ vào sổ. Cùng lỗ cũ, chỉ khác đường vào.
describe("RDB-004 — kho UTxO phải ở ĐÚNG script hash custody", () => {
  it("ĐỎ: kho NFT nằm ở một SCRIPT KHÁC", async () => {
    await expect(buildDrawTx(params({ custodyUtxo: custodyUtxo({ address: otherAddr }) })))
      .rejects.toThrow(/RDB-004/);
  });

  it("XANH ở cổng này: đúng script custody → KHÔNG ném RDB-004", async () => {
    let msg = "";
    try { await buildDrawTx(params()); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/RDB-004/);
  });
});

// ══ RDB-005 — gương C-MIG-7 ═════════════════════════════════════════════
describe("RDB-005 — value kho ra == vào ⊕ Δ (lovelace chỉ TĂNG)", () => {
  it("ĐỎ: value ra KHÔNG cộng Δ (đúng hình dạng 'value tăng ở nơi khác, kho không nhận')", async () => {
    await expect(buildDrawTx(params({ custodyOutValue: { lovelace: 2_000_000n, [khoUnit]: 1n } })))
      .rejects.toThrow(/RDB-005/);
  });

  it("ĐỎ: value ra cộng THIẾU Δ", async () => {
    await expect(buildDrawTx(params({
      custodyOutValue: { lovelace: 2_000_000n, [khoUnit]: 1n, [lampUnit]: DELTA - 1n },
    }))).rejects.toThrow(/RDB-005/);
  });

  it("ĐỎ: kho NFT bị rút ra khỏi output", async () => {
    await expect(buildDrawTx(params({
      custodyOutValue: { lovelace: 2_000_000n, [lampUnit]: DELTA },
    }))).rejects.toThrow(/RDB-005/);
  });

  it("ĐỎ: lovelace GIẢM (vét ADA của kho)", async () => {
    await expect(buildDrawTx(params({
      custodyOutValue: { lovelace: 1_000_000n, [khoUnit]: 1n, [lampUnit]: DELTA },
    }))).rejects.toThrow(/RDB-005/);
  });

  // F5: lượt migrate ĐẦU thêm asset mới + một dòng datum ⇒ min-UTxO tăng. Khoá cứng lovelace
  // bằng đẳng thức làm MigrateIn bất khả thi vĩnh viễn ⇒ pot Reserve khoá. Nên phải cho TĂNG.
  it("XANH ở cổng này: lovelace TĂNG để bù min-UTxO → KHÔNG ném RDB-005", async () => {
    let msg = "";
    try {
      await buildDrawTx(params({
        custodyOutValue: { lovelace: 2_500_000n, [khoUnit]: 1n, [lampUnit]: DELTA },
      }));
    } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/RDB-005/);
  });

  it("ĐỎ: nhét token rác vào kho trong cùng lượt", async () => {
    await expect(buildDrawTx(params({
      custodyOutValue: {
        lovelace: 2_000_000n, [khoUnit]: 1n, [lampUnit]: DELTA,
        [toUnit("ee".repeat(28), "01")]: 5n,
      },
    }))).rejects.toThrow(/RDB-005/);
  });
});

// ══ RDB-006 — gương Luật 7: địa chỉ recreate LẤY TỪ INPUT ═══════════════
//
// `reserve_draw.ak:159` ▸ `expect s_out.address == own_out.address` — đẳng thức trên CẢ
// Address, tức stake credential cũng bị ghim. Bản cũ nhận địa chỉ qua trường rời
// `reserveAddress`, nên ReserveState gieo dưới dạng base sẽ được recreate thành enterprise
// và on-chain từ chối; ở dạng enterprise thì hai bên trùng nhau ngẫu nhiên và không ai thấy.
describe("RDB-006 — ReserveState' phải ở ĐÚNG địa chỉ input", () => {
  const RESERVE_HASH = "99".repeat(28);
  const STAKE_KEY_HASH = "5e".repeat(28);
  const reserveEnterprise = credentialToAddress("Preview", scriptHashToCredential(RESERVE_HASH));
  const reserveBase = credentialToAddress(
    "Preview", scriptHashToCredential(RESERVE_HASH), keyHashToCredential(STAKE_KEY_HASH),
  );

  function withReserveAddress(address: string): DrawParams {
    const p = params();
    return { ...p, reserveUtxo: { ...p.reserveUtxo, address } };
  }

  it("hai cực khác nhau — tiền đề: enterprise ≠ base của CÙNG script", () => {
    expect(reserveBase).not.toBe(reserveEnterprise);
  });

  it("ĐỎ: reserveAddress lệch reserveUtxo.address (hai nguồn cùng tả một sự thật)", async () => {
    await expect(buildDrawTx({ ...params(), reserveAddress: "addr_test1reserve" }))
      .rejects.toThrow(/RDB-006/);
  });

  it("XANH ở cổng này: reserveAddress TRÙNG reserveUtxo.address → không ném RDB-006", async () => {
    const p = withReserveAddress(reserveEnterprise);
    let msg = "";
    try {
      await buildDrawTx({ ...p, reserveAddress: reserveEnterprise });
    } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/RDB-006/);
  });

  // Hai cực phải phân biệt được: bản cũ nhận enterprise string cho CẢ HAI ca và im lặng.
  it("ĐỎ: ReserveState gieo BASE nhưng bên gọi đưa địa chỉ enterprise", async () => {
    await expect(buildDrawTx({
      ...withReserveAddress(reserveBase), reserveAddress: reserveEnterprise,
    })).rejects.toThrow(/RDB-006/);
  });

  it("ĐỎ ngược lại: ReserveState gieo ENTERPRISE nhưng bên gọi đưa địa chỉ base", async () => {
    await expect(buildDrawTx({
      ...withReserveAddress(reserveEnterprise), reserveAddress: reserveBase,
    })).rejects.toThrow(/RDB-006/);
  });

  it("RDB-006: reserveUtxo thiếu address → ném, không dựng tx mù", async () => {
    const p = params();
    await expect(buildDrawTx({
      ...p, reserveUtxo: { ...p.reserveUtxo, address: "" as never },
    })).rejects.toThrow(/RDB-006/);
  });
});

// ══ Thứ tự cổng: chặn TRƯỚC khi đụng mạng ═══════════════════════════════
describe("ba cổng chặn TRƯỚC khi builder đụng lucid", () => {
  it("lucid rỗng vẫn ném đúng mã cổng, không phải TypeError của lucid", async () => {
    // `lucid: {}` — nếu cổng chạy SAU khi dựng tx thì lỗi sẽ là TypeError (newTx không phải hàm).
    await expect(buildDrawTx(params({ custodyUtxo: custodyUtxo({ address: otherAddr }) })))
      .rejects.toThrow(/RDB-004/);
  });
});
