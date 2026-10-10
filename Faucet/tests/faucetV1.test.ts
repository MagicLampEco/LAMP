// Vòi v1 — off-chain `offchain/src/faucetV1.ts`, validator `onchain/validators/faucet_v1.ak`.
//
// Phần Emulator chạy VALIDATOR THẬT (blueprint `onchain/plutus.json`, cần `aiken build` trước):
// `complete()` của Lucid đánh giá script bằng máy UPLC cục bộ, nên một lần dựng xanh nghĩa là
// validator Aiken ĐÃ CHẤP NHẬN giao dịch do builder dựng. Ca đối chứng `tamper` dựng tay một tx
// lệch đúng một chỗ (pool trả thiếu) và phải đỏ — chứng minh đánh giá là thật, không phải xanh
// vì không chạy.
//
// CHỐT BÀI KIỂM NÀY KHÔNG GHIM ĐƯỢC:
//   • Koios Preprod thật (định dạng UTxO trả về, giới hạn tần suất) — Emulator thay nhà cung cấp;
//   • ví thật của ứng dụng thêm chữ ký mà giữ nguyên byte thân — ở đây ký bằng lucid;
//   • tranh chấp UTxO giữa hai người claim cùng lúc trên chuỗi thật — chỉ kiểm việc chọn ngẫu nhiên.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  Constr, Data, Emulator, Lucid, coreToTxOutput, credentialToAddress, credentialToRewardAddress,
  generateEmulatorAccountFromPrivateKey, keyHashToCredential,
  scriptHashToCredential, type LucidEvolution, type UTxO,
} from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";

import {
  FAUCET_V1_CLAIM_OILDROP, FAUCET_V1_PARAM_ORDER, FAUCET_V1_PREPROD_TLAMP, FAUCET_V1_TITLE,
  FaucetV1Error, assertClaimerAddress, buildFaucetV1ClaimTx, decodeFaucetV1Datum, encodeFaucetV1Datum,
  faucetV1Validator, faucetV1ValidatorFromCommitted, scanFaucetV1Pool, type FaucetV1Code,
} from "../offchain/src/faucetV1.js";

const ONCHAIN = resolve(process.cwd(), "../onchain");
const blueprint = JSON.parse(readFileSync(resolve(ONCHAIN, "plutus.json"), "utf8"));
const UNIT = FAUCET_V1_PREPROD_TLAMP.policyId + FAUCET_V1_PREPROD_TLAMP.assetName;
const CLAIM = FAUCET_V1_CLAIM_OILDROP;
const DATUM = encodeFaucetV1Datum(CLAIM);
const { validator, scriptHash } = faucetV1Validator(blueprint, FAUCET_V1_PREPROD_TLAMP);
const POOL = credentialToAddress("Custom", scriptHashToCredential(scriptHash));

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<FaucetV1Code | "OK" | string> {
  try {
    if (typeof p === "function") p(); else await p;
    return "OK";
  } catch (e) {
    return e instanceof FaucetV1Error ? e.code : `KHÁC: ${(e as Error).message}`;
  }
}

describe("script + datum", () => {
  it("tham số: thứ tự trong mã Aiken = thứ tự blueprint = thứ tự off-chain", () => {
    const src = readFileSync(resolve(ONCHAIN, "validators/faucet_v1.ak"), "utf8");
    const sig = /validator faucet\(([^)]*)\)/.exec(src)?.[1];
    expect(sig).toBeDefined();
    expect(sig!.split(",").map((s) => s.split(":")[0]!.trim())).toEqual([...FAUCET_V1_PARAM_ORDER]);
    const v = blueprint.validators.find((x: { title: string }) => x.title === FAUCET_V1_TITLE);
    expect(v.parameters.map((p: { title: string }) => p.title)).toEqual([...FAUCET_V1_PARAM_ORDER]);
  });

  it("hash áp tham số cho tLAMP Preprod 493002cc — đổi mã v1 thì bài này đỏ", () => {
    expect(scriptHash).toBe("75e87583f0e8ede310f8d230f6d320ded5a920761fa9e4c23689356a");
    expect(credentialToAddress("Preprod", scriptHashToCredential(scriptHash)))
      .toBe("addr_test1wp67savr7r5wmccslrfrpaknyr0dt2fqwc06nexzx6yn26sypk9ka");
  });

  it("blueprint thiếu validator / lệch số tham số ⇒ FAUCET-CONFIG", async () => {
    expect(await codeOf(() => faucetV1Validator({ validators: [] }, FAUCET_V1_PREPROD_TLAMP))).toBe("FAUCET-CONFIG");
    const v = blueprint.validators.find((x: { title: string }) => x.title === FAUCET_V1_TITLE);
    const bad = { validators: [{ ...v, parameters: [v.parameters[0]] }] };
    expect(await codeOf(() => faucetV1Validator(bad, FAUCET_V1_PREPROD_TLAMP))).toBe("FAUCET-CONFIG");
    expect(await codeOf(() => faucetV1Validator(blueprint, { policyId: "zz", assetName: "" }))).toBe("FAUCET-CONFIG");
  });

  it("datum FaucetDatum{100 tLAMP} = d8799f1a05f5e100ff, giải ngược đúng, hình dạng lạ thì NÉM", () => {
    expect(DATUM).toBe("d8799f1a05f5e100ff");
    expect(decodeFaucetV1Datum(DATUM)).toBe(CLAIM);
    expect(() => decodeFaucetV1Datum(Data.to(new Constr(1, [CLAIM])))).toThrow();
    expect(() => decodeFaucetV1Datum(Data.to(new Constr(0, [CLAIM, 1n])))).toThrow();
    expect(() => decodeFaucetV1Datum(Data.to(new Constr(0, [0n])))).toThrow();
    expect(() => decodeFaucetV1Datum(Data.to(new Constr(0, ["ab"])))).toThrow();
  });
});

const PKH = "ab".repeat(28);

describe("FAUCET-ADDR", () => {
  it("đối chứng: ví khoá Preprod cùng PKH thì nhận", () => {
    const a = credentialToAddress("Preprod", keyHashToCredential(PKH));
    expect(assertClaimerAddress(` ${a} `)).toBe(a);
  });
  const cases: Array<[string, unknown]> = [
    ["thiếu", undefined],
    ["không phải chuỗi", 42],
    ["chuỗi rác", "not-an-address"],
    ["mainnet (ví khoá hợp lệ)", credentialToAddress("Mainnet", keyHashToCredential(PKH))],
    ["địa chỉ script", POOL],
    ["địa chỉ stake", credentialToRewardAddress("Preprod", keyHashToCredential(PKH))],
  ];
  it.each(cases)("%s", async (_n, a) => {
    expect(await codeOf(() => assertClaimerAddress(a))).toBe("FAUCET-ADDR");
  });
});

// ── Emulator, validator thật ─────────────────────────────────────────────────

interface World { emulator: Emulator; lucid: LucidEvolution; claimer: ReturnType<typeof generateEmulatorAccountFromPrivateKey>;
  poor: ReturnType<typeof generateEmulatorAccountFromPrivateKey>; refUtxo: UTxO }

async function world(pools: Array<{ tlamp: bigint; datum?: string }>): Promise<World> {
  const admin = generateEmulatorAccountFromPrivateKey({ lovelace: 10_000_000_000n, [UNIT]: 10_000_000_000_000n });
  const claimer = generateEmulatorAccountFromPrivateKey({ lovelace: 20_000_000n });
  // Ví nghèo: 3 ADA thuần + một UTxO mang token kèm nhiều ADA — UTxO đó KHÔNG được dùng.
  const poor = generateEmulatorAccountFromPrivateKey({ lovelace: 3_000_000n });
  const emulator = new Emulator([admin, claimer, poor]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromPrivateKey(admin.privateKey);
  let tx = lucid.newTx();
  for (const p of pools) {
    tx = tx.pay.ToContract(POOL, { kind: "inline", value: p.datum ?? DATUM }, { lovelace: 2_000_000n, [UNIT]: p.tlamp });
  }
  // Reference script khoá vĩnh viễn ở chính địa chỉ pool (không datum ⇒ validator ném ở `expect Some`).
  tx = tx.pay.ToAddressWithData(POOL, undefined, { lovelace: 20_000_000n }, validator);
  tx = tx.pay.ToAddress(poor.address, { lovelace: 50_000_000n, [UNIT]: 1n });
  const signed = await (await tx.complete()).sign.withWallet().complete();
  await signed.submit();
  emulator.awaitBlock(1);
  const refUtxo = (await lucid.utxosAt(POOL)).find((u) => u.scriptRef);
  if (!refUtxo) throw new Error("không thấy UTxO reference script");
  return { emulator, lucid, claimer, poor, refUtxo };
}

const opts = (w: World, over: Partial<Parameters<typeof buildFaucetV1ClaimTx>[1]> = {}) => ({
  poolAddress: POOL, claimer: w.claimer.address, tlampUnit: UNIT, claimAmount: CLAIM, refScriptUtxo: w.refUtxo, ...over,
});

function outputsOf(lucid: LucidEvolution, cbor: string) {
  const body = lucid.fromTx(cbor).toTransaction().body();
  const outs = body.outputs();
  const shaped = [];
  for (let i = 0; i < outs.len(); i++) shaped.push(coreToTxOutput(outs.get(i)));
  const ins = body.inputs();
  const inputs: string[] = [];
  for (let i = 0; i < ins.len(); i++) inputs.push(`${ins.get(i).transaction_id().to_hex()}#${ins.get(i).index()}`);
  const col = body.collateral_inputs();
  const collateral: string[] = [];
  for (let i = 0; i < (col?.len() ?? 0); i++) collateral.push(`${col!.get(i).transaction_id().to_hex()}#${col!.get(i).index()}`);
  return { outputs: shaped, inputs, collateral, mint: body.mint() };
}

const ref = (u: UTxO) => `${u.txHash}#${u.outputIndex}`;

describe("Emulator — Claim trên validator thật", () => {
  it("happy (reference script): pool ra đúng địa chỉ/datum/value, người claim nhận 100 tLAMP, ký + gửi được", async () => {
    const w = await world([{ tlamp: 500_000n * 1_000_000n }]);
    const { lucid, emulator, claimer } = w;
    const r = await buildFaucetV1ClaimTx(lucid, opts(w));
    const { outputs, inputs, collateral, mint } = outputsOf(lucid, r.txCbor);

    const claimerUtxos = await lucid.utxosAt(claimer.address);
    expect(inputs).toContain(ref(r.poolUtxo));
    // Mọi input ngoài pool đều là UTxO thuần ADA của người claim; collateral cũng vậy.
    for (const i of inputs.filter((x) => x !== ref(r.poolUtxo))) expect(claimerUtxos.map(ref)).toContain(i);
    for (const c of collateral) expect(claimerUtxos.map(ref)).toContain(c);
    expect(mint).toBeUndefined();

    const poolOuts = outputs.filter((o) => o.address === POOL);
    expect(poolOuts).toHaveLength(1);
    expect(poolOuts[0]!.datum).toBe(r.poolUtxo.datum);
    expect(poolOuts[0]!.scriptRef).toBeUndefined();
    expect(poolOuts[0]!.assets).toEqual({ lovelace: r.poolUtxo.assets.lovelace, [UNIT]: r.poolUtxo.assets[UNIT]! - CLAIM });
    const toClaimer = outputs.filter((o) => o.address === claimer.address);
    expect(toClaimer.reduce((s, o) => s + (o.assets[UNIT] ?? 0n), 0n)).toBe(CLAIM);

    // Ví ứng dụng: thêm chữ ký vkey vào CBOR chưa ký rồi gửi.
    const signed = await lucid.fromTx(r.txCbor).sign.withPrivateKey(claimer.privateKey).complete();
    await signed.submit();
    emulator.awaitBlock(1);
    const after = await lucid.utxosAt(claimer.address);
    expect(after.reduce((s, u) => s + (u.assets[UNIT] ?? 0n), 0n)).toBe(CLAIM);
    const poolAfter = (await lucid.utxosAt(POOL)).reduce((s, u) => s + (u.assets[UNIT] ?? 0n), 0n);
    expect(poolAfter).toBe(500_000n * 1_000_000n - CLAIM);
  });

  it("happy (script đính trực tiếp lấy từ tệp COMMIT SẴN của máy chủ, không reference) + rút cạn đúng một UTxO 100 tLAMP", async () => {
    // Đúng đường máy chủ chạy khi không có FAUCET_REF_UTXO: đọc `server/faucet_v1.preprod.json`,
    // kiểm hash với địa chỉ pool, đính inline. Validator thật đánh giá trong `complete()`.
    const committed = faucetV1ValidatorFromCommitted(
      JSON.parse(readFileSync(resolve(process.cwd(), "../server/faucet_v1.preprod.json"), "utf8")), POOL);
    expect(committed.scriptHash).toBe(scriptHash);
    const w = await world([{ tlamp: CLAIM }]);
    const r = await buildFaucetV1ClaimTx(w.lucid, opts(w, { refScriptUtxo: undefined, validator: committed.validator }));
    const tx = w.lucid.fromTx(r.txCbor).toTransaction();
    expect(tx.body().reference_inputs()).toBeUndefined();
    expect(tx.witness_set().plutus_v3_scripts()?.len()).toBe(1);
    const { outputs } = outputsOf(w.lucid, r.txCbor);
    const poolOut = outputs.find((o) => o.address === POOL)!;
    expect(poolOut.assets).toEqual({ lovelace: 2_000_000n });   // tLAMP về 0, ADA giữ nguyên
    const signed = await w.lucid.fromTx(r.txCbor).sign.withPrivateKey(w.claimer.privateKey).complete();
    await signed.submit();
    w.emulator.awaitBlock(1);
    // Hết tLAMP ⇒ lần sau FAUCET-EMPTY.
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w)))).toBe("FAUCET-EMPTY");
  });

  it("đối chứng: cùng hình dạng nhưng pool trả THIẾU 1 oildrop ⇒ validator từ chối", async () => {
    const w = await world([{ tlamp: 1_000n * 1_000_000n }]);
    const pool = (await w.lucid.utxosAt(POOL)).find((u) => u.datum === DATUM)!;
    w.lucid.selectWallet.fromPrivateKey(w.claimer.privateKey);
    const tamper = w.lucid.newTx()
      .collectFrom([pool], Data.to(new Constr(0, [])))
      .pay.ToContract(POOL, { kind: "inline", value: DATUM }, { lovelace: 2_000_000n, [UNIT]: pool.assets[UNIT]! - CLAIM - 1n })
      .pay.ToAddress(w.claimer.address, { [UNIT]: CLAIM + 1n })
      .readFrom([w.refUtxo]);
    await expect(tamper.complete()).rejects.toThrow();
    // Cùng dựng tay, đúng lượng ⇒ được nhận (lỗi trên không đến từ phí/cân bằng/chữ ký).
    const ok = w.lucid.newTx()
      .collectFrom([pool], Data.to(new Constr(0, [])))
      .pay.ToContract(POOL, { kind: "inline", value: DATUM }, { lovelace: 2_000_000n, [UNIT]: pool.assets[UNIT]! - CLAIM })
      .pay.ToAddress(w.claimer.address, { [UNIT]: CLAIM })
      .readFrom([w.refUtxo]);
    await expect(ok.complete()).resolves.toBeDefined();
  });

  it("chọn ngẫu nhiên giữa ≥2 UTxO pool; UTxO rác (claim_amount sai, thiếu tLAMP, datum lạ) bị bỏ", async () => {
    const w = await world([
      { tlamp: 1_000n * 1_000_000n },
      { tlamp: 2_000n * 1_000_000n },
      { tlamp: 1_000n * 1_000_000n, datum: encodeFaucetV1Datum(1n) },           // bụi
      { tlamp: CLAIM - 1n },                                                     // thiếu
      { tlamp: 1_000n * 1_000_000n, datum: Data.to(new Constr(1, [])) },        // datum lạ
    ]);
    const scan = scanFaucetV1Pool(await w.lucid.utxosAt(POOL), UNIT, CLAIM);
    expect(scan.usable).toHaveLength(2);
    expect(scan.skipped).toHaveLength(4);   // 3 rác + UTxO reference script (không datum)

    const lo = await buildFaucetV1ClaimTx(w.lucid, opts(w, { random: () => 0 }));
    const hi = await buildFaucetV1ClaimTx(w.lucid, opts(w, { random: () => 0.999 }));
    expect(ref(lo.poolUtxo)).not.toBe(ref(hi.poolUtxo));
    expect(scan.usable.map(ref)).toContain(ref(lo.poolUtxo));
    expect(scan.usable.map(ref)).toContain(ref(hi.poolUtxo));

    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(ref((await buildFaucetV1ClaimTx(w.lucid, opts(w))).poolUtxo));
    expect(seen.size).toBe(2);   // xác suất đỏ oan 2·2^-30
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { random: () => 1 })))).toBe("FAUCET-CONFIG");
  });

  it("FAUCET-EMPTY: chỉ còn UTxO rác", async () => {
    const w = await world([{ tlamp: CLAIM - 1n }, { tlamp: 5n * CLAIM, datum: encodeFaucetV1Datum(2n * CLAIM) }]);
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w)))).toBe("FAUCET-EMPTY");
  });

  it("FAUCET-NO-ADA: 3 ADA thuần (UTxO mang token 50 ADA không được tính)", async () => {
    const w = await world([{ tlamp: 1_000n * 1_000_000n }]);
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { claimer: w.poor.address })))).toBe("FAUCET-NO-ADA");
  });

  it("FAUCET-ADDR trước mọi lời gọi mạng; FAUCET-CONFIG khi script/địa chỉ/đơn vị khai lệch", async () => {
    const w = await world([{ tlamp: 1_000n * 1_000_000n }]);
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { claimer: POOL })))).toBe("FAUCET-ADDR");
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { validator })))).toBe("FAUCET-CONFIG");          // cả hai nguồn
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { refScriptUtxo: undefined })))).toBe("FAUCET-CONFIG"); // không nguồn nào
    const other = faucetV1Validator(blueprint, { policyId: "11".repeat(28), assetName: "744c414d50" });
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { refScriptUtxo: undefined, validator: other.validator }))))
      .toBe("FAUCET-CONFIG");
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { tlampUnit: "lovelace" })))).toBe("FAUCET-CONFIG");
    expect(await codeOf(buildFaucetV1ClaimTx(w.lucid, opts(w, { claimAmount: 0n })))).toBe("FAUCET-CONFIG");
  });
});
