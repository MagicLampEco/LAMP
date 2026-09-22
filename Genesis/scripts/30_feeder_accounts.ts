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
//   sweep  — gom ĐÚNG AMOUNT_OILDROP LAMP (bắt buộc) từ địa chỉ feeder về một ví payment-key
//            (mặc định: ví vận hành). Chọn UTxO như fundpot (lớn trước, loại UTxO mang asset lạ),
//            LAMP thừa về feeder ĐẦU lô cuối; không đủ ⇒ dừng, không gửi thiếu. Không validator
//            nào chạy; ký bằng khoá các feeder trong lô, ví vận hành trả phí và nhận lại min-ADA
//            của các UTxO feeder qua tiền thối.
//   fundpot — rót LAMP từ địa chỉ feeder THẲNG vào kho script của một pot, không đi qua ví vận
//            hành. Không validator nào chạy lúc tạo output, nên runner đòi khai hình dạng UTxO kho
//            nhận (POT_ADDRESS + POT_SCRIPT_HASH + POT_DATUM_CBOR, không mặc định) và soát bằng
//            đúng các cổng của `29_fund_script_pot.ts` (`_potShape.ts`). Output pot = đúng phần
//            LAMP của lượt + POT_LOVELACE, InlineDatum; LAMP thừa về địa chỉ feeder ĐẦU lô; ký
//            bằng khoá các feeder trong lô; ví vận hành trả phí + min-ADA, nhận tiền thối ADA.
//            Không đủ LAMP ⇒ dừng, in có/thiếu; rót một phần chỉ khi ALLOW_PARTIAL=true.
//
// TÍNH LẶP LẠI ĐƯỢC. Mặc định (CHAIN_DEPTH=1) mọi bước đọc lại chuỗi trước MỖI giao dịch và chờ
// giao dịch vào block rồi mới dựng giao dịch kế: kho TREASURY là singleton, mọi grant/redeem đều tiêu
// nó, nên hai giao dịch dựng trên cùng một bản đọc thì giao dịch sau chắc chắn hỏng. `grant` bỏ
// qua feeder đã có tài khoản; chạy lại sau khi đứt giữa chừng là chạy tiếp, không cấp trùng.
//
// NỐI CHUỖI (CHAIN_DEPTH=n>1, chỉ STEP=grant|redeem). Mempool node nhận giao dịch tiêu output của
// giao dịch còn trong mempool ⇒ không phải đợi block cho từng giao dịch. Mở chuỗi = chụp chuỗi
// một lần (beacon, kho, tài khoản, ví vận hành) thành LỚP PHỦ (`_chainOverlay.ts`); mỗi giao dịch
// dựng xong thì chồng hiệu ứng của nó (input tiêu, output tạo — trích từ chính thân giao dịch)
// lên lớp phủ, ví vận hành đọc qua `overrideUTxOs`. Gửi tối đa n giao dịch chưa xác nhận, chờ
// giao dịch CUỐI vào block (AWAIT_TX_TIMEOUT_MS), chờ chỉ mục thấy carrier mới nhất và không
// còn thấy input chuỗi đã tiêu, rồi mới chụp lại cho chuỗi kế. Cả chuỗi dùng MỘT cửa sổ
// (`windowNow()` lúc mở chuỗi); sắp hết cửa sổ (< CHAIN_WINDOW_MARGIN_MS) ⇒ không dựng thêm.
// Một giao dịch bị từ chối khi gửi ⇒ FEED-CHAIN-001 kèm mọi hash đã gửi, KHÔNG gửi tiếp; chạy
// lại đọc chuỗi thật từ đầu. SUBMIT=false + CHAIN_DEPTH=n ⇒ dựng khô n giao dịch nối nhau trên
// lớp phủ (đánh giá script cục bộ của Lucid chạy cho từng cái), không ký, không gửi.
//
// Chạy (mặc định STEP=plan, CHỈ ĐỌC; SUBMIT=false thì dựng giao dịch đầu tiên rồi dừng):
//   NETWORK=Preprod FEEDER_COUNT=1000 tsx 30_feeder_accounts.ts
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=grant  MAX_TX=500 SUBMIT=true tsx 30_feeder_accounts.ts
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=redeem MAX_TX=200 SUBMIT=true tsx 30_feeder_accounts.ts
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=redeem DRY_RUN_AT_MS=<posix ms> tsx 30_feeder_accounts.ts
//     (chạy khô ở cửa sổ của mốc đó — chỉ plan|redeem, chỉ khi SUBMIT=false)
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=sweep  AMOUNT_OILDROP=<n> [SWEEP_TO=<addr>] SUBMIT=true tsx 30_feeder_accounts.ts
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=fundpot AMOUNT_OILDROP=<n> \
//     POT_ADDRESS=<addr_test1w…> POT_SCRIPT_HASH=<hex28> POT_DATUM_CBOR=<cbor> POT_SHARE_OILDROP=<D> \
//     [POT_LOVELACE=2000000] [POT_BATCH=40] [MAX_TX=25] [ALLOW_PARTIAL=true] tsx 30_feeder_accounts.ts
//     (SUBMIT=false mặc định: dựng + soát giao dịch đầu tiên rồi dừng; thêm SUBMIT=true để ký, gửi.)
//   NETWORK=Preprod FEEDER_COUNT=1000 STEP=redeem MAX_TX=200 CHAIN_DEPTH=8 SUBMIT=true tsx 30_feeder_accounts.ts
//     (nối chuỗi tối đa 8 giao dịch chưa xác nhận; mặc định 1 = chờ từng giao dịch)
//   Mọi bước gửi: AWAIT_TX_TIMEOUT_MS (mặc định 1200000 = 20 phút) — quá hạn chờ vào block ⇒
//   FEED-AWAIT-001, thoát mã 1, câu lỗi mang hash giao dịch đã gửi.
import {
  Data, credentialToAddress, scriptHashToCredential, toUnit, getAddressDetails, walletFromSeed,
  coreToTxOutput,
  type LucidEvolution, type TxSignBuilder, type UTxO,
} from "@lucid-evolution/lucid";

import { NETWORK, SUBMIT, WALLET_SEED, makeLucid, walletPkh, explorerTx } from "./config.js";
import {
  rehydrate, canonicalWindowOrigin, canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, MS_PER_EPOCH,
  DROP_NAME, TREASURY_NAME, waitFor, isWaitTimeout,
} from "./_canonical_v2.js";
import {
  claimScripts, assertClaimScriptsMatch, pickTreasury, refKey,
} from "./_distributionScripts.js";
import {
  feederIndices, grantsThatFit, pickNextRedeem, assertSweepTarget, trancheCost,
  planPotFunding, planSweep, sweepAmountFromEnv, dryRunAtFromEnv, withDeadline,
  type FeederAccount, type FeederUtxo,
} from "./_feederPlan.js";
import {
  chainDepthFromEnv, makeView, applyTx, viewUtxosAt, viewUtxosAtWithUnit, viewCarrier,
  providerCaughtUp, spentByChain, chainWindowBlock, outRef, txEffects, type ChainView, type TxEffects,
} from "./_chainOverlay.js";
import {
  requireField, positiveBig, potTargetFromEnv, potOutputAssets, assertPotOutputs, unitAt, type OutputShape,
} from "./_potShape.js";
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
/**
 * Hạn giờ chờ MỘT giao dịch đã gửi vào block (ms). Mặc định 20 phút. `awaitTx` của nhà cung cấp
 * không có hạn giờ: giao dịch bị rớt khỏi mempool sau khi đã nhận thì tiến trình treo mãi, và job
 * gọi nó treo theo mà không có dòng log nào.
 */
const AWAIT_TX_TIMEOUT_MS = envInt("AWAIT_TX_TIMEOUT_MS", "1200000");
/**
 * Số giao dịch chưa xác nhận tối đa trong một chuỗi (STEP=grant|redeem). 1 = hành vi cũ y nguyên.
 * Trần: `CHAIN_DEPTH_MAX` (`_chainOverlay.ts`).
 */
const CHAIN_DEPTH = chainDepthFromEnv(process.env.CHAIN_DEPTH);
/** Không dựng thêm giao dịch của chuỗi khi còn ít hơn chừng này tới đầu trên cửa sổ (ms). */
const CHAIN_WINDOW_MARGIN_MS = envBig("CHAIN_WINDOW_MARGIN_MS", "600000");

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

/**
 * Nguồn đọc UTxO: nhà cung cấp (`lucid`, CHAIN_DEPTH=1 và mọi bước khác) hoặc lớp phủ của chuỗi
 * đang mở (`Chain.source`). Hai hàm đọc dưới đây không biết mình đang đọc cái nào — cố ý, để
 * đường chuỗi và đường cũ đi qua CÙNG phép giải mã + cùng cổng (BCN-001, TREASURY-001, FEED-ACC-*).
 */
interface UtxoSource {
  utxosAt(addr: string): Promise<UTxO[]>;
  utxosAtWithUnit(addr: string, unit: string): Promise<UTxO[]>;
}

async function readState(lucid: UtxoSource, wiring: Wiring): Promise<ChainState> {
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
async function readAccounts(lucid: UtxoSource, claimAddr: string, accountPid: string,
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
async function accountsOf(lucid: UtxoSource, claimAddr: string, accountPid: string,
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
  const hash = await signSubmit(tx, label, feederKeys);
  await awaitConfirmed(lucid, hash, label);
  return true;
}

/** Ký (ví vận hành + khoá feeder) và gửi. Dòng `📤 <label>: <hash>` là thứ job đếm — giữ khuôn. */
async function signSubmit(tx: TxSignBuilder, label: string, feederKeys: string[]): Promise<string> {
  let s = tx.sign.withWallet();
  for (const k of feederKeys) s = s.sign.withPrivateKey(k);
  const hash = await (await s.complete()).submit();
  console.log(`  📤 ${label}: ${hash}  ${explorerTx(hash)}`);
  return hash;
}

/**
 * Chờ `hash` vào block, có hạn giờ. Quá hạn ⇒ ném lên `main().catch` ⇒ thoát mã 1 (giết luôn vòng
 * thăm dò của nhà cung cấp). Giao dịch ĐÃ GỬI: câu lỗi mang hash để người chạy tra trước khi chạy lại.
 */
async function awaitConfirmed(lucid: LucidEvolution, hash: string, label: string, alsoSent: string[] = []): Promise<void> {
  const others = alsoSent.filter((h) => h !== hash);
  await withDeadline(lucid.awaitTx(hash), AWAIT_TX_TIMEOUT_MS, () => new Error(
    `FEED-AWAIT-001: quá ${AWAIT_TX_TIMEOUT_MS} ms (AWAIT_TX_TIMEOUT_MS) chờ ${label} vào block. ` +
    `Giao dịch ĐÃ GỬI: ${hash} — tra ${explorerTx(hash)} trước khi chạy lại (có thể đã vào block, ` +
    `có thể đã rớt khỏi mempool).` +
    (others.length > 0 ? ` Cùng chuỗi, gửi trước nó: ${others.join(", ")}.` : ""),
  ));
}

type EpochWindow = ReturnType<typeof epochWindow>;

/**
 * Một chuỗi giao dịch nối nhau (CHAIN_DEPTH > 1). Với CHAIN_DEPTH = 1 mọi phương thức quay về
 * đúng đường cũ: `source()` = nhà cung cấp, `window()` = `windowNow()` mỗi lần, `send()` = `finish`.
 *
 * Vòng đời: `source()` lần đầu ⇒ chụp chuỗi (mở chuỗi, chốt MỘT cửa sổ). `send()` ⇒ chồng hiệu ứng
 * lên lớp phủ TRƯỚC khi gửi (lớp phủ không nhất quán ⇒ ném trước khi có gì lên mạng), gửi, và đủ
 * CHAIN_DEPTH thì `settle()`. `settle()` ⇒ chờ giao dịch cuối vào block, chờ chỉ mục bắt kịp, bỏ
 * lớp phủ, trả ví về nhà cung cấp. Người gọi PHẢI gọi `settle()` khi rời vòng lặp.
 */
class Chain {
  private view: ChainView | null = null;
  private w: EpochWindow | null = null;
  private effects: TxEffects[] = [];
  private sent: string[] = [];

  constructor(
    private readonly lucid: LucidEvolution,
    private readonly addrs: { beacon: string; treasury: string; claim: string; wallet: string },
    private readonly khoUnit: string,
    private readonly windowNow: () => EpochWindow,
    private readonly nowMs: () => bigint,
    private readonly windowOriginMs: bigint,
  ) {}

  async source(): Promise<UtxoSource> {
    if (CHAIN_DEPTH === 1) return this.lucid;
    if (!this.view) await this.open();
    const v = this.view!;
    return {
      utxosAt: async (a) => viewUtxosAt(v, a),
      utxosAtWithUnit: async (a, u) => viewUtxosAtWithUnit(v, a, u),
    };
  }

  /** Cửa sổ cho giao dịch kế; `null` = không được dựng thêm (đã in lý do). */
  async window(): Promise<EpochWindow | null> {
    if (CHAIN_DEPTH === 1) return this.windowNow();
    if (!this.view) await this.open();
    const why = chainWindowBlock(this.w!, MS_PER_EPOCH, this.windowOriginMs, this.nowMs(), CHAIN_WINDOW_MARGIN_MS);
    if (why) { console.log(`Chuỗi dừng dựng: ${why}.`); return null; }
    return this.w!;
  }

  private async open(): Promise<void> {
    this.lucid.overrideUTxOs([]);   // ảnh chụp ví phải đến từ nhà cung cấp, không từ lớp phủ cũ
    const snap = new Map<string, UTxO[]>();
    for (const a of [this.addrs.beacon, this.addrs.treasury, this.addrs.claim]) snap.set(a, await this.lucid.utxosAt(a));
    snap.set(this.addrs.wallet, await this.lucid.wallet().getUtxos());
    this.view = makeView(snap);
    this.w = this.windowNow();
    this.effects = [];
    this.sent = [];
    viewCarrier(this.view, this.addrs.treasury, this.khoUnit);   // singleton ngay từ ảnh chụp
    this.overrideWallet();
    console.log(`── mở chuỗi (tối đa ${CHAIN_DEPTH} giao dịch) · cửa sổ ${this.w.epoch} · carrier ` +
      `${outRef(viewCarrier(this.view, this.addrs.treasury, this.khoUnit))}`);
  }

  /** Ví vận hành đọc qua lớp phủ. Rỗng ⇒ ném: `overrideUTxOs([])` của Lucid = quay về nhà cung cấp, im lặng. */
  private overrideWallet(): void {
    const ws = viewUtxosAt(this.view!, this.addrs.wallet);
    if (ws.length === 0) {
      throw new Error(`FEED-CHAIN-006: lớp phủ không còn UTxO nào của ví vận hành — Lucid sẽ lặng lẽ đọc ` +
        `ví từ nhà cung cấp (trạng thái cũ). Dừng chuỗi.`);
    }
    this.lucid.overrideUTxOs(ws);
  }

  /** Gửi (hoặc dựng khô) một giao dịch của chuỗi. Trả `false` khi vòng lặp phải dừng (như `finish`). */
  async send(tx: TxSignBuilder, label: string, feederKeys: string[] = []): Promise<boolean> {
    if (CHAIN_DEPTH === 1) return finish(this.lucid, tx, label, feederKeys);
    if (!this.view) throw new Error(`FEED-CHAIN-002: gửi ${label} khi chưa mở chuỗi (thiếu source()/window()).`);
    const eff = txEffects(tx);
    const next = applyTx(this.view!, eff);
    const carrier = viewCarrier(next, this.addrs.treasury, this.khoUnit);
    if (!SUBMIT) {
      console.log(`  (SUBMIT=false) ${label} dựng xong trên lớp phủ, hash thân ${eff.txHash} · carrier kế ` +
        `${outRef(carrier)} · ${this.effects.length + 1}/${CHAIN_DEPTH}. Không ký, không gửi.`);
      this.commit(next, eff);
      return this.effects.length < CHAIN_DEPTH;
    }
    // THỨ TỰ: ký khi ví còn đọc lớp phủ TRƯỚC giao dịch này. `signTx` của ví Lucid chọn khoá theo
    // UTxO ví đang thấy; ghi đè bằng lớp phủ SAU giao dịch trước khi ký thì input ví của chính nó
    // biến mất ⇒ ví không ký ⇒ thiếu chữ ký (ghim: `chainOverlay.test.ts`, ca "ghi đè ví … TRƯỚC khi ký").
    let hash: string;
    try {
      hash = await signSubmit(tx, label, feederKeys);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`FEED-CHAIN-001: ${label} bị từ chối khi gửi (giao dịch thứ ${this.sent.length + 1} của chuỗi). ` +
        `KHÔNG gửi tiếp. Đã gửi trong chuỗi: ${this.sent.length > 0 ? this.sent.join(", ") : "(chưa có)"}. ` +
        (this.sent.length > 0 ? `Chờ ${this.sent[this.sent.length - 1]} vào block rồi chạy lại (lần chạy sau đọc lại chuỗi thật). ` : "") +
        `Lỗi gốc: ${msg}`);
    }
    if (hash !== eff.txHash) {
      throw new Error(`FEED-CHAIN-001: nhà cung cấp trả hash ${hash} ≠ hash thân ${eff.txHash} mà lớp phủ đã ghi. ` +
        `KHÔNG gửi tiếp. Đã gửi trong chuỗi: ${[...this.sent, hash].join(", ")}.`);
    }
    this.sent.push(hash);
    this.commit(next, eff);
    if (this.sent.length >= CHAIN_DEPTH) await this.settle();
    return true;
  }

  private commit(next: ChainView, eff: TxEffects): void {
    this.view = next;
    this.effects.push(eff);
    this.overrideWallet();
  }

  /** Đóng chuỗi đang mở: chờ giao dịch cuối vào block + chỉ mục bắt kịp, rồi bỏ lớp phủ. */
  async settle(): Promise<void> {
    if (CHAIN_DEPTH === 1 || !this.view) return;
    const view = this.view;
    const sent = this.sent;
    const spent = spentByChain(this.effects);
    this.view = null; this.w = null; this.effects = []; this.sent = [];
    this.lucid.overrideUTxOs([]);
    if (sent.length === 0) return;
    const last = sent[sent.length - 1]!;
    await awaitConfirmed(this.lucid, last, `giao dịch cuối của chuỗi (${sent.length} giao dịch)`, sent);
    const carrierRef = outRef(viewCarrier(view, this.addrs.treasury, this.khoUnit));
    // Giao dịch cuối vào block kéo theo mọi giao dịch trước nó (nó tiêu output của chúng). Chỉ mục
    // theo địa chỉ có thể trễ ⇒ chờ tới khi thấy carrier mới nhất VÀ không còn thấy input đã tiêu
    // ở kho + ví. Hết giờ ⇒ ném: chuỗi kế dựng trên chỉ mục cũ là dựng trên carrier đã chết.
    try {
      await waitFor(
        `chỉ mục thấy carrier ${carrierRef}`,
        async () => [...await this.lucid.utxosAt(this.addrs.treasury), ...await this.lucid.wallet().getUtxos()],
        (us) => providerCaughtUp(us, [carrierRef], spent),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`FEED-CHAIN-007: chuỗi ĐÃ vào block (${last}) nhưng chỉ mục chưa bắt kịp — dừng, ` +
        `không mở chuỗi kế trên dữ liệu cũ. Chạy lại là chạy tiếp. (${msg})`);
    }
    console.log(`── chuỗi ${sent.length} giao dịch đã vào block; chỉ mục thấy carrier ${carrierRef}.`);
  }
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");
  // Builder Distribution nhận `Network` của `@magiclamp/utils` (không có "Custom") — thu hẹp
  // tường minh, cùng lý do ở `28_beacon_grant_redeem.ts` ▸ main.
  if (NETWORK !== "Preprod" && NETWORK !== "Preview") {
    throw new Error(`CHẶN: NETWORK='${NETWORK}' — script diễn tập chỉ chạy Preprod|Preview.`);
  }
  if (FEEDER_COUNT <= 0) throw new Error(`FEED-ENV-002: đặt FEEDER_COUNT > 0 (số feeder của dải).`);
  // Soát TRƯỚC khi gửi gì: hạn giờ sai mà chỉ lộ ra trong `finish` là lộ ra SAU một lần gửi.
  if (AWAIT_TX_TIMEOUT_MS < 1) throw new Error(`FEED-ENV-002: AWAIT_TX_TIMEOUT_MS phải ≥ 1 (đang ${AWAIT_TX_TIMEOUT_MS}).`);
  const dryRunAt = dryRunAtFromEnv(process.env.DRY_RUN_AT_MS, SUBMIT, STEP);
  // Cửa sổ hiệu lực cho plan/redeem: giờ thật, hoặc mốc DRY_RUN_AT_MS (chỉ khi SUBMIT=false).
  // Gốc cửa sổ lấy từ MẠNG đang chạy (`NETWORK`), cùng nguồn với `deriveWiring` ở `rehydrate()` bên dưới
  // (`wiring.network` được đối chiếu khi dựng lại); Preview NÉM ngay ở đây — fail-closed.
  const originMs = canonicalWindowOrigin(NETWORK);
  const windowNow = () => epochWindow(MS_PER_EPOCH, originMs, dryRunAt ?? BigInt(Date.now()));
  // Nối chuỗi chỉ hiện thực cho hai bước tiêu carrier. Bước khác nhận CHAIN_DEPTH>1 mà im lặng
  // chạy kiểu cũ là để người chạy tin rằng mình đang chạy nhanh.
  if (CHAIN_DEPTH > 1 && STEP !== "grant" && STEP !== "redeem") {
    throw new Error(`FEED-CHAIN-004: CHAIN_DEPTH=${CHAIN_DEPTH} chỉ áp cho STEP=grant|redeem (đang STEP=${STEP}).`);
  }

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  // `assertClaimScriptsMatch` bên dưới là cổng nếu gốc của NETWORK lệch gốc đã nướng trong state:
  // `claimHash` chứa gốc, nên lệch ⇒ APPLY-003, không phải một cửa sổ lệch im lặng.
  const cs = await claimScripts(pkh, wiring.markers.khoPid, wiring.lampPid,
                                wiring.tokenName, wiring.markers.beaconPid, originMs);
  assertClaimScriptsMatch(cs, wiring);
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(cs.claimHash));
  const feeders = deriveFeeders(pkh);
  const byPkh = new Map(feeders.map((f) => [f.pkh, f]));
  const treasuryCommon = {
    script: scripts.treasury, nftPolicy: wiring.markers.khoPid, nftAssetName: TREASURY_NAME,
  };
  const chain = new Chain(
    lucid,
    { beacon: wiring.beaconAddr, treasury: wiring.treAddr, claim: claimAddr, wallet: await lucid.wallet().address() },
    wiring.khoUnit, windowNow, () => dryRunAt ?? BigInt(Date.now()), originMs,
  );

  console.log(`═══ Feeder pot Wakeme (${NETWORK}) · STEP=${STEP} ═══`);
  console.log(`Dải khoá        : #${FEEDER_BASE}..#${FEEDER_BASE + FEEDER_COUNT - 1} (${FEEDER_COUNT} feeder)`);
  console.log(`E mỗi feeder    : ${lamp(FEEDER_E)}`);
  if (dryRunAt !== undefined) {
    console.log(`⚠ CHẠY KHÔ ở mốc DRY_RUN_AT_MS=${dryRunAt} (cửa sổ ${windowNow().epoch}), KHÔNG phải giờ thật. ` +
      `Pha 2 đánh giá cục bộ; pha 1 (khoảng hiệu lực so với tip) KHÔNG được thử.`);
  }

  // ── plan ──────────────────────────────────────────────────────────────────
  if (STEP === "plan") {
    const st = await readState(lucid, wiring);
    const accs = await readAccounts(lucid, claimAddr, cs.accountPid, feeders);
    const todo = feeders.length - accs.owners.size;
    const fit = grantsThatFit(st.pool, st.treasury.outstanding_entitlement, FEEDER_E, todo);
    const cost = trancheCost(fit, FEEDER_E);
    const walletLovelace = (await lucid.wallet().getUtxos()).reduce((s, u) => s + u.assets.lovelace, 0n);
    const perWindow = isqrt(FEEDER_E) * st.beacon.rate_root;
    const e = windowNow().epoch;
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
      // CHAIN_DEPTH>1: "đọc lại" = đọc lớp phủ, nơi đã có tài khoản của các grant vừa gửi.
      const src = await chain.source();
      const already = await accountsOf(src, claimAddr, cs.accountPid, f);
      if (already.length > 0) {
        console.log(`Bỏ qua feeder #${f.index}: đã có tài khoản ${already.map((a) => a.ref).join(", ")}.`);
        continue;
      }
      const st = await readState(src, wiring);
      if (grantsThatFit(st.pool, st.treasury.outstanding_entitlement, FEEDER_E, 1) < 1) {
        console.log(`Kho hết chỗ (pool ${lamp(st.pool)}, nợ ${lamp(st.treasury.outstanding_entitlement)}). Dừng — vest + Refill rồi chạy lại.`);
        break;
      }
      // CHAIN_DEPTH=1: `epochWindow(MS_PER_EPOCH, originMs)` mỗi lượt như cũ (grant không nhận DRY_RUN_AT_MS).
      const w = await chain.window();
      if (!w) break;
      const r = await buildClaimTx({
        lucid, claimScript: cs.claim, network: NETWORK,
        ownerPkh: f.pkh, amount: FEEDER_E,
        msPerEpoch: MS_PER_EPOCH, windowOriginMs: originMs,   // C-ACC-2: builder suy start_epoch từ validFromMs
        accountNft: { script: cs.accountNft, policyId: cs.accountPid },
        treasury: { utxo: st.treasuryUtxo, ...treasuryCommon },
        beacon: { utxo: st.beaconUtxo, datum: st.beacon },   // C-CLAIM-8
        committeeKeyHashes: canonicalCommittee(pkh),
        threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
        solvency: { treasuryLamp: st.pool, otherOutstanding: st.treasury.outstanding_entitlement },
        validFromMs: w.loMs, validToMs: w.hiMs,
      });
      if (r.mode !== "create") throw new Error(`FEED-GRANT-002: builder trả mode='${r.mode}', chờ 'create'.`);
      if (!(await chain.send(r.tx, `Grant feeder #${f.index}`))) { await chain.settle(); return; }
      done++;
    }
    await chain.settle();
    console.log(`\nXong ${done} grant. Tài khoản mở ở cửa sổ e rút được từ cửa sổ e+1.`);
    return;
  }

  // ── redeem ────────────────────────────────────────────────────────────────
  if (STEP === "redeem") {
    let done = 0;
    let total = 0n;
    for (let i = 0; i < MAX_TX; i++) {
      // CHAIN_DEPTH>1: trạng thái + tài khoản đọc qua lớp phủ (carrier và tài khoản do các
      // Redeem vừa gửi tạo ra), cửa sổ là MỘT giá trị cho cả chuỗi.
      const src = await chain.source();
      const st = await readState(src, wiring);
      const accs = await readAccounts(src, claimAddr, cs.accountPid, feeders);
      const w = await chain.window();
      if (!w) break;
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
        // Builder SUY cửa sổ từ đầu dưới (`(validFromMs − windowOriginMs) / msPerEpoch`) — cùng `w`
        // mà kế hoạch `pickNextRedeem` vừa dùng, nên `r.amount` so được với `pick.amount` bên dưới.
        msPerEpoch: MS_PER_EPOCH, windowOriginMs: originMs,
        validFromMs: w.loMs,
        validToMs: w.hiMs,
        treasuryNftPolicy: wiring.markers.khoPid, treasuryNftAssetName: TREASURY_NAME,
        lampPolicyId: wiring.lampPid, lampAssetName: wiring.tokenName,
        destinationAddress: f.address,           // util.lamp_to_owner: payment = VK(owner)
      });
      // Kế hoạch và builder dùng cùng `redeemable`; lệch nghĩa là hai bên đọc hai trạng thái.
      if (r.amount !== pick.amount) {
        throw new Error(`FEED-RDM-001: kế hoạch ${pick.amount}, builder ${r.amount} cho feeder #${f.index}. Dừng.`);
      }
      if (!(await chain.send(r.tx, `Redeem feeder #${f.index} · ${lamp(r.amount)}`, [f.key]))) {
        await chain.settle();
        return;
      }
      done++;
      total += r.amount;
    }
    await chain.settle();
    console.log(`\nXong ${done} lượt rút, tổng ${lamp(total)}.`);
    return;
  }

  // ── sweep ─────────────────────────────────────────────────────────────────
  if (STEP === "sweep") {
    // Lượng gom BẮT BUỘC (FEED-SWEEP-004): gom ĐÚNG số này, không gom tất. Phép chọn dùng chung
    // với fundpot (`planSweep` → `planPotFunding`): lớn trước, loại UTxO mang asset lạ, LAMP thừa
    // về feeder ĐẦU lô cuối. Không đủ ⇒ ném, không gửi thiếu.
    const amount = sweepAmountFromEnv(process.env.AMOUNT_OILDROP);
    const lampUnit = wiring.lampUnit;
    const walletAddr = await lucid.wallet().address();
    const target = SWEEP_TO || walletAddr;
    assertSweepTarget(target, 0);   // Mainnet đã bị chặn ở đầu main() ⇒ networkId luôn 0
    // Đích trùng một feeder: gom về chính dải (vô nghĩa) và làm phép đối chiếu theo địa chỉ ở dưới
    // cộng lẫn phần thừa với phần gom.
    const self = feeders.find((f) => f.address === target);
    if (self) throw new Error(`FEED-SWEEP-006: SWEEP_TO là địa chỉ của chính feeder #${self.index}. Dừng.`);

    const held: FeederUtxo[] = [];
    const utxoByRef = new Map<string, UTxO>();
    for (const f of feeders) {
      for (const u of await lucid.utxosAt(f.address)) {
        if ((u.assets[lampUnit] ?? 0n) <= 0n) continue;
        const ref = refKey(u);
        utxoByRef.set(ref, u);
        held.push({ index: f.index, pkh: f.pkh, address: f.address, ref, assets: u.assets });
      }
    }
    const byIndex = new Map(feeders.map((f) => [f.index, f]));
    const sum = held.reduce((s, h) => s + h.assets[lampUnit]!, 0n);
    console.log(`Đích gom        : ${target}`);
    console.log(`Cần gom         : ${amount} oildrop (${lamp(amount)})`);
    console.log(`Đang nằm ở feeder: ${held.length} UTxO · ${lamp(sum)}`);
    const plan = planSweep(held, { lampUnit, amount, batchSize: SWEEP_BATCH, maxTx: MAX_TX });
    for (const x of plan.excluded) console.log(`  loại ${x.ref} (feeder #${x.index}): ${x.reason}`);
    console.log(`Kế hoạch        : ${plan.batches.length} giao dịch · gom ${plan.total} oildrop · loại ${plan.excluded.length}`);

    let swept = 0n;
    for (const [i, b] of plan.batches.entries()) {
      const owners = [...new Map(b.inputs.map((x) => [x.pkh, byIndex.get(x.index)!])).values()];
      // Khai người ký bắt buộc để phép ước phí đếm đủ chữ ký feeder — ví chỉ biết khoá của nó.
      let txb = lucid.newTx()
        .collectFrom(b.inputs.map((x) => utxoByRef.get(x.ref)!))
        .pay.ToAddress(target, { [lampUnit]: b.potAmount });
      if (b.change > 0n) txb = txb.pay.ToAddress(b.changeAddress, { [lampUnit]: b.change });
      for (const o of owners) txb = txb.addSignerKey(o.pkh);
      const tx = await txb.complete();

      // Soát giao dịch ĐÃ DỰNG, không tin value đã khai: đích nhận ĐÚNG phần của lô, LAMP thừa
      // nằm đúng ở feeder đầu lô, không LAMP nào đi địa chỉ thứ tư. Ngoại lệ duy nhất: ví vận hành
      // có thể bị chọn input trả phí mang LAMP của CHÍNH nó, phần đó về lại ví qua tiền thối — nên
      // khi đích = ví vận hành, đích được nhận ≥ (không =) phần của lô.
      const outs = tx.toTransaction().body().outputs();
      const built: OutputShape[] = [];
      for (let k = 0; k < outs.len(); k++) built.push(coreToTxOutput(outs.get(k)));
      const toTarget = unitAt(built, target, lampUnit);
      const toChange = unitAt(built, b.changeAddress, lampUnit);
      const elsewhere = built
        .filter((o) => o.address !== target && o.address !== b.changeAddress && o.address !== walletAddr)
        .reduce((s, o) => s + (o.assets[lampUnit] ?? 0n), 0n);
      const targetOk = target === walletAddr ? toTarget >= b.potAmount : toTarget === b.potAmount;
      if (!targetOk || toChange !== b.change || elsewhere !== 0n) {
        throw new Error(
          `FEED-SWEEP-007: giao dịch dựng ra lệch kế hoạch — đích ${toTarget}/${b.potAmount}, ` +
          `thừa ở feeder ${toChange}/${b.change}, LAMP đi địa chỉ khác ${elsewhere}. Dừng.`,
        );
      }
      const label = `Gom ${i + 1}/${plan.batches.length} · ${b.inputs.length} UTxO · ${lamp(b.potAmount)}` +
        (b.change > 0n ? ` · thừa ${b.change} oildrop về feeder #${b.inputs[0]!.index}` : "");
      if (!(await finish(lucid, tx, label, owners.map((o) => o.key)))) return;
      swept += b.potAmount;
    }
    console.log(`\nXong ${plan.batches.length} lượt gom, tổng ${swept} oildrop (${lamp(swept)}) về ${target}.`);
    return;
  }

  // ── fundpot ───────────────────────────────────────────────────────────────
  if (STEP === "fundpot") {
    // Mọi lời khai của pot bắt buộc, không mặc định; soát bằng cổng chung với 29 (`_potShape.ts`).
    // Mainnet đã bị chặn ở đầu main() ⇒ networkId luôn 0.
    const pot = potTargetFromEnv(process.env, 0);
    const amount = positiveBig("AMOUNT_OILDROP", requireField("AMOUNT_OILDROP", process.env.AMOUNT_OILDROP));
    const potLovelace = positiveBig("POT_LOVELACE", process.env.POT_LOVELACE ?? "2000000");
    // D — một suất của pot (tham số cap của validator pot). BẮT BUỘC như mọi lời khai pot khác:
    // mọi output pot phải ≥ D, vì dịch vụ phát chỉ chọn MỘT UTxO kho ≥ D (`planPotFunding`).
    const potShare = positiveBig("POT_SHARE_OILDROP", requireField("POT_SHARE_OILDROP", process.env.POT_SHARE_OILDROP));
    const batchSize = envInt("POT_BATCH", "40");
    const partialRaw = (process.env.ALLOW_PARTIAL ?? "false").trim().toLowerCase();
    if (partialRaw !== "true" && partialRaw !== "false") {
      throw new Error(`FEED-ENV-001: ALLOW_PARTIAL='${process.env.ALLOW_PARTIAL}' — chỉ nhận true|false.`);
    }
    const allowPartial = partialRaw === "true";
    const lampUnit = wiring.lampUnit;

    const held: FeederUtxo[] = [];
    const utxoByRef = new Map<string, UTxO>();
    for (const f of feeders) {
      for (const u of await lucid.utxosAt(f.address)) {
        if ((u.assets[lampUnit] ?? 0n) <= 0n) continue;
        const ref = refKey(u);
        utxoByRef.set(ref, u);
        held.push({ index: f.index, pkh: f.pkh, address: f.address, ref, assets: u.assets });
      }
    }
    const byIndex = new Map(feeders.map((f) => [f.index, f]));

    console.log(`Pot đích        : ${pot.address}`);
    console.log(`Script hash     : ${pot.scriptHash}  (khớp địa chỉ)`);
    console.log(`Datum           : InlineDatum ${pot.datumCbor}`);
    console.log(`Cần rót         : ${amount} oildrop (${lamp(amount)}) · lovelace/output ${potLovelace}`);
    console.log(`Suất pot (D)    : ${potShare} oildrop (${lamp(potShare)}) — mọi output pot ≥ D`);
    const plan = planPotFunding(held, { lampUnit, amount, batchSize, maxTx: MAX_TX, allowPartial, minPotAmount: potShare });
    console.log(`Đang ở feeder   : ${held.length} UTxO mang LAMP · dùng được ${plan.available} oildrop · loại ${plan.excluded.length}`);
    for (const x of plan.excluded) console.log(`  loại ${x.ref} (feeder #${x.index}): ${x.reason}`);
    console.log(`Kế hoạch        : ${plan.batches.length} giao dịch · rót ${plan.total} oildrop` +
      (plan.partial ? ` — MỘT PHẦN (ALLOW_PARTIAL=true), thiếu ${amount - plan.total}` : ""));

    let funded = 0n;
    for (const [i, b] of plan.batches.entries()) {
      const owners = [...new Map(b.inputs.map((x) => [x.pkh, byIndex.get(x.index)!])).values()];
      let txb = lucid.newTx()
        .collectFrom(b.inputs.map((x) => utxoByRef.get(x.ref)!))
        .pay.ToContract(pot.address, { kind: "inline", value: pot.datumCbor },
                        potOutputAssets(potLovelace, lampUnit, b.potAmount));
      if (b.change > 0n) txb = txb.pay.ToAddress(b.changeAddress, { [lampUnit]: b.change });
      // Khai người ký bắt buộc để phép ước phí đếm đủ chữ ký feeder — ví chỉ biết khoá của nó.
      for (const o of owners) txb = txb.addSignerKey(o.pkh);
      const tx = await txb.complete();

      // Soát giao dịch ĐÃ DỰNG, không tin value đã khai: đúng 1 output ở pot, đúng hình dạng;
      // LAMP thừa nằm đúng ở feeder đầu lô.
      const outs = tx.toTransaction().body().outputs();
      const built: OutputShape[] = [];
      for (let k = 0; k < outs.len(); k++) built.push(coreToTxOutput(outs.get(k)));
      const expect = { lampUnit, amount: b.potAmount, datumCbor: pot.datumCbor };
      assertPotOutputs(built, pot.address, expect, "FEED-POT-010");
      const changeBuilt = unitAt(built, b.changeAddress, lampUnit);
      if (changeBuilt !== b.change) {
        throw new Error(`FEED-POT-011: LAMP thừa ở feeder đầu lô ${changeBuilt} ≠ kế hoạch ${b.change}. Dừng.`);
      }

      const h = tx.toHash();   // id giao dịch = hash thân, ký không đổi nó
      const label = `Rót pot ${i + 1}/${plan.batches.length} · ${b.inputs.length} UTxO · ${b.potAmount} oildrop` +
        (b.change > 0n ? ` · thừa ${b.change} về feeder #${b.inputs[0]!.index}` : "");
      if (!(await finish(lucid, tx, label, owners.map((o) => o.key)))) return;
      funded += b.potAmount;

      // Đối chiếu trên chuỗi. Giao dịch ĐÃ vào block (`finish` chờ rồi); chỉ mục theo địa chỉ có
      // thể trễ ⇒ chờ bằng `waitFor`. Hết giờ = CHƯA ĐO ĐƯỢC (mã 2), khác HỎNG THẬT (mã 1).
      try {
        const made = await waitFor(
          `UTxO của ${h} ở địa chỉ pot`,
          async () => (await lucid.utxosAt(pot.address)).filter((u) => u.txHash === h),
          (us) => us.length > 0,
        );
        assertPotOutputs(made, pot.address, expect, "FEED-POT-VERIFY-001");
        console.log(`  ✅ Đối chiếu trên chuỗi: 1 UTxO · ${b.potAmount} oildrop LAMP · chỉ {ada, LAMP} · datum inline đúng.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isWaitTimeout(e)) {
          process.exitCode = 2;
          console.log(`\n⚠ CHƯA ĐO ĐƯỢC (không phải "hỏng"): ${msg}\n  Đo lại bằng: ${explorerTx(h)}`);
        } else {
          process.exitCode = 1;
          console.error(`\n❌ HỎNG khi đối chiếu pot — giao dịch ĐÃ gửi (${h}): ${msg}`);
        }
        console.log(`Đã rót ${funded} oildrop. Chạy lại thì đặt AMOUNT_OILDROP=${amount - funded}, đừng dùng lại ${amount}.`);
        return;
      }
    }
    console.log(`\nXong ${plan.batches.length} lượt rót, tổng ${funded} oildrop (${lamp(funded)}) vào pot.`);
    if (funded < amount) console.log(`Còn thiếu ${amount - funded} oildrop. Chạy lại thì đặt AMOUNT_OILDROP=${amount - funded}.`);
    return;
  }

  throw new Error(`STEP='${STEP}' không hợp lệ. Chọn: plan | grant | redeem | sweep | fundpot.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
