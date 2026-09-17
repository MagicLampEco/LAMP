// LampDistribution claimBuilder — committee 2/3 confirm → tạo/cập nhật ClaimAccount.
// CONTRACT v2 "Capped Drop": Claim cấp/tăng entitlement E (committee confirm activity).
//
//   CREATE: account chưa có → datum {owner, entitlement=amount, redeemed=0,
//           start_epoch=current, drops_per_epoch}.
//   UPDATE: account đã có → REBASE: entitlement = (E − redeemed) + amount, redeemed = 0,
//           start_epoch = current; dpe bất biến. Giữ mốc cũ thì tuổi tài khoản mang sang
//           phần vừa cấp và nó rút được ngay — `treasury.ak` C-ACC-3 có đủ lý do.
//
// SOLVENCY ON-CHAIN (C-SOLV-*): MỌI Claim PHẢI co-spend treasury UTxO (GrantEntitlement):
//   treasury.outstanding_entitlement += amount, ép outstanding_entitlement ≤ pool LAMP.
//   → bất biến global Σ(E−redeemed) ≤ pool ép được PER-TX qua sổ cái singleton (NFT "TRSY").
//   Đây thay thế chốt off-chain assertClaimSolvency (vẫn giữ làm pre-flight cảnh báo sớm).
//
// Invariants:
//   C-CLAIM-1  ≥ ⌈2N/3⌉ committee signatures.
//   C-CLAIM-1  amount > 0.
//   C-CLAIM-4  out.entitlement = in.entitlement − in.redeemed + amount.
//   C-CLAIM-5  out.redeemed = 0.
//   C-CLAIM-6  out.start_epoch = cửa sổ của validity range (cả hai đầu cùng cửa sổ).
//   C-CLAIM-3/7 out.owner == in.owner; drops_per_epoch unchanged.
//   C-ACC-4    CREATE: 1 ≤ drops_per_epoch ≤ DROPS_PER_EPOCH_MAX.
//   C-SOLV-1   treasury.outstanding_entitlement_out = cum_in + amount (co-spend bắt buộc).
//   C-SOLV-2   outstanding_entitlement_out ≤ treasury pool LAMP (ép on-chain ở treasury).
//   C-MINT-1   tập policy trong tx.mint ⊆ {account_nft_policy}
//              → UPDATE: KHÔNG đúc gì (claim_account ép `is_zero(tx.mint)`).
//              → CREATE: đúc ĐÚNG 1 NFT tên blake2b_256(owner) (C-ACC-1, A-ACC-2..6).
//   C-VAL-0    assets bảo toàn (lovelace + dust) — chỉ datum đổi; treasury pool bất biến.

import {
  Data, toUnit, mintingPolicyToId,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import type { ClaimAccountDatum, TreasuryDatum } from "./types.js";
import {
  claimAccountDatumToCbor, claimRedeemerToCbor, decodeClaimAccountDatum,
  decodeTreasuryDatum, treasuryDatumToCbor, grantEntitlementRedeemerToCbor,
} from "./datum.js";
import { accountNftName, mintAccountRedeemerToCbor } from "./accountNft.js";
import { assertCommitteeSigners } from "./committee.js";
import { DEFAULT_DROPS_PER_EPOCH, DROPS_PER_EPOCH_MAX, TREASURY_NFT_ASSET_NAME } from "./constants.js";

export interface ClaimParams {
  lucid:        LucidEvolution;
  /** Applied claim_account validator (định nghĩa script address). */
  claimScript:  Validator;
  network:      Network;

  /** PKH chủ ví (hex 28-byte) được committee xác nhận. */
  ownerPkh:     string;
  /** Số oildrop entitlement cấp thêm lần này (> 0). */
  amount:       bigint;
  /** Epoch hiện tại (committee tính off-chain từ validity range). */
  currentEpoch: bigint;

  /**
   * ClaimAccount UTxO hiện tại của owner (UPDATE path). Bỏ trống → CREATE path
   * (account đầu tiên cho owner này): start_epoch = currentEpoch.
   */
  claimAccountUtxo?: UTxO;

  /**
   * drops_per_epoch cho account mới (CREATE). Mặc định 1 (MVP).
   *
   * BẮT BUỘC `> 0` — `0`, số âm, hoặc thứ không phải `bigint` đều ném `CLAIM-004`. Ràng buộc
   * này ghi ở đây chứ không chỉ trong thân hàm: người dùng SDK đọc `ClaimParams`, không đọc
   * thân hàm cách đó 180 dòng.
   */
  dropsPerEpoch?: bigint;

  /** Min-ADA cho ClaimAccount UTxO mới (CREATE path). Mặc định 2 ADA. */
  accountLovelace?: bigint;

  /**
   * NFT XÁC THỰC TÀI KHOẢN — **BẮT BUỘC ở đường CREATE** (bỏ qua ở UPDATE).
   *
   * `treasury.GrantEntitlement` nhánh CREATE ép C-ACC-1:
   *   `assets.quantity_of(tx.mint, account_nft_policy, blake2b_256(ca_out.owner)) == 1`
   * ⇒ tx CREATE nào KHÔNG đúc NFT này là fail on-chain, không có đường vòng.
   * Còn `claim_account` (C-ACC-0) đòi đúng NFT đó ở cả input lẫn output mỗi lần spend,
   * nên tạo tài khoản không kèm NFT (hoặc NFT sai tên) = ghi nợ vào sổ cho một tài khoản
   * VĨNH VIỄN không tiêu được: `outstanding_entitlement` phình mà không đường lùi, siết
   * dần trần cấp phát về sau qua C-SOLV-2.
   *
   * Ở UPDATE thì ngược lại: `claim_account` ép `is_zero(tx.mint)` — truyền vào cũng không
   * dùng, builder KHÔNG đúc gì.
   */
  accountNft?: {
    /** Minting policy `claim_account_nft` ĐÃ apply đủ 3 tham số. */
    script:    MintingPolicy;
    /** Policy id; bỏ trống → suy từ `script`. Truyền vào chỉ để đối chiếu. */
    policyId?: string;
  };

  /**
   * TREASURY CO-SPEND (BẮT BUỘC on-chain solvency, C-SOLV-*). Mọi Claim spend treasury
   * UTxO với GrantEntitlement: outstanding_entitlement += amount, pool LAMP bất biến.
   * Treasury validator ép outstanding_entitlement ≤ pool → over-grant vượt quỹ FAIL on-chain.
   * **BẮT BUỘC** (2026-08-12, review PR #22 điểm 4). Trước đây là tuỳ chọn và builder in
   * ra "(off-chain only — no treasury co-spend)" như thể đó là một chế độ hợp lệ — nhưng
   * on-chain MỌI Claim đều đòi đúng 1 input + 1 output mang TRSY (`find_treasury_in`
   * `expect [i]`), nên nhánh không-treasury CHỈ dựng ra được tx chắc chắn fail. Cùng loại
   * lỗi mà PR #23 đang vá ở `mintBuilder` — builder kẹt ở hình dạng validator không nhận.
   */
  treasury: {
    /** Treasury UTxO hiện tại (mang NFT "TRSY", inline TreasuryDatum). */
    utxo:        UTxO;
    /** Applied treasury validator (định nghĩa treasury address). */
    script:      Validator;
    /** Treasury authenticity NFT policy id (compile-time param). */
    nftPolicy:   string;
    /** NFT asset-name hex; mặc định "TRSY". */
    nftAssetName?: string;
  };

  /** Danh sách committee key-hash (hex). */
  committeeKeyHashes: string[];
  threshold?:        number;
  signerKeyHashes?:  string[];

  /**
   * SOLVENCY GUARD (over-collateralization) — chặn committee cấp E vượt quỹ.
   * Khi cung cấp `solvency`, builder ép `Σ(entitlement − redeemed) sau Claim ≤ treasuryLamp`.
   * Đây là chốt off-chain pre-flight TẠI LÚC cấp E (cảnh báo sớm, mạnh hơn REDEEM-012
   * vốn chỉ chặn lúc redeem). KHÔNG còn là chốt duy nhất: on-chain treasury validator
   * ĐÃ ép outstanding_entitlement ≤ pool (C-SOLV-2) qua treasury co-spend bắt buộc.
   */
  solvency?: {
    /** LAMP (oildrop) hiện có trong treasury pool. */
    treasuryLamp: bigint;
    /**
     * Tổng (entitlement − redeemed) của MỌI ClaimAccount ĐANG MỞ KHÁC (không gồm
     * account đang Claim này — account đó tính lại từ amount + datum cũ). oildrop.
     */
    otherOutstanding: bigint;
  };

  /**
   * POSIX ms cho lower_bound validity_range (BẮT BUỘC live tx CREATE: validator
   * get_epoch đọc lower_bound → start_epoch). Bỏ trống → KHÔNG set (unit test off-chain).
   */
  validFromMs?: bigint;

  /**
   * POSIX ms cho upper_bound validity_range — BẮT BUỘC live tx CREATE kể từ C-ACC-2.
   *
   * Trước bản vá Issue #72 chỉ có đầu dưới, và đầu dưới MỘT MÌNH không chứng minh được
   * `start_epoch` là cửa sổ thật: sổ cái nhận tx khi `lower ≤ now`, nên `lower` đặt lùi
   * bao xa cũng hợp lệ. Validator nay ép CẢ HAI đầu rơi cùng cửa sổ ("Luật 2b").
   *
   * Lấy cặp lo/hi bằng `epochWindow(msPerEpoch)` trong `constants.ts` — nó kéo `hi` về sát
   * cuối cửa sổ khi khoảng mặc định vắt qua biên epoch. Tự đặt tay thì mấy lần mỗi chu kỳ
   * sẽ có một tx bị từ chối mà không có gì nói vì sao.
   */
  validToMs?: bigint;
}

export interface ClaimResult {
  tx:               TxSignBuilder;
  claimAddress:     string;
  newDatum:         ClaimAccountDatum;
  mode:             "create" | "update";
  /** Treasury datum mới (outstanding_entitlement += amount). Luôn có — treasury co-spend
   *  là BẮT BUỘC, xem `ClaimParams.treasury`. */
  newTreasuryDatum:  TreasuryDatum;
  /** Unit NFT tài khoản đã đúc (chỉ CREATE; UPDATE không đúc gì — C-MINT-1). */
  accountNftUnit?:  string;
  summary:          string;
}

const DEFAULT_ACCOUNT_LOVELACE = 2_000_000n;

/** Strip leading 0x + lowercase (so sánh owner). */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

/**
 * Over-collateralization invariant (off-chain, lúc cấp E):
 *   Σ(entitlement − redeemed) toàn hệ thống SAU Claim ≤ treasuryLamp.
 * `thisOutstandingAfter` = entitlement_after − redeemed của account đang Claim.
 * Ném CLAIM-010 nếu vi phạm. Pure → unit-testable.
 */
export function assertClaimSolvency(
  treasuryLamp: bigint,
  otherOutstanding: bigint,
  thisOutstandingAfter: bigint,
): void {
  const totalOutstanding = otherOutstanding + thisOutstandingAfter;
  if (totalOutstanding > treasuryLamp) {
    throw new Error(
      `CLAIM-010: solvency — Σ(entitlement−redeemed) sau Claim = ${totalOutstanding} oildrop ` +
      `> treasury ${treasuryLamp} oildrop. Cấp E vượt quỹ (under-collateralized). ` +
      `Fund thêm treasury ≥ ${totalOutstanding} oildrop TRƯỚC khi Claim, hoặc giảm amount.`,
    );
  }
}

export async function buildClaimTx(params: ClaimParams): Promise<ClaimResult> {
  const {
    lucid, claimScript, network, ownerPkh, amount, currentEpoch,
    claimAccountUtxo, committeeKeyHashes,
  } = params;

  if (amount <= 0n) throw new Error(`CLAIM-001: amount must be > 0 (got ${amount})`); // C-CLAIM-2

  const signers   = params.signerKeyHashes ?? committeeKeyHashes;
  const threshold = assertCommitteeSigners(committeeKeyHashes, signers, params.threshold); // C-CLAIM-1

  const claimAddress = credentialToAddress(
    network,
    scriptHashToCredential(validatorToScriptHash(claimScript)),
  );

  const owner = normHex(ownerPkh);

  let txb = lucid.newTx();
  let newDatum: ClaimAccountDatum;
  let mode: "create" | "update";
  let outAssets: Record<string, bigint>;
  /** Unit NFT tài khoản đúc trong tx này (chỉ CREATE). */
  let mintedAccountNft: string | undefined;

  if (claimAccountUtxo) {
    // ── UPDATE path ────────────────────────────────────────────────
    mode = "update";
    if (!claimAccountUtxo.datum) {
      throw new Error("CLAIM-002: claimAccountUtxo has no inline datum");
    }
    const prev = decodeClaimAccountDatum(Data.from(claimAccountUtxo.datum));

    // CLAIM-005: cùng cái bẫy một chiều của CLAIM-004, khác lối vào. Ở đây `drops_per_epoch`
    // KHÔNG do caller đặt — nó đọc từ datum cũ và được bảo toàn nguyên (dòng dưới). Nên một
    // tài khoản đã mang `drops_per_epoch = 0` (tạo trước bản vá này, hoặc bởi một tx không đi
    // qua builder này — trên chuỗi chưa chặn, xem Issue) vẫn nhận thêm entitlement được, và
    // mỗi lần nhận lại đẩy `outstanding_entitlement` lên (`treasury.ak:166`) cho một tài khoản
    // mà `claim_account.ak:119` đã giết nhánh Redeem vĩnh viễn.
    //
    // Phép kiểm này đứng TRƯỚC phép kiểm owner có chủ đích: kiểm owner là bộ lọc NGHIỆP VỤ
    // (ai được cấp), kiểm này là phép kiểm TÍNH TOÀN VẸN (dữ liệu có hợp lệ không). Trộn hai
    // loại vào một chỗ thì thứ tự giữa chúng thành ngẫu nhiên, và không có gì báo khi đặt nhầm.
    if (prev.drops_per_epoch <= 0n) {
      throw new Error(
        `CLAIM-005: account hiện có drops_per_epoch = ${prev.drops_per_epoch} — cấp thêm ` +
        `entitlement chỉ làm phình outstanding_entitlement cho một tài khoản chưa redeem được`,
      );
    }

    if (normHex(prev.owner) !== owner) {
      throw new Error(
        `CLAIM-003: ownerPkh mismatch — datum owner ${prev.owner} ≠ ${owner}`, // C-CLAIM-3
      );
    }

    // REBASE (C-CLAIM-4/5/6 ở `claim_account.ak`, C-ACC-3 ở `treasury.ak`). Phần chưa rút
    // `E − redeemed` nằm nguyên trong E' — người nhận không mất gì; phần đã vest-mà-chưa-rút
    // phải vest lại, nên caller muốn giữ nó thì Redeem TRƯỚC rồi mới cấp thêm.
    newDatum = {
      owner:           prev.owner,                                    // C-CLAIM-3
      entitlement:     prev.entitlement - prev.redeemed + amount,     // C-CLAIM-4
      redeemed:        0n,                                            // C-CLAIM-5
      start_epoch:     currentEpoch,                                  // C-CLAIM-6
      drops_per_epoch: prev.drops_per_epoch,                          // C-CLAIM-7 (unchanged)
    };

    // Bảo toàn TẤT CẢ assets (lovelace + bất kỳ dust) — chỉ datum đổi (C-VAL-0).
    outAssets = { ...claimAccountUtxo.assets };

    txb = txb
      .collectFrom([claimAccountUtxo], claimRedeemerToCbor(amount))
      .attach.SpendingValidator(claimScript);
  } else {
    // ── CREATE path ────────────────────────────────────────────────
    mode = "create";
    const accountLovelace = params.accountLovelace ?? DEFAULT_ACCOUNT_LOVELACE;

    // CLAIM-004: `??` chỉ bắt null/undefined, KHÔNG bắt 0n — nên một caller truyền
    // `dropsPerEpoch: 0n` ghi thẳng `drops_per_epoch = 0` vào datum. Đó là bẫy MỘT CHIỀU:
    // `claim_account.ak:119` (`expect datum.drops_per_epoch > 0`) giết nhánh `Redeem` vĩnh
    // viễn, trong khi khoản nợ đã vào sổ kho ở chính tx này và chỉ giảm được qua
    // `ReleaseForRedeem` (`treasury.ak:92`) — vốn cần một lần redeem thành công. Kết quả là
    // một khoản nợ khống bào mòn `outstanding_out ≤ pool_in` (`treasury.ak:170`) mãi mãi.
    // `vested.ts:36` không chặn hộ (nó nhận `>= 0`), nên chốt phải nằm ở đây.
    // Kiểm KIỂU chứ không chỉ kiểm DẤU: đây là SDK mở, caller từ JavaScript không kiểu truyền
    // được `NaN` hoặc chuỗi rác. `NaN <= 0n` trả `false` — mọi phép so sánh với NaN đều false —
    // nên một chốt chỉ so dấu sẽ CHO QUA đúng ca tệ nhất, và `NaN` đi tiếp vào datum.
    const dropsPerEpoch = params.dropsPerEpoch ?? DEFAULT_DROPS_PER_EPOCH;
    if (typeof dropsPerEpoch !== "bigint" || dropsPerEpoch <= 0n) {
      throw new Error(
        `CLAIM-004: dropsPerEpoch must be a bigint > 0 (got ${String(dropsPerEpoch)}) — tài ` +
        `khoản tạo với drops_per_epoch = 0 không bao giờ redeem được, mà khoản nợ thì đã vào sổ kho`,
      );
    }
    // CLAIM-006: trần on-chain C-ACC-4 (`treasury.ak`). Chặn ở đây để lỗi nói đúng thứ sai
    // thay vì "validator crashed" từ chuỗi.
    if (dropsPerEpoch > DROPS_PER_EPOCH_MAX) {
      throw new Error(
        `CLAIM-006: dropsPerEpoch ${dropsPerEpoch} vượt trần ${DROPS_PER_EPOCH_MAX} ` +
        `(treasury.ak C-ACC-4) — tốc độ mở khoá là D · drops_per_epoch, trần D một mình không đủ`,
      );
    }

    newDatum = {
      owner,
      entitlement:     amount,
      redeemed:        0n,
      start_epoch:     currentEpoch,
      drops_per_epoch: dropsPerEpoch,
    };

    // C-ACC-1 / A-ACC-2..A-ACC-4: đúc ĐÚNG 1 NFT tên blake2b_256(owner), hạ cánh ngay
    // trên chính ClaimAccount output này. Thiếu → dựng ra tx chắc chắn fail, nên chặn
    // TẠI ĐÂY thay vì để phát hiện lúc submit.
    const nft = params.accountNft;
    if (!nft) {
      throw new Error(
        "CLAIM-030: đường CREATE thiếu `accountNft` — treasury.GrantEntitlement (C-ACC-1) " +
        "đòi tx đúc đúng 1 NFT tên blake2b_256(owner) dưới account_nft_policy. " +
        "Truyền minting policy `claim_account_nft` đã apply đủ 3 tham số.",
      );
    }
    const derivedPolicyId = mintingPolicyToId(nft.script);
    if (nft.policyId !== undefined && normHex(nft.policyId) !== normHex(derivedPolicyId)) {
      throw new Error(
        `CLAIM-031: accountNft.policyId ${normHex(nft.policyId)} ≠ policy id suy từ script ` +
        `${derivedPolicyId}. Script đã apply SAI tham số (xem APPLY-001) — dừng, đừng đúc.`,
      );
    }
    const nftUnit = toUnit(derivedPolicyId, accountNftName(owner));
    mintedAccountNft = nftUnit;

    outAssets = { lovelace: accountLovelace, [nftUnit]: 1n };

    txb = txb
      .mintAssets({ [nftUnit]: 1n }, mintAccountRedeemerToCbor())
      .attach.MintingPolicy(nft.script);
  }

  // SOLVENCY GUARD (off-chain pre-flight, over-collateralization) — cảnh báo sớm.
  // KHÔNG còn là chốt duy nhất: on-chain treasury validator ép cum ≤ pool (C-SOLV-2).
  if (params.solvency) {
    const thisOutstandingAfter = newDatum.entitlement - newDatum.redeemed;
    assertClaimSolvency(
      params.solvency.treasuryLamp,
      params.solvency.otherOutstanding,
      thisOutstandingAfter,
    );
  }

  txb = txb.pay.ToAddressWithData(
    claimAddress,
    { kind: "inline", value: claimAccountDatumToCbor(newDatum) },
    outAssets,
  );

  // ── TREASURY CO-SPEND (C-SOLV-1/2): outstanding_entitlement += amount ≤ pool ───
  let newTreasuryDatum: TreasuryDatum;
  {
    const t = params.treasury;
    if (!t.utxo.datum) throw new Error("CLAIM-020: treasury.utxo has no inline datum");
    // Kho: MANG ĐỊA CHỈ THEO TỪ INPUT, KHÔNG dựng lại từ script hash.
    // `claim_account.ak:105` (C-SOLV-5) ép `tre_in_addr == tre_out_addr` — so CẢ `Address`,
    // kể cả stake credential; còn `credentialToAddress(network, scriptHashToCredential(...))`
    // LUÔN trả dạng enterprise (không stake credential). Hai vế chỉ trùng nhau CHỪNG NÀO kho
    // còn ngụ ở UTxO enterprise — trùng ngẫu nhiên, không phải do ràng buộc nào.
    // Đường UPDATE: `claim_account` spend CHẠY ⇒ kho ở địa chỉ base thì tx bị chuỗi từ chối.
    // Đường CREATE: không có account input nên `claim_account` KHÔNG chạy, tx qua được —
    // nhưng NFT "TRSY" bị âm thầm hạ từ base xuống enterprise, mất uỷ quyền stake mà không
    // ai đỏ. Mang theo từ input bịt cả hai đường bằng cùng một dòng.
    const treasuryAddress = t.utxo.address;
    const prevTreasury = decodeTreasuryDatum(Data.from(t.utxo.datum));

    // Authenticity: treasury UTxO PHẢI mang đúng 1 NFT "TRSY" (chống treasury giả).
    const nftUnit = toUnit(t.nftPolicy, t.nftAssetName ?? TREASURY_NFT_ASSET_NAME);
    const nftQty = t.utxo.assets[nftUnit] ?? 0n;
    if (nftQty !== 1n) {
      throw new Error(
        `CLAIM-021: treasury UTxO phải giữ đúng 1 NFT authenticity (${nftUnit}); got ${nftQty}`,
      );
    }

    newTreasuryDatum = {
      committee_hash:         prevTreasury.committee_hash,                       // C-TRE-2
      outstanding_entitlement: prevTreasury.outstanding_entitlement + amount,      // C-SOLV-1
    };

    // C-SOLV-2: on-chain treasury validator ép cum_out ≤ pool LAMP (over-grant → fail).
    // Pool LAMP + mọi asset BẤT BIẾN khi grant (chỉ datum đổi) — C-VAL-0.
    const treasuryOutAssets: Record<string, bigint> = { ...t.utxo.assets };

    txb = txb
      .collectFrom([t.utxo], grantEntitlementRedeemerToCbor())
      .attach.SpendingValidator(t.script)
      .pay.ToAddressWithData(
        treasuryAddress,
        { kind: "inline", value: treasuryDatumToCbor(newTreasuryDatum) },
        treasuryOutAssets,
      );
  }

  for (const k of signers) txb = txb.addSignerKey(k);

  // validity_range → validator get_epoch_strict (CREATE start_epoch). Live tx bắt buộc CẢ HAI
  // đầu: C-ACC-2 ép chúng rơi cùng một cửa sổ, vì đầu dưới một mình đặt lùi được tuỳ ý.
  if (params.validFromMs !== undefined) {
    txb = txb.validFrom(Number(params.validFromMs));
  }
  if (params.validToMs !== undefined) {
    txb = txb.validTo(Number(params.validToMs));
  }

  // CREATE-002 — chặn ở đây thay vì để chuỗi từ chối. Thiếu đầu trên thì validator ném, mà
  // lỗi từ chuỗi chỉ nói "validator crashed"; câu dưới nói ĐÚNG thứ thiếu. Áp cho CẢ UPDATE
  // từ 2026-09-17: rebase ghim `start_epoch` bằng cùng `get_epoch_strict` (C-ACC-3, C-CLAIM-6).
  // Mã lỗi giữ tên cũ để không gãy chỗ nào đang bắt nó.
  if (params.validFromMs !== undefined && params.validToMs === undefined) {
    throw new Error(
      `CREATE-002: đường ${mode.toUpperCase()} thiếu \`validToMs\`. C-ACC-2/C-ACC-3 (treasury.ak) ép cả hai đầu ` +
        "validity_range rơi cùng một cửa sổ epoch — đầu dưới một mình đặt lùi bao xa cũng " +
        "hợp lệ với sổ cái, nên nó không ghim được `start_epoch`. Lấy cặp lo/hi bằng " +
        "`epochWindow(msPerEpoch)` trong `constants.ts`.",
    );
  }

  const tx = await txb.complete();

  const summary = [
    `═══ Claim (${mode}) ═══`,
    ...(mintedAccountNft ? [`Account NFT:  mint 1 × ${mintedAccountNft}`] : []),
    `Owner:        ${owner}`,
    `Amount:       ${amount / 1_000_000n} LAMP (${amount} oildrop)`,
    `Entitlement:  ${newDatum.entitlement} oildrop`,
    `Redeemed:     ${newDatum.redeemed} oildrop`,
    `Start epoch:  ${newDatum.start_epoch}  · drops/epoch ${newDatum.drops_per_epoch}`,
    `Committee:    ${signers.length}/${committeeKeyHashes.length} signers (need ${threshold})`,
    `Outstanding:  ${newTreasuryDatum.outstanding_entitlement} oildrop (sổ cái nợ sau Claim)`,
    `Claim addr:   ${claimAddress}`,
  ].join("\n");

  // `exactOptionalPropertyTypes`: thêm khoá bằng spread có điều kiện, KHÔNG gán undefined.
  return {
    tx, claimAddress, newDatum, mode, summary, newTreasuryDatum,
    ...(mintedAccountNft !== undefined ? { accountNftUnit: mintedAccountNft } : {}),
  };
}
