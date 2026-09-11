// Nhánh MIGRATE-IN off-chain — gương của `lib/magiclamp/treasury/migrate.ak`.
//
// Đợt vá "Δ Reserve nhả ra vào SỔ": Reserve nhả Δ bằng MINT, bản cũ rót Δ vào ĐỊA CHỈ kho
// bằng `.pay.ToAddress(...)` ⇒ UTxO KHÔNG datum ⇒ Δ trong SÂN kho, ngoài SỔ kho, không tiêu
// lại được. Các bài dưới đây canh phần off-chain của luật mới.
//
// KỶ LUẬT ĐẶT BÀI: mỗi chốt có CẶP ca (một xanh, một đỏ) để đầu vào phân biệt được hai bên
// đột biến. Ca chỉ-xanh không kiểm được gì — gỡ chốt ra nó vẫn xanh.

import { describe, it, expect } from "vitest";
import {
  RESERVE_INFLOW_BUCKET_ID, RESERVE_SOURCE_TAG,
  assetAccepted, mintOk, valueOk, ledgerOk, lineDelta,
  targetLinePresent, eachOutLineOk, eachInLineSettled,
  planMigrateLedger, planMigrateDatum,
} from "../offchain/src/migrate.js";
import {
  assetKey, allItemsValid, noReservedBucketLines, seedDatumOk, isCanonical,
  type AssetMap,
} from "../offchain/src/collect.js";
import { custodyRedeemerToCbor, decodeCustodyRedeemer } from "../offchain/src/datum.js";
import { Data } from "@lucid-evolution/lucid";
import type { CollectItem, CustodyDatum, LedgerEntry } from "../offchain/src/types.js";

// ── Fixtures ───────────────────────────────────────────────────────────
const LAMP = "77".repeat(28);
const TLAMP = "744c414d50";              // "tLAMP"
const NFT_POLICY = "c0".repeat(28);
const INSTANCE = "6c616d702d7265736572766528";  // instance_id (cũng là NFT name)
const OTHER = "ab".repeat(28);

const lampK = assetKey(LAMP, TLAMP);
const nftK = assetKey(NFT_POLICY, INSTANCE);
const adaK = assetKey("", "");

function datum(over: Partial<CustodyDatum> = {}): CustodyDatum {
  return {
    instance_id: INSTANCE,
    accepted_assets: [
      { policy: LAMP, name: TLAMP },
      { policy: NFT_POLICY, name: INSTANCE },
    ],
    ledger: [{ bucket_id: 9n, policy: NFT_POLICY, name: INSTANCE, amount: 1n }],
    cut_bps: 1000n,
    governance_ref: "",
    epoch: 5n,
    consumed_proposals: [],
    ...over,
  };
}

// ══ Hằng ghim theo on-chain ═════════════════════════════════════════════
describe("hằng F4 khớp migrate.ak", () => {
  it("reserve_inflow_bucket_id == 1_000_000", () => {
    expect(RESERVE_INFLOW_BUCKET_ID).toBe(1_000_000n);
  });

  // `reserve_source_tag = "reserve-draw"` on-chain là ByteArray từ literal ASCII.
  // Off-chain redeemer mang hex ⇒ phải là hex của đúng chuỗi đó, không phải chuỗi thô.
  //
  // Tự quy đổi bằng charCodeAt thay vì `Buffer` — gói này không nạp kiểu node, và bài kiểm
  // hằng thì không nên kéo theo một phụ thuộc mới chỉ để đổi chuỗi thành hex.
  it("reserve_source_tag == hex ASCII \"reserve-draw\"", () => {
    const toHex = (s: string) =>
      [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    expect(RESERVE_SOURCE_TAG).toBe(toHex("reserve-draw"));
    expect(RESERVE_SOURCE_TAG).toBe("726573657276652d64726177");
  });

  // Nhãn nguồn đi qua vòng encode→decode phải NGUYÊN. Sai một byte thì C-MIG-8 từ chối và
  // cả pot Reserve đứng, nên vòng này đáng canh.
  it("MigrateIn redeemer round-trip giữ nguyên nhãn nguồn (Constr index 3)", () => {
    const cbor = custodyRedeemerToCbor({ kind: "MigrateIn", source: RESERVE_SOURCE_TAG });
    const back = decodeCustodyRedeemer(Data.from(cbor));
    expect(back).toEqual({ kind: "MigrateIn", source: RESERVE_SOURCE_TAG });
  });
});

// ══ C-MIG-6 mint ════════════════════════════════════════════════════════
describe("mintOk (C-MIG-6)", () => {
  it("XANH: đúng một cặp (lamp, token) với Δ > 0", () => {
    expect(mintOk({ [lampK]: 100n }, LAMP, TLAMP, 100n)).toBe(true);
  });

  it("ĐỎ: Δ == 0 (mint rỗng / no-op)", () => {
    expect(mintOk({ [lampK]: 0n }, LAMP, TLAMP, 0n)).toBe(false);
  });

  it("ĐỎ: Δ < 0 (burn — LAMP KHÔNG đốt)", () => {
    expect(mintOk({ [lampK]: -5n }, LAMP, TLAMP, -5n)).toBe(false);
  });

  // Đây là vế mua được nhiều nhất: chỉ ép "Δ > 0" thì cùng tx còn đúc được asset KHÁC —
  // kể cả NFT authenticity của instance khác — mà nhánh này không nhìn tới.
  it("ĐỎ: đúc kèm asset KHÁC trong cùng tx", () => {
    expect(mintOk({ [lampK]: 100n, [nftK]: 1n }, LAMP, TLAMP, 100n)).toBe(false);
  });

  it("ĐỎ: đúc asset-name khác dưới CÙNG policy", () => {
    expect(mintOk({ [assetKey(LAMP, "4c414d50")]: 100n }, LAMP, TLAMP, 0n)).toBe(false);
  });

  it("XANH: lovelace trong trường mint bị bỏ qua (ada không đúc được)", () => {
    expect(mintOk({ [adaK]: 2_000_000n, [lampK]: 7n }, LAMP, TLAMP, 7n)).toBe(true);
  });
});

// ══ C-MIG-7 value ═══════════════════════════════════════════════════════
describe("valueOk (C-MIG-7)", () => {
  const vIn: AssetMap = { [adaK]: 2_000_000n, [nftK]: 1n };

  it("XANH: asset đích tăng đúng Δ, NFT giữ nguyên, lovelace giữ nguyên", () => {
    const vOut: AssetMap = { [adaK]: 2_000_000n, [nftK]: 1n, [lampK]: 50n };
    expect(valueOk(vIn, vOut, LAMP, TLAMP, 50n)).toBe(true);
  });

  // F5: lượt migrate ĐẦU thêm asset mới + một dòng datum ⇒ min-UTxO tăng. Khoá cứng lovelace
  // bằng đẳng thức làm MigrateIn bất khả thi vĩnh viễn ⇒ pot Reserve khoá. Nên `>=`.
  it("XANH: lovelace TĂNG (bù min-UTxO của lượt migrate đầu)", () => {
    const vOut: AssetMap = { [adaK]: 2_500_000n, [nftK]: 1n, [lampK]: 50n };
    expect(valueOk(vIn, vOut, LAMP, TLAMP, 50n)).toBe(true);
  });

  it("ĐỎ: lovelace GIẢM (vét ADA của kho)", () => {
    const vOut: AssetMap = { [adaK]: 1_000_000n, [nftK]: 1n, [lampK]: 50n };
    expect(valueOk(vIn, vOut, LAMP, TLAMP, 50n)).toBe(false);
  });

  it("ĐỎ: Δ vào value ÍT hơn Δ đã mint", () => {
    const vOut: AssetMap = { [adaK]: 2_000_000n, [nftK]: 1n, [lampK]: 49n };
    expect(valueOk(vIn, vOut, LAMP, TLAMP, 50n)).toBe(false);
  });

  it("ĐỎ: NFT authenticity bị rút ra khỏi kho", () => {
    const vOut: AssetMap = { [adaK]: 2_000_000n, [lampK]: 50n };
    expect(valueOk(vIn, vOut, LAMP, TLAMP, 50n)).toBe(false);
  });

  it("ĐỎ: nhét token rác vào kho", () => {
    const vOut: AssetMap = {
      [adaK]: 2_000_000n, [nftK]: 1n, [lampK]: 50n, [assetKey(OTHER, "01")]: 9n,
    };
    expect(valueOk(vIn, vOut, LAMP, TLAMP, 50n)).toBe(false);
  });
});

// ══ C-MIG-8 sổ ══════════════════════════════════════════════════════════
describe("ledgerOk (C-MIG-8)", () => {
  const lIn: LedgerEntry[] = [{ bucket_id: 9n, policy: NFT_POLICY, name: INSTANCE, amount: 1n }];

  it("XANH: thêm dòng đích mới đúng Δ, dòng cũ nguyên", () => {
    const lOut = planMigrateLedger(lIn, LAMP, TLAMP, 50n);
    expect(ledgerOk(lIn, lOut, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 50n)).toBe(true);
  });

  it("XANH: cộng dồn vào dòng đích ĐÃ CÓ", () => {
    const seeded: LedgerEntry[] = [
      ...lIn,
      { bucket_id: RESERVE_INFLOW_BUCKET_ID, policy: LAMP, name: TLAMP, amount: 40n },
    ];
    const lOut = planMigrateLedger(seeded, LAMP, TLAMP, 10n);
    expect(ledgerOk(seeded, lOut, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 10n)).toBe(true);
    const line = lOut.find((e) => e.bucket_id === RESERVE_INFLOW_BUCKET_ID);
    expect(line?.amount).toBe(50n);
  });

  // ĐÂY LÀ CHỐT CỦA CẢ ĐỢT VÁ: "value tăng, sổ không đổi" là đúng hình dạng đã gây sự cố.
  // `eachOutLineOk` một mình KHÔNG bắt được — nó chỉ soi những dòng ĐANG CÓ, nó không biết
  // dòng nào đáng lẽ phải xuất hiện. `targetLinePresent` mới là vế bắt.
  it("ĐỎ: sổ KHÔNG đổi trong khi value tăng (Δ ngoài sổ = đốt trá hình)", () => {
    expect(ledgerOk(lIn, lIn, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 50n)).toBe(false);
    expect(targetLinePresent(lIn, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP)).toBe(false);
    // …trong khi vế "mỗi dòng ra khớp" vẫn XANH ⇒ chứng minh hai vế không thay nhau được.
    expect(eachOutLineOk(lIn, lIn, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 50n)).toBe(true);
  });

  it("ĐỎ: ghi sổ ÍT hơn Δ đã mint", () => {
    const lOut = planMigrateLedger(lIn, LAMP, TLAMP, 40n);
    expect(ledgerOk(lIn, lOut, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 50n)).toBe(false);
  });

  it("ĐỎ: xoá lén một dòng IN (để rút value ra sau này)", () => {
    const lOut = [{ bucket_id: RESERVE_INFLOW_BUCKET_ID, policy: LAMP, name: TLAMP, amount: 50n }];
    expect(eachInLineSettled(lIn, lOut)).toBe(false);
    expect(ledgerOk(lIn, lOut, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 50n)).toBe(false);
  });

  it("ĐỎ: ghi Δ vào bucket KHÁC bucket dành riêng Reserve", () => {
    const lOut = [...lIn, { bucket_id: 0n, policy: LAMP, name: TLAMP, amount: 50n }];
    expect(ledgerOk(lIn, lOut, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 50n)).toBe(false);
  });

  it("lineDelta: chỉ dòng ĐÚNG khoá đích nhận Δ", () => {
    const hit: LedgerEntry = { bucket_id: RESERVE_INFLOW_BUCKET_ID, policy: LAMP, name: TLAMP, amount: 0n };
    const miss: LedgerEntry = { bucket_id: 0n, policy: LAMP, name: TLAMP, amount: 0n };
    expect(lineDelta(hit, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 7n)).toBe(7n);
    expect(lineDelta(miss, RESERVE_INFLOW_BUCKET_ID, LAMP, TLAMP, 7n)).toBe(0n);
  });

  it("planMigrateLedger trả sổ CANONICAL (strict-sorted, mọi dòng > 0)", () => {
    const lOut = planMigrateLedger(lIn, LAMP, TLAMP, 50n);
    expect(isCanonical(lOut)).toBe(true);
  });

  it("planMigrateLedger ném khi Δ <= 0 (C-MIG-6 từ chối mint rỗng)", () => {
    expect(() => planMigrateLedger(lIn, LAMP, TLAMP, 0n)).toThrow(/TMIG-001/);
  });
});

// ══ C-MIG-9 asset accepted ══════════════════════════════════════════════
describe("assetAccepted (C-MIG-9)", () => {
  it("XANH khi asset nằm trong accepted_assets", () => {
    expect(assetAccepted(datum().accepted_assets, LAMP, TLAMP)).toBe(true);
  });
  it("ĐỎ khi kho không khai là nhận asset này", () => {
    expect(assetAccepted(datum().accepted_assets, OTHER, TLAMP)).toBe(false);
  });
});

// ══ C-MIG-3 + C-MIG-4: datum ra ═════════════════════════════════════════
describe("planMigrateDatum (C-MIG-3 + C-MIG-4)", () => {
  it("chỉ ledger + epoch đổi; mọi trường instance BẢO TOÀN", () => {
    const dIn = datum({ consumed_proposals: ["aa", "bb"] });
    const dOut = planMigrateDatum(dIn, LAMP, TLAMP, 50n, 9n);
    expect(dOut.instance_id).toBe(dIn.instance_id);
    expect(dOut.accepted_assets).toEqual(dIn.accepted_assets);
    expect(dOut.governance_ref).toBe(dIn.governance_ref);
    expect(dOut.cut_bps).toBe(dIn.cut_bps);
    // MigrateIn KHÔNG được làm đường vòng cho Release: marker single-use giữ NGUYÊN.
    expect(dOut.consumed_proposals).toEqual(["aa", "bb"]);
    expect(dOut.epoch).toBe(9n);
    expect(dOut.ledger).not.toEqual(dIn.ledger);
  });

  it("ném khi asset không nằm trong accepted_assets (C-MIG-9)", () => {
    expect(() => planMigrateDatum(datum(), OTHER, TLAMP, 50n, 9n)).toThrow(/TMIG-002/);
  });

  it("ném khi epoch LÙI (C-MIG-4 ép epoch không lùi)", () => {
    expect(() => planMigrateDatum(datum({ epoch: 10n }), LAMP, TLAMP, 50n, 9n)).toThrow(/TMIG-003/);
  });
});

// ══ F4: bucket Reserve được CƯỠNG CHẾ, không còn là quy ước ═════════════
// Hai gương off-chain này trước đợt vá KHÔNG có, tức off-chain dựng được tx mà on-chain chắc
// chắn từ chối. Cặp xanh/đỏ ở đây canh đúng hai vế mới thêm.
describe("F4 — bucket Reserve chỉ MigrateIn được ghi", () => {
  const accepted = datum().accepted_assets;
  const item = (category: bigint): CollectItem =>
    ({ app_id: "aa", policy: LAMP, name: TLAMP, amount: 100n, category });

  it("allItemsValid ĐỎ khi Collect nhắm vào bucket dành riêng Reserve", () => {
    expect(allItemsValid([item(RESERVE_INFLOW_BUCKET_ID)], accepted)).toBe(false);
  });

  it("allItemsValid XANH với bucket thường", () => {
    expect(allItemsValid([item(0n)], accepted)).toBe(true);
  });

  it("noReservedBucketLines ĐỎ khi sổ genesis khai khống số dư Reserve-inflow", () => {
    expect(noReservedBucketLines([
      { bucket_id: RESERVE_INFLOW_BUCKET_ID, policy: LAMP, name: TLAMP, amount: 1n },
    ])).toBe(false);
  });

  it("noReservedBucketLines XANH với sổ genesis thường", () => {
    expect(noReservedBucketLines(datum().ledger)).toBe(true);
  });

  // seedDatumOk phải TỪ CHỐI seed mang dòng bucket Reserve — kể cả khi value nạp đủ khớp,
  // vì đó chính là cách một seed khai khống lọt qua S-SEED-0.
  it("seedDatumOk ĐỎ khi seed mang dòng bucket Reserve (dù value khớp)", () => {
    const RESERVED_ADA = 2_000_000n;
    const ledger: LedgerEntry[] = [
      { bucket_id: RESERVE_INFLOW_BUCKET_ID, policy: LAMP, name: TLAMP, amount: 500n },
    ];
    const value: AssetMap = { [adaK]: RESERVED_ADA, [lampK]: 500n, [nftK]: 1n };
    expect(seedDatumOk(value, datum({ ledger }), RESERVED_ADA, NFT_POLICY)).toBe(false);
  });

  it("seedDatumOk XANH với cùng hình dạng nhưng bucket thường", () => {
    const RESERVED_ADA = 2_000_000n;
    const ledger: LedgerEntry[] = [
      { bucket_id: 0n, policy: LAMP, name: TLAMP, amount: 500n },
    ];
    const value: AssetMap = { [adaK]: RESERVED_ADA, [lampK]: 500n, [nftK]: 1n };
    expect(seedDatumOk(value, datum({ ledger }), RESERVED_ADA, NFT_POLICY)).toBe(true);
  });
});
