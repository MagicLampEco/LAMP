// 28_beacon_grant_redeem.ts — ba bước đưa LAMP từ KHO ra VÍ THƯỜNG, đường hợp lệ DUY NHẤT.
//
// VÌ SAO CÓ TỆP NÀY. Kho Distribution giữ 1.011.000 LAMP và `lamp_mint.ak` (nhánh
// `DistributionVest`, A-DEST) ÉP mọi lượt đúc phải rót vào kho — không có đường đúc thẳng
// về ví. Lối ra duy nhất làm GIẢM LAMP trong kho là `treasury.ReleaseForRedeem`, và nó chỉ
// chạy khi một `claim_account` hợp lệ chạy nhánh `Redeem`. Nên muốn có LAMP trong một ví
// thường thì phải đi đủ ba bước, theo đúng thứ tự:
//
//   beacon  — `PostBeacon` đặt D = drop_value > 0. Beacon thật đang bằng 0
//             (`claim_account.ak:118` `expect drop_value > 0`) ⇒ hôm nay Grant xong vẫn rút
//             ra 0. Đây là bước đầu tiên, và nó KHÔNG phụ thuộc gì khác.
//   grant   — `GrantEntitlement` + `MintAccount`: mở tài khoản cho ví vận hành, ghi nợ E vào
//             sổ kho. Đúc NFT tài khoản (C-ACC-1) là BẮT BUỘC ở đường CREATE.
//   topup   — `Claim` đường UPDATE: E += amount trên tài khoản ĐÃ có. Đường CREATE chỉ chạy
//             được MỘT lần cho mỗi ví (tên NFT = blake2b_256(owner)), nên mọi lần cấp thêm
//             sau đó đi lối này.
//   redeem  — `Redeem`: tính `vested` rồi kéo LAMP về địa chỉ ví thường.
//   send    — chuyển thường LAMP từ ví vận hành sang một ví KHÁC. Không đụng validator nào;
//             có ở đây vì nó là bước cuối của cùng một đường (kho → ví → nhà tiêu thụ).
//
// TRẦN CỦA `topup` — đọc trước khi đặt số. `Claim` ép `drops_per_epoch` BẤT BIẾN
// (`claim_account.ak` nhánh `Claim`), nên tăng E không tăng tốc độ mở khoá. Trong một cửa sổ
// epoch, phần rút ra được bị chặn cứng ở `D · drops_per_epoch · elapsed`. Muốn rút nhiều hơn
// trần đó trong CÙNG một cửa sổ thì phải nâng D bằng một lượt `beacon` mới — D là tham số
// quản trị đọc tại thời điểm redeem từ beacon reference input, đúng chỗ nó sinh ra để đổi.
//
// ĐỒNG HỒ EPOCH — chỗ dễ đọc nhầm nhất, đọc kỹ trước khi đổi số.
// `util.get_epoch(tx, ms_per_epoch) = validity_range.lower_bound / ms_per_epoch`
// (`Distribution/onchain/lib/magiclamp/lampdist/util.ak:12-15`). Với
// `MS_PER_EPOCH = 432_000_000` thì đây là cửa sổ 5 ngày neo vào mốc Unix, KHÔNG liên quan
// lịch epoch của Cardano. Đừng tra epoch Cardano rồi suy ra hạn ở đây — hai đồng hồ khác nhau.
//
//   vested = min(E, D · drops_per_epoch · max(0, current_epoch − start_epoch))
//
// `elapsed = 0` ⇒ `vested = 0` ⇒ `amount = 0` ⇒ `expect amount > 0` fail. Nên tài khoản phải
// có `start_epoch` NHỎ HƠN epoch lúc redeem. `start_epoch` là một trường DATUM do bên dựng
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
// ║ Bản vá đổi hash của `treasury` và `beacon` ⇒ nó CHỈ có hiệu lực từ cụm đúc lại. Tệp   ║
// ║ này vẫn nhắm cụm CŨ và cố ý KHÔNG đổi, vì đổi bây giờ là làm hỏng vòng đầu-cuối đang  ║
// ║ chạy trên cụm cũ.                                                                    ║
// ║                                                                                      ║
// ║ SAU lượt đúc lại, hai thứ trong tệp này TRỞ THÀNH SAI và phải sửa cùng lượt:          ║
// ║   (1) `BACKDATE_EPOCHS` — C-ACC-2 từ chối mọi giá trị ≠ 0. Bỏ hẳn tham số này.        ║
// ║   (2) nhãn beacon tính bằng `beaconEpochOnChain + 1` — C-BCN-3 đòi nhãn = cửa sổ      ║
// ║       hiện tại. Dùng `epochWindow(msPerEpoch)` (`Distribution/offchain/src/           ║
// ║       constants.ts`) và đặt CẢ HAI đầu validity range, không chỉ `validFrom`.         ║
// ║                                                                                      ║
// ║ Cả hai chỗ sẽ ĐỎ ở chuỗi chứ không im lặng — nhưng lỗi chuỗi chỉ nói "validator       ║
// ║ crashed", nên dòng này tồn tại để người gặp nó biết đi đâu.                           ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Ở đây `start_epoch` được đặt = `epoch hiện tại − BACKDATE_EPOCHS`, và giao dịch CREATE
// mang `validFrom` nằm TRONG chính epoch đó — nên `get_epoch` của chính giao dịch ấy khớp
// `start_epoch` nó ghi, không có hai con số đá nhau. Đặt `BACKDATE_EPOCHS=0` để quay về lối
// bảo thủ (chờ hết một ranh giới 5 ngày mới redeem được).
//
// Chạy (mặc định CHỈ ĐỌC, không ký, không gửi):
//   NETWORK=Preprod tsx 28_beacon_grant_redeem.ts                    # in trạng thái rồi dừng
//   NETWORK=Preprod STEP=beacon tsx 28_beacon_grant_redeem.ts        # dựng thử, không gửi
//   NETWORK=Preprod STEP=beacon SUBMIT=true tsx 28_beacon_grant_redeem.ts
//   NETWORK=Preprod STEP=grant  SUBMIT=true tsx 28_beacon_grant_redeem.ts
//   NETWORK=Preprod STEP=redeem SUBMIT=true tsx 28_beacon_grant_redeem.ts
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Data, applyParamsToScript, validatorToScriptHash, credentialToAddress,
  scriptHashToCredential, toUnit, getAddressDetails,
  type UTxO, type Validator, type MintingPolicy, type LucidEvolution,
} from "@lucid-evolution/lucid";

import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import {
  rehydrate, canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, MS_PER_EPOCH, DROP_NAME,
} from "./_canonical_v2.js";
import { buildPostBeaconTx } from "../../Distribution/offchain/src/beaconBuilder.js";
import { buildClaimTx } from "../../Distribution/offchain/src/claimBuilder.js";
import { buildRedeemTx } from "../../Distribution/offchain/src/redeemBuilder.js";
import { decodeTreasuryDatum, decodeClaimAccountDatum } from "../../Distribution/offchain/src/datum.js";
import { D_GENESIS, OILDROP_PER_LAMP } from "../../Distribution/offchain/src/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Tham số màn diễn tập ─────────────────────────────────────────────────────
/** D — oildrop mở khoá mỗi drop·epoch. Mặc định giá trị thiết kế `D_GENESIS` = 100 LAMP. */
const DROP_VALUE = BigInt(process.env.DROP_VALUE_OILDROP ?? D_GENESIS.toString());
/** E — entitlement cấp cho ví vận hành. 2002 LAMP = 1001 cho ví thử + 1001 mồi kho pot Wakeme. */
const ENTITLEMENT = BigInt(process.env.ENTITLEMENT_OILDROP ?? "2002000000");
/** `drops_per_epoch` của tài khoản. D · dpe ≥ E ⇒ vào đủ trong đúng một ranh giới epoch. */
const DROPS_PER_EPOCH = BigInt(process.env.DROPS_PER_EPOCH ?? "21");
/** Số cửa sổ lùi `start_epoch`. 1 ⇒ redeem được ngay; 0 ⇒ chờ hết một cửa sổ 5 ngày. */
const BACKDATE_EPOCHS = BigInt(process.env.BACKDATE_EPOCHS ?? "1");
/** `STEP=topup` — oildrop cấp THÊM vào tài khoản đã có (đường UPDATE của `Claim`). */
const TOPUP = BigInt(process.env.TOPUP_OILDROP ?? "0");
/** `STEP=send` — địa chỉ nhận của lượt chuyển thường. Phải là ví payment-key. */
const SEND_TO = (process.env.SEND_TO ?? "").trim();
/** `STEP=send` — oildrop chuyển đi. */
const SEND_AMOUNT = BigInt(process.env.SEND_OILDROP ?? "0");
/** Lovelace kèm theo output của `STEP=send`. Đủ trên min-ADA cho một output một tài sản. */
const SEND_LOVELACE = BigInt(process.env.SEND_LOVELACE ?? "2000000");

const STEP = (process.env.STEP ?? "").toLowerCase();

const refKey = (u: UTxO) => `${u.txHash}#${u.outputIndex}`;
const lamp = (oildrop: bigint) => `${oildrop / OILDROP_PER_LAMP} LAMP (${oildrop} oildrop)`;

/** Epoch VALIDATOR (cửa sổ 5 ngày neo mốc Unix), KHÔNG phải epoch Cardano. */
function epochNow(): bigint {
  return BigInt(Date.now()) / MS_PER_EPOCH;
}
/** Một mốc ms nằm GIỮA epoch `e` — dùng làm `validFrom` để `get_epoch` trả đúng `e`. */
function msInEpoch(e: bigint): bigint {
  return e * MS_PER_EPOCH + MS_PER_EPOCH / 2n;
}

// ── Hai script Distribution mà `rehydrate()` KHÔNG trả về ────────────────────
// `CanonicalScripts` chỉ mang `treasury` + `beacon`; `claim_account` và `claim_account_nft`
// chỉ có HASH trong wiring. Dựng lại ở đây từ chính blueprint, rồi ĐỐI CHIẾU hash với wiring
// — dựng lệch một tham số là ra một địa chỉ khác, và Cardano không chạy validator lúc TẠO
// output nên cái lệch đó sẽ không đỏ ở đâu cả cho tới lúc tiền đã nằm ở địa chỉ chết.
async function claimScripts(pkh: string, khoPid: string, lampPid: string,
                            tokenName: string, beaconPid: string) {
  const p = resolve(__dirname, "../../Distribution/onchain/plutus.json");
  const vs = (JSON.parse(await readFile(p, "utf8")) as {
    validators: { title: string; compiledCode: string; parameters?: unknown[] }[];
  }).validators;
  const find = (title: string) => {
    const v = vs.find((x) => x.title === title);
    if (!v) throw new Error(`Không thấy '${title}' trong Distribution/onchain/plutus.json — chạy 'aiken build'.`);
    if (!Array.isArray(v.parameters)) throw new Error(`APPLY-001: blueprint không khai 'parameters' cho '${title}'.`);
    return v;
  };
  const apply = (title: string, params: unknown[]) => {
    const v = find(title);
    if (v.parameters!.length !== params.length) {
      throw new Error(
        `APPLY-002: '${title}' khai ${v.parameters!.length} tham số, truyền ${params.length}. ` +
        `applyParamsToScript KHÔNG ném khi thiếu — nó trả một script hash KHÁC, im lặng.`,
      );
    }
    return { type: "PlutusV3" as const, script: applyParamsToScript(v.compiledCode, params as never) };
  };

  const committee = canonicalCommittee(pkh);
  const threshold = CANONICAL_COMMITTEE_THRESHOLD;
  const accountNft: MintingPolicy = apply("claim_account_nft.claim_account_nft.mint",
    [committee, threshold, khoPid]);
  const accountPid = validatorToScriptHash(accountNft as Validator);
  const claim: Validator = apply("claim_account.claim_account.spend", [
    committee, threshold, MS_PER_EPOCH, lampPid, tokenName, beaconPid, khoPid, accountPid,
  ]);
  return { accountNft, accountPid, claim, claimHash: validatorToScriptHash(claim) };
}

/** UTxO kho canonical = cái mang ĐÚNG 1 NFT "TRSY". Địa chỉ kho công khai, ai cũng đỗ được vào. */
function pickTreasury(all: UTxO[], khoUnit: string): UTxO {
  const carriers = all.filter((u) => (u.assets[khoUnit] ?? 0n) === 1n);
  if (carriers.length !== 1) {
    throw new Error(
      `TRSY-001: cần ĐÚNG 1 UTxO mang NFT "TRSY" ở địa chỉ kho, đếm ${carriers.length}. ` +
      `Nhiều hơn 1 hoặc 0 ⇒ dừng; gộp bằng 27_refill_treasury.ts trước.`,
    );
  }
  const u = carriers[0]!;
  if (!u.datum) throw new Error(`TRSY-002: UTxO kho ${refKey(u)} không có inline datum.`);
  return u;
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);

  const cs = await claimScripts(pkh, wiring.markers.khoPid, wiring.lampPid,
                                wiring.tokenName, wiring.markers.beaconPid);
  if (cs.claimHash !== wiring.claimHash) {
    throw new Error(`APPLY-003: claim_account dựng lại ra hash ${cs.claimHash}, state ghi ${wiring.claimHash}.`);
  }
  if (cs.accountPid !== wiring.accountPid) {
    throw new Error(`APPLY-003: claim_account_nft dựng lại ra pid ${cs.accountPid}, state ghi ${wiring.accountPid}.`);
  }
  const claimAddr = credentialToAddress(NETWORK, scriptHashToCredential(cs.claimHash));

  // ── Đọc trạng thái chuỗi ───────────────────────────────────────────────────
  const beaconUnit = toUnit(wiring.markers.beaconPid, DROP_NAME);
  const beaconUtxos = (await lucid.utxosAt(wiring.beaconAddr))
    .filter((u) => (u.assets[beaconUnit] ?? 0n) === 1n);
  if (beaconUtxos.length !== 1) {
    throw new Error(`BCN-001: cần ĐÚNG 1 UTxO mang NFT "DROP" ở ${wiring.beaconAddr}, đếm ${beaconUtxos.length}.`);
  }
  const beaconUtxo = beaconUtxos[0]!;
  const beaconD = beaconUtxo.datum
    ? (Data.from(beaconUtxo.datum) as unknown as { fields: unknown[] }).fields
    : undefined;

  const treasuryUtxo = pickTreasury(await lucid.utxosAt(wiring.treAddr), wiring.khoUnit);
  const tDatum = decodeTreasuryDatum(Data.from(treasuryUtxo.datum!));
  const pool = treasuryUtxo.assets[wiring.lampUnit] ?? 0n;

  const accountName = /* blake2b_256(owner) — builder tự tính, ở đây chỉ để LỌC */ undefined;
  const claimUtxos = await lucid.utxosAt(claimAddr);
  const myAccounts = claimUtxos.filter((u) =>
    Object.keys(u.assets).some((k) => k.startsWith(wiring.accountPid)));
  void accountName;

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
  console.log(`\nTài khoản @ ${claimAddr}`);
  console.log(`  UTxO mang NFT tài khoản: ${myAccounts.length}`);
  for (const u of myAccounts) console.log(`    · ${refKey(u)}  ${lamp(u.assets[wiring.lampUnit] ?? 0n)}`);

  if (!STEP) {
    console.log(
      `\nDỪNG: chưa nêu STEP. Thứ tự bắt buộc — beacon → grant → redeem.\n` +
      `  STEP=beacon  đặt D = ${lamp(DROP_VALUE)}\n` +
      `  STEP=grant   cấp E = ${lamp(ENTITLEMENT)}, drops/epoch ${DROPS_PER_EPOCH}, lùi ${BACKDATE_EPOCHS} cửa sổ\n` +
      `  STEP=topup   cấp THÊM E cho tài khoản đã có — đặt TOPUP_OILDROP\n` +
      `  STEP=redeem  kéo phần đã vested về ví thường\n` +
      `  STEP=send    chuyển thường sang ví khác — đặt SEND_TO + SEND_OILDROP`,
    );
    return;
  }

  // ── STEP beacon ────────────────────────────────────────────────────────────
  if (STEP === "beacon") {
    // `beacon.ak:45` ép `out_datum.epoch > datum.epoch` — ĐƠN ĐIỆU TĂNG, không phải "bằng
    // epoch hiện tại". Lượt post thứ hai trong cùng một cửa sổ vì thế phải mang nhãn epoch
    // của cửa sổ KẾ, và lượt đầu tiên gặp chỗ này chỉ thấy "validator crashed".
    //
    // ⚠ Nhãn `epoch` của beacon KHÔNG ràng buộc gì ở lúc rút: `claim_account.ak`
    // `find_drop_value` (`:173-187`) đọc đúng `bd.drop_value`, bỏ qua `bd.epoch` — nên một D
    // dán nhãn cửa sổ 4143 có hiệu lực NGAY trong cửa sổ 4142. Nhãn đó là kế toán, không
    // phải cổng; ai đọc nó như một cam kết "D này chỉ áp từ cửa sổ sau" là đọc sai.
    const beaconEpochOnChain = beaconD ? (beaconD[0] as bigint) : 0n;
    const nextLabel = beaconEpochOnChain + 1n;
    const beaconEpoch = BigInt(process.env.BEACON_EPOCH ?? (e > nextLabel ? e : nextLabel).toString());
    if (beaconEpoch <= beaconEpochOnChain) {
      throw new Error(`BCN-002: nhãn epoch ${beaconEpoch} không lớn hơn nhãn đang trên chuỗi ${beaconEpochOnChain} (beacon.ak:45).`);
    }
    console.log(`\nNhãn epoch beacon: ${beaconEpochOnChain} → ${beaconEpoch}   D: ${lamp((beaconD?.[2] as bigint) ?? 0n)} → ${lamp(DROP_VALUE)}`);
    const r = await buildPostBeaconTx({
      lucid, beaconUtxo, beaconScript: scripts.beacon, network: NETWORK,
      beaconNftPolicy: wiring.markers.beaconPid,
      newBeacon: { epoch: beaconEpoch, kind: "DropParam", drop_value: DROP_VALUE },
      committeeKeyHashes: canonicalCommittee(pkh),
      threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
    });
    console.log(`\n${r.summary}`);
    await finish(lucid, r.tx, "PostBeacon");
    return;
  }

  // ── STEP grant ─────────────────────────────────────────────────────────────
  if (STEP === "grant") {
    if (!beaconD || (beaconD[2] as bigint) <= 0n) {
      throw new Error(
        `GRANT-000: beacon drop_value đang = 0. Cấp tài khoản lúc này thì Redeem rút ra 0 ` +
        `(claim_account.ak:118 'expect drop_value > 0'). Chạy STEP=beacon trước.`,
      );
    }
    if (myAccounts.length > 0) {
      throw new Error(
        `GRANT-001: ví này ĐÃ có ${myAccounts.length} tài khoản ở ${claimAddr}. Đường CREATE chỉ ` +
        `chạy một lần cho mỗi ví (tên NFT = blake2b_256(owner)). Tăng E thì đi đường UPDATE.`,
      );
    }
    const startEpoch = e - BACKDATE_EPOCHS;
    const r = await buildClaimTx({
      lucid, claimScript: cs.claim, network: NETWORK,
      ownerPkh: pkh, amount: ENTITLEMENT,
      currentEpoch: startEpoch,                 // CREATE ⇒ start_epoch := giá trị này
      dropsPerEpoch: DROPS_PER_EPOCH,
      accountNft: { script: cs.accountNft, policyId: cs.accountPid },
      treasury: {
        utxo: treasuryUtxo, script: scripts.treasury,
        nftPolicy: wiring.markers.khoPid, nftAssetName: "54525359",
      },
      committeeKeyHashes: canonicalCommittee(pkh),
      threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
      solvency: { treasuryLamp: pool, otherOutstanding: tDatum.outstanding_entitlement },
      validFromMs: msInEpoch(startEpoch),       // get_epoch(tx) == start_epoch, không đá nhau
    });
    console.log(`\n${r.summary}`);
    console.log(
      `\nvested sau MỘT ranh giới = min(E, D·dpe·1) = min(${ENTITLEMENT}, ` +
      `${DROP_VALUE * DROPS_PER_EPOCH}) = ${lamp(ENTITLEMENT < DROP_VALUE * DROPS_PER_EPOCH ? ENTITLEMENT : DROP_VALUE * DROPS_PER_EPOCH)}`,
    );
    await finish(lucid, r.tx, "GrantEntitlement (CREATE)");
    return;
  }

  // ── STEP topup ─────────────────────────────────────────────────────────────
  // Đường UPDATE của `Claim`: E += amount. `drops_per_epoch` và `start_epoch` BẤT BIẾN
  // (`claim_account.ak` nhánh `Claim` ép cả hai), nên bước này KHÔNG nới trần rút trong
  // cửa sổ hiện tại — trần đó là `D · drops_per_epoch · elapsed` và chỉ `beacon` nới được.
  if (STEP === "topup") {
    if (myAccounts.length !== 1) {
      throw new Error(`TOPUP-000: cần ĐÚNG 1 tài khoản ở ${claimAddr}, đếm ${myAccounts.length}. Chạy STEP=grant trước.`);
    }
    if (TOPUP <= 0n) throw new Error(`TOPUP-001: đặt TOPUP_OILDROP > 0 (đang ${TOPUP}).`);
    if (!beaconD || (beaconD[2] as bigint) <= 0n) {
      throw new Error(`TOPUP-005: beacon drop_value đang = 0 ⇒ redeem sau đó rút ra 0. Chạy STEP=beacon trước.`);
    }
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

    const eAfter = accDatum.entitlement + TOPUP;
    const capThisWindow = (beaconD![2] as bigint) * accDatum.drops_per_epoch
      * (e > accDatum.start_epoch ? e - accDatum.start_epoch : 0n);
    const vestedAfter = eAfter < capThisWindow ? eAfter : capThisWindow;
    console.log(
      `\nTài khoản ${refKey(accUtxo)}\n` +
      `  E hiện tại   : ${lamp(accDatum.entitlement)}\n` +
      `  đã rút       : ${lamp(accDatum.redeemed)}\n` +
      `  start_epoch  : ${accDatum.start_epoch}   drops/epoch: ${accDatum.drops_per_epoch}\n` +
      `  E sau topup  : ${lamp(eAfter)}\n` +
      `  trần cửa sổ  : D·dpe·elapsed = ${lamp(capThisWindow)}\n` +
      `  rút được sau bước này: ${lamp(vestedAfter - accDatum.redeemed)}`,
    );

    const r = await buildClaimTx({
      lucid, claimScript: cs.claim, network: NETWORK,
      ownerPkh: pkh, amount: TOPUP,
      currentEpoch: e,
      claimAccountUtxo: accUtxo,          // ⇒ đường UPDATE, builder KHÔNG đúc NFT
      treasury: {
        utxo: treasuryUtxo, script: scripts.treasury,
        nftPolicy: wiring.markers.khoPid, nftAssetName: "54525359",
      },
      committeeKeyHashes: canonicalCommittee(pkh),
      threshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
      solvency: { treasuryLamp: pool, otherOutstanding },
      validFromMs: msInEpoch(e),
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
      validFromMs: msInEpoch(e),
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
