// fund_pot.ts — rót trọn phân bổ của MỘT pot từ kho Treasury canonical vào kho script của pot đó,
// qua nhánh `FundPot` của `Distribution/onchain/validators/treasury.ak` (`Distribution/FundPot.md` v1.0).
//
// Khác `30_feeder_accounts.ts` STEP=fundpot (rót từ địa chỉ feeder, không qua kho): ở đây LAMP rời
// THẲNG carrier của kho, do committee ký, sổ nợ không đổi. Builder: `Distribution/offchain/src/
// fundPotBuilder.ts`. Cổng hình dạng pot dùng chung với 29/30: `_potShape.ts`.
//
// Mọi lời khai bắt buộc, KHÔNG mặc định (trừ POT_LOVELACE):
//   POT_ID            mã pot trong sổ `pots.ts` — AMOUNT_OILDROP phải BẰNG ngân sách pot đó (FPB-001)
//   POT_ADDRESS       địa chỉ kho pot (Script)
//   POT_SCRIPT_HASH   hash script pot — khai lần hai để đối chiếu với địa chỉ
//   POT_DATUM_CBOR    datum inline của mọi output pot (Wakeme: 4100)
//   AMOUNT_OILDROP    tổng rót
//   POT_SHARE_OILDROP D — một suất; mọi output pot ≥ D và là BỘI của D
//   POT_OUTPUTS       K — số output pot
//   POT_LOVELACE      lovelace mỗi output pot (mặc định 2000000)
// SUBMIT=false (mặc định): dựng, đọc lại giao dịch đã dựng, KHÔNG ký, KHÔNG in CBOR.
//
// Chạy:
//   NETWORK=Preprod POT_ID=wakeme POT_ADDRESS=addr_test1w… POT_SCRIPT_HASH=… POT_DATUM_CBOR=4100 \
//     AMOUNT_OILDROP=1001000000000000 POT_SHARE_OILDROP=1001000000 POT_OUTPUTS=40 tsx fund_pot.ts
import { coreToTxOutput, validatorToScriptHash } from "@lucid-evolution/lucid";
import { NETWORK, SUBMIT, makeLucid, walletPkh, explorerTx } from "./config.js";
import { rehydrate, canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, TREASURY_NAME } from "./_canonical_v2.js";
import { requireField, positiveBig, potTargetFromEnv } from "./_potShape.js";
import {
  buildFundPotTx, splitPotOutputs, fundPotOutputFailures, type FundPotOutputShape,
} from "../../Distribution/offchain/src/fundPotBuilder.js";
import { potById } from "../../Distribution/offchain/src/pots.js";

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  // ── Lời khai: soát hết TRƯỚC khi đụng mạng ─────────────────────────────
  const pot = potTargetFromEnv(process.env, 0);
  const potId = potById(requireField("POT_ID", process.env.POT_ID)).id;
  const amount = positiveBig("AMOUNT_OILDROP", requireField("AMOUNT_OILDROP", process.env.AMOUNT_OILDROP));
  const share = positiveBig("POT_SHARE_OILDROP", requireField("POT_SHARE_OILDROP", process.env.POT_SHARE_OILDROP));
  const kRaw = requireField("POT_OUTPUTS", process.env.POT_OUTPUTS);
  const k = Number(positiveBig("POT_OUTPUTS", kRaw));
  if (!Number.isSafeInteger(k)) throw new Error(`POT-FUND-004: POT_OUTPUTS='${kRaw}' quá lớn.`);
  const potLovelace = positiveBig("POT_LOVELACE", process.env.POT_LOVELACE ?? "2000000");
  const outputAmounts = splitPotOutputs(amount, share, k);   // ném nếu amount không phải bội của D

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);

  // Script kho dựng từ mã HIỆN TẠI phải trùng hash kho đã triển khai — lệch nghĩa là bản
  // `treasury.ak` đang có trên đĩa không phải bản đang giữ kho (vd chưa có nhánh FundPot).
  const treHash = validatorToScriptHash(scripts.treasury);
  if (treHash !== wiring.treHash) {
    throw new Error(
      `FUNDPOT-001: script kho từ mã hiện tại có hash ${treHash}, state ghi ${wiring.treHash}. ` +
      `Kho đang chạy không phải bản có nhánh FundPot — cần genesis mới, không gửi.`,
    );
  }

  // ── Carrier: đúng MỘT UTxO ở địa chỉ kho mang TREASURY thật ─────────────
  const carriers = (await lucid.utxosAt(wiring.treAddr)).filter((u) => (u.assets[wiring.khoUnit] ?? 0n) === 1n);
  if (carriers.length !== 1) {
    throw new Error(`FUNDPOT-002: địa chỉ kho có ${carriers.length} UTxO mang '${wiring.khoUnit}', cần đúng 1.`);
  }
  const carrier = carriers[0]!;

  const result = await buildFundPotTx({
    lucid, treasuryUtxo: carrier, treasuryScript: scripts.treasury,
    committeeSigners: canonicalCommittee(wiring.pkh),
    committeeThreshold: Number(CANONICAL_COMMITTEE_THRESHOLD),
    // Tên tài sản lấy từ `lampUnit` (policy 56 hex + tên) — cùng đơn vị mà phép đọc lại dùng.
    lampPolicyId: wiring.lampPid, lampAssetName: wiring.lampUnit.slice(56),
    treasuryNftPolicy: wiring.markers.khoPid, treasuryNftAssetName: TREASURY_NAME,
    claimAccountHash: wiring.claimHash,
    potId, pot, amountOildrop: amount, potShareOildrop: share, outputAmounts, potLovelace,
  });
  console.log(`\n${result.summary}`);
  console.log(`Pot (sổ):       ${potId} · K = ${k} · ${outputAmounts.length} output, mỗi output bội của D`);

  // ── FPB-010: đọc lại giao dịch ĐÃ DỰNG, không tin value đã khai ─────────
  const outs = result.tx.toTransaction().body().outputs();
  const built: FundPotOutputShape[] = [];
  for (let i = 0; i < outs.len(); i++) built.push(coreToTxOutput(outs.get(i)));
  const fails = fundPotOutputFailures(built, {
    treasuryAddress: carrier.address, treasuryHash: treHash, claimAccountHash: wiring.claimHash,
    lampUnit: wiring.lampUnit, carrierAssets: result.carrierAssets, carrierDatumCbor: carrier.datum!,
    carrierLovelaceIn: carrier.assets["lovelace"] ?? 0n, pot, potShareOildrop: share, outputAmounts,
  });
  if (fails.length > 0) throw new Error(`FPB-010: giao dịch đã dựng lệch FundPot — ${fails.join("; ")}`);
  console.log(`✓ Đọc lại giao dịch đã dựng: carrier y nguyên trừ ${amount} LAMP, ${k} output pot đúng hình dạng.`);

  if (!SUBMIT) {
    // Không ký, không in CBOR: committee canonical 1-of-1 nên CBOR đã ký nộp được bởi bất kỳ ai đọc log.
    console.log(`\n(SUBMIT=false ⇒ KHÔNG ký, KHÔNG gửi.) Hash thân giao dịch: ${result.tx.toHash()}`);
    return;
  }

  const signed = await result.tx.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`\n📤 FundPot: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  const made = (await lucid.utxosAt(pot.address)).filter((u) => u.txHash === hash);
  if (made.length === 0) {
    process.exitCode = 2;
    console.log(`\n⚠ CHƯA ĐO ĐƯỢC (không phải "hỏng"): chỉ mục chưa thấy output pot của ${hash}. Đo lại sau.`);
    return;
  }
  const total = made.reduce((s, u) => s + (u.assets[wiring.lampUnit] ?? 0n), 0n);
  if (made.length !== k || total !== amount) {
    process.exitCode = 1;
    console.error(`\n❌ Trên chuỗi: ${made.length} output pot, ${total} oildrop — dựng ra ${k} output, ${amount}.`);
    return;
  }
  console.log(`\n✅ Trên chuỗi: ${k} output pot, tổng ${amount} oildrop.`);
}

main().catch((e) => { console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
