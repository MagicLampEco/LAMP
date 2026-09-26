// 28_beacon_grant_redeem.ts — ba bước đưa LAMP từ KHO ra VÍ THƯỜNG, đường hợp lệ DUY NHẤT.
//
// VÌ SAO CÓ TỆP NÀY. Kho Distribution giữ 1.011.000 LAMP và `lamp_mint.ak` (nhánh
// `DistributionVest`, A-DEST) ÉP mọi lượt đúc phải rót vào kho — không có đường đúc thẳng
// về ví. Lối ra duy nhất làm GIẢM LAMP trong kho là `treasury.ReleaseForRedeem`, và nó chỉ
// chạy khi một `claim_account` hợp lệ chạy nhánh `Redeem`. Nên muốn có LAMP trong một ví
// thường thì phải đi đủ ba bước, theo đúng thứ tự:
//
//   beacon  — `PostBeacon` (v3): chuyển chỉ số cộng dồn sang cửa sổ hiện tại theo C-BCN-6
//             (`index' = index + rate_root_CŨ · Δepoch`) và, nếu muốn, nới `rate_root` (w)
//             ≤ +10%. Beacon genesis v3 đã mang w > 0, nên bước này KHÔNG còn là điều kiện
//             trước của grant như ở v2 (v2: D genesis = 0 ⇒ phải post trước mới rút được).
//   grant   — `GrantEntitlement` + `MintAccount`: mở tài khoản cho ví vận hành, ghi nợ E vào
//             sổ kho. Đúc NFT tài khoản (C-ACC-1) là BẮT BUỘC ở đường CREATE.
//   topup   — `Claim` đường UPDATE: E += amount trên tài khoản ĐÃ có. Đường CREATE chỉ chạy
//             được MỘT lần cho mỗi ví (tên NFT = blake2b_256(owner)), nên mọi lần cấp thêm
//             sau đó đi lối này.
//   redeem  — `Redeem`: tính `vested` rồi kéo LAMP về địa chỉ ví thường.
//   send    — chuyển thường LAMP từ ví vận hành sang một ví KHÁC. Không đụng validator nào;
//             có ở đây vì nó là bước cuối của cùng một đường (kho → ví → nhà tiêu thụ).
//
// TRẦN CỦA `topup` — đọc trước khi đặt số (v3 "Capped Drop"). `drops_per_epoch` GHIM == 1
// (`treasury.ak` C-ACC-DPE), và phần mở khoá là
//   vested = min(E, √E · A_span),   A_span = A(bây giờ) − index_at_start,
//   A(t)   = index + rate_root · (t − epoch)     (đọc từ beacon reference input)
// rồi mỗi lượt rút còn bị CẮT NGỌN ở `max(trim_floor, total_redeemed · κ)`. Tăng E chỉ tăng
// tốc theo √E; muốn nhanh hơn nữa thì nới `rate_root` bằng một lượt `beacon` (≤ +10%/lượt).
// Toán học nằm ở SDK (`Distribution/offchain/src/vested.ts`) — tệp này không tự tính lại.
//
// ĐỒNG HỒ EPOCH — chỗ dễ đọc nhầm nhất, đọc kỹ trước khi đổi số.
// `util.get_epoch(tx, ms_per_epoch) = validity_range.lower_bound / ms_per_epoch`
// (`Distribution/onchain/lib/magiclamp/lampdist/util.ak:12-15`). Với
// `MS_PER_EPOCH = 432_000_000` thì đây là cửa sổ 5 ngày neo vào mốc Unix, KHÔNG liên quan
// lịch epoch của Cardano. Đừng tra epoch Cardano rồi suy ra hạn ở đây — hai đồng hồ khác nhau.
//
//   v2 (lịch sử): vested = min(E, D · drops_per_epoch · max(0, current_epoch − start_epoch))
//   v3 (hiện hành): xem khối TRẦN CỦA `topup` ở trên — `A_span` thay cho `elapsed`.
//
// `A_span = 0` ⇒ `vested = 0` ⇒ `amount = 0` ⇒ `expect amount > 0` fail. Nên tài khoản mở ở
// cửa sổ `e` chỉ rút được từ cửa sổ `e + 1`.
//
// Đoạn dưới (tới hết khung) là LỊCH SỬ v2 về `start_epoch`, giữ để đọc lý do các bản vá. `start_epoch` là một trường DATUM do bên dựng
// giao dịch đặt: KHÔNG validator nào ghim nó về epoch hiện tại lúc CREATE — đã soát cả ba
// chỗ có thẩm quyền (`claim_account_nft.ak` nhánh `MintAccount` A-ACC-1…6 chỉ ép committee ·
// đúng-1-NFT · carrier là Script · tên NFT = blake2b_256(owner) · `redeemed == 0` · đúng-1
// input TRSY; `treasury.ak:105-163` nhánh `GrantEntitlement` không đụng `start_epoch`;
// `claim_account.ak` KHÔNG CHẠY ở CREATE vì không có input tài khoản).
//
// ⚠ HỆ QUẢ PHẢI ĐỌC THÀNH LỜI, vì nó là một tính chất an ninh chứ không phải một tiện ích:
// committee lùi được `start_epoch` bao xa tuỳ ý ⇒ **lịch vesting KHÔNG ràng buộc được chính
// committee**. Với màn diễn tập Preprod, ví chủ tài khoản CŨNG là ví committee nên không ai
// bị thiệt. Với mainnet thì đây là một lỗ phải bịt trước khi vesting được rao như một lời
// hứa với người dùng.
//
// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ ĐỌC TRƯỚC KHI DÙNG TỆP NÀY SAU 2026-09-16 — ba đoạn mô tả ở TRÊN nói về CỤM ĐANG     ║
// ║ CHẠY, và cụm đó nay là cụm TRƯỚC BẢN VÁ.                                             ║
// ║                                                                                      ║
// ║ Ba lỗ mà đoạn trên mô tả ĐÃ ĐƯỢC VÁ trong mã (Issue #72) nhưng CHƯA ĐƯỢC TRIỂN KHAI: ║
// ║   · `treasury.ak` C-ACC-2 — ghim `start_epoch` vào cửa sổ hiện tại lúc CREATE;        ║
// ║   · `beacon.ak`   C-BCN-3 — nhãn `epoch` phải BẰNG cửa sổ tx chạy trong đó;           ║
// ║   · `beacon.ak`   C-BCN-4/5 — D nằm trong biên cứng, mỗi lượt đổi ≤ ±10%.             ║
// ║                                                                                      ║
// ║ Bản vá đổi hash của `treasury`, `beacon` VÀ `claim_account` ⇒ nó CHỈ có hiệu lực từ   ║
// ║ cụm đúc lại. Bản tệp này trên nhánh vá (2026-09-17) nhắm CỤM ĐÚC LẠI: không chạy nó    ║
// ║ vào cụm cũ. Cụm cũ dùng bản trên nhánh chính TRƯỚC khi bản vá được gộp.               ║
// ║                                                                                      ║
// ║ ⚠ HIỆU LỰC NGAY KHI BẢN VÁ VÀO NHÁNH CHÍNH — KHÔNG đợi lượt đúc lại. Tệp này KHÔNG   ║
// ║ đọc hash từ sổ; nó gọi `deriveWiring()`, và hàm đó TÍNH hash TỪ MÃ NGUỒN `.ak` đang   ║
// ║ có trên đĩa. Đo bằng thực thi 2026-09-17: bản vá làm lệch 4 trường (`treHash`,        ║
// ║ `treAddr`, `beaconHash`, `beaconAddr`), `rehydrate()` ném DRIFT, và 10 script dừng    ║
// ║ ngay — trước khi ai kịp đúc lại thứ gì. Câu "cụm đang chạy ở nguyên đó" đúng với TỆP  ║
// ║ này và sai với HÀM nó gọi.                                                            ║
// ║                                                                                      ║
// ║ Đã sửa theo bản vá (2026-09-17):                                                     ║
// ║   (1) bỏ `BACKDATE_EPOCHS` — C-ACC-2 từ chối mọi giá trị ≠ 0;                         ║
// ║   (2) nhãn beacon = cửa sổ hiện tại (C-BCN-3), builder tự đặt cửa sổ qua `msPerEpoch`; ║
// ║   (3) mọi tx đóng dấu thời gian lấy cặp lo/hi từ `epochWindow` — `validFrom` giữa     ║
// ║       cửa sổ cũ là mốc TƯƠNG LAI trong nửa đầu cửa sổ, sổ cái từ chối;                ║
// ║   (4) `topup` theo rebase (C-ACC-3): mốc về cửa sổ hiện tại, redeemed về 0.           ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Hệ quả vận hành phải biết: tài khoản mở (hoặc cấp thêm) ở cửa sổ `e` chỉ rút được từ cửa
// sổ `e + 1`. Không còn đường "rút ngay" — đường đó chính là lỗ đã vá.
//
// Chạy (mặc định CHỈ ĐỌC, không ký, không gửi):
//   NETWORK=Preprod tsx 28_beacon_grant_redeem.ts                    # in trạng thái rồi dừng
//   NETWORK=Preprod STEP=beacon tsx 28_beacon_grant_redeem.ts        # dựng thử, không gửi
//   NETWORK=Preprod STEP=beacon SUBMIT=true tsx 28_beacon_grant_redeem.ts
//   NETWORK=Preprod STEP=grant  SUBMIT=true tsx 28_beacon_grant_redeem.ts
//   NETWORK=Preprod STEP=redeem SUBMIT=true tsx 28_beacon_grant_redeem.ts
import {
  Data, credentialToAddress, scriptHashToCredential, toUnit, getAddressDetails,
  type LucidEvolution,
} from "@lucid-evolution/lucid";

import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import {
  rehydrate, canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, MS_PER_EPOCH, DROP_NAME,
} from "./_canonical_v2.js";
// `claim_account` + `claim_account_nft` dựng lại từ blueprint, và chọn UTxO kho — dùng chung
// với `30_feeder_accounts.ts`, không chép lại.
import {
  claimScripts, assertClaimScriptsMatch, pickTreasury, refKey,
} from "./_distributionScripts.js";
import { buildPostBeaconTx } from "../../Distribution/offchain/src/beaconBuilder.js";
import { buildClaimTx } from "../../Distribution/offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../../Distribution/offchain/src/redeemBuilder.js";
import {
  decodeTreasuryDatum, decodeClaimAccountDatum, decodeBeaconDatum,
} from "../../Distribution/offchain/src/datum.js";
import {
  OILDROP_PER_LAMP, RATE_ROOT_GENESIS, TRIM_FLOOR, epochWindow,
} from "../../Distribution/offchain/src/constants.js";
import { redeemable, beaconIndexAt } from "../../Distribution/offchain/src/vested.js";
import { accountNftName } from "../../Distribution/offchain/src/accountNft.js";
import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "../../Distribution/offchain/src/types.js";
// Kế hoạch beacon/redeem THUẦN của runner v3 đã chạy thật (`Distribution/scripts/04_e2e.ts`),
// có bài kiểm riêng (`Distribution/tests/e2ePlan.test.ts`). Dùng lại thay vì tính C-BCN-6 lần
// thứ hai ở đây — hai chỗ tính riêng là hai chỗ trôi riêng.
import { planBeacon, planRedeem } from "../../Distribution/scripts/e2ePlan.js";

// ── Tham số màn diễn tập ─────────────────────────────────────────────────────
// Hai biến v2 CHẾT ở v3 — từ chối thẳng thay vì bỏ qua, cùng lý do với `04_e2e.ts`
// (`E2E-V3-001`): bỏ qua im lặng làm người vận hành tin mình đã chỉnh được tốc độ.
//   · `DROP_VALUE_OILDROP` — v3 không có D; beacon mang `rate_root` (w).
//   · `DROPS_PER_EPOCH`    — v3 ghim `drops_per_epoch == 1` (`treasury.ak` C-ACC-DPE).
for (const dead of ["DROP_VALUE_OILDROP", "DROPS_PER_EPOCH"] as const) {
  if ((process.env[dead] ?? "").trim() !== "") {
    throw new Error(
      `BCN-V3-001: '${dead}' không còn nghĩa ở v3 (beacon mang rate_root; drops_per_epoch ghim 1). ` +
      `Đặt RATE_ROOT nếu muốn chỉnh tốc độ, rồi bỏ biến cũ đi.`,
    );
  }
}
/** w — `rate_root` đích cho lượt `STEP=beacon`. Mặc định = mốc genesis (giữ nguyên tốc độ). */
const RATE_ROOT = BigInt(process.env.RATE_ROOT ?? RATE_ROOT_GENESIS.toString());
/** E — entitlement cấp cho ví vận hành. 2002 LAMP = 1001 cho ví thử + 1001 mồi kho pot Wakeme. */
const ENTITLEMENT = BigInt(process.env.ENTITLEMENT_OILDROP ?? "2002000000");
/** `STEP=topup` — oildrop cấp THÊM vào tài khoản đã có (đường UPDATE của `Claim`). */
const TOPUP = BigInt(process.env.TOPUP_OILDROP ?? "0");
/** `STEP=send` — địa chỉ nhận của lượt chuyển thường. Phải là ví payment-key. */
const SEND_TO = (process.env.SEND_TO ?? "").trim();
/** `STEP=send` — oildrop chuyển đi. */
const SEND_AMOUNT = BigInt(process.env.SEND_OILDROP ?? "0");
/** Lovelace kèm theo output của `STEP=send`. Đủ trên min-ADA cho một output một tài sản. */
const SEND_LOVELACE = BigInt(process.env.SEND_LOVELACE ?? "2000000");

const STEP = (process.env.STEP ?? "").toLowerCase();

const lamp = (oildrop: bigint) => `${oildrop / OILDROP_PER_LAMP} LAMP (${oildrop} oildrop)`;

/** Epoch VALIDATOR (cửa sổ 5 ngày neo mốc Unix), KHÔNG phải epoch Cardano. */
function epochNow(): bigint {
  return BigInt(Date.now()) / MS_PER_EPOCH;
}
/** Cặp lo/hi của cửa sổ hiện tại. Ném nếu cửa sổ đã sang trang so với `e` in ở đầu lượt —
 *  nhãn in ra cho người vận hành và nhãn ghi vào datum phải là CÙNG một cửa sổ. */
function windowNow(e: bigint): { loMs: bigint; hiMs: bigint; epoch: bigint } {
  const w = epochWindow(MS_PER_EPOCH);
  if (w.epoch !== e) {
    throw new Error(`WINDOW-001: cửa sổ vừa sang trang (${e} → ${w.epoch}) giữa lượt chạy. Chạy lại.`);
  }
  return w;
}

/**
 * Cổng GRANT-000 / TOPUP-005, bản v3. v2 đòi `drop_value > 0`; v3 không có D — đại lượng
 * tương đương là `rate_root` (w): w ≤ 0 thì chỉ số cộng dồn đứng yên, `A_span` mãi bằng 0, và
 * tài khoản vừa ghi nợ vào sổ kho KHÔNG BAO GIỜ rút được (`planRedeem` trả `stalled`).
 * Beacon không có datum thì cũng dừng: v3 bắt MỌI `GrantEntitlement` mang beacon làm
 * reference input (C-CLAIM-8), nên không có đường cấp nào bỏ qua được nó.
 */
function requireLiveBeacon(b: BeaconDatum | undefined, code: string): BeaconDatum {
  if (!b) {
    throw new Error(`${code}: beacon không có inline datum — v3 cần nó ở mọi lượt cấp (C-CLAIM-8).`);
  }
  if (b.rate_root <= 0n) {
    throw new Error(
      `${code}: beacon rate_root = ${b.rate_root} ≤ 0 ⇒ chỉ số cộng dồn đứng yên, tài khoản cấp ` +
      `lúc này không bao giờ rút được. Chạy STEP=beacon với RATE_ROOT > 0 trước.`,
    );
  }
  return b;
}

/** Khi nào tài khoản rút được — đọc từ `planRedeem` của runner v3, không tự tính lại. */
function redeemOutlook(a: ClaimAccountDatum, b: BeaconDatum, t: TreasuryDatum, e: bigint): string {
  const p = planRedeem(a, b, t, e);
  switch (p.action) {
    case "redeem":
      return `rút được ${lamp(p.amount)} ngay cửa sổ ${e}` +
        (p.trimmed > 0n ? ` (cắt ngọn ${lamp(p.trimmed)} — không mất, rút ở lượt sau)` : "");
    case "wait":
      return `rút được từ cửa sổ ${p.fromEpoch} (nếu rate_root giữ nguyên)`;
    case "stalled":
      return `KẸT — rate_root ≤ 0, không cửa sổ nào rút được`;
    case "exhausted":
      return `đã rút trọn`;
  }
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);

  const cs = await claimScripts(pkh, wiring.markers.khoPid, wiring.lampPid,
                                wiring.tokenName, wiring.markers.beaconPid);
  assertClaimScriptsMatch(cs, wiring);
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(cs.claimHash));

  // ── Đọc trạng thái chuỗi ───────────────────────────────────────────────────
  const beaconUnit = toUnit(wiring.markers.beaconPid, DROP_NAME);
  const beaconUtxos = (await lucid.utxosAt(wiring.beaconAddr))
    .filter((u) => (u.assets[beaconUnit] ?? 0n) === 1n);
  if (beaconUtxos.length !== 1) {
    throw new Error(`BCN-001: cần ĐÚNG 1 UTxO mang NFT "DROP" ở ${wiring.beaconAddr}, đếm ${beaconUtxos.length}.`);
  }
  const beaconUtxo = beaconUtxos[0]!;
  // Giải mã bằng decoder SDK v3: beacon mang datum v2 (3 trường) thì ném DATUM-031 NGAY ở đây,
  // thay vì để bước sau đọc `fields[2]` ra một con số trông hợp lệ nhưng sai nghĩa.
  const beaconD: BeaconDatum | undefined = beaconUtxo.datum
    ? decodeBeaconDatum(Data.from(beaconUtxo.datum))
    : undefined;

  const treasuryUtxo = pickTreasury(await lucid.utxosAt(wiring.treAddr), wiring.khoUnit);
  const tDatum = decodeTreasuryDatum(Data.from(treasuryUtxo.datum!));
  const pool = treasuryUtxo.assets[wiring.lampUnit] ?? 0n;

  // Tài khoản CỦA VÍ NÀY: NFT đúng tên blake2b_256(pkh) (A-ACC-4) và datum mang đúng owner.
  // Lọc theo policy suông thì đếm luôn tài khoản của feeder (`30_feeder_accounts.ts`) cùng policy
  // ⇒ GRANT-001/TOPUP-000/REDEEM-000 chặn ví vận hành ngay sau đợt grant feeder đầu tiên.
  const myUnit = toUnit(wiring.accountPid, accountNftName(pkh));
  const myAccounts = (await lucid.utxosAtWithUnit(claimAddr, myUnit)).filter((u) => {
    if ((u.assets[myUnit] ?? 0n) !== 1n) return false;
    if (!u.datum) throw new Error(`ACC-001: tài khoản ${refKey(u)} không có inline datum.`);
    const owner = decodeClaimAccountDatum(Data.from(u.datum)).owner;
    if (owner.toLowerCase() !== pkh.toLowerCase()) {
      throw new Error(`ACC-002: ${refKey(u)} mang NFT tài khoản của ví này nhưng datum owner ${owner}.`);
    }
    return true;
  });

  const e = epochNow();
  console.log(`═══ Beacon · Grant · Redeem (${NETWORK}) ═══`);
  console.log(`Ví vận hành pkh : ${pkh}`);
  console.log(`Epoch VALIDATOR : ${e}  (cửa sổ 5 ngày neo mốc Unix — KHÔNG phải epoch Cardano)`);
  console.log(`  cửa sổ này mở : ${new Date(Number(e * MS_PER_EPOCH)).toISOString()}`);
  console.log(`  cửa sổ kế mở  : ${new Date(Number((e + 1n) * MS_PER_EPOCH)).toISOString()}`);
  console.log(`\nBeacon  ${refKey(beaconUtxo)}`);
  console.log(`  datum : ${JSON.stringify(beaconD, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
  console.log(`\nKho     ${refKey(treasuryUtxo)}  @ ${wiring.treAddr}`);
  console.log(`  pool  : ${lamp(pool)}`);
  console.log(`  sổ nợ : ${lamp(tDatum.outstanding_entitlement)}`);
  console.log(`  đã phát ra (total_redeemed): ${lamp(tDatum.total_redeemed)}`);
  console.log(`\nTài khoản @ ${claimAddr}`);
  console.log(`  tài khoản của ví này: ${myAccounts.length}`);
  for (const u of myAccounts) console.log(`    · ${refKey(u)}  ${lamp(u.assets[wiring.lampUnit] ?? 0n)}`);

  if (!STEP) {
    console.log(
      `\nDỪNG: chưa nêu STEP. Thứ tự — grant → (beacon tuỳ chọn) → redeem.\n` +
      `  STEP=beacon  chuyển chỉ số sang cửa sổ ${e}, rate_root → ${RATE_ROOT}\n` +
      `  STEP=grant   cấp E = ${lamp(ENTITLEMENT)}, drops/epoch 1 (ghim v3), mốc = cửa sổ ${e}\n` +
      `  STEP=topup   cấp THÊM E cho tài khoản đã có — đặt TOPUP_OILDROP\n` +
      `  STEP=redeem  kéo phần đã vested về ví thường\n` +
      `  STEP=send    chuyển thường sang ví khác — đặt SEND_TO + SEND_OILDROP`,
    );
    return;
  }

  // ── STEP beacon ────────────────────────────────────────────────────────────
  if (STEP === "beacon") {
    // C-BCN-2 (`beacon.ak`) ép `out_datum.epoch > datum.epoch`, C-BCN-3 ép nhãn PHẢI bằng
    // cửa sổ hiện tại ⇒ mỗi cửa sổ post tối đa một lượt.
    //
    // Ở v3 nhãn `epoch` KHÔNG còn là nhãn kế toán suông như v2: nó là mốc của chỉ số cộng dồn
    // `A(t) = index + rate_root · (t − epoch)`, và cả `treasury` (C-CLAIM-8) lẫn
    // `claim_account` (Redeem) đọc `A` qua nó.
    //
    // v3: `index` mới KHÔNG phải tham số — `planBeacon` tính nó theo C-BCN-6 từ beacon cũ
    // (quá khứ định giá bằng `rate_root` CŨ). `currentBeacon` truyền TRỌN datum cũ để builder
    // kiểm C-BCN-5'/5a/6 trước khi gửi; v2 chỉ truyền một con số (`currentDropValue`).
    if (!beaconD) throw new Error(`BCN-003: beacon ${refKey(beaconUtxo)} không có inline datum.`);
    const plan = planBeacon({
      onChain: beaconD, window: windowNow(e), rateRoot: RATE_ROOT, msPerEpoch: MS_PER_EPOCH,
    });
    if (plan.action === "skip") {
      throw new Error(
        `BCN-002: cửa sổ ${e} đã có lượt post (nhãn trên chuỗi ${plan.onChainEpoch}). ` +
        `C-BCN-2/3 cho mỗi cửa sổ đúng một lượt — chờ cửa sổ kế.`,
      );
    }
    const nb = plan.params.newBeacon;
    console.log(
      `\nNhãn epoch beacon: ${beaconD.epoch} → ${nb.epoch}   index: ${beaconD.index} → ${nb.index}` +
      `   rate_root: ${beaconD.rate_root} → ${nb.rate_root}`,
    );
    const r = await buildPostBeaconTx({
      lucid, beaconUtxo, beaconScript: scripts.beacon, network: NETWORK,
      beaconNftPolicy: wiring.markers.beaconPid,
      committeeKeyHashes: canonicalCommittee(pkh),
      threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
      ...plan.params,   // newBeacon + msPerEpoch (builder tự đặt lo/hi) + currentBeacon
    });
    console.log(`\n${r.summary}`);
    await finish(lucid, r.tx, "PostBeacon");
    return;
  }

  // ── STEP grant ─────────────────────────────────────────────────────────────
  if (STEP === "grant") {
    const beaconLive = requireLiveBeacon(beaconD, "GRANT-000");
    if (myAccounts.length > 0) {
      throw new Error(
        `GRANT-001: ví này ĐÃ có ${myAccounts.length} tài khoản ở ${claimAddr}. Runner chỉ CREATE ` +
        `một lần cho mỗi ví — quy ước của runner: chuỗi KHÔNG chặn đúc lại cùng tên ở giao dịch ` +
        `sau (A-ACC-2 chỉ đếm trong một giao dịch). Tăng E thì đi đường UPDATE.`,
      );
    }
    const w = windowNow(e);
    const r = await buildClaimTx({
      lucid, claimScript: cs.claim, network: NETWORK,
      ownerPkh: pkh, amount: ENTITLEMENT,
      currentEpoch: w.epoch,                    // C-ACC-2: start_epoch == cửa sổ hiện tại
      // `dropsPerEpoch` bỏ trống ⇒ mặc định 1 = giá trị ghim của v3 (CLAIM-006 chặn mọi số khác).
      accountNft: { script: cs.accountNft, policyId: cs.accountPid },
      treasury: {
        utxo: treasuryUtxo, script: scripts.treasury,
        nftPolicy: wiring.markers.khoPid, nftAssetName: "54525359",
      },
      // v3: beacon là reference input BẮT BUỘC — treasury ghim `index_at_start = A(cửa sổ này)`.
      beacon: { utxo: beaconUtxo, datum: beaconLive },
      committeeKeyHashes: canonicalCommittee(pkh),
      threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
      solvency: { treasuryLamp: pool, otherOutstanding: tDatum.outstanding_entitlement },
      validFromMs: w.loMs, validToMs: w.hiMs,   // Luật 2b: hai đầu cùng cửa sổ
    });
    console.log(`\n${r.summary}`);
    console.log(`\nSau grant: ${redeemOutlook(r.newDatum, beaconLive, r.newTreasuryDatum, w.epoch)}`);
    await finish(lucid, r.tx, "GrantEntitlement (CREATE)");
    return;
  }

  // ── STEP topup ─────────────────────────────────────────────────────────────
  // Đường UPDATE của `Claim` theo REBASE (C-ACC-3, C-CLAIM-4…8): E' = E − redeemed + amount,
  // redeemed' = 0, index_at_start' = A(cửa sổ này). Bước này KHÔNG nới tốc độ mở khoá — tốc
  // độ là √E' · rate_root mỗi cửa sổ, và chỉ `beacon` nới được `rate_root`.
  if (STEP === "topup") {
    if (myAccounts.length !== 1) {
      throw new Error(`TOPUP-000: cần ĐÚNG 1 tài khoản ở ${claimAddr}, đếm ${myAccounts.length}. Chạy STEP=grant trước.`);
    }
    if (TOPUP <= 0n) throw new Error(`TOPUP-001: đặt TOPUP_OILDROP > 0 (đang ${TOPUP}).`);
    const beaconLive = requireLiveBeacon(beaconD, "TOPUP-005");
    const accUtxo = myAccounts[0]!;
    if (!accUtxo.datum) throw new Error(`TOPUP-002: tài khoản ${refKey(accUtxo)} không có inline datum.`);
    const accDatum = decodeClaimAccountDatum(Data.from(accUtxo.datum));

    // `otherOutstanding` phải LOẠI tài khoản đang claim — builder tự tính lại phần của nó
    // từ `amount` + datum cũ. Truyền thẳng sổ nợ kho vào đây là đếm tài khoản này HAI LẦN.
    const thisOutstanding = accDatum.entitlement - accDatum.redeemed;
    const otherOutstanding = tDatum.outstanding_entitlement - thisOutstanding;
    if (otherOutstanding < 0n) {
      throw new Error(
        `TOPUP-003: sổ nợ kho ${tDatum.outstanding_entitlement} nhỏ hơn phần chưa rút của chính ` +
        `tài khoản này (${thisOutstanding}). Hai con số này không thể lệch chiều đó — dừng.`,
      );
    }

    // REBASE (C-ACC-3 + C-CLAIM-8): E' = (E − redeemed) + TOPUP, redeemed' = 0, mốc cửa sổ
    // = cửa sổ này, index_at_start' = A(cửa sổ này). Phần ĐÃ VEST MÀ CHƯA RÚT sẽ phải vest lại.
    // Không mất tiền, nhưng mất thời gian — nên mặc định DỪNG và bảo rút trước; ai cố ý chấp
    // nhận thì đặt ACCEPT_REVEST=true.
    //
    // "Đang rút được" lấy từ `redeemable` của SDK (cùng hàm `buildRedeemTx` dùng, kể cả phép cắt
    // ngọn), không tự tính lại — bản v2 tính `D · dpe · elapsed` tại chỗ và nó đứng yên khi
    // công thức đổi.
    const pending = redeemable(accDatum, beaconLive, tDatum, e, TRIM_FLOOR);
    const eAfter = accDatum.entitlement - accDatum.redeemed + TOPUP;
    const afterTopup: ClaimAccountDatum = {
      ...accDatum, entitlement: eAfter, redeemed: 0n,
      start_epoch: e, index_at_start: beaconIndexAt(beaconLive, e),
    };
    console.log(
      `\nTài khoản ${refKey(accUtxo)}\n` +
      `  E hiện tại   : ${lamp(accDatum.entitlement)}\n` +
      `  đã rút       : ${lamp(accDatum.redeemed)}\n` +
      `  start_epoch  : ${accDatum.start_epoch}   index_at_start: ${accDatum.index_at_start}\n` +
      `  đang rút được: ${lamp(pending)}  (sẽ phải vest lại nếu cấp thêm bây giờ)\n` +
      `  sau topup    : E = ${lamp(eAfter)}, redeemed = 0, start_epoch = ${e}, ` +
      `index_at_start = ${afterTopup.index_at_start}\n` +
      `  sau topup    : ${redeemOutlook(afterTopup, beaconLive, tDatum, e)}`,
    );
    if (pending > 0n && process.env.ACCEPT_REVEST !== "true") {
      throw new Error(
        `TOPUP-006: tài khoản đang có ${lamp(pending)} rút được. Cấp thêm bây giờ thì phần đó ` +
        `phải vest lại từ đầu (rebase, treasury.ak C-ACC-3). Chạy STEP=redeem trước, hoặc đặt ` +
        `ACCEPT_REVEST=true nếu cố ý.`,
      );
    }

    const w = windowNow(e);
    const r = await buildClaimTx({
      lucid, claimScript: cs.claim, network: NETWORK,
      ownerPkh: pkh, amount: TOPUP,
      currentEpoch: w.epoch,
      claimAccountUtxo: accUtxo,          // ⇒ đường UPDATE, builder KHÔNG đúc NFT
      treasury: {
        utxo: treasuryUtxo, script: scripts.treasury,
        nftPolicy: wiring.markers.khoPid, nftAssetName: "54525359",
      },
      beacon: { utxo: beaconUtxo, datum: beaconLive },   // v3: C-CLAIM-8 áp cả UPDATE
      committeeKeyHashes: canonicalCommittee(pkh),
      threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
      solvency: { treasuryLamp: pool, otherOutstanding },
      validFromMs: w.loMs, validToMs: w.hiMs,   // C-ACC-3 dùng get_epoch_strict
    });
    if (r.mode !== "update") throw new Error(`TOPUP-004: builder trả mode='${r.mode}', chờ 'update'.`);
    console.log(`\n${r.summary}`);
    await finish(lucid, r.tx, "Claim (UPDATE, topup)");
    return;
  }

  // ── STEP send ──────────────────────────────────────────────────────────────
  // Chuyển thường, không validator nào chạy. Chốt duy nhất đáng có ở đây là chốt ĐÍCH:
  // Cardano KHÔNG chạy validator lúc TẠO output, nên rót vào một địa chỉ script mà không
  // biết bên trong nó đòi hình dạng UTxO nào là cách khoá tài sản vĩnh viễn mà không gì
  // đỏ lên. Nên bước này CHỈ nhận ví payment-key; rót vào kho có script thì phải đi qua
  // một runner riêng biết hình dạng mà kho đó đòi.
  if (STEP === "send") {
    if (!SEND_TO) throw new Error(`SEND-000: đặt SEND_TO = địa chỉ nhận.`);
    if (SEND_AMOUNT <= 0n) throw new Error(`SEND-001: đặt SEND_OILDROP > 0 (đang ${SEND_AMOUNT}).`);
    const det = getAddressDetails(SEND_TO);
    if (det.networkId !== (NETWORK === "Mainnet" ? 1 : 0)) {
      throw new Error(`SEND-002: ${SEND_TO} thuộc networkId ${det.networkId}, không phải ${NETWORK}.`);
    }
    if (det.paymentCredential?.type !== "Key") {
      throw new Error(
        `SEND-003: ${SEND_TO} có payment credential kiểu '${det.paymentCredential?.type}', ` +
        `không phải 'Key'. Bước này chỉ rót vào ví thường. Rót vào kho có script cần biết ` +
        `script hash + hình dạng UTxO kho đó nhận — dùng runner riêng, đừng rót mù.`,
      );
    }
    const have = (await lucid.wallet().getUtxos())
      .reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);
    if (have < SEND_AMOUNT) {
      throw new Error(`SEND-004: ví đang có ${lamp(have)}, cần ${lamp(SEND_AMOUNT)}. Chạy topup + redeem trước.`);
    }
    console.log(
      `\nChuyển thường\n  từ  : ví vận hành (${lamp(have)} đang có)\n` +
      `  tới : ${SEND_TO}\n  số  : ${lamp(SEND_AMOUNT)}\n  kèm : ${SEND_LOVELACE} lovelace`,
    );
    const tx = await lucid.newTx()
      .pay.ToAddress(SEND_TO, { lovelace: SEND_LOVELACE, [wiring.lampUnit]: SEND_AMOUNT })
      .complete();
    await finish(lucid, tx, "Chuyển thường");
    return;
  }

  // ── STEP redeem ────────────────────────────────────────────────────────────
  if (STEP === "redeem") {
    if (myAccounts.length !== 1) {
      throw new Error(`REDEEM-000: cần ĐÚNG 1 tài khoản ở ${claimAddr}, đếm ${myAccounts.length}. Chạy STEP=grant trước.`);
    }
    const r = await buildRedeemTx({
      lucid, network: NETWORK,
      claimAccountUtxo: myAccounts[0]!, claimScript: cs.claim,
      treasuryUtxo, treasuryScript: scripts.treasury,
      dropBeaconUtxo: beaconUtxo,
      currentEpoch: e,
      validFromMs: windowNow(e).loMs,   // đầu dưới ≤ now: giữa cửa sổ là mốc tương lai
      treasuryNftPolicy: wiring.markers.khoPid, treasuryNftAssetName: "54525359",
      lampPolicyId: wiring.lampPid, lampAssetName: wiring.tokenName,
    });
    console.log(`\n${r.summary}`);
    await finish(lucid, r.tx, "Redeem");
    return;
  }

  throw new Error(`STEP='${STEP}' không hợp lệ. Chọn: beacon | grant | topup | redeem | send.`);
}

/**
 * Ký + gửi, hoặc dừng. Cố ý KHÔNG in CBOR đã ký khi `SUBMIT=false`: committee canonical là
 * 1-of-1 (`_canonical_v2.ts:99`), nên một CBOR đã ký đầy đủ dán vào log là một giao dịch
 * NỘP ĐƯỢC NGAY bởi bất kỳ ai đọc log đó — cổng `SUBMIT` chỉ chặn lời gọi `submit()` của
 * tiến trình này, nó không chặn việc phát hành một công cụ mang quyền ra ngoài.
 */
async function finish(lucid: LucidEvolution, tx: { toHash(): string;
  sign: { withWallet(): { complete(): Promise<{ submit(): Promise<string> }> } } },
  nhan: string): Promise<void> {
  if (!SUBMIT) {
    console.log(
      `\n(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.)\n` +
      `${nhan} dựng xong. Hash thân giao dịch: ${tx.toHash()}\n` +
      `Gửi thật: thêm SUBMIT=true vào chính lệnh vừa chạy.`,
    );
    return;
  }
  const signed = await tx.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`\n📤 ${nhan}: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);
  console.log(`✅ ${nhan} đã vào block. Đối chiếu lại bằng chính chuỗi trước khi chạy bước kế.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
