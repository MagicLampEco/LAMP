// mintBuilder — Faucet v3 deploy: mint tLAMP total supply (tlamp_policy, KHÔNG đổi ở bản vá
// này) + mint POOL NFT one-shot (faucet_nft MintPool) + seed pool UTxO, TẤT CẢ trong MỘT tx.
//
// LỊCH SỬ: tệp này trước đây gọi `buildMintPoolTx` (v1) — mint tLAMP rồi gửi THẲNG vào một
// UTxO ở validator `faucet.ak` (đã XOÁ) với `FaucetDatum{claim_amount}` trần, KHÔNG NFT. v3
// đổi hẳn: pool nay là một UTxO ĐỊNH DANH bằng POOL NFT (`faucet_nft` policy, redeemer
// `MintPool`), datum là `PoolDatum{cfg, window_epoch, claims_in_window, opened_root}` — mọi ràng
// buộc khởi tạo (C-MP-1..8; C-MP-8 = sổ `opened_root` RỖNG) bị ép NGAY LÚC ĐÚC vì sau tx này `faucet_pool` C-CFG-1 đóng băng `cfg` vĩnh
// viễn và POOL NFT one-shot nên không đúc lại datum được.
//
// MỘT genesis UTxO DÙNG CHUNG cho CẢ HAI policy (`tlamp_policy` lẫn `faucet_nft`) — một UTxO
// chỉ spend được MỘT LẦN nên tự nó khoá one-shot cho cả hai, miễn là cả hai policy đã được
// apply-param với ĐÚNG cùng một `OutputReference`. Nếu wallet đã có sẵn tLAMP từ một lượt mint
// riêng (không qua builder này) thì đừng gọi builder này để mint lại — dùng `topUpPoolBuilder.ts`
// (`TopUpPool`) để nạp thêm vào một pool ĐÃ deploy.
//
// Validity range: `MintPool` dùng `util.get_epoch_pinned` (C-MP-6: `window_epoch` khởi tạo
// PHẢI đúng bucket thật) — BẮT BUỘC qua `pinnedEpochWindow`.

import {
  toUnit,
  credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  type LucidEvolution, type UTxO, type MintingPolicy, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import {
  TLAMP_ASSET_NAME, TOTAL_SUPPLY_OILDROP, DRIP_OILDROP, COOLDOWN, MAX_CLAIMS_CEILING,
  POOL_NFT_NAME, assertMsPerEpochMatchesNetwork,
} from "./constants.js";
import { poolDatumToCbor, mintGenesisRedeemerToCbor, mintPoolRedeemerToCbor } from "./datum.js";
import { pinnedEpochWindow } from "./epochWindow.js";
import { OPENED_ROOT_EMPTY } from "./openedLedger.js";
import type { FaucetConfig, PoolDatum } from "./types.js";

export interface MintPoolParams {
  lucid: LucidEvolution;
  network: Network;

  /** Applied tLAMP minting policy (đã apply genesis_ref + total_supply). Validator
   *  `tlamp_policy` — KHÔNG đổi ở bản vá Faucet v3, chỉ dùng lại ở đây. */
  tlampPolicy: MintingPolicy;
  tlampPolicyId: string;
  tlampAssetName?: string;

  /** Applied faucet_nft minting policy (đã apply genesis_ref + ms_per_epoch). */
  faucetNftPolicy: MintingPolicy;
  faucetNftPolicyId: string;
  /** Applied faucet_pool spend validator (địa chỉ nhận pool). */
  faucetPoolScript: Validator;

  /** UTxO genesis BẮT BUỘC consume — DÙNG CHUNG cho CẢ HAI policy (xem đầu tệp). */
  genesisUtxo: UTxO;

  /** Tổng cung tLAMP mint (oildrop). Mặc định TOTAL_SUPPLY_OILDROP = 36 tỷ LAMP. */
  totalSupplyOildrop?: bigint;
  /** tLAMP nạp ban đầu vào pool (oildrop). Mặc định = TOÀN BỘ supply vừa mint. Phần dư
   *  (nếu có) tự động về ví qua coin selection của lucid. */
  poolInitialTlampOildrop?: bigint;
  /** ADA (lovelace) kèm pool UTxO (min-ADA). Mặc định 5 tADA. */
  poolLovelace?: bigint;

  /** Cấu hình pool — ĐÓNG BĂNG VĨNH VIỄN sau tx này (C-CFG-1). */
  dripOildrop?: bigint;          // mặc định DRIP_OILDROP (1001 tLAMP)
  cooldownEpochs?: bigint;       // mặc định COOLDOWN (36 cửa sổ)
  /** BẮT BUỘC: trần claim mỗi cửa sổ. Phải trong (0, MAX_CLAIMS_CEILING] (C-MP-7). */
  maxClaimsPerWindow: bigint;

  /** Mốc "bây giờ" (ms Unix) — dùng để tính `window_epoch` khởi tạo pinned (C-MP-6). */
  nowMs: number;
  msPerEpoch: bigint;
  /**
   * `window_origin_ms` đã apply vào faucet_nft/faucet_pool/faucet_account (tham số CUỐI,
   * Specs/Window/CONTRACT.md v1.0): cửa sổ = `(nowMs − windowOriginMs) / msPerEpoch`. Lấy từ
   * `windowOriginMs(network)` của `@magiclamp/utils` (Preview ném lỗi, không có giá trị). Truyền
   * lệch thì nhãn cửa sổ trong datum lệch với cái validator suy ra và giao dịch bị từ chối.
   */
  windowOriginMs: bigint;
}

export interface MintPoolResult {
  tx: TxSignBuilder;
  poolAddress: string;
  tlampUnit: string;
  poolNftUnit: string;
  totalSupply: bigint;
  poolInitial: bigint;
  poolDatum: PoolDatum;
  epoch: bigint;
  summary: string;
}

export async function buildMintPoolTx(params: MintPoolParams): Promise<MintPoolResult> {
  const {
    lucid, network, tlampPolicy, tlampPolicyId, faucetNftPolicy, faucetNftPolicyId,
    faucetPoolScript, genesisUtxo, msPerEpoch, windowOriginMs,
  } = params;

  assertMsPerEpochMatchesNetwork(msPerEpoch, network);

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);
  const poolNftUnit = toUnit(faucetNftPolicyId, POOL_NFT_NAME);

  const totalSupply = params.totalSupplyOildrop ?? TOTAL_SUPPLY_OILDROP;
  const poolInitial = params.poolInitialTlampOildrop ?? totalSupply;
  const poolLovelace = params.poolLovelace ?? 5_000_000n;

  const drip = params.dripOildrop ?? DRIP_OILDROP;
  const cooldown = params.cooldownEpochs ?? COOLDOWN;
  const maxClaims = params.maxClaimsPerWindow;

  if (totalSupply <= 0n) throw new Error("MINT-POOL-001: totalSupplyOildrop phải > 0");
  if (poolInitial <= 0n) throw new Error("MINT-POOL-002: poolInitialTlampOildrop phải > 0");
  if (poolInitial > totalSupply) throw new Error("MINT-POOL-003: poolInitialTlampOildrop > totalSupplyOildrop");
  if (drip <= 0n) throw new Error("MINT-POOL-004: dripOildrop phải > 0 (C-CFG-2)");
  if (cooldown < 0n) throw new Error("MINT-POOL-005: cooldownEpochs phải >= 0 (C-CFG-3)");
  if (maxClaims <= 0n || maxClaims > MAX_CLAIMS_CEILING) {
    throw new Error(
      `MINT-POOL-006: maxClaimsPerWindow phải trong (0, ${MAX_CLAIMS_CEILING}] — trần compile-time ` +
      `C-MP-7, nhận ${maxClaims}.`,
    );
  }

  // C-MP-6: window_epoch khởi tạo PHẢI đúng bucket thật (pinned) — window_epoch=0 (giá trị
  // mặc định tự nhiên khi viết builder ẩu) sẽ cho sẵn hàng nghìn bậc thang quota ngay sau deploy.
  const { loMs, hiMs, epoch } = pinnedEpochWindow(params.nowMs, Number(msPerEpoch), Number(windowOriginMs));

  const poolAddress = credentialToAddress(
    network, scriptHashToCredential(validatorToScriptHash(faucetPoolScript)),
  );

  const cfg: FaucetConfig = { drip_oildrop: drip, cooldown_epochs: cooldown, max_claims_per_window: maxClaims };
  // C-MP-8: sổ `opened_root` khởi tạo RỖNG — chưa DID nào có account.
  const poolDatum: PoolDatum = { cfg, window_epoch: epoch, claims_in_window: 0n, opened_root: OPENED_ROOT_EMPTY };

  const poolAssets: Record<string, bigint> = {
    lovelace: poolLovelace,
    [poolNftUnit]: 1n,
    [tlampUnit]: poolInitial,
  };

  const tx = await lucid
    .newTx()
    .collectFrom([genesisUtxo])                                              // one-shot cả hai policy
    .mintAssets({ [tlampUnit]: totalSupply }, mintGenesisRedeemerToCbor())    // C-MINT-1 (tlamp_policy)
    .attach.MintingPolicy(tlampPolicy)
    .mintAssets({ [poolNftUnit]: 1n }, mintPoolRedeemerToCbor())              // C-MP-1..7 (faucet_nft)
    .attach.MintingPolicy(faucetNftPolicy)
    .pay.ToAddressWithData(
      poolAddress,
      { kind: "inline", value: poolDatumToCbor(poolDatum) },
      poolAssets,
    )
    .validFrom(loMs)
    .validTo(hiMs)
    .complete();

  const summary = [
    `═══ Faucet v3 Deploy (mint tLAMP + MintPool) ═══`,
    `Policy id tLAMP: ${tlampPolicyId}`,
    `Total supply:    ${totalSupply} oildrop = ${totalSupply / 1_000_000n} LAMP`,
    `Pool address:    ${poolAddress}`,
    `Pool initial:    ${poolInitial} oildrop = ${poolInitial / 1_000_000n} LAMP`,
    `cfg:             drip=${drip / 1_000_000n} tLAMP, cooldown=${cooldown}, maxClaims=${maxClaims}`,
    `window_epoch:    ${epoch}`,
    `Genesis ref:     ${genesisUtxo.txHash}#${genesisUtxo.outputIndex} (consumed → locked)`,
  ].join("\n");

  return {
    tx, poolAddress, tlampUnit, poolNftUnit, totalSupply, poolInitial, poolDatum, epoch, summary,
  };
}
