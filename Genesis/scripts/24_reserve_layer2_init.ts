// 24_reserve_layer2_init.ts — LỚP 2 bước dựng: đưa meter NFT xuống dưới `reserve_draw`.
//
// TRƯỚC BƯỚC NÀY, nhánh Reserve của policy canonical MỞ nhưng KHÔNG CÓ PHANH: meter NFT nằm
// ở ví, nên tiêu nó không kích validator nào. Ai giữ khoá ví rút trọn 9,63 tỷ LAMP trong một
// giao dịch (`22_reserve_draw.ts` phần đầu nói rõ điều này).
//
// SAU BƯỚC NÀY, tiêu meter = chạy `reserve_draw.ak`, và bốn ràng buộc bật lên cùng lúc:
//   ≤1 lượt/epoch · δ ≤ tổng/1000 · δ ≤ pot còn lại · phải kích cổng sàn của Treasury.
//
// BA GIAO DỊCH, VÀ VÌ SAO KHÔNG GỘP ĐƯỢC
//   L2a  đúc custody NFT → két. PHẢI đi RIÊNG: `custody_seed.ak` luật S-MINT-2 ép
//        `list.length(assets.policies(tx.mint)) == 1` — giao dịch đúc custody không được mang
//        thêm policy mint nào khác.
//   L2b  đúc auth NFT → `reserve_gate`. Hạt giống của nó chọn SAU L2a, vì coin-selection của
//        L2a có quyền tiêu bất kỳ UTxO ví nào, kể cả cái định dành làm hạt giống auth.
//   L2c  dời meter NFT từ ví → `reserve_draw` kèm `ReserveState`. Không đúc gì.
//
//   L2b và L2c gộp được (auth mint không cấm policy khác), nhưng để RIÊNG thì mỗi giao dịch
//   hỏng nói đúng một chuyện — và bước này chỉ chạy một lần trong đời một policy.
//
// CHẠY LẠI ĐƯỢC: mỗi bước tự kiểm marker của nó đã trên chuỗi chưa rồi mới gửi. Ngắt giữa
// chừng thì chạy lại tiếp đúng chỗ dừng, không đúc trùng.
//
// Chạy: NETWORK=Preprod tsx 24_reserve_layer2_init.ts
import { type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, makeLucid, walletPkh, explorerTx } from "./config.js";
import { rehydrate, writeState, waitFor, MET_NAME } from "./_canonical_v2.js";
import { supplyStateFromCbor } from "../offchain/src/datum.js";
import {
  AUTH_NAME, INSTANCE_ID, deriveCustody, deriveReserveWiring, custodySeedDatum,
  reserveStateDatum, epochNow, printReserveWiring, VOID_DATUM, RESERVE_TOTAL,
} from "./_reserve_layer2.js";
import { custodyDatumToCbor } from "../../Treasury/offchain/src/datum.js";
import { mintAuthRedeemerToCbor } from "../../Treasury/offchain/src/reserveAuthBuilder.js";
import { Constr, Data } from "@lucid-evolution/lucid";

/**
 * min-ADA đặt lên UTxO custody. Con số này KHÔNG tuỳ ý: `custody_seed.ak` luật S-SEED-0 là một
 * đẳng thức chính xác `value == value_of(ledger) + lovelace(reserved_min_ada) + NFT(1)`, nên
 * lovelace trên output phải ĐÚNG BẰNG `reserved_min_ada` truyền trong redeemer. Lệch một
 * lovelace là giao dịch bị từ chối.
 */
const RESERVED_MIN_ADA = 2_000_000n;
const NFT_ADA = 2_000_000n;

/** Chọn một UTxO ví ≥ `min` lovelace KHÔNG mang NFT nào cần giữ. */
function pickSeed(utxos: UTxO[], avoid: Set<string>, min = 5_000_000n): UTxO {
  const key = (u: UTxO) => `${u.txHash}#${u.outputIndex}`;
  const ok = utxos
    .filter((u) => !avoid.has(key(u)) && (u.assets.lovelace ?? 0n) >= min)
    .sort((a, b) => Number((b.assets.lovelace ?? 0n) - (a.assets.lovelace ?? 0n)));
  if (!ok.length) {
    throw new Error(
      `không còn UTxO ví nào ≥ ${min} lovelace để làm hạt giống one-shot ` +
      `(đã loại ${avoid.size} cái đang giữ NFT). Tách bớt UTxO rồi chạy lại.`,
    );
  }
  return ok[0]!;
}

/**
 * Script hash của validator governance, đọc từ `GOVERNANCE_SCRIPT_HASH`. KHÔNG có mặc định.
 *
 * Trường này đi vào datum lượt sinh và BẤT BIẾN từ đó (`custody.ak:79,133`); nhánh `Release`
 * của két gác bằng đúng nó (`release.ak:52-53`). Bản trước điền `""` — khi đó `Release` không
 * bao giờ thoả và két thành hố một chiều. Không có giá trị thì DỪNG: một két seed sai còn tệ
 * hơn một két chưa seed, vì lượt seed không làm lại được (one-shot NFT).
 */
function governanceRef(): string {
  const v = (process.env.GOVERNANCE_SCRIPT_HASH ?? "").trim();
  if (!v) {
    throw new Error(
      `GOV-REF-001: chưa đặt GOVERNANCE_SCRIPT_HASH. Đây là script hash 28 byte của validator ` +
      `governance sẽ ký duyệt các lượt chi từ két. Nó BẤT BIẾN sau lượt sinh custody và là cổng ` +
      `cứng duy nhất của nhánh Release — đặt sai hoặc bỏ trống là két chỉ nhận, không bao giờ chi, ` +
      `và LAMP trong đó không đốt được (Treasury/CONTRACT.md §5). Lượt sinh dùng NFT one-shot nên ` +
      `KHÔNG làm lại được. Đặt GOVERNANCE_SCRIPT_HASH=<56 ký tự hex> rồi chạy lại.`,
    );
  }
  return v;
}

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  const { state, wiring } = await rehydrate();
  if (pkh !== wiring.pkh) {
    throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  }

  console.log(`=== Lớp 2 — đặt phanh lên nhánh Reserve (${NETWORK}) ===`);
  console.log(`lamp_policy: ${wiring.lampPid}`);
  console.log(`meter (MET): ${wiring.markers.metPid}\n`);

  const key = (u: UTxO) => `${u.txHash}#${u.outputIndex}`;
  const metHeld = (us: UTxO[]) => us.filter((u) => (u.assets[wiring.metUnit] ?? 0n) === 1n);

  // ══ L2a — custody NFT (giao dịch RIÊNG vì S-MINT-2) ═══════════════════════
  let custodyRef = state.reserve?.custodyRef;
  let cust = custodyRef
    ? await deriveCustody(custodyRef.txHash, custodyRef.outputIndex, wiring.network)
    : undefined;

  const custodyLive = async () =>
    cust
      ? (await lucid.utxosAt(cust.custodyAddr))
          .filter((u) => (u.assets[cust!.custodyNftUnit] ?? 0n) === 1n)
      : [];

  if (cust && (await custodyLive()).length === 1) {
    console.log(`↷ L2a bỏ qua — custody NFT đã ở ${cust.custodyAddr}`);
  } else {
    const utxos = await lucid.wallet().getUtxos();
    // Không lấy UTxO đang giữ MET làm hạt giống: tiêu nó ở đây thì MET đi theo coin-selection
    // về một output không kiểm soát, và bước L2c mất thứ nó phải dời.
    const avoid = new Set(metHeld(utxos).map(key));
    const seed = pickSeed(utxos, avoid);
    custodyRef = { txHash: seed.txHash, outputIndex: seed.outputIndex };
    cust = await deriveCustody(seed.txHash, seed.outputIndex, wiring.network);

    console.log(`L2a hạt giống custody: ${key(seed)}`);
    console.log(`    custody policy: ${cust.custodySeedPid}`);
    console.log(`    custody addr:   ${cust.custodyAddr}`);

    const tx = await lucid.newTx()
      .collectFrom([seed])
      .mintAssets({ [cust.custodyNftUnit]: 1n }, Data.to(new Constr(0, [RESERVED_MIN_ADA])))
      .attach.MintingPolicy(cust.custodySeed)
      // Sổ RỖNG + lovelace ĐÚNG BẰNG `reserved_min_ada` — xem `custodySeedDatum()`.
      .pay.ToContract(cust.custodyAddr,
        { kind: "inline",
          value: custodyDatumToCbor(
            custodySeedDatum(wiring.lampPid, wiring.tokenName, governanceRef()),
          ) },
        { lovelace: RESERVED_MIN_ADA, [cust.custodyNftUnit]: 1n })
      .addSigner(walletAddr)
      .complete();
    const h = await (await tx.sign.withWallet().complete()).submit();
    console.log(`📤 L2a custody seed: ${h}\n   ${explorerTx(h)}`);
    await lucid.awaitTx(h);
    await waitFor("custody NFT tại két", custodyLive, (us) => us.length === 1);
    console.log(`✓ custody NFT ở két, parked = 0 LAMP (dưới sàn ⇒ cổng cầu MỞ)\n`);

    state.reserve = { ...(state.reserve ?? { authRef: { txHash: "", outputIndex: -1 } }), custodyRef };
    state.tx.custodySeed = h;
    await writeState(state);
  }

  // ══ L2b — auth NFT → reserve_gate ═════════════════════════════════════════
  // Hạt giống auth chọn Ở ĐÂY, sau khi L2a đã lên chuỗi.
  let authRef = state.reserve?.authRef;
  const authRefValid = authRef && authRef.outputIndex >= 0;

  let rw = authRefValid
    ? await deriveReserveWiring(wiring, {
        custodyTxHash: custodyRef!.txHash, custodyIndex: custodyRef!.outputIndex,
        authTxHash: authRef!.txHash, authIndex: authRef!.outputIndex,
        network: wiring.network,
      })
    : undefined;

  const authLive = async () =>
    rw ? (await lucid.utxosAt(rw.reserve.gateAddr))
          .filter((u) => (u.assets[rw!.reserve.authUnit] ?? 0n) === 1n)
       : [];

  if (rw && (await authLive()).length === 1) {
    console.log(`↷ L2b bỏ qua — auth NFT đã ở gate ${rw.reserve.gateAddr}`);
  } else {
    // Chờ chỉ mục ví BỎ HẲN hạt giống custody trước khi chọn hạt giống auth.
    //
    // Vì sao không bỏ qua được: `awaitTx` bảo giao dịch đã vào khối, nhưng chỉ mục UTxO của
    // nhà cung cấp còn chậm hơn một nhịp, nên `getUtxos()` ngay sau đó vẫn TRẢ VỀ cái vừa
    // tiêu. Lượt chạy đầu trên Preprod (2026-09-03) rơi đúng vậy: hạt giống auth được chọn
    // trùng hạt giống custody, và cổng SEED-001 bắt được. Cổng đó đúng, nhưng để nó phải
    // bắt là bắt người chạy làm lại tay — nên chờ ở đây, và VẪN loại tường minh bên dưới.
    const spent = `${custodyRef!.txHash}#${custodyRef!.outputIndex}`;
    const utxos = await waitFor(
      `ví không còn hạt giống custody ${spent}`,
      () => lucid.wallet().getUtxos(),
      (us) => !us.some((u) => key(u) === spent),
    );
    const avoid = new Set([...metHeld(utxos).map(key), spent]);
    const seed = pickSeed(utxos, avoid);
    authRef = { txHash: seed.txHash, outputIndex: seed.outputIndex };
    rw = await deriveReserveWiring(wiring, {
      custodyTxHash: custodyRef!.txHash, custodyIndex: custodyRef!.outputIndex,
      authTxHash: seed.txHash, authIndex: seed.outputIndex,
      network: wiring.network,
    });

    console.log(`\nL2b hạt giống auth: ${key(seed)}`);
    printReserveWiring(rw.reserve);

    const tx = await lucid.newTx()
      .collectFrom([seed])
      .mintAssets({ [rw.reserve.authUnit]: 1n }, mintAuthRedeemerToCbor())
      .attach.MintingPolicy(rw.scripts.auth)
      // Datum Void: `reserve_gate.spend` đọc `Option<Void>`, và auth NFT phải TIÊU ĐƯỢC lại ở
      // mọi lượt rút sau. Output không datum thì gate không spend được, và auth kẹt vĩnh viễn
      // ở một script mà `reserve_auth` cấm burn (`reserve_auth.ak:50` — else → fail).
      .pay.ToContract(rw.reserve.gateAddr, { kind: "inline", value: VOID_DATUM },
        { lovelace: NFT_ADA, [rw.reserve.authUnit]: 1n })
      .addSigner(walletAddr)
      .complete();
    const h = await (await tx.sign.withWallet().complete()).submit();
    console.log(`📤 L2b auth mint: ${h}\n   ${explorerTx(h)}`);
    await lucid.awaitTx(h);
    await waitFor("auth NFT tại gate", authLive, (us) => us.length === 1);
    console.log(`✓ auth NFT bị KHOÁ tại reserve_gate — mọi lượt rút phải đi qua cổng sàn\n`);

    state.reserve = { custodyRef: custodyRef!, authRef, brakeProof: state.reserve?.brakeProof };
    state.tx.authMint = h;
    await writeState(state);
  }

  // ══ L2c — dời meter NFT xuống reserve_draw kèm ReserveState ═══════════════
  const atDraw = await lucid.utxosAt(rw!.reserve.drawAddr);
  if (atDraw.some((u) => (u.assets[wiring.metUnit] ?? 0n) === 1n)) {
    console.log(`↷ L2c bỏ qua — meter NFT đã ở ${rw!.reserve.drawAddr}`);
  } else {
    const inWallet = metHeld(await lucid.wallet().getUtxos());
    if (inWallet.length !== 1) {
      throw new Error(
        `meter NFT (${wiring.metUnit}) không ở ví: tìm thấy ${inWallet.length} bản. ` +
        `Lớp 1 để nó ở ví; nếu nó đã đi chỗ khác thì Lớp 2 không dựng tiếp được.`,
      );
    }
    // ── Cổng RESERVE-CAP-001, fail-closed ──────────────────────────────────
    //
    // `total_oildrop` ghi vào ReserveState ở đây trở thành BẤT BIẾN VĨNH VIỄN: Luật 7 của
    // `reserve_draw.ak:128` ép mọi lượt sau giữ nguyên nó, và trần mỗi epoch tính TỪ nó
    // (`reserve_draw.ak:94`, `reserve/math.ak::max_per_epoch` = total/1000). Không validator
    // nào đối chiếu nó với `reserve_cap` của SupplyState — nên ghi lớn gấp N lần là trần nhịp
    // lớn gấp N, và "1000 epoch ≈ 13,7 năm" thành 13,7/N năm. Cap tuyệt đối 36 tỷ vẫn giữ
    // (`lamp_mint.ak:185`), nên đây là mất NHỊP chứ không mất TRẦN — nhưng nhịp là phanh duy
    // nhất đang thật sự chạy (cổng cầu chưa đóng được), nên nó phải được đo trước khi gửi.
    //
    // Chỗ đo đúng là ĐÂY, không phải `verify_canonical_v2.ts`: cái đó chạy tay, SAU khi datum
    // đã lên chuỗi và đã thành bất biến.
    const ssAll = await lucid.utxosAt(wiring.ssAddr);
    const ssU = ssAll.find((u) => (u.assets[wiring.threadUnit] ?? 0n) === 1n);
    if (!ssU?.datum) {
      throw new Error(
        `RESERVE-CAP-001: không đọc được SupplyState tại ${wiring.ssAddr} (thread NFT ` +
        `${wiring.threadUnit}), nên KHÔNG đối chiếu được total_oildrop với reserve_cap. ` +
        `Không đo được thì DỪNG — datum này bất biến sau khi gửi.`,
      );
    }
    const sNow = supplyStateFromCbor(ssU.datum);
    if (RESERVE_TOTAL !== sNow.reserve_cap) {
      throw new Error(
        `RESERVE-CAP-001: total_oildrop sắp ghi (${RESERVE_TOTAL}) KHÁC reserve_cap trên chuỗi ` +
        `(${sNow.reserve_cap}). Trần mỗi epoch = total/1000, và total là BẤT BIẾN sau khi gửi ` +
        `(reserve_draw.ak Luật 7) ⇒ sai ở đây là sai vĩnh viễn. Sửa RESERVE_TOTAL trong ` +
        `_reserve_layer2.ts cho khớp SupplyState rồi chạy lại.`,
      );
    }
    console.log(`✓ RESERVE-CAP-001: total_oildrop = reserve_cap trên chuỗi (${RESERVE_TOTAL})`);

    const start = epochNow();
    console.log(`\nL2c dời meter: ví → ${rw!.reserve.drawAddr}`);
    console.log(`    ReserveState: start_epoch=${start} total=${RESERVE_TOTAL} drawn=0 last_epoch=0`);
    console.log(`    trần mỗi epoch = ${rw!.reserve.maxPerEpoch} oildrop`);

    const tx = await lucid.newTx()
      .collectFrom(inWallet)
      // `last_epoch = 0` cho phép lượt rút đầu ở epoch bất kỳ > 0 (Luật 3: t > last_epoch).
      // `start_epoch` và `total_oildrop` là BẤT BIẾN kể từ đây — Luật 7 ép mọi lượt giữ nguyên.
      .pay.ToContract(rw!.reserve.drawAddr,
        { kind: "inline", value: reserveStateDatum(start) },
        { lovelace: NFT_ADA, [wiring.metUnit]: 1n })
      .addSigner(walletAddr)
      .complete();
    const h = await (await tx.sign.withWallet().complete()).submit();
    console.log(`📤 L2c meter → reserve_draw: ${h}\n   ${explorerTx(h)}`);
    await lucid.awaitTx(h);
    await waitFor("meter NFT tại reserve_draw",
      async () => (await lucid.utxosAt(rw!.reserve.drawAddr))
        .filter((u) => (u.assets[wiring.metUnit] ?? 0n) === 1n),
      (us) => us.length === 1);

    state.tx.meterPark = h;
    await writeState(state);
  }

  console.log(`\n✅ PHANH ĐÃ LẮP.`);
  console.log(`   Từ giờ tiêu meter = chạy reserve_draw.ak. Rút quá ${rw!.reserve.maxPerEpoch} oildrop`);
  console.log(`   trong một epoch, hoặc rút lượt hai cùng epoch, hoặc rút mà không kích cổng sàn`);
  console.log(`   — cả ba đều bị validator từ chối, không phải bị cảnh báo.`);
  console.log(`\n   Bước kế: tsx 25_gated_draw.ts (rút THẬT qua cổng), rồi tsx 26_prove_brake.ts.`);
  console.log(`\n   Ghi chú tên: asset name meter là "${MET_NAME}" (MET), auth là "${AUTH_NAME}" (TPULL),`);
  console.log(`   custody instance là "${INSTANCE_ID}".`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
