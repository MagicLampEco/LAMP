// Vitest — đăng ký + uỷ quyền phần stake của địa chỉ kho (`stakeDelegationBuilder.ts`).
//
// Hai lớp kiểm:
//   1. Phần thuần: kiểm đầu vào và danh sách chứng chỉ.
//   2. Bộ giả lập lucid: giao dịch thật được dựng, script `treasury_stake` (đã apply ba khe)
//      được ĐÁNH GIÁ thật ở bước `complete()`, rồi giao dịch được nộp và trạng thái uỷ quyền
//      đọc lại từ bộ giả lập. Ca âm: ví không giữ khoá `delegation_admin` đã nướng vào script
//      thì `certificate_ok` trả False và giao dịch không dựng nổi.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CML, Emulator, Lucid, generateEmulatorAccount, paymentCredentialOf,
  validatorToScriptHash, type Validator,
} from "@lucid-evolution/lucid";
import { applyTreasuryStake } from "../offchain/src/stakeBuilder.js";
import {
  assertPoolId, planStakeDelegation, buildStakeDelegation,
} from "../offchain/src/stakeDelegationBuilder.js";

const PLUTUS_JSON = resolve(process.cwd(), "../onchain/plutus.json");

function load(title: string): Validator {
  const pj = JSON.parse(readFileSync(PLUTUS_JSON, "utf8"));
  const v = pj.validators.find((x: { title: string }) => x.title === title);
  if (!v) throw new Error(`${title} không có trong plutus.json — chạy aiken build trong onchain/`);
  return { type: "PlutusV3", script: v.compiledCode as string };
}

const STAKE_RAW = load("treasury_stake.treasury_stake.withdraw");
const CUSTODY_HASH = validatorToScriptHash(load("custody.custody.spend"));
const INSTANCE = "74726561737572792d637573746f64792d7631";   // "treasury-custody-v1"

const POOL_A = CML.Ed25519KeyHash.from_hex("ab".repeat(28)).to_bech32("pool");
const POOL_B = CML.Ed25519KeyHash.from_hex("cd".repeat(28)).to_bech32("pool");

function stakeFor(adminPkh: string): Validator {
  return applyTreasuryStake(STAKE_RAW.script, {
    instanceId: INSTANCE,
    rewardCred: { kind: "Script", hash: CUSTODY_HASH },
    delegationAdmin: adminPkh,
  });
}

// ══ Phần thuần ═════════════════════════════════════════════════════════
describe("planStakeDelegation", () => {
  const stake = stakeFor("5e".repeat(28));
  const base = { network: "Preprod" as const, stakeScript: stake, poolId: POOL_A, delegationAdmin: "5e".repeat(28) };

  it("lần đầu: đăng ký TRƯỚC rồi uỷ quyền", () => {
    const p = planStakeDelegation({ ...base, mode: "register-and-delegate" });
    expect(p.certs).toEqual(["register", "delegate"]);
    expect(p.rewardAddress.startsWith("stake_test1")).toBe(true);
    expect(p.poolId).toBe(POOL_A);
  });

  it("đã đăng ký: chỉ uỷ quyền", () => {
    expect(planStakeDelegation({ ...base, mode: "delegate" }).certs).toEqual(["delegate"]);
  });

  it("reward address là của CHÍNH script stake (Mainnet ra tiền tố stake1)", () => {
    const p = planStakeDelegation({ ...base, network: "Mainnet", mode: "delegate" });
    expect(p.rewardAddress.startsWith("stake1")).toBe(true);
  });

  it("ĐỎ: pool id không có tiền tố pool1", () => {
    expect(() => assertPoolId("ab".repeat(28))).toThrow(/TDELEG-001/);
  });

  it("ĐỎ: pool id sai checksum", () => {
    const broken = POOL_A.slice(0, -1) + (POOL_A.endsWith("q") ? "p" : "q");
    expect(() => assertPoolId(broken)).toThrow(/TDELEG-002/);
  });

  it("ĐỎ: delegation_admin sai độ dài", () => {
    expect(() => planStakeDelegation({ ...base, delegationAdmin: "aa", mode: "delegate" })).toThrow(/TDELEG-003/);
  });

  it("ĐỎ: mode lạ", () => {
    expect(() => planStakeDelegation({ ...base, mode: "deregister" as never })).toThrow(/TDELEG-004/);
  });
});

// ══ Bộ giả lập: script được đánh giá thật ══════════════════════════════
describe("buildStakeDelegation trên Emulator", () => {
  async function setup() {
    const admin = generateEmulatorAccount({ lovelace: 50_000_000_000n });
    const stranger = generateEmulatorAccount({ lovelace: 50_000_000_000n });
    const emulator = new Emulator([admin, stranger]);
    const lucid = await Lucid(emulator, "Custom");
    const adminPkh = paymentCredentialOf(admin.address).hash;
    const strangerPkh = paymentCredentialOf(stranger.address).hash;
    return { emulator, lucid, admin, stranger, adminPkh, strangerPkh, stake: stakeFor(adminPkh) };
  }

  it("admin đăng ký + uỷ quyền, rồi đổi pool", async () => {
    const { emulator, lucid, admin, adminPkh, stake } = await setup();
    lucid.selectWallet.fromSeed(admin.seedPhrase);
    const p = { network: "Custom" as const, stakeScript: stake, delegationAdmin: adminPkh };

    const tx1 = await buildStakeDelegation(lucid, { ...p, poolId: POOL_A, mode: "register-and-delegate" }).complete();
    const h1 = await (await tx1.sign.withWallet().complete()).submit();
    emulator.awaitBlock(1);
    expect(await lucid.awaitTx(h1)).toBe(true);
    const reward = planStakeDelegation({ ...p, poolId: POOL_A, mode: "delegate" }).rewardAddress;
    expect((await emulator.getDelegation(reward)).poolId).toBe(POOL_A);

    const tx2 = await buildStakeDelegation(lucid, { ...p, poolId: POOL_B, mode: "delegate" }).complete();
    const h2 = await (await tx2.sign.withWallet().complete()).submit();
    emulator.awaitBlock(1);
    expect(await lucid.awaitTx(h2)).toBe(true);
    expect((await emulator.getDelegation(reward)).poolId).toBe(POOL_B);
  });

  // Đăng ký phải là `reg_cert` (Conway, CÓ nhân chứng ⇒ script chạy ⇒ cổng chữ ký có hiệu
  // lực), không phải `stake_registration` kiểu cũ (không nhân chứng ⇒ ai cũng đăng ký hộ được).
  // Ca âm bên dưới KHÔNG phân biệt được hai kiểu: chứng chỉ uỷ quyền đi kèm đã đủ làm nó đỏ.
  it("chứng chỉ trong giao dịch: RegCert rồi StakeDelegation, đúng hai cái", async () => {
    const { lucid, admin, adminPkh, stake } = await setup();
    lucid.selectWallet.fromSeed(admin.seedPhrase);
    const tx = await buildStakeDelegation(lucid, {
      network: "Custom", stakeScript: stake, delegationAdmin: adminPkh, poolId: POOL_A, mode: "register-and-delegate",
    }).complete();
    const certs = tx.toTransaction().body().certs()!;
    const kinds = Array.from({ length: certs.len() }, (_, i) => certs.get(i).kind());
    expect(kinds).toEqual([CML.CertificateKind.RegCert, CML.CertificateKind.StakeDelegation]);
  });

  // `certificate_ok` đòi chữ ký của khoá đã NƯỚNG vào script, không phải của ví đang ký.
  // Người lạ khai khoá của chính mình làm admin thì builder vẫn dựng, nhưng script trả False.
  it("ĐỎ: ví không giữ khoá delegation_admin đã nướng vào script", async () => {
    const { lucid, stranger, strangerPkh, stake } = await setup();
    lucid.selectWallet.fromSeed(stranger.seedPhrase);
    await expect(
      buildStakeDelegation(lucid, {
        network: "Custom", stakeScript: stake, delegationAdmin: strangerPkh,
        poolId: POOL_A, mode: "register-and-delegate",
      }).complete(),
    ).rejects.toThrow(/validator|script|evaluat/i);
  });

  it("ĐỎ: uỷ quyền khi credential chưa đăng ký", async () => {
    const { lucid, admin, adminPkh, stake } = await setup();
    lucid.selectWallet.fromSeed(admin.seedPhrase);
    const tx = await buildStakeDelegation(lucid, {
      network: "Custom", stakeScript: stake, delegationAdmin: adminPkh, poolId: POOL_A, mode: "delegate",
    }).complete();
    await expect((await tx.sign.withWallet().complete()).submit()).rejects.toThrow(/not registered/i);
  });
});
