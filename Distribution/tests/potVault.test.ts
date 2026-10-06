// Két pot 8 — off-chain `Distribution/offchain/src/potVault.ts`, hợp đồng
// `Distribution/pot-vault/CONTRACT.md` v1.0.
//
// Phần Emulator chạy VALIDATOR THẬT (blueprint `pot-vault/onchain/plutus.json`, cần `aiken build`
// trước): `complete()` của Lucid đánh giá script bằng máy UPLC cục bộ, nên một bước xanh nghĩa là
// validator Aiken ĐÃ CHẤP NHẬN giao dịch do builder dựng, và một bước "bị từ chối" nghĩa là UPLC
// trả lỗi. Mỗi ca phải-bị-từ-chối đi cặp với một ca ĐỐI CHỨNG chỉ khác đúng một biến (thời điểm,
// lượng rót) và được nhận — để lỗi không thể đến từ chỗ khác (cân bằng, phí, chữ ký).
//
// Két swap giả lập: native script `all[sig admin]`, NFT `(hash, "")` ở `Script(hash)` enterprise.
// KHÔNG phải validator Feecover thật — pot không ép luật của két (CONTRACT §Giới hạn đã biết).
//
// CHỐT BÀI KIỂM NÀY KHÔNG GHIM ĐƯỢC:
//   • luật của két swap (redeemer, datum output két) — két giả lập không có luật;
//   • đường reference script cho pot (builder chỉ gắn script inline);
//   • thời gian thật của Preprod: Emulator đặt slot 0 = lúc khởi tạo, không phải gốc Shelley Preprod;
//   • nhánh UTxO lạc bị tiêu một mình hoặc kèm `Feed` — đã có ca Aiken (`spend_lac_*`, `feed_kem_utxo_lac`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  Emulator, Lucid, generateEmulatorAccountFromPrivateKey, getAddressDetails, mintingPolicyToId,
  paymentCredentialOf, scriptFromNative, toUnit,
  type LucidEvolution, type TxBuilder, type UTxO,
} from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import {
  POT_MAX_RANGE_MS, POT_VAULT_PARAM_ORDER, POT_VAULT_PREPROD_CAPS, applyPotVault, buildAbsorbTx,
  buildFeedTx, buildMintPotTx, decodePotDatum, encodePotDatum, enterpriseScriptAddress, feedWindow,
  initialPotDatum, parseOutRef, potVaultParamList, type AppliedPotVault, type PotVaultParams,
} from "../offchain/src/potVault.js";

const ONCHAIN = resolve(__dirname, "../pot-vault/onchain");
const blueprint = JSON.parse(readFileSync(resolve(ONCHAIN, "plutus.json"), "utf8"));
const MS = 432_000_000n;
const ORIGIN = 1_654_041_600_000n; // Preprod, Specs/Window/CONTRACT.md — KHÔNG chia hết cho MS
const LAMP = 1_000_000n;           // 1 LAMP = 10^6 oildrop
const TLAMP = "744c414d50";

const params = (over: Partial<PotVaultParams> = {}): PotVaultParams => ({
  genesisRef: { txHash: "ab".repeat(32), outputIndex: 0 },
  lampPolicy: "44".repeat(28), lampName: TLAMP, msPerEpoch: MS,
  windowCap: POT_VAULT_PREPROD_CAPS.windowCap, totalCap: POT_VAULT_PREPROD_CAPS.totalCap,
  windowOriginMs: ORIGIN, ...over,
});

describe("tham số — khớp chữ ký `validator pot_vault(`", () => {
  it("thứ tự off-chain = thứ tự trong mã Aiken = thứ tự blueprint", () => {
    const src = readFileSync(resolve(ONCHAIN, "validators/pot_vault.ak"), "utf8");
    const sig = /validator pot_vault\(([\s\S]*?)\)\s*\{/.exec(src)?.[1];
    expect(sig).toBeDefined();
    const names = sig!.split("\n").map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter(Boolean).map((l) => l.split(":")[0]!.trim());
    expect(names).toEqual([...POT_VAULT_PARAM_ORDER]);
    const v = blueprint.validators.find((x: { title: string }) => x.title === "pot_vault.pot_vault.spend");
    expect(v.parameters.map((p: { title: string }) => p.title)).toEqual([...POT_VAULT_PARAM_ORDER]);
  });

  it("danh sách áp đúng vị trí: cap cửa sổ ở khe 4, cap tổng ở khe 5, gốc ở khe cuối", () => {
    const l = potVaultParamList(params());
    expect(l).toHaveLength(7);
    expect(l[4]).toBe(POT_VAULT_PREPROD_CAPS.windowCap);
    expect(l[5]).toBe(POT_VAULT_PREPROD_CAPS.totalCap);
    expect(l[6]).toBe(ORIGIN);
  });

  it("blueprint khai tham số lệch tên/thứ tự ⇒ NÉM, không áp", () => {
    const bad = JSON.parse(JSON.stringify(blueprint));
    const v = bad.validators.find((x: { title: string }) => x.title === "pot_vault.pot_vault.spend");
    [v.parameters[4], v.parameters[5]] = [v.parameters[5], v.parameters[4]];
    expect(() => applyPotVault(bad, params(), "Preprod")).toThrow(/POTV-BP-003/);
  });

  it("miền M-7 ép trước khi có địa chỉ", () => {
    expect(() => potVaultParamList(params({ msPerEpoch: 0n }))).toThrow(/POTV-PARAM-004/);
    expect(() => potVaultParamList(params({ windowCap: 0n }))).toThrow(/POTV-PARAM-004/);
    expect(() => potVaultParamList(params({ lampPolicy: "44" }))).toThrow(/POTV-PARAM-002/);
    expect(() => parseOutRef("ab#0")).toThrow(/POTV-REF-001/);
    expect(parseOutRef(`${"cd".repeat(32)}#7`)).toEqual({ txHash: "cd".repeat(32), outputIndex: 7 });
  });

  it("đổi genesis_ref ⇒ đổi hash (one-shot neo vào hạt giống)", () => {
    const a = applyPotVault(blueprint, params(), "Preprod");
    const b = applyPotVault(blueprint, params({ genesisRef: { txHash: "ab".repeat(32), outputIndex: 1 } }), "Preprod");
    expect(a.scriptHash).not.toBe(b.scriptHash);
  });
});

describe("định danh — địa chỉ enterprise, NFT = (hash, \"\")", () => {
  it("pot_return là Script(hash) KHÔNG stake credential; policy NFT = hash; asset name rỗng", () => {
    const p = applyPotVault(blueprint, params(), "Preprod");
    const d = getAddressDetails(p.address);
    expect(d.type).toBe("Enterprise");
    expect(d.stakeCredential).toBeUndefined();
    expect(d.paymentCredential).toEqual({ type: "Script", hash: p.scriptHash });
    expect(p.nftUnit).toBe(p.scriptHash);
    expect(p.address.startsWith("addr_test1w")).toBe(true);
  });
});

describe("datum · redeemer — chỉ số CBOR của types.ak", () => {
  it("PotDatum = Constr 0 [bytes, int, int]; khởi tạo last_window = −1", () => {
    const h = "22".repeat(28);
    expect(initialPotDatum(h)).toBe(`d8799f581c${h}0020ff`);
    expect(decodePotDatum(encodePotDatum({ reserveHash: h, drawnTotal: 5n, lastWindow: 317n })))
      .toEqual({ reserveHash: h, drawnTotal: 5n, lastWindow: 317n });
  });
  it("datum lạ ⇒ NÉM", () => {
    expect(() => decodePotDatum("d87980")).toThrow(/POTV-DATUM-002/);
    expect(() => decodePotDatum(`d8799f4122${"00"}20ff`)).toThrow(/POTV-DATUM-003/);
  });
});

describe("cửa sổ Feed — util.get_epoch_pinned (có trừ gốc)", () => {
  const end = (w: bigint) => ORIGIN + (w + 1n) * MS - 1n;
  it("giữa cửa sổ: hi = lo + ttl; lo thẳng giây", () => {
    const now = ORIGIN + 317n * MS + 1_234_567n;
    const w = feedWindow(now, MS, ORIGIN, 1_800_000n);
    expect(w.window).toBe(317n);
    expect(w.loMs % 1000n).toBe(0n);
    expect(w.hiMs - w.loMs).toBe(1_800_000n);
  });
  it("sát cuối cửa sổ: hi kẹp ở cuối cửa sổ, KHÔNG sang cửa sổ sau", () => {
    const now = end(317n) - 20n * 60_000n;
    const w = feedWindow(now, MS, ORIGIN, POT_MAX_RANGE_MS, 60_000n);
    expect(w.hiMs).toBe(end(317n));
    expect((w.hiMs - ORIGIN) / MS).toBe(317n);
  });
  it("phần còn lại ngắn hơn ttl tối thiểu ⇒ NÉM (chờ), ttl > 1 giờ ⇒ NÉM", () => {
    expect(() => feedWindow(end(317n) - 30_000n, MS, ORIGIN, 1_800_000n, 60_000n)).toThrow(/POTV-TIME-005/);
    expect(() => feedWindow(ORIGIN + 317n * MS, MS, ORIGIN, POT_MAX_RANGE_MS + 1n)).toThrow(/POTV-TIME-002/);
  });
  it("gốc Preprod không chia hết cho ms_per_epoch ⇒ công thức thiếu gốc (CONTRACT §Nghĩa vụ off-chain) lệch cửa sổ", () => {
    expect(ORIGIN % MS).not.toBe(0n);
    const now = ORIGIN + 317n * MS + 1_000n;
    expect(feedWindow(now, MS, ORIGIN, 1_800_000n).window).not.toBe(now / MS);
  });
});

// ── Emulator, validator thật ─────────────────────────────────────────────────

async function submit(lucid: LucidEvolution, emulator: Emulator, tx: TxBuilder): Promise<string> {
  const signed = await (await tx.complete()).sign.withWallet().complete();
  const h = await signed.submit();
  emulator.awaitBlock(1);
  void lucid;
  return h;
}

function advanceTo(emulator: Emulator, t: bigint): void {
  const now = BigInt(emulator.now());
  if (t <= now) throw new Error(`advanceTo: ${t} ≤ now ${now}`);
  emulator.awaitSlot(Number((t - now + 999n) / 1000n));
}

// Lỗi của máy UPLC cục bộ khi validator pot (input Plutus duy nhất — két giả là native script)
// trả False. Khớp chuỗi này để một lỗi cân bằng/phí không bị đọc thành "validator từ chối".
const UPLC_REJECT = /failed script execution Spend\[0\] the validator crashed/;

const windowNow = (em: Emulator) => (BigInt(em.now()) - ORIGIN) / MS;

describe("Emulator — MintPot → Feed → Absorb trên validator thật", () => {
  it("đúc · rót · hai ca bị từ chối có đối chứng · rót sát cuối cửa sổ · hút UTxO lạc", async () => {
    const admin = generateEmulatorAccountFromPrivateKey({ lovelace: 10_000_000_000n });
    const emulator = new Emulator([admin]);
    const lucid = await Lucid(emulator, "Custom");
    lucid.selectWallet.fromPrivateKey(admin.privateKey);
    const pkh = paymentCredentialOf(admin.address).hash;

    // tLAMP giả + két swap giả (native script khác hash với chính sách LAMP).
    const lampNative = scriptFromNative({ type: "sig", keyHash: pkh });
    const lampPolicy = mintingPolicyToId(lampNative);
    const lampUnit = toUnit(lampPolicy, TLAMP);
    const reserveNative = scriptFromNative({ type: "all", scripts: [{ type: "sig", keyHash: pkh }] });
    const reserveHash = mintingPolicyToId(reserveNative);
    const reserveNft = toUnit(reserveHash, "");
    const reserveAddr = enterpriseScriptAddress("Custom", reserveHash);
    await submit(lucid, emulator, lucid.newTx()
      .mintAssets({ [lampUnit]: 10_000_000n * LAMP }).attach.MintingPolicy(lampNative)
      .mintAssets({ [reserveNft]: 1n }).attach.MintingPolicy(reserveNative)
      .pay.ToContract(reserveAddr, { kind: "inline", value: "d87980" }, { lovelace: 2_000_000n, [reserveNft]: 1n })
      .pay.ToAddress(admin.address, { lovelace: 20_000_000n }) // hạt giống genesis_ref, thuần ADA
      .addSignerKey(pkh));

    // Áp tham số với genesis_ref = một UTxO thuần ADA của ví.
    const seed = (await lucid.wallet().getUtxos())
      .find((u) => Object.keys(u.assets).length === 1 && u.assets.lovelace === 20_000_000n)!;
    expect(seed).toBeDefined();
    const pot: AppliedPotVault = applyPotVault(blueprint, params({
      genesisRef: { txHash: seed.txHash, outputIndex: seed.outputIndex }, lampPolicy, lampName: TLAMP,
    }), "Custom");

    // ── MintPot ──
    await submit(lucid, emulator, buildMintPotTx({
      lucid, pot, genesisUtxo: seed, reserveHash, initialLamp: 2_000_000n * LAMP, potLovelace: 2_000_000n,
    }));
    const potUtxo = async (): Promise<UTxO> => {
      const us = await lucid.utxosAtWithUnit(pot.address, pot.nftUnit);
      expect(us).toHaveLength(1);
      return us[0]!;
    };
    const reserveUtxo = async (): Promise<UTxO> => (await lucid.utxosAtWithUnit(reserveAddr, reserveNft))[0]!;
    expect(decodePotDatum((await potUtxo()).datum!)).toEqual({ reserveHash, drawnTotal: 0n, lastWindow: -1n });
    expect((await potUtxo()).assets[lampUnit]).toBe(2_000_000n * LAMP);
    // one-shot: genesis_ref đã tiêu ⇒ lượt đúc thứ hai bị SỔ CÁI từ chối (input đã chi). UPLC vẫn
    // nhận vì nó thấy genesis_ref trong input; vế M-1 của validator do ca Aiken
    // `mintpot_khong_tieu_genesis_ref` ghim.
    await expect(submit(lucid, emulator, buildMintPotTx({
      lucid, pot, genesisUtxo: seed, reserveHash, initialLamp: 0n, potLovelace: 2_000_000n,
    }))).rejects.toThrow();
    expect(await lucid.utxosAtWithUnit(pot.address, pot.nftUnit)).toHaveLength(1);

    const attachReserve = (tx: TxBuilder) => tx.attach.SpendingValidator(reserveNative).addSignerKey(pkh);
    const feed = async (d: bigint, opts: { ttlMs?: bigint; minTtlMs?: bigint; preflight?: boolean } = {}) =>
      buildFeedTx({
        lucid, pot, potUtxo: await potUtxo(), reserveUtxo: await reserveUtxo(),
        reserveOutDatum: "d87980", attachReserve, d, nowMs: BigInt(emulator.now()), ...opts,
      });

    // ── Feed #1, đầu một cửa sổ ──
    advanceTo(emulator, ORIGIN + (windowNow(emulator) + 1n) * MS + 10_000n);
    const w1 = windowNow(emulator);
    await submit(lucid, emulator, (await feed(400_000n * LAMP)).tx);
    expect(decodePotDatum((await potUtxo()).datum!)).toEqual({ reserveHash, drawnTotal: 400_000n * LAMP, lastWindow: w1 });
    expect((await reserveUtxo()).assets[lampUnit]).toBe(400_000n * LAMP);
    expect((await potUtxo()).assets[lampUnit]).toBe(1_600_000n * LAMP);

    // ── TỪ CHỐI 1: Feed lần hai CÙNG cửa sổ (F-1 `now > last_window`) ──
    emulator.awaitSlot(60);
    expect(windowNow(emulator)).toBe(w1);
    await expect((await feed(1n * LAMP, { preflight: false })).tx.complete()).rejects.toThrow(UPLC_REJECT);
    await expect(feed(1n * LAMP)).rejects.toThrow(/POTV-FEED-004/);
    // đối chứng: cùng lượng, cửa sổ sau ⇒ nhận.
    advanceTo(emulator, ORIGIN + (w1 + 1n) * MS + 10_000n);
    await submit(lucid, emulator, (await feed(1n * LAMP)).tx);
    const w2 = windowNow(emulator);
    expect(decodePotDatum((await potUtxo()).datum!).lastWindow).toBe(w2);

    // ── TỪ CHỐI 2: Feed vượt window_cap (F-6 `LAMP két sau ≤ window_cap`) ──
    advanceTo(emulator, ORIGIN + (w2 + 1n) * MS + 10_000n);
    const overCap = POT_VAULT_PREPROD_CAPS.windowCap - 400_001n * LAMP + 1n; // két 400.001 LAMP + d = cap + 1
    await expect((await feed(overCap, { preflight: false })).tx.complete()).rejects.toThrow(UPLC_REJECT);
    await expect(feed(overCap)).rejects.toThrow(/POTV-FEED-007/);
    // đối chứng: d nhỏ hơn đúng 1 oildrop ⇒ két chạm ĐÚNG trần ⇒ nhận.
    await submit(lucid, emulator, (await feed(overCap - 1n)).tx);
    expect((await reserveUtxo()).assets[lampUnit]).toBe(POT_VAULT_PREPROD_CAPS.windowCap);

    // Két swap thật sẽ tiêu LAMP của nó; két giả: rút ra ví để lượt sau còn chỗ dưới trần.
    const r = await reserveUtxo();
    await submit(lucid, emulator, lucid.newTx().collectFrom([r]).attach.SpendingValidator(reserveNative)
      .pay.ToContract(reserveAddr, { kind: "inline", value: "d87980" }, { lovelace: 2_000_000n, [reserveNft]: 1n })
      .addSignerKey(pkh));

    // ── Feed SÁT CUỐI cửa sổ, ttl 1 giờ: hi phải kẹp ở cuối cửa sổ (nếu không, hai cận khác bucket) ──
    const w3 = windowNow(emulator) + 1n;
    advanceTo(emulator, ORIGIN + (w3 + 1n) * MS - 20n * 60_000n);
    expect(windowNow(emulator)).toBe(w3);
    const tail = await feed(5n * LAMP, { ttlMs: POT_MAX_RANGE_MS, minTtlMs: 60_000n });
    // Gửi TRƯỚC khi so `hiMs`: hi không kẹp thì validator (hai cận khác bucket) từ chối ở đây —
    // đỏ vì HÀNH VI on-chain, không chỉ vì một phép so số.
    await submit(lucid, emulator, tail.tx);
    expect(tail.window.hiMs).toBe(ORIGIN + (w3 + 1n) * MS - 1n);
    const afterTail = decodePotDatum((await potUtxo()).datum!);
    expect(afterTail.lastWindow).toBe(w3);
    const drawn = 400_000n * LAMP + 1n * LAMP + (overCap - 1n) + 5n * LAMP;
    expect(afterTail.drawnTotal).toBe(drawn);

    // ── Absorb: hai UTxO lạc (một mang datum OutputReference như két trả về, một không datum) ──
    const strayRefDatum = encodeRef(seed.txHash, 9);
    await submit(lucid, emulator, lucid.newTx()
      .pay.ToContract(pot.address, { kind: "inline", value: strayRefDatum }, { lovelace: 3_000_000n, [lampUnit]: 7n * LAMP })
      .pay.ToAddress(pot.address, { lovelace: 2_500_000n, [lampUnit]: 3n * LAMP }));
    const before = await potUtxo();
    const strays = (await lucid.utxosAt(pot.address)).filter((u) => !(pot.nftUnit in u.assets));
    expect(strays).toHaveLength(2);
    await submit(lucid, emulator, buildAbsorbTx({ lucid, pot, potUtxo: before, strays }));
    const after = await potUtxo();
    expect(after.assets[lampUnit]).toBe((before.assets[lampUnit] ?? 0n) + 10n * LAMP);
    expect(after.assets.lovelace).toBe(before.assets.lovelace);
    expect(after.datum).toBe(before.datum); // A-1: drawn_total KHÔNG hoàn
    expect((await lucid.utxosAt(pot.address))).toHaveLength(1);
  }, 120_000);
});

function encodeRef(txHash: string, idx: number): string {
  // OutputReference = Constr 0 [bytes(32), int] — datum két swap gửi kèm khi trả LAMP về pot_return.
  const n = idx.toString(16).padStart(2, "0");
  return `d8799f5820${txHash}${idx < 24 ? n : `18${n}`}ff`;
}
