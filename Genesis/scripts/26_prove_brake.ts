// 26_prove_brake.ts — BA PHÉP THỬ PHỦ ĐỊNH: chứng minh phanh CHẶN, không chỉ chứng minh nó có.
//
// VÌ SAO CẦN RIÊNG MỘT BƯỚC CHO CHUYỆN NÀY
//   `25_gated_draw.ts` chạy xanh chỉ chứng minh một lượt rút HỢP LỆ đi được. Nó không nói gì
//   về lượt rút KHÔNG hợp lệ — mà đó mới là toàn bộ giá trị của phanh. Một validator luôn
//   trả `True` cũng cho lượt hợp lệ đi qua y hệt.
//
//   Ba phép dưới đây dựng ba giao dịch SAI theo ba kiểu khác nhau và đòi cả ba BỊ TỪ CHỐI.
//   Không ký, không gửi: `.complete()` chạy đánh giá script qua nhà cung cấp, nên một giao
//   dịch vi phạm luật gãy ngay ở bước dựng, trước khi tốn một lovelace phí nào.
//
//     P1  δ vượt trần nhịp     → `reserve_draw.ak` Luật 4 (δ ≤ tổng/1000)
//     P2  rút lượt hai cùng epoch → Luật 3 (t > last_epoch)
//     P3  rút KHÔNG kích cổng   → Luật 5 (auth NFT phải tiêu TỪ gate script)
//
//   P3 là phép quan trọng nhất trong ba: nó là thứ ngăn người rút bỏ qua cổng cầu của
//   Treasury. Nếu P3 xanh (tức giao dịch dựng ĐƯỢC) thì cổng sàn chỉ là trang trí.
//
// Chạy: NETWORK=Preprod tsx 26_prove_brake.ts
import { type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, makeLucid, walletPkh } from "./config.js";
import {
  supplyStateToCbor, supplyStateFromCbor, supplyStateRedeemerToCbor, mintRouteToCbor,
} from "../offchain/src/datum.js";
import { rehydrate, writeState } from "./_canonical_v2.js";
import { deriveReserveWiring, reserveStateDatum, drawWindow } from "./_reserve_layer2.js";
import { reserveStateFromCbor, drawRedeemerToCbor } from "../../Reserve/offchain/src/datum.js";
import { attachGateSpend } from "../../Treasury/offchain/src/reserveGateBuilder.js";

const NFT_ADA = 2_000_000n;

function theOneHolding(utxos: UTxO[], unit: string, what: string): UTxO {
  const hits = utxos.filter((u) => (u.assets[unit] ?? 0n) === 1n);
  if (hits.length !== 1) throw new Error(`cần ĐÚNG 1 UTxO mang ${what} (${unit}), tìm thấy ${hits.length}.`);
  return hits[0]!;
}

/** Rút gọn thông điệp lỗi cho dễ đọc — giữ nguyên chữ, chỉ cắt đuôi. */
const short = (e: unknown, n = 240) => {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const walletAddr = await lucid.wallet().address();
  const { state, wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);
  if (!state.reserve?.custodyRef || (state.reserve.authRef?.outputIndex ?? -1) < 0) {
    throw new Error("chưa dựng Lớp 2 — chạy 'tsx 24_reserve_layer2_init.ts' trước.");
  }

  const { reserve, scripts: rs } = await deriveReserveWiring(wiring, {
    custodyTxHash: state.reserve.custodyRef.txHash,
    custodyIndex:  state.reserve.custodyRef.outputIndex,
    authTxHash:    state.reserve.authRef.txHash,
    authIndex:     state.reserve.authRef.outputIndex,
    network:       wiring.network,
  });

  const drawU = theOneHolding(await lucid.utxosAt(reserve.drawAddr), wiring.metUnit, "meter NFT tại reserve_draw");
  const ssU   = theOneHolding(await lucid.utxosAt(wiring.ssAddr),    wiring.threadUnit, "SUPPLY NFT");
  const authU = theOneHolding(await lucid.utxosAt(reserve.gateAddr), reserve.authUnit,  "auth NFT tại gate");
  const custU = theOneHolding(await lucid.utxosAt(reserve.custodyAddr), reserve.custodyNftUnit, "custody NFT");

  const r0 = reserveStateFromCbor(drawU.datum!);
  const s0 = supplyStateFromCbor(ssU.datum!);
  const authName = reserve.authUnit.slice(56);

  console.log(`=== Ba phép thử PHỦ ĐỊNH của phanh Reserve (${NETWORK}) ===`);
  console.log(`ReserveState: total=${r0.total_oildrop} drawn=${r0.drawn_oildrop} last_epoch=${r0.last_epoch}`);
  console.log(`trần mỗi epoch = ${reserve.maxPerEpoch} oildrop\n`);
  console.log(`Không ký, không gửi — mọi phép dừng ở bước dựng giao dịch.\n`);

  /**
   * Dựng một lượt rút với các tham số cho trước. `withGate=false` bỏ hẳn phần cổng
   * (không tiêu auth NFT, không reference custody) để thử đường đi vòng.
   */
  async function buildDraw(o: { delta: bigint; epoch: bigint; loMs: number; hiMs: number; withGate: boolean }) {
    let txb = lucid.newTx()
      .collectFrom([drawU], drawRedeemerToCbor())
      .attach.SpendingValidator(rs.draw)
      .pay.ToContract(reserve.drawAddr,
        { kind: "inline", value: reserveStateDatum(r0.start_epoch, r0.total_oildrop, r0.drawn_oildrop + o.delta, o.epoch) },
        { lovelace: NFT_ADA, [wiring.metUnit]: 1n })
      .mintAssets({ [wiring.lampUnit]: o.delta }, mintRouteToCbor("ReserveDraw"))
      .attach.MintingPolicy(scripts.lampMint)
      .collectFrom([ssU], supplyStateRedeemerToCbor())
      .attach.SpendingValidator(scripts.supplyState)
      .pay.ToContract(wiring.ssAddr,
        { kind: "inline", value: supplyStateToCbor({ ...s0, reserve_minted: s0.reserve_minted + o.delta }) },
        { lovelace: NFT_ADA, [wiring.threadUnit]: 1n })
      .pay.ToAddress(reserve.custodyAddr, { lovelace: NFT_ADA, [wiring.lampUnit]: o.delta })
      .validFrom(o.loMs).validTo(o.hiMs)
      .addSigner(walletAddr);

    if (o.withGate) {
      txb = attachGateSpend(txb, {
        lucid, authUtxo: authU, gateScript: rs.gate, gateAddress: reserve.gateAddr,
        authPolicyId: reserve.authPid, authName,
        custodyUtxo: custU, lampPolicyId: wiring.lampPid, tokenName: wiring.tokenName,
        floorOildrop: reserve.floorOildrop,
      });
    }
    return txb.complete();
  }

  const results: { name: string; blocked: boolean; error: string }[] = [];

  /**
   * Một lỗi CHỈ được tính là "validator đã chặn" khi nó là lỗi thực thi script.
   *
   * Vì sao phải lọc: bản trước bắt MỌI ngoại lệ rồi ghi `blocked: true`. Mạng rớt, Blockfrost
   * 429, ví thiếu ADA, CBOR sai — tất cả thành "phanh có tác dụng". Đó đúng là trạng thái thứ
   * ba (KHÔNG ĐO ĐƯỢC) đội lốt trạng thái thứ nhất (khớp), và nó đi thẳng vào cổng phát hành.
   */
  function laLoiValidator(e: unknown): boolean {
    const m = String((e as { message?: string })?.message ?? e);
    return /validator crashed|exited prematurely|Spend\[|Mint\[|ScriptFailure|EvaluationFailure/i.test(m);
  }

  async function expectRejected(name: string, luat: string, run: () => Promise<unknown>): Promise<void> {
    console.log(`── ${name}`);
    console.log(`   ${luat}`);
    try {
      await run();
      results.push({ name, blocked: false, error: "" });
      console.log(`   ❌ KHÔNG BỊ CHẶN — giao dịch dựng được. Phanh này KHÔNG có tác dụng.\n`);
    } catch (e) {
      if (!laLoiValidator(e)) {
        // KHÔNG nuốt: phép đo này không đo được gì, và im lặng ở đây là dựng bằng chứng giả.
        throw new Error(
          `${name}: lỗi KHÔNG PHẢI do validator từ chối, nên phép phủ định này không đo được gì.\n` +
          `Lỗi thô: ${short(e, 400)}\n` +
          `Sửa nguyên nhân (mạng, ví, tham số) rồi chạy lại. Ghi nó thành "bị chặn" là dựng ` +
          `bằng chứng giả cho cổng phát hành mainnet.`,
        );
      }
      results.push({ name, blocked: true, error: short(e) });
      console.log(`   ✓ bị chặn: ${short(e, 180)}\n`);
    }
  }

  /**
   * Cửa sổ hiệu lực ở một epoch CHẮC CHẮN qua được Luật 3 (t > last_epoch).
   *
   * Vì sao phải có: nếu `25_gated_draw.ts` đã rút trong epoch hiện tại thì MỌI giao dịch dựng
   * ở epoch đó đều bị Luật 3 chặn — và lúc ấy P1/P3 "bị chặn" chẳng chứng minh được gì về
   * Luật 4 hay Luật 5. Lượt chạy đầu (2026-09-03) mắc đúng lỗi này: cả ba phép đều xanh, nhưng
   * P1 dựng ở epoch đã rút nên nó thật ra đang đo lại Luật 3.
   *
   * Epoch kế cách hiện tại ≤ 5 ngày trên Preprod, nằm trong tầm ttl của node (~36 giờ) khi
   * lượt rút vừa xảy ra trong epoch này — đủ để `.complete()` dựng được.
   */
  function windowAfterLastDraw(): { loMs: number; hiMs: number; t: bigint } {
    const w = drawWindow();
    if (w.t > r0.last_epoch) return w;
    const t = r0.last_epoch + 1n;
    const loMs = Number(t * 432_000_000n) + 60_000;
    return { loMs, hiMs: loMs + 90_000, t };
  }

  // ── P0: ĐỐI CHỨNG DƯƠNG — cùng khuôn, không khuyết tật nào ───────────────
  // Ba phép phủ định dưới đây trả về CÙNG một chuỗi lỗi ("Spend[0] the validator crashed"),
  // nên bản thân chuỗi đó không nói được luật nào đã chặn. Đối chứng này lấp chỗ đó: cùng
  // khuôn giao dịch, cùng epoch, chỉ khác ở chỗ KHÔNG có khuyết tật. Nó dựng ĐƯỢC thì mỗi
  // phép phủ định chỉ còn khác nó ĐÚNG MỘT chiều, và chiều đó là nguyên nhân.
  // KHÔNG ký, KHÔNG gửi — dựng xong là vứt.
  {
    const w = windowAfterLastDraw();
    console.log(`── P0 (đối chứng DƯƠNG) — δ hợp lệ, epoch ${w.t} > last_epoch ${r0.last_epoch}, có cổng`);
    try {
      await buildDraw({ delta: 1_000_000n, epoch: w.t, loMs: w.loMs, hiMs: w.hiMs, withGate: true });
      console.log(`   ✓ dựng ĐƯỢC — khuôn giao dịch đúng, nên mọi lỗi dưới đây là do khuyết tật cố ý.\n`);
    } catch (e) {
      // Đối chứng dương đỏ ⇒ DỪNG. Bản trước chỉ in một dòng ⚠ rồi vẫn chạy tiếp và vẫn ghi
      // `brakeProof` — tức vẫn sinh ra bằng chứng cho cổng phát hành, từ một lượt chạy mà
      // chính nó vừa khai là không quy được về luật nào.
      console.error(`   ⚠ ĐỐI CHỨNG DƯƠNG KHÔNG DỰNG ĐƯỢC: ${short(e, 300)}`);
      console.error(
        `\n   Ba phép phủ định dưới đây đều trả về CÙNG một chuỗi lỗi, nên nếu không có một\n` +
        `   lượt dựng THÀNH CÔNG cùng khuôn thì "bị chặn" không quy được về luật nào — nó chỉ\n` +
        `   nói khuôn giao dịch hỏng. KHÔNG ghi brakeProof, KHÔNG chạy tiếp.`,
      );
      process.exit(1);
    }
  }

  // ── P1: δ vượt trần nhịp ────────────────────────────────────────────────
  // Vượt ĐÚNG 1 oildrop. Cố ý sát biên: nếu luật cài bằng `<` thay vì `≤` (hoặc ngược lại)
  // thì chỉ phép thử sát biên mới lộ ra. Epoch lấy từ `windowAfterLastDraw()` để phép này
  // KHÔNG vướng Luật 3 — khác đối chứng P0 đúng một chiều: δ.
  {
    const w = windowAfterLastDraw();
    const over = reserve.maxPerEpoch + 1n;
    await expectRejected(
      `P1 — δ = trần + 1 (${over} oildrop), epoch ${w.t}`,
      `reserve_draw.ak Luật 4: delta ≤ max_per_epoch(total) = total/1000`,
      () => buildDraw({ delta: over, epoch: w.t, loMs: w.loMs, hiMs: w.hiMs, withGate: true }),
    );
  }

  // ── P2: rút lượt hai trong CÙNG epoch ───────────────────────────────────
  // Chỉ có nghĩa khi `25_gated_draw.ts` đã chạy trong epoch hiện tại (last_epoch == t).
  {
    const w = drawWindow();
    if (w.t > r0.last_epoch) {
      console.log(`── P2 — rút lượt hai cùng epoch`);
      console.log(`   ↷ BỎ QUA: epoch hiện tại t=${w.t} > last_epoch=${r0.last_epoch}, tức epoch này CHƯA rút.`);
      console.log(`   Chạy '25_gated_draw.ts' trước rồi chạy lại bước này trong CÙNG epoch thì phép mới có nghĩa.\n`);
      results.push({ name: "P2", blocked: false, error: "BỎ QUA — epoch này chưa rút lượt nào" });
    } else {
      await expectRejected(
        `P2 — lượt hai trong epoch ${w.t} (last_epoch = ${r0.last_epoch})`,
        `reserve_draw.ak Luật 3: t > last_epoch — mỗi epoch tối đa MỘT lượt`,
        () => buildDraw({ delta: 1_000_000n, epoch: w.t, loMs: w.loMs, hiMs: w.hiMs, withGate: true }),
      );
    }
  }

  // ── P3: rút KHÔNG kích cổng ─────────────────────────────────────────────
  // Bỏ hẳn auth NFT và custody reference. δ hợp lệ, epoch hợp lệ — sai DUY NHẤT một chuyện:
  // không đi qua cổng sàn của Treasury.
  {
    const w = windowAfterLastDraw();
    await expectRejected(
      `P3 — rút mà KHÔNG tiêu auth NFT từ gate, epoch ${w.t}`,
      `reserve_draw.ak Luật 5: ∃ input mang treasury_auth NFT Ở gate_script_hash`,
      () => buildDraw({ delta: 1_000_000n, epoch: w.t, loMs: w.loMs, hiMs: w.hiMs, withGate: false }),
    );
  }

  // ── Kết ──────────────────────────────────────────────────────────────────
  const [p1, p2, p3] = results;
  const real = results.filter((r) => !r.error.startsWith("BỎ QUA"));
  const allBlocked = real.every((r) => r.blocked);

  console.log(`═══ Kết ═══`);
  for (const r of results) {
    console.log(`${r.blocked ? "✓" : r.error.startsWith("BỎ QUA") ? "↷" : "✗"} ${r.name}`);
  }
  console.log(
    allBlocked
      ? `\n✅ Mọi phép PHỦ ĐỊNH chạy được đều BỊ CHẶN — phanh có tác dụng thật, không phải trang trí.`
      : `\n⚠ Có phép KHÔNG bị chặn. ĐỪNG phát hành cho tới khi hiểu vì sao.`,
  );

  state.reserve!.brakeProof = {
    attemptedAt: new Date().toISOString(),
    overCapBlocked: p1!.blocked, overCapError: p1!.error,
    sameEpochBlocked: p2!.blocked, sameEpochError: p2!.error,
    noGateBlocked: p3!.blocked, noGateError: p3!.error,
  };
  await writeState(state);
  if (!allBlocked) process.exit(1);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
