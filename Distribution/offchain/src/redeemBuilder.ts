// LampDistribution redeemBuilder — user redeem LAMP đã vested (CONTRACT v3 §4).
//
// Tất định, permissionless: account tự tính vested on-chain, không proof/committee.
//
// Input:
//   - ClaimAccount UTxO (của owner) — spend với Redeem redeemer (Constr 1, [amount]).
//   - Treasury UTxO (giữ LAMP pool) — spend với ReleaseForRedeem redeemer.
// Reference input:
//   - DropParam beacon UTxO (read-only) — cung cấp `index`, `rate_root`, `epoch`, κ.
// Output:
//   - ClaimAccount': redeemed' = redeemed + amount; field khác bất biến.
//   - Treasury': LAMP giảm đúng `amount`; `total_redeemed` TĂNG đúng `amount`.
//   - User: nhận đúng `amount` LAMP.
//
//   A_span  = A(bây giờ) − index_at_start,  A(t) = index + rate_root · (t − epoch)
//   vested  = min(E, isqrt(dpe² · E · A_span²))
//   trần    = max(trim_floor, total_redeemed · trim_num / trim_den)
//   amount  = min(vested − redeemed, trần)   (yêu cầu > 0)
//
// ⚠ v3 ĐỔI HÌNH DẠNG GIAO DỊCH: redeemer `Redeem` nay MANG `amount`, và `total_redeemed`
//   là trường thứ ba của TreasuryDatum. Một bản dựng theo v2 gửi lên validator v3 sẽ bị
//   từ chối ở tầng giải mã datum, tức mất collateral chứ không phải hiện một lỗi đọc được.
//
// Invariants (CONTRACT §4/§7):
//   C-RDM-1     amount > 0.
//   C-RDM-VEST  (redeemed + amount)² ≤ dpe² · E · A_span²  (dạng bình phương, không căn).
//   C-RDM-2     vested ≤ entitlement (cap E — đã bảo đảm bởi vested()).
//   C-RDM-3     user nhận đúng `amount` LAMP.
//   C-RDM-4     out.redeemed == redeemed + amount; field khác unchanged (kể cả index_at_start).
//   C-RDM-6     owner signs.
//   C-RDM-TRIM  trần một lượt = max(trim_floor, total_redeemed · κ) — chia NGUYÊN.
//   C-RDM-CAP   amount ≤ trần một lượt.
//   C-RDM-TOTAL out.total_redeemed == in.total_redeemed + amount.
//   C-TRE-1     treasury_out.value = treasury_in.value − amount (bảo toàn, không burn).
//   C-TRE-2     treasury datum (committee_hash) bảo toàn.
//   C-MINT-0    tx.mint == 0.
//   C-VAL-0     mọi assets khác bảo toàn (audit dust lesson — không drop token nào).

import {
  Data, toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash, getAddressDetails,
  type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import { windowIndex, type Network } from "@magiclamp/utils";

import type { ClaimAccountDatum, TreasuryDatum } from "./types.js";
import {
  decodeClaimAccountDatum, decodeBeaconDatum,
  claimAccountDatumToCbor, redeemRedeemerToCbor,
  decodeTreasuryDatum, treasuryDatumToCbor, treasuryRedeemerToCbor,
} from "./datum.js";
import { vested, aSpan, trimCap } from "./vested.js";
import { TREASURY_NFT_ASSET_NAME, TRIM_FLOOR, LAMP_ASSET_NAME } from "./constants.js";


/** Strip leading 0x + lowercase. */
function normHex(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

export interface RedeemParams {
  lucid:        LucidEvolution;
  network:      Network;

  /** ClaimAccount UTxO của owner (inline datum bắt buộc). */
  claimAccountUtxo: UTxO;
  claimScript:      Validator;

  /** Treasury UTxO giữ LAMP pool (inline datum bắt buộc). */
  treasuryUtxo:     UTxO;
  treasuryScript:   Validator;

  /**
   * DropParam beacon UTxO — dùng làm REFERENCE input (read-only).
   * Datum phải là BeaconDatum{kind: DropParam}; cung cấp `index`, `rate_root`, `epoch`
   * (để dựng A(t)) và `trim_num`/`trim_den` (để dựng trần một lượt).
   */
  dropBeaconUtxo:   UTxO;

  /**
   * ms mỗi cửa sổ — PHẢI khớp `ms_per_epoch` đã apply vào `claim_account` (Preview/Preprod
   * canonical: xem `MS_PER_EPOCH` của runner đang dùng). Builder KHÔNG đo được giá trị đã
   * nướng trong `claimScript` (tham số đã apply nằm trong CBOR) — truyền lệch thì cửa sổ
   * suy ra lệch, và giao dịch bị từ chối. `epochWindow(msPerEpoch, windowOriginMs)` trong `constants.ts`
   * trả cặp `validFromMs`/`validToMs` dùng thẳng được.
   */
  msPerEpoch:       bigint;

  /**
   * `window_origin_ms` đã apply vào `claim_account` (Specs/Window/CONTRACT.md v1.0): cửa sổ t
   * = `(validFromMs − windowOriginMs) / msPerEpoch`. Lấy từ `windowOriginMs(network)` của
   * `@magiclamp/utils` (Preview ném lỗi). Lệch ⇒ `A(t)` tính ở cửa sổ khác validator ⇒ từ chối.
   */
  windowOriginMs:   bigint;

  /**
   * POSIX ms đầu DƯỚI của validity_range — BẮT BUỘC. Cửa sổ t mà builder dùng để tính
   * `A(t)` được SUY TỪ ĐÂY (`(validFromMs − windowOriginMs) / msPerEpoch`, chia sàn), đúng như validator:
   * `claim_account.ak` nhánh `Redeem` gọi `util.get_epoch` = `lower_bound / ms_per_epoch`.
   *
   * Vì sao không nhận `currentEpoch` rời nữa: hai giá trị rời nhau thì lệch được, và lệch
   * theo chiều nào cũng hỏng — t lớn hơn cửa sổ của `validFromMs` ⇒ builder tính `amount`
   * lớn hơn trần mà validator tính ⇒ C-RDM-VEST từ chối; t nhỏ hơn ⇒ rút ít hơn phần
   * đã vest. Bản trước còn để `validFromMs` TUỲ CHỌN: bỏ trống thì không đặt đầu dưới nào,
   * và `get_epoch` (`expect Some(s) = … |> get_finite`) chết ngay. Một nguồn, không hai.
   */
  validFromMs:      bigint;

  /**
   * POSIX ms đầu TRÊN của validity_range — BẮT BUỘC, phải > `validFromMs`.
   * Validator nhánh `Redeem` KHÔNG đọc đầu trên (`get_epoch` chỉ đọc đầu dưới — cửa sổ nhỏ
   * đi thì chính người rút thiệt). Nó bắt buộc vì hai lẽ ngoài validator: (a) khoảng
   * `[lo, hi)` với `hi ≤ lo` không chứa slot nào ⇒ sổ cái không bao giờ nhận; (b) để Lucid
   * tự đặt đầu trên thì nó có thể vượt chân trời dự báo slot của node (PastHorizon — xem
   * `WINDOW_TTL_MS` trong `constants.ts`). Không bắt buộc cùng cửa sổ với `validFromMs`.
   */
  validToMs:        bigint;

  /**
   * Policy của NFT "TREASURY" — BẮT BUỘC, không có mặc định.
   * `claim_account.ak:138-148` (C-SOLV-3/4/5) đòi `find_treasury_in` thấy ĐÚNG MỘT input mang
   * TREASURY. Chọn nhầm UTxO ở địa chỉ kho ⇒ validator từ chối ⇒ MẤT COLLATERAL. Rủi ro đó TĂNG theo
   * thời gian: `Refill` (`treasury.ak:177`) tồn tại chính vì địa chỉ kho sẽ có nhiều UTxO (A-DEST
   * hạ cánh không datum). Để tuỳ chọn thì cổng tắt theo mặc định — đúng lớp lỗi "cổng gác bất
   * đối xứng" đã trả giá ở METER_NFT_POLICY. Vậy nên BẮT BUỘC.
   */
  treasuryNftPolicy:    string;
  treasuryNftAssetName?: string;

  /** LAMP policy + asset-name. */
  lampPolicyId:   string;
  lampAssetName?: string;

  /**
   * Nơi nhận LAMP redeem. PHẢI có payment credential = khoá `owner` của tài khoản.
   *
   * `claim_account.ak` nhánh `Redeem` (C-RDM-3) ép `util.lamp_to_owner(outputs, owner, …)
   * >= amount`, và `util.is_owned_by` chỉ đếm output có payment credential
   * `VerificationKey(owner)` — stake credential tuỳ ý. Một đích khác owner thì LAMP rời
   * khỏi tập đếm, và giao dịch chỉ lọt khi tiền thối của ví tình cờ mang đủ LAMP cho owner
   * — builder không dựng tx dựa vào tình cờ đó (REDEEM-018).
   *
   * Bỏ trống ⇒ dùng địa chỉ ví đang nối vào `lucid` NẾU nó thuộc owner (giữ stake credential
   * của ví). Ví khác owner (ví vận hành rút hộ, relayer) thì NÉM REDEEM-019 thay vì đoán một
   * địa chỉ của owner: builder chỉ biết PKH, không biết stake credential owner muốn dùng, và
   * một địa chỉ enterprise tự dựng là một địa chỉ ví của owner có thể không quét tới.
   * Bản trước mặc định thẳng về ví `lucid` mà KHÔNG so với owner, trong khi chú thích nói
   * "ví owner" — ở ca rút hộ, tx dựng ra chắc chắn bị từ chối.
   */
  destinationAddress?: string;
}

export interface RedeemResult {
  tx:            TxSignBuilder;
  /** Cửa sổ t đã dùng để tính `A(t)` — suy từ `(validFromMs − windowOriginMs) / msPerEpoch`, không nhận từ caller. */
  currentEpoch:  bigint;
  /** Địa chỉ nhận LAMP thật sự được đặt vào giao dịch (đã soát thuộc owner). */
  destination:   string;
  amount:        bigint;     // released = min(vested − redeemed, trần một lượt)
  vested:        bigint;     // vested(t) đã tính
  /** Phần bị CẮT NGỌN lượt này (`vested − redeemed − amount`). 0 nghĩa là không bị cắt.
   *  Trả ra riêng vì nó KHÔNG mất — gộp nó vào `amount` là nói dối theo chiều ngược lại,
   *  còn im lặng là để người dùng đọc phép cắt thành tịch thu. */
  trimmed:       bigint;
  /** Trần một lượt đang áp (`max(trim_floor, total_redeemed · κ)`). */
  trimCap:       bigint;
  newClaimDatum: ClaimAccountDatum;
  treasuryAfter: bigint;     // LAMP còn lại trên treasury output
  summary:       string;
}

export async function buildRedeemTx(params: RedeemParams): Promise<RedeemResult> {
  const {
    lucid, network, claimAccountUtxo, claimScript,
    treasuryUtxo, treasuryScript, dropBeaconUtxo,
    msPerEpoch, windowOriginMs, validFromMs, validToMs, lampPolicyId,
  } = params;
  const lampAssetName = params.lampAssetName ?? LAMP_ASSET_NAME;
  const lampUnit = toUnit(lampPolicyId, lampAssetName);

  // ── Cửa sổ t: SUY từ đầu dưới validity, không nhận rời ──────────────
  // Mirror `util.get_epoch` (`(lower_bound − window_origin_ms) / ms_per_epoch`, chia sàn) mà
  // `claim_account.ak` nhánh `Redeem` dùng (C-RDM-EPOCH). Cùng khuôn với
  // `Allocation/offchain/src/redeemBuilder.ts` (F1+F2).
  if (msPerEpoch <= 0n) {
    throw new Error(`REDEEM-015: msPerEpoch phải > 0, nhận ${msPerEpoch}.`);
  }
  if (typeof windowOriginMs !== "bigint" || windowOriginMs < 0n) {
    throw new Error(
      `REDEEM-020: windowOriginMs phải là bigint ≥ 0, nhận ${String(windowOriginMs)}. Lấy từ ` +
      `\`windowOriginMs(network)\` của @magiclamp/utils (Specs/Window/CONTRACT.md v1.0, WIN-ORIGIN-3/4).`,
    );
  }
  if (validFromMs < 0n) {
    throw new Error(
      `REDEEM-016: validFromMs phải ≥ 0, nhận ${validFromMs}. POSIX ms âm không rơi vào cửa ` +
      `sổ nào mà validator tính được theo cùng phép chia với builder.`,
    );
  }
  if (validToMs <= validFromMs) {
    throw new Error(
      `REDEEM-017: validToMs (${validToMs}) phải > validFromMs (${validFromMs}). Khoảng ` +
      `hiệu lực rỗng không chứa slot nào — sổ cái không bao giờ nhận giao dịch này.`,
    );
  }
  if (validFromMs < windowOriginMs) {
    throw new Error(
      `REDEEM-021: validFromMs (${validFromMs}) trước windowOriginMs (${windowOriginMs}) — không rơi ` +
      `vào cửa sổ nào (WIN-ORIGIN-1).`,
    );
  }
  // Phép tính cửa sổ nằm ở Utils (`windowIndex`) — mirror get_epoch: (t − o) / m, chia sàn.
  const currentEpoch = windowIndex(validFromMs, windowOriginMs, msPerEpoch);

  // ── Decode ClaimAccount datum ──────────────────────────────────────
  if (!claimAccountUtxo.datum) throw new Error("REDEEM-001: claimAccountUtxo has no inline datum");
  const claim = decodeClaimAccountDatum(Data.from(claimAccountUtxo.datum));
  const owner = normHex(claim.owner);

  // ── Đọc D từ DropParam beacon (reference input) ────────────────────
  if (!dropBeaconUtxo.datum) throw new Error("REDEEM-004: dropBeaconUtxo has no inline datum");
  const beacon = decodeBeaconDatum(Data.from(dropBeaconUtxo.datum));
  if (beacon.kind !== "DropParam") {
    throw new Error(`REDEEM-005: beacon kind must be DropParam, got ${beacon.kind}`);
  }
  // ── Decode Treasury datum ──────────────────────────────────────────
  // v3 ĐẨY khối này LÊN TRƯỚC phép tính `amount`: trần một lượt rút đọc
  // `treasury.total_redeemed`, nên số tiền không còn tính được chỉ từ tài khoản và beacon.
  if (!treasuryUtxo.datum) throw new Error("REDEEM-011: treasuryUtxo has no inline datum");

  // Authenticity: treasury UTxO PHẢI mang đúng 1 NFT "TREASURY" (C-SOLV-3/4/5, claim_account.ak:138-148).
  // Đối xứng với CLAIM-021 ở claimBuilder — trước bản này đường redeem KHÔNG có phép kiểm nào,
  // nên mọi lỗi chọn nhầm kho chỉ lộ ra khi chuỗi từ chối, tức sau khi đã mất collateral.
  {
    const nftUnit = toUnit(
      params.treasuryNftPolicy, params.treasuryNftAssetName ?? TREASURY_NFT_ASSET_NAME,
    );
    const nftQty = treasuryUtxo.assets[nftUnit] ?? 0n;
    if (nftQty !== 1n) {
      throw new Error(
        `REDEEM-013: treasury UTxO phải giữ đúng 1 NFT authenticity (${nftUnit}); got ${nftQty}. ` +
        `Địa chỉ kho có thể có nhiều UTxO — chọn đúng cái mang TREASURY, đừng chọn theo số dư LAMP.`,
      );
    }
  }

  const treasury: TreasuryDatum = decodeTreasuryDatum(Data.from(treasuryUtxo.datum));

  // ── v3: A_span → vested → trần một lượt → amount ───────────────────
  //   A_span  = A(bây giờ) − index_at_start                         (ném khi âm)
  //   vested  = min(E, isqrt(dpe² · E · A_span²))                    C-RDM-VEST
  //   trần    = max(trim_floor, total_redeemed · trim_num / trim_den) C-RDM-TRIM
  //   amount  = min(vested − redeemed, trần)                         C-RDM-CAP
  const span = aSpan(claim, beacon, currentEpoch);
  const vestedNow = vested(claim.entitlement, claim.drops_per_epoch, span);  // C-RDM-VEST
  const uncapped = vestedNow - claim.redeemed;                       // C-RDM-1
  if (uncapped <= 0n) {
    throw new Error(
      `REDEEM-002: redeemable ≤ 0 (vested=${vestedNow}, redeemed=${claim.redeemed}). ` +
      `Chưa tới cửa sổ mở khoá thêm, hoặc đã redeem hết phần vested.`,
    );
  }
  const cap = trimCap(treasury, beacon, TRIM_FLOOR);                 // C-RDM-TRIM
  const amount = uncapped < cap ? uncapped : cap;                    // C-RDM-CAP
  // `amount < uncapped` KHÔNG phải lỗi và KHÔNG được ném: phần bị cắt còn nguyên quyền,
  // chờ lượt sau. Builder chỉ nói ra để giao diện gọi nó phân biệt được "rút được lượt này"
  // với "còn lại tất cả" — gộp hai số đó lại thì mỗi lần cắt ngọn đọc như tịch thu.
  const trimmed = uncapped - amount;

  const treasuryLamp = treasuryUtxo.assets[lampUnit] ?? 0n;
  if (treasuryLamp < amount) {
    throw new Error(
      `REDEEM-012: treasury UTxO chỉ có ${treasuryLamp} oildrop LAMP < amount ${amount}. ` +
      `Chọn treasury UTxO khác hoặc tách.`,
    );
  }

  // ── Addresses ──────────────────────────────────────────────────────
  const claimAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(claimScript)),
  );
  // Kho: MANG ĐỊA CHỈ THEO TỪ INPUT, KHÔNG dựng lại từ script hash.
  // `claim_account.ak:146` (C-SOLV-5) ép `trsy_in_addr == trsy_out_addr` — so CẢ `Address`,
  // tức KỂ CẢ stake credential. Một địa chỉ script có hai dạng cùng script hash: enterprise
  // (chỉ payment credential) và base (payment + stake). `credentialToAddress(network,
  // scriptHashToCredential(...))` LUÔN trả enterprise. Ngày kho còn ngụ ở UTxO enterprise thì
  // hai vế trùng nhau một cách NGẪU NHIÊN; đúng lượt kho được uỷ quyền stake (địa chỉ base),
  // mọi tx redeem dựng ra đều bị chuỗi từ chối — mất collateral, và không phép kiểm nào báo
  // trước vì không ca nào đọc tới địa chỉ dựng lại.
  const treasuryAddress = treasuryUtxo.address;

  // Đích nhận LAMP: payment credential PHẢI là VerificationKey(owner) — C-RDM-3,
  // `util.lamp_to_owner` + `util.is_owned_by`. Soát cả đích tường minh lẫn đích mặc định.
  const paymentKeyHashOf = (addr: string): string | undefined => {
    let cred;
    try {
      cred = getAddressDetails(addr).paymentCredential;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`REDEEM-018: không đọc được địa chỉ đích '${addr}' (${msg}).`);
    }
    return cred?.type === "Key" ? normHex(cred.hash) : undefined;
  };
  let destination: string;
  if (params.destinationAddress !== undefined) {
    destination = params.destinationAddress;
    const pkh = paymentKeyHashOf(destination);
    if (pkh !== owner) {
      throw new Error(
        `REDEEM-018: destinationAddress có payment credential ` +
        `${pkh === undefined ? "không phải khoá (script/không có)" : `khoá ${pkh}`}, khác owner ` +
        `${owner}. \`claim_account.ak\` (C-RDM-3, \`util.lamp_to_owner\`) chỉ đếm LAMP về ` +
        `output có payment credential = khoá owner — đích này làm tx bị từ chối.`,
      );
    }
  } else {
    const walletAddr = await lucid.wallet().address();
    const pkh = paymentKeyHashOf(walletAddr);
    if (pkh !== owner) {
      throw new Error(
        `REDEEM-019: không truyền destinationAddress, và ví đang nối (payment ` +
        `${pkh ?? "không phải khoá"}) KHÔNG phải owner ${owner}. Rút hộ thì truyền tường minh ` +
        `một địa chỉ của owner (payment credential = khoá owner); builder không tự dựng địa chỉ ` +
        `cho owner vì không biết stake credential owner dùng.`,
      );
    }
    destination = walletAddr;
  }

  // ── Output datums ──────────────────────────────────────────────────
  // ClaimAccount': redeemed' = redeemed + amount; field khác unchanged (C-RDM-4).
  const newClaimDatum: ClaimAccountDatum = {
    owner:           claim.owner,
    entitlement:     claim.entitlement,
    redeemed:        claim.redeemed + amount,        // C-RDM-4
    start_epoch:     claim.start_epoch,
    drops_per_epoch: claim.drops_per_epoch,
    index_at_start:  claim.index_at_start,           // C-RDM-4: mốc chỉ số BẤT BIẾN khi rút
  };
  // Treasury': committee_hash bảo toàn (C-TRE-2); sổ cái nợ GIẢM ĐÚNG `amount` cùng nhịp
  // với pool (C-SOLV-3). Redeem = TRẢ NỢ, nên cả hai vế đi cặp — nếu chỉ pool giảm mà sổ
  // cái đứng yên thì `nợ ≤ pool` siết dần tới bế tắc grant (xem đầu `treasury.ak`).
  // `treasury.ak:92-95` ép `out.outstanding_entitlement == in − released` VÀ `>= 0`. Sổ cái
  // thấp hơn amount nghĩa là nó đã lệch với các account đang mở (kho bị genesis/Refill sai,
  // hoặc chọn nhầm UTxO kho của deployment khác). Không chặn ở đây thì builder vẫn dựng ra
  // tx với sổ cái ÂM — hợp lệ về CBOR, chắc chắn bị chuỗi từ chối, MẤT COLLATERAL.
  if (treasury.outstanding_entitlement < amount) {
    throw new Error(
      `REDEEM-014: sổ cái nợ kho = ${treasury.outstanding_entitlement} oildrop < amount ` +
      `${amount}. Redeem là TRẢ NỢ nên nợ phải giảm đúng amount, mà treasury.ak ép nợ ≥ 0 ` +
      `⇒ tx này chắc chắn fail. Kho đang lệch sổ (sai UTxO kho, hay genesis/Refill sai) — ` +
      `soát lại trước khi submit.`,
    );
  }
  const newTreasuryDatum: TreasuryDatum = {
    committee_hash:         treasury.committee_hash,
    outstanding_entitlement: treasury.outstanding_entitlement - amount,
    // C-RDM-TOTAL: đây là đường DUY NHẤT `total_redeemed` được tăng, và nó phải tăng ĐÚNG
    // `amount`. Trường này là mẫu số của phép cắt ngọn ở mọi tài khoản khác, nên đứng yên
    // ở đây là giữ trần hệ thấp mãi; tăng quá là nới trần cho cả hệ bằng một lượt rút.
    total_redeemed:         treasury.total_redeemed + amount,
  };

  // ── Output assets: bảo toàn TẤT CẢ (audit dust lesson, C-VAL-0) ────
  // ClaimAccount: chỉ datum đổi → clone toàn bộ assets.
  const claimOutAssets: Record<string, bigint> = { ...claimAccountUtxo.assets };

  // Treasury: clone toàn bộ rồi trừ đúng `amount` LAMP (giữ lovelace + dust).
  const treasuryOutAssets: Record<string, bigint> = { ...treasuryUtxo.assets };
  const treasuryAfter = treasuryLamp - amount;
  if (treasuryAfter > 0n) treasuryOutAssets[lampUnit] = treasuryAfter;
  else delete treasuryOutAssets[lampUnit];          // hết LAMP → bỏ unit, giữ lovelace+dust

  // ── Redeemers ──────────────────────────────────────────────────────
  // v3: `Redeem` MANG `amount`. Validator không còn tự suy số tiền từ hiệu datum — nó ép
  // `amount` trong redeemer khớp cả ba: phần chuyển cho user, mức tăng của `redeemed`, và
  // trần. Truyền nhầm số ở đây thì giao dịch bị từ chối, không phải rút nhầm.
  const claimRedeemer    = redeemRedeemerToCbor(amount);   // Constr(1, [amount])
  const treasuryRedeemer = treasuryRedeemerToCbor();

  // ── Build tx ───────────────────────────────────────────────────────
  let txb = lucid
    .newTx()
    .collectFrom([claimAccountUtxo], claimRedeemer)
    .attach.SpendingValidator(claimScript)
    .collectFrom([treasuryUtxo], treasuryRedeemer)
    .attach.SpendingValidator(treasuryScript)
    .readFrom([dropBeaconUtxo])                       // reference input (read-only)
    .pay.ToAddressWithData(
      claimAddress,
      { kind: "inline", value: claimAccountDatumToCbor(newClaimDatum) },
      claimOutAssets,
    )
    .pay.ToAddressWithData(
      treasuryAddress,
      { kind: "inline", value: treasuryDatumToCbor(newTreasuryDatum) },
      treasuryOutAssets,
    )
    .pay.ToAddress(destination, { [lampUnit]: amount })   // C-RDM-3: user nhận đúng amount
    .addSignerKey(owner);                            // C-RDM-6: owner signs

  // validity_range: đầu dưới LUÔN đặt (C-RDM-EPOCH — `get_epoch` đòi Finite), và chính nó là
  // nguồn của `currentEpoch` ở trên; đầu trên luôn đặt (REDEEM-017).
  txb = txb.validFrom(Number(validFromMs)).validTo(Number(validToMs));

  const tx = await txb.complete();

  const summary = [
    `═══ Redeem (Capped Drop v3) ═══`,
    `Owner:          ${owner}`,
    `Entitlement E:  ${claim.entitlement} oildrop`,
    `Redeemed before:${claim.redeemed} oildrop`,
    `Beacon:         index=${beacon.index} rate_root=${beacon.rate_root} epoch=${beacon.epoch}`,
    `A(t):           ${beacon.index + beacon.rate_root * (currentEpoch - beacon.epoch)}` +
      `  −  a₀=${claim.index_at_start}  ⟹  A_span=${span}`,
    `Cửa sổ:         t=${currentEpoch} = (${validFromMs} − ${windowOriginMs}) / ${msPerEpoch} ` +
      `(start_epoch=${claim.start_epoch}, KHÔNG vào phép tính)`,
    `Vested(t):      ${vestedNow} oildrop`,
    `Trần một lượt:  ${cap} oildrop (κ=${beacon.trim_num}/${beacon.trim_den}, ` +
      `total_redeemed=${treasury.total_redeemed}, sàn=${TRIM_FLOOR})`,
    `Amount:         ${amount / 1_000_000n} LAMP (${amount} oildrop)`,
    trimmed > 0n
      ? `Bị cắt lượt này:${trimmed} oildrop — CÒN NGUYÊN QUYỀN, rút được ở lượt sau`
      : `Bị cắt lượt này:0 (trần không chạm)`,
    `Treasury LAMP:  ${treasuryLamp} → ${treasuryAfter} oildrop`,
    `total_redeemed: ${treasury.total_redeemed} → ${newTreasuryDatum.total_redeemed}`,
    `Destination:    ${destination}`,
  ].join("\n");

  return {
    tx, currentEpoch, destination, amount, vested: vestedNow, trimmed, trimCap: cap,
    newClaimDatum, treasuryAfter, summary,
  };
}
