// topUpPoolBuilder — Faucet v3 TopUpPool: nạp thêm tLAMP vào pool ĐÃ deploy (ops).
//
// MỚI ở v3 (`PoolRedeemer::TopUpPool`, index 3) — v1/v2 không có redeemer này, nạp pool phải
// đi qua đường deploy (mint + seed) lại từ đầu. Tách khỏi `Reclaim`: hai ý định khác nhau —
// `Reclaim` là ĐÓNG (permissionless, thu hồi account chết) còn `TopUpPool` là MỞ (ai cũng nạp
// được, không cần account nào). Cấm account input (không mượn đường thu hồi); đòi nạp THẬT
// (C-TUP-1: delta ≥ 1 drip, không phải spend rỗng).
//
// Validity range: nhánh `TopUpPool` KHÔNG gọi hàm epoch nào on-chain (không đụng
// `window_epoch`/`claims_in_window` ngoài việc BẢO TOÀN chúng) — builder KHÔNG cần đặt
// `validFrom`/`validTo`.

import {
  toUnit, type LucidEvolution, type UTxO, type Validator, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import type { Network } from "@magiclamp/utils";

import { TLAMP_ASSET_NAME } from "./constants.js";
import { decodePoolDatum, poolDatumToCbor, poolTopUpPoolRedeemerToCbor } from "./datum.js";
import type { PoolDatum } from "./types.js";
import { Data } from "@lucid-evolution/lucid";

export interface TopUpPoolParams {
  lucid: LucidEvolution;
  network: Network;

  /** POOL UTxO (PoolDatum, POOL NFT). */
  poolUtxo: UTxO;
  faucetPoolScript: Validator;

  tlampPolicyId: string;
  tlampAssetName?: string;

  /** Lượng tLAMP (oildrop) nạp thêm. Phải ≥ cfg.drip_oildrop (C-TUP-1: nạp THẬT). */
  depositOildrop: bigint;
}

export interface TopUpPoolResult {
  tx: TxSignBuilder;
  poolAfter: bigint;
  summary: string;
}

export async function buildTopUpPoolTx(params: TopUpPoolParams): Promise<TopUpPoolResult> {
  const { lucid, poolUtxo, faucetPoolScript, tlampPolicyId, depositOildrop } = params;

  const assetName = params.tlampAssetName ?? TLAMP_ASSET_NAME;
  const tlampUnit = toUnit(tlampPolicyId, assetName);

  if (!poolUtxo.datum) throw new Error("TOPUP-POOL-000: poolUtxo has no inline datum");
  const pd: PoolDatum = decodePoolDatum(Data.from(poolUtxo.datum));

  if (depositOildrop < pd.cfg.drip_oildrop) {
    throw new Error(
      `TOPUP-POOL-001: nạp ${depositOildrop} oildrop < drip_oildrop ${pd.cfg.drip_oildrop} — ` +
      `C-TUP-1 đòi nạp THẬT (≥ 1 drip), không phải spend rỗng.`,
    );
  }

  const poolLamp = poolUtxo.assets[tlampUnit] ?? 0n;
  const poolAfter = poolLamp + depositOildrop;
  const poolOutAssets: Record<string, bigint> = { ...poolUtxo.assets, [tlampUnit]: poolAfter };
  // C-TUP-2/3: bộ đếm tốc độ BẢO TOÀN — nạp tiền không được đụng window_epoch/claims_in_window.
  // C-ROOT-KEEP-1: sổ `opened_root` cũng giữ nguyên. Cả datum đi nguyên khối (`pd` đã giải mã
  // đủ 4 trường) — không dựng lại từng trường để không có chỗ quên trường thứ tư.
  const poolDatumOut: PoolDatum = pd;

  const tx = await lucid
    .newTx()
    .collectFrom([poolUtxo], poolTopUpPoolRedeemerToCbor())
    .attach.SpendingValidator(faucetPoolScript)
    .pay.ToAddressWithData(
      poolUtxo.address,
      { kind: "inline", value: poolDatumToCbor(poolDatumOut) },
      poolOutAssets,
    )
    .complete();

  const summary = [
    `═══ Faucet v3 TopUpPool (nạp thêm vào pool) ═══`,
    `Nạp:          ${depositOildrop / 1_000_000n} tLAMP (${depositOildrop} oildrop)`,
    `Pool tLAMP:   ${poolLamp} → ${poolAfter} oildrop`,
  ].join("\n");

  return { tx, poolAfter, summary };
}
