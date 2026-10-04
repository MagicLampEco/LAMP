// 32_etd_claim.ts — đợt ETD (pot `early-tiger-deleg`) trên cụm canonical: cấp tài khoản Capped Drop
// cho danh sách delegator đã ký, rồi dựng lượt rút cho ví của người dùng.
//
// LUỒNG MỘT NGƯỜI DÙNG (đầu-cuối):
//   1. Delegator mở trang ký bằng ví trình duyệt (CIP-30 `signData` bằng STAKE key), chỉ định ví
//      nhận = ví khoá của họ trong app (payment key-hash). Bên Launch lưu bản ghi đó.
//   2. Launch lập danh sách cấp (`_etdGrants.ts` ▸ hợp đồng `etd-grants/1`) và giao cho LAMP.
//   3. STEP=grant (committee = ví vận hành ký): mỗi dòng một tài khoản `claim_account`,
//      owner = payment key-hash ở dòng đó, E = entitlement. Mở ở cửa sổ e ⇒ rút được từ e+1.
//   4. STEP=redeem: dựng giao dịch rút cho ví owner. Ví owner trả phí + collateral và KÝ (C-RDM-6);
//      LAMP về chính ví đó (`util.lamp_to_owner`). Không có khoá owner ⇒ in CBOR CHƯA KÝ để app ký.
//   5. App chuyển tiếp LAMP từ ví khoá vào Phoenix vault (địa chỉ `did_payment` của DID) bằng
//      một giao dịch thường. STEP=forward làm bước này cho ví THỬ, để đo trọn đường trên Preprod.
//
// VÍ THỬ (chỉ mạng thử). TEST_OWNER_INDEX=n ⇒ khoá payment CIP-1852 account n dẫn xuất từ seed vận
// hành, địa chỉ enterprise — cùng cách `30_feeder_accounts.ts` dẫn xuất feeder. Dải feeder dùng từ 1;
// chọn n ngoài dải đó. STEP=fund-test-owner gửi ADA cho ví thử để nó trả phí + collateral.
//
// Chạy (SUBMIT=false mặc định: dựng, không ký, không gửi):
//   NETWORK=Preprod GRANTS_FILE=<etd-grants.json> tsx 32_etd_claim.ts                 # plan
//   NETWORK=Preprod GRANTS_FILE=<…> STEP=grant SUBMIT=true tsx 32_etd_claim.ts
//   NETWORK=Preprod STEP=redeem OWNER_ADDRESS=addr_test1… tsx 32_etd_claim.ts         # CBOR chưa ký
//   NETWORK=Preprod STEP=test-owner TEST_OWNER_INDEX=9001 tsx 32_etd_claim.ts          # in địa chỉ ví thử
//   NETWORK=Preprod STEP=fund-test-owner TEST_OWNER_INDEX=9001 SUBMIT=true tsx 32_etd_claim.ts
//   NETWORK=Preprod STEP=redeem TEST_OWNER_INDEX=9001 SUBMIT=true tsx 32_etd_claim.ts
//   NETWORK=Preprod STEP=forward TEST_OWNER_INDEX=9001 VAULT_ADDRESS=addr_test1w… SUBMIT=true tsx 32_etd_claim.ts
import { readFileSync } from "node:fs";
import {
  Data, credentialToAddress, scriptHashToCredential, toUnit, getAddressDetails, walletFromSeed,
  type LucidEvolution, type UTxO,
} from "@lucid-evolution/lucid";

import { NETWORK, SUBMIT, WALLET_SEED, makeLucid, walletPkh, explorerTx } from "./config.js";
import {
  rehydrate, canonicalWindowOrigin, canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, MS_PER_EPOCH,
  DROP_NAME, TREASURY_NAME,
} from "./_canonical_v2.js";
import { claimScripts, assertClaimScriptsMatch, pickTreasury, refKey } from "./_distributionScripts.js";
import { grantsThatFit, dryRunAtFromEnv } from "./_feederPlan.js";
import { parseEtdGrants, planEtdGrants, type EtdGrant, type ExistingAccount } from "./_etdGrants.js";
import { buildClaimTx } from "../../Distribution/offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../../Distribution/offchain/src/redeemBuilder.js";
import {
  decodeTreasuryDatum, decodeClaimAccountDatum, decodeBeaconDatum,
} from "../../Distribution/offchain/src/datum.js";
import { OILDROP_PER_LAMP, TRIM_FLOOR, epochWindow } from "../../Distribution/offchain/src/constants.js";
import { accountNftName } from "../../Distribution/offchain/src/accountNft.js";
import { redeemable, remaining, windowsToFull } from "../../Distribution/offchain/src/vested.js";
import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "../../Distribution/offchain/src/types.js";

const STEP = (process.env.STEP ?? "plan").trim().toLowerCase();
const GRANTS_FILE = (process.env.GRANTS_FILE ?? "").trim();
const OWNER_ADDRESS_ENV = (process.env.OWNER_ADDRESS ?? "").trim();
const TEST_OWNER_INDEX = (process.env.TEST_OWNER_INDEX ?? "").trim();
const VAULT_ADDRESS = (process.env.VAULT_ADDRESS ?? "").trim();
const FORWARD_OILDROP = (process.env.FORWARD_OILDROP ?? "").trim();
const TEST_OWNER_LOVELACE = BigInt(process.env.TEST_OWNER_LOVELACE ?? "20000000");
const VAULT_LOVELACE = 2_000_000n;

const lamp = (o: bigint) => `${(Number(o) / Number(OILDROP_PER_LAMP)).toLocaleString("vi-VN")} LAMP`;

type Wiring = Awaited<ReturnType<typeof rehydrate>>["wiring"];

interface ChainState {
  beaconUtxo:   UTxO;
  beacon:       BeaconDatum;
  treasuryUtxo: UTxO;
  treasury:     TreasuryDatum;
  pool:         bigint;
}

async function readState(lucid: LucidEvolution, wiring: Wiring): Promise<ChainState> {
  const beaconUnit = toUnit(wiring.markers.beaconPid, DROP_NAME);
  const bs = (await lucid.utxosAt(wiring.beaconAddr)).filter((u) => (u.assets[beaconUnit] ?? 0n) === 1n);
  if (bs.length !== 1) throw new Error(`ETD-CHAIN-001: cần ĐÚNG 1 UTxO mang NFT "DROP", đếm ${bs.length}.`);
  const beaconUtxo = bs[0]!;
  if (!beaconUtxo.datum) throw new Error(`ETD-CHAIN-002: beacon không có inline datum.`);
  const treasuryUtxo = pickTreasury(await lucid.utxosAt(wiring.treAddr), wiring.khoUnit);
  return {
    beaconUtxo,
    beacon: decodeBeaconDatum(Data.from(beaconUtxo.datum)),
    treasuryUtxo,
    treasury: decodeTreasuryDatum(Data.from(treasuryUtxo.datum!)),
    pool: treasuryUtxo.assets[wiring.lampUnit] ?? 0n,
  };
}

/** Tài khoản của một owner, đọc theo unit NFT; datum phải mang đúng owner — không tin tên NFT suông. */
async function accountsOf(lucid: LucidEvolution, claimAddr: string, accountPid: string,
                          ownerPkh: string): Promise<{ utxo: UTxO; datum: ClaimAccountDatum }[]> {
  const unit = toUnit(accountPid, accountNftName(ownerPkh));
  return (await lucid.utxosAtWithUnit(claimAddr, unit))
    .filter((u) => (u.assets[unit] ?? 0n) === 1n)
    .map((u) => {
      if (!u.datum) throw new Error(`ETD-ACC-001: tài khoản ${refKey(u)} không có datum.`);
      const datum = decodeClaimAccountDatum(Data.from(u.datum));
      if (datum.owner.toLowerCase() !== ownerPkh) {
        throw new Error(`ETD-ACC-002: tài khoản ${refKey(u)} mang NFT của ${ownerPkh} nhưng datum owner ${datum.owner}.`);
      }
      return { utxo: u, datum };
    });
}

function loadGrants(): EtdGrant[] {
  if (!GRANTS_FILE) throw new Error("ETD-ENV-001: đặt GRANTS_FILE = đường tới danh sách `etd-grants/1`.");
  if (NETWORK !== "Preprod" && NETWORK !== "Preview" && NETWORK !== "Mainnet") {
    throw new Error(`ETD-ENV-002: NETWORK='${NETWORK}' không hỗ trợ.`);
  }
  return parseEtdGrants(JSON.parse(readFileSync(GRANTS_FILE, "utf8")), NETWORK);
}

interface TestOwner { address: string; pkh: string; key: string; stakeAddress: string | null }

function testOwner(): TestOwner {
  const n = Number(TEST_OWNER_INDEX);
  if (!Number.isInteger(n) || n < 1 || n > 0x7fffffff) {
    throw new Error(`ETD-TEST-001: TEST_OWNER_INDEX='${TEST_OWNER_INDEX}' phải là số nguyên trong [1, 2^31).`);
  }
  if (!WALLET_SEED) throw new Error("ETD-TEST-002: ví thử dẫn xuất từ seed vận hành, nhưng ví đang nạp bằng khoá riêng.");
  const w = walletFromSeed(WALLET_SEED, { addressType: "Enterprise", accountIndex: n, network: NETWORK });
  const pkh = getAddressDetails(w.address).paymentCredential?.hash;
  if (!pkh) throw new Error("ETD-TEST-003: không đọc được payment credential của ví thử.");
  // Địa chỉ stake của CÙNG account (dạng Base), để lập dòng thử cho danh sách `etd-grants/1`.
  const base = walletFromSeed(WALLET_SEED, { addressType: "Base", accountIndex: n, network: NETWORK });
  return { address: w.address, pkh, key: w.paymentKey, stakeAddress: base.rewardAddress ?? null };
}

async function submitAndWait(lucid: LucidEvolution, signed: { submit(): Promise<string> }, label: string): Promise<string> {
  // Mọi chỗ gọi đã rẽ nhánh SUBMIT=false trước; cổng này đứng ngay trước lời gửi để không đường
  // nào tới được bước gửi mà không qua nó (`Genesis/tests/submitGate.test.ts`).
  if (!SUBMIT) throw new Error(`ETD-SUBMIT-001: ${label} — SUBMIT=false nhưng đã tới bước gửi.`);
  const hash = await signed.submit();
  console.log(`📤 ${label}: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  console.log(`✅ Đã vào block.`);
  return hash;
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") {
    throw new Error("CHẶN: Mainnet chưa có genesis canonical; cụm ETD chỉ chạy được trên mạng thử.");
  }
  if (NETWORK !== "Preprod" && NETWORK !== "Preview") throw new Error(`CHẶN: NETWORK='${NETWORK}'.`);

  const lucid = await makeLucid();
  const opPkh = await walletPkh(lucid);
  const { wiring, scripts } = await rehydrate();
  if (opPkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${opPkh}.`);
  const originMs = canonicalWindowOrigin(NETWORK);
  const cs = await claimScripts(opPkh, wiring.markers.khoPid, wiring.lampPid,
                                wiring.tokenName, wiring.markers.beaconPid, originMs);
  assertClaimScriptsMatch(cs, wiring);
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(cs.claimHash));
  // DRY_RUN_AT_MS: chạy khô ở cửa sổ của một mốc khác (chỉ khi SUBMIT=false) — để thử Redeem của
  // tài khoản vừa mở trước khi tới cửa sổ e+1. Cùng cổng với `30_feeder_accounts.ts`.
  const dryRunAt = dryRunAtFromEnv(process.env.DRY_RUN_AT_MS, SUBMIT, STEP);
  const win = () => epochWindow(MS_PER_EPOCH, originMs, dryRunAt ?? BigInt(Date.now()));
  if (dryRunAt !== undefined) console.log(`⚠ CHẠY KHÔ ở mốc DRY_RUN_AT_MS=${dryRunAt} (cửa sổ ${win().epoch}), không phải giờ thật.`);

  console.log(`═══ ETD (${NETWORK}) · STEP=${STEP} · policy ${wiring.lampPid} ═══`);

  // ── plan / grant ───────────────────────────────────────────────────────────
  if (STEP === "plan" || STEP === "grant") {
    const grants = loadGrants();
    const st = await readState(lucid, wiring);
    const w = win();
    const existing = new Map<string, ExistingAccount[]>();
    const datums = new Map<string, ClaimAccountDatum>();
    for (const g of grants) {
      const accs = await accountsOf(lucid, claimAddr, cs.accountPid, g.ownerPkh);
      existing.set(g.ownerPkh, accs.map((a) => ({ ref: refKey(a.utxo), entitlement: a.datum.entitlement })));
      if (accs.length === 1) datums.set(g.ownerPkh, accs[0]!.datum);
    }
    const plan = planEtdGrants(grants, existing);
    const need = plan.toGrant.reduce((s, g) => s + g.entitlementOildrop, 0n);
    console.log(`Kho      : pool ${lamp(st.pool)} · còn nợ ${lamp(st.treasury.outstanding_entitlement)} · đã phát ${lamp(st.treasury.total_redeemed)}`);
    console.log(`Cửa sổ   : ${w.epoch} · beacon w=${st.beacon.rate_root} κ=${st.beacon.trim_num}/${st.beacon.trim_den}`);
    console.log(`Danh sách: ${grants.length} dòng · tổng ${lamp(grants.reduce((s, g) => s + g.entitlementOildrop, 0n))}`);
    console.log(`  cấp mới ${plan.toGrant.length} (${lamp(need)}) · đã cấp ${plan.done.length} · lệch ${plan.conflicts.length}`);
    for (const c of plan.conflicts) {
      console.log(`  ⚠ ETD-GRANT-011 ${c.grant.paymentAddress}: danh sách E=${c.grant.entitlementOildrop}, ` +
        `trên chuỗi ${c.accounts.map((a) => `${a.ref} E=${a.entitlement}`).join(", ")} — không tự xử.`);
    }
    for (const g of plan.done) {
      const d = datums.get(g.ownerPkh)!;
      const now = redeemable(d, st.beacon, st.treasury, w.epoch, TRIM_FLOOR);
      console.log(`  ✓ ${g.paymentAddress}: còn ${lamp(remaining(d))}, rút được lượt này ${lamp(now)}, ` +
        `đầy sau ~${windowsToFull(d.entitlement, d.drops_per_epoch, st.beacon.rate_root) ?? "∞"} cửa sổ kể từ lúc mở`);
    }
    if (STEP === "plan") {
      if (need > st.pool - st.treasury.outstanding_entitlement) {
        console.log(`⚠ Kho thiếu chỗ cho lượt cấp: cần ${lamp(need)}, trống ${lamp(st.pool - st.treasury.outstanding_entitlement)}. ` +
          `Vest + Refill trước (21_vest_to_kho.ts, 27_refill_treasury.ts).`);
      }
      return;
    }

    let done = 0;
    for (const g of plan.toGrant) {
      // Đọc lại NGAY trước khi dựng: kho là singleton, và chuỗi không chặn đúc trùng tên tài khoản.
      if ((await accountsOf(lucid, claimAddr, cs.accountPid, g.ownerPkh)).length > 0) {
        console.log(`Bỏ qua ${g.paymentAddress}: vừa có tài khoản.`);
        continue;
      }
      const s = await readState(lucid, wiring);
      if (grantsThatFit(s.pool, s.treasury.outstanding_entitlement, g.entitlementOildrop, 1) < 1) {
        console.log(`Kho hết chỗ (pool ${lamp(s.pool)}, nợ ${lamp(s.treasury.outstanding_entitlement)}). Dừng — vest + Refill rồi chạy lại.`);
        break;
      }
      const ww = win();
      const r = await buildClaimTx({
        lucid, claimScript: cs.claim, network: NETWORK,
        ownerPkh: g.ownerPkh, amount: g.entitlementOildrop,
        msPerEpoch: MS_PER_EPOCH, windowOriginMs: originMs,
        accountNft: { script: cs.accountNft, policyId: cs.accountPid },
        treasury: { utxo: s.treasuryUtxo, script: scripts.treasury, nftPolicy: wiring.markers.khoPid, nftAssetName: TREASURY_NAME },
        beacon: { utxo: s.beaconUtxo, datum: s.beacon },
        committeeKeyHashes: canonicalCommittee(opPkh),
        threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
        solvency: { treasuryLamp: s.pool, otherOutstanding: s.treasury.outstanding_entitlement },
        validFromMs: ww.loMs, validToMs: ww.hiMs,
      });
      if (r.mode !== "create") throw new Error(`ETD-GRANT-012: builder trả mode='${r.mode}', chờ 'create'.`);
      const label = `Grant ETD ${g.paymentAddress} · ${lamp(g.entitlementOildrop)}`;
      if (!SUBMIT) {
        console.log(`(SUBMIT=false) ${label} dựng xong, hash thân ${r.tx.toHash()}. Không ký, không gửi.`);
        return;
      }
      await submitAndWait(lucid, await r.tx.sign.withWallet().complete(), label);
      done++;
    }
    console.log(`\nXong ${done} lượt cấp. Tài khoản mở ở cửa sổ ${win().epoch} rút được từ cửa sổ ${win().epoch + 1n}.`);
    return;
  }

  // ── ví thử ─────────────────────────────────────────────────────────────────
  if (STEP === "test-owner") {
    const t = testOwner();
    console.log(`Ví thử #${TEST_OWNER_INDEX}: ${t.address}\n  pkh ${t.pkh}\n  stake ${t.stakeAddress}`);
    return;
  }

  if (STEP === "fund-test-owner") {
    const t = testOwner();
    const tx = await lucid.newTx().pay.ToAddress(t.address, { lovelace: TEST_OWNER_LOVELACE }).complete();
    if (!SUBMIT) { console.log(`(SUBMIT=false) gửi ${TEST_OWNER_LOVELACE} lovelace → ${t.address}. Hash ${tx.toHash()}.`); return; }
    await submitAndWait(lucid, await tx.sign.withWallet().complete(), `ADA cho ví thử #${TEST_OWNER_INDEX}`);
    return;
  }

  // ── redeem ─────────────────────────────────────────────────────────────────
  if (STEP === "redeem") {
    const t = TEST_OWNER_INDEX ? testOwner() : null;
    const ownerAddress = t ? t.address : OWNER_ADDRESS_ENV;
    if (!ownerAddress) throw new Error("ETD-RDM-001: đặt OWNER_ADDRESS (ví người dùng) hoặc TEST_OWNER_INDEX (ví thử).");
    if (t && OWNER_ADDRESS_ENV && OWNER_ADDRESS_ENV !== t.address) {
      throw new Error(`ETD-RDM-002: OWNER_ADDRESS khác địa chỉ ví thử #${TEST_OWNER_INDEX} (${t.address}).`);
    }
    const od = getAddressDetails(ownerAddress);
    if (od.paymentCredential?.type !== "Key") throw new Error("ETD-RDM-003: ví owner phải là ví khoá.");
    const ownerPkh = od.paymentCredential.hash.toLowerCase();

    const accs = await accountsOf(lucid, claimAddr, cs.accountPid, ownerPkh);
    if (accs.length === 0) throw new Error(`ETD-RDM-004: ${ownerAddress} chưa có tài khoản ETD.`);
    const st = await readState(lucid, wiring);
    const w = win();
    const ranked = accs
      .map((a) => ({ a, amt: redeemable(a.datum, st.beacon, st.treasury, w.epoch, TRIM_FLOOR) }))
      .sort((x, y) => (y.amt > x.amt ? 1 : y.amt < x.amt ? -1 : 0));
    const pick = ranked[0]!;
    if (pick.amt <= 0n) {
      throw new Error(`ETD-RDM-005: cửa sổ ${w.epoch} chưa rút được gì (tài khoản mở ở cửa sổ e rút từ e+1; ` +
        `start_epoch=${pick.a.datum.start_epoch}).`);
    }
    const ownerUtxos = await lucid.utxosAt(ownerAddress);
    if (ownerUtxos.length === 0) {
      throw new Error(`ETD-RDM-006: ví owner không có UTxO nào — cần ADA trả phí + collateral.`);
    }
    // Ví dựng giao dịch = ví owner: owner trả phí, nộp collateral, nhận tiền thối và nhận LAMP.
    lucid.selectWallet.fromAddress(ownerAddress, ownerUtxos);
    const r = await buildRedeemTx({
      lucid, network: NETWORK,
      claimAccountUtxo: pick.a.utxo, claimScript: cs.claim,
      treasuryUtxo: st.treasuryUtxo, treasuryScript: scripts.treasury,
      dropBeaconUtxo: st.beaconUtxo,
      msPerEpoch: MS_PER_EPOCH, windowOriginMs: originMs,
      validFromMs: w.loMs, validToMs: w.hiMs,
      treasuryNftPolicy: wiring.markers.khoPid, treasuryNftAssetName: TREASURY_NAME,
      lampPolicyId: wiring.lampPid, lampAssetName: wiring.tokenName,
      destinationAddress: ownerAddress,
    });
    console.log(`Rút ${lamp(r.amount)} từ ${refKey(pick.a.utxo)} về ${ownerAddress} (cửa sổ ${w.epoch}).`);
    if (!t) {
      // CBOR CHƯA KÝ: không ai nộp được nó nếu thiếu chữ ký owner (C-RDM-6), nên in ra là an toàn.
      console.log(`CBOR chưa ký (ví owner ký rồi nộp):\n${r.tx.toCBOR()}`);
      return;
    }
    if (!SUBMIT) { console.log(`(SUBMIT=false) hash thân ${r.tx.toHash()}. Không ký, không gửi.`); return; }
    await submitAndWait(lucid, await r.tx.sign.withPrivateKey(t.key).complete(), `Redeem ETD ví thử #${TEST_OWNER_INDEX}`);
    return;
  }

  // ── forward (ví thử → Phoenix vault) ────────────────────────────────────────
  if (STEP === "forward") {
    const t = testOwner();
    if (!VAULT_ADDRESS) throw new Error("ETD-FWD-001: đặt VAULT_ADDRESS = địa chỉ Phoenix vault (did_payment) của DID.");
    const vd = getAddressDetails(VAULT_ADDRESS);
    if (vd.paymentCredential?.type !== "Script") {
      throw new Error("ETD-FWD-002: VAULT_ADDRESS không phải địa chỉ script — Phoenix vault là địa chỉ `did_payment` (addr_test1w…).");
    }
    if (vd.networkId !== 0) throw new Error("ETD-FWD-003: VAULT_ADDRESS không thuộc mạng thử.");
    const utxos = await lucid.utxosAt(t.address);
    const held = utxos.reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);
    const amount = FORWARD_OILDROP ? BigInt(FORWARD_OILDROP) : held;
    if (amount <= 0n || amount > held) throw new Error(`ETD-FWD-004: ví thử giữ ${held} oildrop, xin chuyển ${amount}.`);
    lucid.selectWallet.fromAddress(t.address, utxos);
    // Không datum: `did_payment` nhận UTxO không datum (spend nhận Option<Data>).
    const tx = await lucid.newTx()
      .pay.ToAddress(VAULT_ADDRESS, { lovelace: VAULT_LOVELACE, [wiring.lampUnit]: amount })
      .complete();
    console.log(`Chuyển ${lamp(amount)} từ ví thử → ${VAULT_ADDRESS}.`);
    if (!SUBMIT) { console.log(`(SUBMIT=false) hash thân ${tx.toHash()}. Không ký, không gửi.`); return; }
    await submitAndWait(lucid, await tx.sign.withPrivateKey(t.key).complete(), `Chuyển vào Phoenix vault`);
    return;
  }

  throw new Error(`ETD-ENV-003: STEP='${STEP}' — chọn plan | grant | redeem | test-owner | fund-test-owner | forward.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
