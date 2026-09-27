// 30_feeder_accounts.ts — cấp nguồn cho pot Wakeme qua k tài khoản feeder song song.
//
// CÁCH CẤP NGUỒN ĐÃ CHỐT (`Distribution/capped-drop/CONTRACT.md §4d-1`): không đổi hằng số nào
// trên chuỗi; thay vào đó mở k tài khoản Capped Drop, mỗi tài khoản một khoá riêng. Toán học vì
// sao nhiều tài khoản nhanh hơn một tài khoản to: đầu `_feederPlan.ts`.
//
// KHOÁ FEEDER. Khoá thứ i = khoá payment của CIP-1852 account index i, dẫn xuất từ CHÍNH seed
// vận hành (`walletFromSeed`, địa chỉ enterprise). Không có kho khoá thứ hai phải giữ: mất
// seed là mất cả ví vận hành lẫn feeder, giữ seed là giữ cả hai. Index 0 là ví vận hành nên dải
// feeder bắt đầu từ 1 (`feederIndices`, FEED-RANGE-002).
//
// AI KÝ GÌ.
//   grant  — `GrantEntitlement` + `MintAccount`, owner = pkh feeder. Chỉ committee ký (ví vận
//            hành); feeder không ký. Ví vận hành trả phí + min-ADA của UTxO tài khoản.
//   redeem — `Redeem` của tài khoản feeder. C-RDM-6 đòi OWNER ký ⇒ ký thêm bằng khoá feeder.
//            LAMP phải về địa chỉ có payment credential = VK(owner) (`util.lamp_to_owner`), nên
//            đích là địa chỉ enterprise của chính feeder. Ví vận hành trả phí + collateral.
//   sweep  — gom LAMP từ địa chỉ feeder về một ví payment-key (mặc định: ví vận hành). Không
//            validator nào chạy; ký bằng khoá các feeder trong lô, ví vận hành trả phí và nhận
//            lại min-ADA của các UTxO feeder qua tiền thối.
//
// TÍNH LẶP LẠI ĐƯỢC. Mọi bước đọc lại chuỗi trước MỖI giao dịch và chờ giao dịch vào block
// rồi mới dựng giao dịch kế: kho TRSY là singleton, mọi grant/redeem đều tiêu nó, nên hai giao
// dịch dựng trên cùng một bản đọc thì giao dịch sau chắc chắn hỏng. `grant` bỏ qua feeder đã
// có tài khoản; chạy lại sau khi đứt giữa chừng là chạy tiếp, không cấp trùng.
//
// Chạy (mặc định STEP=plan, CHỈ ĐỌC; SUBMIT=false thì dựng giao dịch đầu tiên rồi dừng):
//   NETWORK=Preprod FEEDER_COUNT=1000 tsx 30_feeder_accounts.ts
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=grant  MAX_TX=500 SUBMIT=true tsx 30_feeder_accounts.ts
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=redeem MAX_TX=200 SUBMIT=true tsx 30_feeder_accounts.ts
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=sweep  SUBMIT=true tsx 30_feeder_accounts.ts
import {
  Data, credentialToAddress, scriptHashToCredential, toUnit, getAddressDetails, walletFromSeed,
  type LucidEvolution, type TxSignBuilder, type UTxO,
} from "@lucid-evolution/lucid";

import { NETWORK, SUBMIT, WALLET_SEED, makeLucid, walletPkh, explorerTx } from "./config.js";
import {
  rehydrate, canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, MS_PER_EPOCH, DROP_NAME,
} from "./_canonical_v2.js";
import {
  claimScripts, assertClaimScriptsMatch, pickTreasury, refKey,
} from "./_distributionScripts.js";
import {
  feederIndices, grantsThatFit, pickNextRedeem, chunk, assertSweepTarget, trancheCost,
  type FeederAccount,
} from "./_feederPlan.js";
import { buildClaimTx } from "../../Distribution/offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../../Distribution/offchain/src/redeemBuilder.js";
import {
  decodeTreasuryDatum, decodeClaimAccountDatum, decodeBeaconDatum,
} from "../../Distribution/offchain/src/datum.js";
import {
  OILDROP_PER_LAMP, TRIM_FLOOR, epochWindow,
} from "../../Distribution/offchain/src/constants.js";
import { accountNftName } from "../../Distribution/offchain/src/accountNft.js";
import { isqrt, windowsToFull } from "../../Distribution/offchain/src/vested.js";
import type { BeaconDatum, TreasuryDatum } from "../../Distribution/offchain/src/types.js";

// ── Tham số ──────────────────────────────────────────────────────────────────
const STEP = (process.env.STEP ?? "plan").toLowerCase();
const envInt = (name: string, dflt: string): number => {
  const raw = (process.env[name] ?? dflt).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`FEED-ENV-001: ${name}='${raw}' không phải số nguyên không âm.`);
  return Number(raw);
};
const envBig = (name: string, dflt: string): bigint => {
  const raw = (process.env[name] ?? dflt).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`FEED-ENV-001: ${name}='${raw}' không phải số nguyên không âm.`);
  return BigInt(raw);
};
/** Chỉ số khoá đầu dải. ≥ 1 (index 0 = ví vận hành). */
const FEEDER_BASE = envInt("FEEDER_BASE", "1");
/** Số feeder trong dải. Bắt buộc > 0 — không có mặc định, vì đây là núm công suất. */
const FEEDER_COUNT = envInt("FEEDER_COUNT", "0");
/**
 * E mỗi feeder (oildrop). Mặc định 1.001.000 LAMP: 1.000 feeder × E = 1,001 tỷ LAMP = pot Wakeme,
 * mở ~77.500 LAMP/feeder/cửa sổ, đầy sau 13 cửa sổ. Phí rút để phát trọn pot do dốc cắt ngọn
 * quyết (tối thiểu ~7.900 lượt cho 1 tỷ, bất kể k), nên k chỉ đổi tiền mở tài khoản trả trước (~2,5 ADA
 * mỗi feeder) lấy tốc độ (√k). Cần nhanh hơn thì thêm feeder từ lượt vest sau.
 */
const FEEDER_E = envBig("FEEDER_E_OILDROP", "1001000000000");
/** Trần số giao dịch MỘT lượt chạy — chạy lại là chạy tiếp. */
const MAX_TX = envInt("MAX_TX", "25");
/** Lượt rút dưới ngưỡng này bị bỏ qua (phí như nhau bất kể số). Mặc định = trần sàn 1.000 LAMP. */
const REDEEM_MIN = envBig("REDEEM_MIN_OILDROP", TRIM_FLOOR.toString());
/** Đích gom. Trống = ví vận hành. Chỉ nhận ví payment-key. */
const SWEEP_TO = (process.env.SWEEP_TO ?? "").trim();
/** Số UTxO feeder mỗi lượt gom — mỗi input kèm một chữ ký, giữ giao dịch dưới trần kích thước. */
const SWEEP_BATCH = envInt("SWEEP_BATCH", "40");

const lamp = (o: bigint) => `${o / OILDROP_PER_LAMP} LAMP`;
const ada = (l: bigint) => `${l / 1_000_000n},${(l % 1_000_000n).toString().padStart(6, "0").slice(0, 2)} ADA`;

// ── Khoá feeder ──────────────────────────────────────────────────────────────
interface Feeder {
  index:   number;
  address: string;   // enterprise, payment = khoá feeder
  pkh:     string;
  key:     string;   // khoá riêng bech32 — KHÔNG in, KHÔNG ghi ra đâu
}

function deriveFeeders(operatorPkh: string): Feeder[] {
  if (!WALLET_SEED) {
    throw new Error(
      `FEED-KEY-001: khoá feeder dẫn xuất từ seed vận hành, nhưng ví đang nạp bằng khoá riêng ` +
      `(không có seed). Chạy với seed.`,
    );
  }
  // Seed dẫn xuất feeder phải là CHÍNH seed của ví vận hành: index 0 (base) ra đúng pkh ví.
  // Lệch ⇒ feeder thuộc một cây khoá khác ví đang ký phí, và sweep về "ví vận hành" là về chỗ lạ.
  const op = walletFromSeed(WALLET_SEED, { addressType: "Base", accountIndex: 0, network: NETWORK });
  if (getAddressDetails(op.address).paymentCredential?.hash !== operatorPkh) {
    throw new Error(`FEED-KEY-003: seed dẫn xuất ra ví khác ví vận hành đang nạp. Dừng.`);
  }
  const seen = new Set<string>([operatorPkh]);
  return feederIndices({ base: FEEDER_BASE, count: FEEDER_COUNT }).map((index) => {
    const w = walletFromSeed(WALLET_SEED, { addressType: "Enterprise", accountIndex: index, network: NETWORK });
    const pkh = getAddressDetails(w.address).paymentCredential?.hash;
    if (!pkh) throw new Error(`FEED-KEY-004: không đọc được payment credential của feeder #${index}.`);
    if (seen.has(pkh)) throw new Error(`FEED-KEY-002: feeder #${index} trùng pkh với một khoá khác trong dải/ví vận hành.`);
    seen.add(pkh);
    return { index, address: w.address, pkh, key: w.paymentKey };
  });
}

// ── Đọc chuỗi ────────────────────────────────────────────────────────────────
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
  if (bs.length !== 1) throw new Error(`BCN-001: cần ĐÚNG 1 UTxO mang NFT "DROP", đếm ${bs.length}.`);
  const beaconUtxo = bs[0]!;
  if (!beaconUtxo.datum) throw new Error(`GRANT-000: beacon không có inline datum.`);
  const beacon = decodeBeaconDatum(Data.from(beaconUtxo.datum));
  if (beacon.rate_root <= 0n) throw new Error(`GRANT-000: beacon rate_root = ${beacon.rate_root} ≤ 0.`);
  const treasuryUtxo = pickTreasury(await lucid.utxosAt(wiring.treAddr), wiring.khoUnit);
  const treasury = decodeTreasuryDatum(Data.from(treasuryUtxo.datum!));
  return { beaconUtxo, beacon, treasuryUtxo, treasury, pool: treasuryUtxo.assets[wiring.lampUnit] ?? 0n };
}

type Account = { utxo: UTxO } & FeederAccount;

/** Một UTxO mang NFT tài khoản của feeder `f` → tài khoản. Datum phải mang đúng owner — không tin tên NFT suông. */
function toAccount(u: UTxO, f: Feeder): Account {
  if (!u.datum) throw new Error(`FEED-ACC-001: tài khoản ${refKey(u)} của feeder #${f.index} không có datum.`);
  const datum = decodeClaimAccountDatum(Data.from(u.datum));
  if (datum.owner.toLowerCase() !== f.pkh.toLowerCase()) {
    throw new Error(`FEED-ACC-002: tài khoản ${refKey(u)} mang NFT feeder #${f.index} nhưng datum owner ${datum.owner}.`);
  }
  return { utxo: u, pkh: f.pkh, datum, ref: refKey(u) };
}

/**
 * Mọi tài khoản của cả dải. Một feeder có hơn một tài khoản (chuỗi không chặn đúc lại cùng tên —
 * xem đầu `_feederPlan.ts`) thì KHÔNG dừng cả dải: báo FEED-ACC-003, giữ mọi tài khoản, vì tài
 * khoản thứ hai vẫn rút được và phần E của nó vẫn nằm trong sổ nợ của kho.
 */
async function readAccounts(lucid: LucidEvolution, claimAddr: string, accountPid: string,
                            feeders: Feeder[]): Promise<{ accounts: Account[]; owners: Set<string> }> {
  const byUnit = new Map(feeders.map((f) => [toUnit(accountPid, accountNftName(f.pkh)), f]));
  const accounts: Account[] = [];
  for (const u of await lucid.utxosAt(claimAddr)) {
    for (const [unit, f] of byUnit) {
      if ((u.assets[unit] ?? 0n) === 1n) accounts.push(toAccount(u, f));
    }
  }
  const owners = new Set(accounts.map((a) => a.pkh));
  if (owners.size !== accounts.length) {
    const count = new Map<string, number>();
    for (const a of accounts) count.set(a.pkh, (count.get(a.pkh) ?? 0) + 1);
    const dup = feeders.filter((f) => (count.get(f.pkh) ?? 0) > 1).map((f) => `#${f.index}×${count.get(f.pkh)}`);
    console.log(`⚠ FEED-ACC-003: ${dup.length} feeder có hơn một tài khoản (${dup.join(", ")}). ` +
      `Không cấp thêm cho họ; từng tài khoản vẫn được rút riêng.`);
  }
  return { accounts, owners };
}

/** Tài khoản của MỘT feeder, đọc thẳng theo unit NFT — rẻ, dùng ngay trước mỗi grant. */
async function accountsOf(lucid: LucidEvolution, claimAddr: string, accountPid: string,
                          f: Feeder): Promise<Account[]> {
  const unit = toUnit(accountPid, accountNftName(f.pkh));
  return (await lucid.utxosAtWithUnit(claimAddr, unit))
    .filter((u) => (u.assets[unit] ?? 0n) === 1n)
    .map((u) => toAccount(u, f));
}

// ── Ký + gửi ─────────────────────────────────────────────────────────────────
/**
 * Ký bằng ví vận hành + các khoá feeder cần thiết, gửi, chờ vào block. `SUBMIT=false` ⇒ không
 * ký, không gửi, trả `false` để vòng lặp dừng sau giao dịch đầu tiên — giao dịch kế dựng trên
 * trạng thái mà giao dịch này chưa tạo ra. Cố ý không in CBOR: committee 1-of-1, một CBOR đã ký
 * trong log là một giao dịch nộp được ngay bởi người đọc log.
 */
async function finish(lucid: LucidEvolution, tx: TxSignBuilder, label: string,
                      feederKeys: string[] = []): Promise<boolean> {
  if (!SUBMIT) {
    console.log(`  (SUBMIT=false) ${label} dựng xong, hash thân ${tx.toHash()}. Không ký, không gửi.`);
    return false;
  }
  let s = tx.sign.withWallet();
  for (const k of feederKeys) s = s.sign.withPrivateKey(k);
  const hash = await (await s.complete()).submit();
  console.log(`  📤 ${label}: ${hash}  ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  return true;
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");
  if (FEEDER_COUNT <= 0) throw new Error(`FEED-ENV-002: đặt FEEDER_COUNT > 0 (số feeder của dải).`);

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  const cs = await claimScripts(pkh, wiring.markers.khoPid, wiring.lampPid,
                                wiring.tokenName, wiring.markers.beaconPid);
  assertClaimScriptsMatch(cs, wiring);
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(cs.claimHash));
  const feeders = deriveFeeders(pkh);
  const byPkh = new Map(feeders.map((f) => [f.pkh, f]));
  const treasuryCommon = {
    script: scripts.treasury, nftPolicy: wiring.markers.khoPid, nftAssetName: "54525359",
  };

  console.log(`═══ Feeder pot Wakeme (${NETWORK}) · STEP=${STEP} ═══`);
  console.log(`Dải khoá        : #${FEEDER_BASE}..#${FEEDER_BASE + FEEDER_COUNT - 1} (${FEEDER_COUNT} feeder)`);
  console.log(`E mỗi feeder    : ${lamp(FEEDER_E)}`);

  // ── plan ──────────────────────────────────────────────────────────────────
  if (STEP === "plan") {
    const st = await readState(lucid, wiring);
    const accs = await readAccounts(lucid, claimAddr, cs.accountPid, feeders);
    const todo = feeders.length - accs.owners.size;
    const fit = grantsThatFit(st.pool, st.treasury.outstanding_entitlement, FEEDER_E, todo);
    const cost = trancheCost(fit, FEEDER_E);
    const walletLovelace = (await lucid.wallet().getUtxos()).reduce((s, u) => s + u.assets.lovelace, 0n);
    const perWindow = isqrt(FEEDER_E) * st.beacon.rate_root;
    const e = epochWindow(MS_PER_EPOCH).epoch;
    console.log(`\nKho             : pool ${lamp(st.pool)} · còn nợ ${lamp(st.treasury.outstanding_entitlement)} · đã phát ${lamp(st.treasury.total_redeemed)}`);
    console.log(`Beacon          : cửa sổ ${st.beacon.epoch} · w=${st.beacon.rate_root} · κ=${st.beacon.trim_num}/${st.beacon.trim_den}`);
    console.log(`Đã có tài khoản : ${accs.owners.size}/${feeders.length} feeder (${accs.accounts.length} UTxO tài khoản)`);
    console.log(`Grant còn lại   : ${todo} · vừa kho lúc này: ${fit}`);
    console.log(`Chi phí ${fit} grant: khoá ~${ada(cost.lockedLovelace)} + phí ~${ada(cost.grantFeeLovelace)} · ví đang có ${ada(walletLovelace)}`);
    console.log(`Mở khoá / feeder: ~${lamp(perWindow)} mỗi cửa sổ · đầy sau ${windowsToFull(FEEDER_E, 1n, st.beacon.rate_root)} cửa sổ`);
    console.log(`Mở khoá cả dải  : ~${lamp(perWindow * BigInt(feeders.length))} mỗi cửa sổ (chưa tính trần một lượt)`);
    const next = pickNextRedeem(accs.accounts, st.beacon, st.treasury, e, TRIM_FLOOR, REDEEM_MIN);
    console.log(`Rút kế tiếp     : ${next ? `feeder #${byPkh.get(next.pkh)!.index} · ${lamp(next.amount)} (cửa sổ ${e})` : "chưa tài khoản nào đạt ngưỡng"}`);
    return;
  }

  // ── grant ─────────────────────────────────────────────────────────────────
  if (STEP === "grant") {
    const have = await readAccounts(lucid, claimAddr, cs.accountPid, feeders);
    const todo = feeders.filter((f) => !have.owners.has(f.pkh));
    console.log(`Đã có tài khoản : ${have.owners.size}; còn ${todo.length}. Lượt này tối đa ${MAX_TX}.`);
    let done = 0;
    for (const f of todo.slice(0, MAX_TX)) {
      // Đọc lại NGAY trước khi dựng: danh sách đầu lượt có thể cũ (chỉ mục trễ, lượt chạy song
      // song, lượt trước đứt sau khi gửi). Chuỗi không chặn đúc trùng tên — chỗ chặn là ở đây.
      const already = await accountsOf(lucid, claimAddr, cs.accountPid, f);
      if (already.length > 0) {
        console.log(`Bỏ qua feeder #${f.index}: đã có tài khoản ${already.map((a) => a.ref).join(", ")}.`);
        continue;
      }
      const st = await readState(lucid, wiring);
      if (grantsThatFit(st.pool, st.treasury.outstanding_entitlement, FEEDER_E, 1) < 1) {
        console.log(`Kho hết chỗ (pool ${lamp(st.pool)}, nợ ${lamp(st.treasury.outstanding_entitlement)}). Dừng — vest + Refill rồi chạy lại.`);
        break;
      }
      const w = epochWindow(MS_PER_EPOCH);
      const r = await buildClaimTx({
        lucid, claimScript: cs.claim, network: NETWORK,
        ownerPkh: f.pkh, amount: FEEDER_E,
        currentEpoch: w.epoch,                     // C-ACC-2
        accountNft: { script: cs.accountNft, policyId: cs.accountPid },
        treasury: { utxo: st.treasuryUtxo, ...treasuryCommon },
        beacon: { utxo: st.beaconUtxo, datum: st.beacon },   // C-CLAIM-8
        committeeKeyHashes: canonicalCommittee(pkh),
        threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
        solvency: { treasuryLamp: st.pool, otherOutstanding: st.treasury.outstanding_entitlement },
        validFromMs: w.loMs, validToMs: w.hiMs,
      });
      if (r.mode !== "create") throw new Error(`FEED-GRANT-002: builder trả mode='${r.mode}', chờ 'create'.`);
      if (!(await finish(lucid, r.tx, `Grant feeder #${f.index}`))) return;
      done++;
    }
    console.log(`\nXong ${done} grant. Tài khoản mở ở cửa sổ e rút được từ cửa sổ e+1.`);
    return;
  }

  // ── redeem ────────────────────────────────────────────────────────────────
  if (STEP === "redeem") {
    let done = 0;
    let total = 0n;
    for (let i = 0; i < MAX_TX; i++) {
      const st = await readState(lucid, wiring);
      const accs = await readAccounts(lucid, claimAddr, cs.accountPid, feeders);
      const w = epochWindow(MS_PER_EPOCH);
      const pick = pickNextRedeem(accs.accounts, st.beacon, st.treasury, w.epoch, TRIM_FLOOR, REDEEM_MIN);
      if (!pick) { console.log(`Không tài khoản nào đạt ngưỡng ${lamp(REDEEM_MIN)} ở cửa sổ ${w.epoch}.`); break; }
      const f = byPkh.get(pick.pkh)!;
      const acc = accs.accounts.find((a) => a.ref === pick.ref);
      if (!acc) throw new Error(`FEED-RDM-002: kế hoạch chọn ${pick.ref} nhưng không thấy trong danh sách vừa đọc.`);
      const r = await buildRedeemTx({
        lucid, network: NETWORK,
        claimAccountUtxo: acc.utxo, claimScript: cs.claim,
        treasuryUtxo: st.treasuryUtxo, treasuryScript: scripts.treasury,
        dropBeaconUtxo: st.beaconUtxo,
        currentEpoch: w.epoch,
        validFromMs: w.loMs,
        treasuryNftPolicy: wiring.markers.khoPid, treasuryNftAssetName: "54525359",
        lampPolicyId: wiring.lampPid, lampAssetName: wiring.tokenName,
        destinationAddress: f.address,           // util.lamp_to_owner: payment = VK(owner)
      });
      // Kế hoạch và builder dùng cùng `redeemable`; lệch nghĩa là hai bên đọc hai trạng thái.
      if (r.amount !== pick.amount) {
        throw new Error(`FEED-RDM-001: kế hoạch ${pick.amount}, builder ${r.amount} cho feeder #${f.index}. Dừng.`);
      }
      if (!(await finish(lucid, r.tx, `Redeem feeder #${f.index} · ${lamp(r.amount)}`, [f.key]))) return;
      done++;
      total += r.amount;
    }
    console.log(`\nXong ${done} lượt rút, tổng ${lamp(total)}.`);
    return;
  }

  // ── sweep ─────────────────────────────────────────────────────────────────
  if (STEP === "sweep") {
    const target = SWEEP_TO || await lucid.wallet().address();
    assertSweepTarget(target, 0);   // Mainnet đã bị chặn ở đầu main() ⇒ networkId luôn 0
    const held: { f: Feeder; u: UTxO }[] = [];
    for (const f of feeders) {
      for (const u of await lucid.utxosAt(f.address)) {
        if ((u.assets[wiring.lampUnit] ?? 0n) > 0n) held.push({ f, u });
      }
    }
    const sum = held.reduce((s, h) => s + h.u.assets[wiring.lampUnit]!, 0n);
    console.log(`Đích gom        : ${target}`);
    console.log(`Đang nằm ở feeder: ${held.length} UTxO · ${lamp(sum)}`);
    let done = 0;
    for (const batch of chunk(held, SWEEP_BATCH).slice(0, MAX_TX)) {
      const amount = batch.reduce((s, h) => s + h.u.assets[wiring.lampUnit]!, 0n);
      const owners = [...new Map(batch.map((h) => [h.f.pkh, h.f])).values()];
      // Khai người ký bắt buộc để phép ước phí đếm đủ chữ ký feeder — ví chỉ biết khoá của nó.
      let txb = lucid.newTx()
        .collectFrom(batch.map((h) => h.u))
        .pay.ToAddress(target, { [wiring.lampUnit]: amount });
      for (const o of owners) txb = txb.addSignerKey(o.pkh);
      const tx = await txb.complete();
      const keys = owners.map((o) => o.key);
      if (!(await finish(lucid, tx, `Gom ${batch.length} UTxO · ${lamp(amount)}`, keys))) return;
      done++;
    }
    console.log(`\nXong ${done} lượt gom.`);
    return;
  }

  throw new Error(`STEP='${STEP}' không hợp lệ. Chọn: plan | grant | redeem | sweep.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
