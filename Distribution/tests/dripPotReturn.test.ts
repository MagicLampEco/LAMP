// Két drip v0.3 — nhánh `Return` (`Distribution/drip-pot/CONTRACT.md` v0.3 §4.3) chạy qua HAI
// validator thật trong Emulator của Lucid (đánh giá UPLC cục bộ ở `complete()`, rồi ledger giả
// lập nhận giao dịch):
//   • `drip_pot` v0.3 — blueprint `Distribution/drip-pot/onchain/plutus.json` (aiken build);
//   • `treasury` (Distribution) — blueprint `Distribution/onchain/plutus.json`, nhánh `Refill`
//     dựng bằng `buildRefillTx` của chính SDK.
// Hai blueprint là artefact `aiken build`, bị .gitignore chặn: thiếu thì bài này NÉM ở lúc nạp
// (không bỏ qua im lặng).
//
// Policy LAMP và policy NFT TREASURY ở đây là giá trị dựng riêng cho bài kiểm: Emulator nhận tài
// sản tuỳ ý ở genesis, và cả `drip_pot` lẫn nhánh `Refill` chỉ so policy với tham số đã áp.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { describe, it, expect } from "vitest";
import {
  Constr, Data, Emulator, Lucid, applyParamsToScript, credentialToAddress,
  generateEmulatorAccountFromPrivateKey, paymentCredentialOf, toUnit, validatorToScriptHash,
  type EmulatorAccount, type LucidEvolution, type TxSignBuilder, type UTxO, type Validator,
} from "@lucid-evolution/lucid";

import {
  buildDripReturnTx, dripParamList, DRIP_RESERVE_DATUM_CBOR, DRIP_TREASURY_NFT_NAME,
} from "../offchain/src/dripPot.js";
import { DRIP_CURRENT_BLUEPRINT } from "../offchain/src/dripDeployment.js";
import { buildRefillTx } from "../offchain/src/refillBuilder.js";
import { treasuryDatumToCbor } from "../offchain/src/datum.js";

// `Distribution/tests/` biên dịch kiểu CommonJS (không dùng được `import.meta`): lấy đường dẫn từ
// hằng của SDK — `Distribution/drip-pot/onchain/plutus.json` và `Distribution/onchain/plutus.json`.
const DRIP_BLUEPRINT = DRIP_CURRENT_BLUEPRINT;
const TREASURY_BLUEPRINT = resolve(dirname(DRIP_CURRENT_BLUEPRINT), "../../onchain/plutus.json");

type Blueprint = { validators: { title: string; compiledCode: string; hash: string; parameters?: unknown[] }[] };
function compiled(path: string, title: string, nParams: number): string {
  const bp = JSON.parse(readFileSync(path, "utf8")) as Blueprint;
  const v = bp.validators.find((x) => x.title === title);
  if (!v) throw new Error(`thiếu '${title}' trong ${path} — chạy 'aiken build'.`);
  if (v.parameters?.length !== nParams) throw new Error(`'${title}' khai ${v.parameters?.length} tham số, bài kiểm áp ${nParams}.`);
  return v.compiledCode;
}
const DRIP_CODE = compiled(DRIP_BLUEPRINT, "drip_pot.drip_pot.spend", 10);
const TREASURY_CODE = compiled(TREASURY_BLUEPRINT, "treasury.treasury.spend", 9);

const LAMP_POLICY = "a1".repeat(28);
const LAMP_NAME = "744c414d50";
const LAMP = toUnit(LAMP_POLICY, LAMP_NAME);
const NFT_POLICY = "b2".repeat(28);
const NFT = toUnit(NFT_POLICY, DRIP_TREASURY_NFT_NAME);
const MS_PER_EPOCH = 432_000_000n;
const ORIGIN_MS = 1_654_041_600_000n;

const R = 1_000_000_000n;          // LAMP của Reserve (oildrop)
const POOL = 5_000_000n;           // LAMP sẵn trong carrier

interface World {
  emulator: Emulator;
  lucid: LucidEvolution;
  admin: EmulatorAccount;
  pkh: string;
  drip: Validator;
  dripAddr: string;
  treasury: Validator;
  treHash: string;
  treAddr: string;
}

async function submit(w: World, tx: TxSignBuilder): Promise<string> {
  const h = await (await tx.sign.withWallet().complete()).submit();
  w.emulator.awaitBlock(1);
  return h;
}

/** Kho Distribution (carrier mang TREASURY + TreasuryDatum) + két drip v0.3 có một Reserve. */
async function setup(opts: { nftQty?: bigint } = {}): Promise<World> {
  const admin = generateEmulatorAccountFromPrivateKey({
    lovelace: 2_000_000_000n, [LAMP]: 10n * R, [NFT]: opts.nftQty ?? 1n,
  });
  const emulator = new Emulator([admin]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromPrivateKey(admin.privateKey);
  const pkh = paymentCredentialOf(admin.address).hash;

  const treasury: Validator = { type: "PlutusV3", script: applyParamsToScript(TREASURY_CODE, [
    "c3".repeat(28), LAMP_POLICY, LAMP_NAME, [pkh], 1n, "d4".repeat(28), MS_PER_EPOCH, "e5".repeat(28), ORIGIN_MS,
  ] as never) };
  const treHash = validatorToScriptHash(treasury);
  const treAddr = credentialToAddress("Custom", { type: "Script", hash: treHash });

  const drip: Validator = { type: "PlutusV3", script: applyParamsToScript(DRIP_CODE, dripParamList({
    campaignIdHex: Buffer.from("return-test", "utf8").toString("hex"), lampPolicy: LAMP_POLICY, lampName: LAMP_NAME,
    committee: [pkh], threshold: 1n, msPerEpoch: MS_PER_EPOCH, windowOriginMs: ORIGIN_MS, vestEpochs: 36n,
    returnScript: treHash, treasuryNftPolicy: NFT_POLICY,
  }) as never) };
  const dripAddr = credentialToAddress("Custom", { type: "Script", hash: validatorToScriptHash(drip) });

  const w: World = { emulator, lucid, admin, pkh, drip, dripAddr, treasury, treHash, treAddr };
  const carrierDatum = treasuryDatumToCbor({ committee_hash: pkh, outstanding_entitlement: 0n, total_redeemed: 0n });
  let tx = lucid.newTx()
    .pay.ToContract(treAddr, { kind: "inline", value: carrierDatum }, { lovelace: 3_000_000n, [LAMP]: POOL, [NFT]: 1n })
    .pay.ToContract(dripAddr, { kind: "inline", value: DRIP_RESERVE_DATUM_CBOR }, { lovelace: 2_000_000n, [LAMP]: R })
    // Ví giữ LAMP + NFT ở UTxO tiền thối; builder Return chỉ tiêu UTxO THUẦN ADA ⇒ để sẵn hai cái.
    .pay.ToAddress(admin.address, { lovelace: 300_000_000n })
    .pay.ToAddress(admin.address, { lovelace: 300_000_000n });
  // Carrier thứ hai (chỉ cho ca âm "hai carrier"): cùng policy, cùng tên.
  if ((opts.nftQty ?? 1n) === 2n) {
    tx = tx.pay.ToContract(treAddr, { kind: "inline", value: carrierDatum }, { lovelace: 3_000_000n, [NFT]: 1n });
  }
  await submit(w, await tx.complete());
  return w;
}

const reserveOf = async (w: World) => {
  const rs = (await w.lucid.utxosAt(w.dripAddr)).filter((u) => u.datum === DRIP_RESERVE_DATUM_CBOR);
  expect(rs).toHaveLength(1);
  return rs[0]!;
};
const carrierOf = async (w: World) => (await w.lucid.utxosAt(w.treAddr)).filter((u) => (u.assets[NFT] ?? 0n) === 1n);

function returnParams(w: World, reserve: UTxO, treasuryUtxos: UTxO[], keepLamp = 0n) {
  return {
    lucid: w.lucid, script: w.drip, reserve, keepLamp, treasuryUtxos,
    returnScript: w.treHash, treasuryNftPolicy: NFT_POLICY, lampPolicy: LAMP_POLICY, lampName: LAMP_NAME,
    signers: [w.pkh], committee: [w.pkh], threshold: 1n,
  };
}

async function refill(w: World, utxos: UTxO[]) {
  return buildRefillTx({
    lucid: w.lucid, treasuryUtxos: utxos, treasuryScript: w.treasury,
    committeeSigners: [w.pkh], committeeThreshold: 1, lampPolicyId: LAMP_POLICY, lampAssetName: LAMP_NAME,
    treasuryNftPolicy: NFT_POLICY,
  });
}

describe("Return — drip_pot v0.3 thật trên Emulator (§4.3)", () => {
  it("trả trọn: Reserve hết, đúng một output KHÔNG datum ở địa chỉ carrier với r LAMP", async () => {
    const w = await setup();
    const reserve = await reserveOf(w);
    const res = await buildDripReturnTx(returnParams(w, reserve, await w.lucid.utxosAt(w.treAddr)));
    expect([res.reserveLamp, res.keptLamp, res.returnedLamp]).toEqual([R, 0n, R]);
    const h = await submit(w, res.tx);
    expect(await w.lucid.utxosAt(w.dripAddr)).toHaveLength(0);
    const back = (await w.lucid.utxosAt(w.treAddr)).filter((u) => u.txHash === h);
    expect(back).toHaveLength(1);
    expect(back[0]!.address).toBe(res.carrier.address);
    expect(back[0]!.datum ?? null).toBeNull();
    expect(back[0]!.datumHash ?? null).toBeNull();
    expect(back[0]!.assets[LAMP]).toBe(R);
    expect(Object.keys(back[0]!.assets).sort()).toEqual([LAMP, "lovelace"].sort());
  }, 60_000);

  it("trả một phần: Reserve tiếp nối giữ k, carrier nhận r − k", async () => {
    const w = await setup();
    const k = 400_000_000n;
    const res = await buildDripReturnTx(returnParams(w, await reserveOf(w), await w.lucid.utxosAt(w.treAddr), k));
    const h = await submit(w, res.tx);
    const left = await reserveOf(w);
    expect(left.txHash).toBe(h);
    expect(left.assets[LAMP]).toBe(k);
    const back = (await w.lucid.utxosAt(w.treAddr)).filter((u) => u.txHash === h);
    expect(back.map((u) => u.assets[LAMP])).toEqual([R - k]);
    expect(back[0]!.datum ?? null).toBeNull();
  }, 60_000);
});

describe("Return rồi Refill — CẢ HAI validator thật", () => {
  it("output trả về được nhánh Refill của kho gộp vào carrier: pool tăng đúng r", async () => {
    const w = await setup();
    const res = await buildDripReturnTx(returnParams(w, await reserveOf(w), await w.lucid.utxosAt(w.treAddr)));
    const h = await submit(w, res.tx);
    const all = await w.lucid.utxosAt(w.treAddr);
    expect(all).toHaveLength(2);
    const rf = await refill(w, all);
    expect(rf.excluded).toEqual([]);
    expect(rf.merged).toBe(2);
    await submit(w, rf.tx);
    const after = await w.lucid.utxosAt(w.treAddr);
    expect(after).toHaveLength(1);
    expect(after[0]!.assets[NFT]).toBe(1n);
    expect(after[0]!.assets[LAMP]).toBe(POOL + R);
    expect(after.some((u) => u.txHash === h)).toBe(false);
  }, 90_000);

  // Đối chứng cho lập luận NoDatum ở CONTRACT §4.3 ("một datum không giải mã được thành
  // `TreasuryDatum` làm MỌI nhánh từ chối input đó"): CÙNG địa chỉ carrier, CÙNG value, chỉ khác là
  // mang datum inline. Dựng thẳng từ ví vì két từ chối dựng nó (DP-RET-6).
  // ĐO ĐƯỢC 2026-10-05 (aiken v1.1.21, `treasury.ak` ở HEAD 36ce52d): nhánh `Refill` GỘP ĐƯỢC cả
  // ba hình dạng — nó không đọc `datum_opt`, và `Option<TreasuryDatum>` không bị ép kiểu khi không
  // dùng (khớp số đo 2026-09-27 ghi ở `refillBuilder.ts`). Bài này ghim hành vi ĐO ĐƯỢC; nó KHÔNG
  // chứng minh lập luận §4.3 — lập luận đó sai với nhánh `Refill`. NoDatum (DP-RET-6) vẫn là hình
  // dạng Refill gộp được (bài ngay trên), chỉ không phải hình dạng DUY NHẤT.
  const shapes: [string, string][] = [
    ["thẻ OutputReference Constr 0 [bytes, int]", Data.to(new Constr(0, ["ab".repeat(32), 0n]))],
    ["Int 42", Data.to(42n)],
    ["Constr 7 []", Data.to(new Constr(7, []))],
  ];
  for (const [label, datum] of shapes) {
    it(`đối chứng: cùng output nhưng mang datum inline ${label} ⇒ Refill VẪN gộp (lập luận §4.3 sai với Refill)`, async () => {
      const w = await setup();
      const carrier = (await carrierOf(w))[0]!;
      const h = await submit(w, await w.lucid.newTx()
        .pay.ToContract(carrier.address, { kind: "inline", value: datum }, { lovelace: 1_500_000n, [LAMP]: R })
        .complete());
      const stray = (await w.lucid.utxosAt(w.treAddr)).find((u) => u.txHash === h)!;
      expect(stray.datum).toBe(datum);
      const rf = await refill(w, [carrier, stray]);
      // `treasury.spend` chạy cho TỪNG input ở script: hai redeemer ⇒ input mang datum lạ có được
      // đánh giá thật, không phải bị bỏ qua.
      expect(rf.tx.toTransaction().witness_set().redeemers()?.as_arr_legacy_redeemer()?.len()
        ?? rf.tx.toTransaction().witness_set().redeemers()?.as_map_redeemer_key_to_redeemer_val()?.len()).toBe(2);
      await submit(w, rf.tx);
      const after = await w.lucid.utxosAt(w.treAddr);
      expect(after).toHaveLength(1);
      expect(after[0]!.assets[LAMP]).toBe(POOL + R);
    }, 90_000);
  }
});

describe("Return — ca âm của builder (ném trước khi dựng)", () => {
  it("không carrier ⇒ DRIP-RET-003", async () => {
    const w = await setup();
    const noNft = (await w.lucid.utxosAt(w.treAddr)).map((u) => ({ ...u, assets: { lovelace: u.assets.lovelace! } }));
    await expect(buildDripReturnTx(returnParams(w, await reserveOf(w), noNft))).rejects.toThrow(/DRIP-RET-003/);
    await expect(buildDripReturnTx(returnParams(w, await reserveOf(w), []))).rejects.toThrow(/DRIP-RET-003/);
  }, 60_000);

  it("hai carrier ⇒ DRIP-RET-004", async () => {
    const w = await setup({ nftQty: 2n });
    expect(await carrierOf(w)).toHaveLength(2);
    await expect(buildDripReturnTx(returnParams(w, await reserveOf(w), await w.lucid.utxosAt(w.treAddr))))
      .rejects.toThrow(/DRIP-RET-004/);
  }, 60_000);

  it("ví trả phí là script ⇒ DRIP-RET-006", async () => {
    const w = await setup();
    const reserve = await reserveOf(w);
    const tre = await w.lucid.utxosAt(w.treAddr);
    w.lucid.selectWallet.fromAddress(w.treAddr, tre);
    await expect(buildDripReturnTx(returnParams(w, reserve, tre))).rejects.toThrow(/DRIP-RET-006/);
  }, 60_000);

  it("k ≥ r ⇒ DRIP-RET-002; tập kho lẫn UTxO ngoài Script(return_script) ⇒ DRIP-RET-005", async () => {
    const w = await setup();
    const reserve = await reserveOf(w);
    const tre = await w.lucid.utxosAt(w.treAddr);
    await expect(buildDripReturnTx(returnParams(w, reserve, tre, R))).rejects.toThrow(/DRIP-RET-002/);
    await expect(buildDripReturnTx(returnParams(w, reserve, [...tre, reserve]))).rejects.toThrow(/DRIP-RET-005/);
  }, 60_000);
});
