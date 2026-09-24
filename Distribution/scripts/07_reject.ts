// LampDistribution/scripts/07_reject.ts — bộ ca TỪ CHỐI chạy trên TRẠNG THÁI THẬT của cụm.
//
// Mỗi họ ca có MỘT bản đúng và nhiều bản đột biến, dựng bằng CÙNG một hàm, khác đúng một chỗ.
//   · bản đúng phải QUA bước đánh giá script (`complete()` chạy UPLC trên đúng script đã apply);
//   · mỗi đột biến phải bị SCRIPT từ chối.
// Bản đúng đứng cạnh là thứ làm một ca đỏ có nghĩa: không có nó, một đột biến "bị từ chối" có thể
// hỏng vì một lý do chẳng liên quan tới trường vừa đổi (thiếu min-ADA, chọn coin, sai địa chỉ), và
// ca đó xanh cho điều nó không đo. Bản đúng không qua ⇒ cả họ KHÔNG ĐO ĐƯỢC, và runner nói to.
//
// KHÔNG gửi giao dịch nào. Không ký. Chỉ dựng + đánh giá.
//
// Chạy: FAMILY=grant|refill|beacon|redeem|all tsx 07_reject.ts
//   grant, refill: chạy được ở mọi cửa sổ.
//   beacon: bản đúng chỉ qua khi cửa sổ hiện tại LỚN HƠN nhãn beacon trên chuỗi.
//   redeem: bản đúng chỉ qua khi có một tài khoản còn phần rút được (ưu tiên A, rồi tới tài khoản khác).

import { Data, toUnit, credentialToAddress, keyHashToCredential } from "@lucid-evolution/lucid";
import type { LucidEvolution, UTxO, TxBuilder } from "@lucid-evolution/lucid";
import {
  NETWORK, DROP_ASSET_NAME, TREASURY_NFT_ASSET_NAME, MS_PER_EPOCH,
  makeLucid, walletPkh, loadDeployed, reapplyValidators,
} from "./config.js";
import {
  claimAccountDatumToCbor, decodeClaimAccountDatum, decodeBeaconDatum, decodeTreasuryDatum,
  treasuryDatumToCbor, grantEntitlementRedeemerToCbor, refillRedeemerToCbor,
  redeemRedeemerToCbor, treasuryRedeemerToCbor, beaconDatumToCbor, beaconRedeemerToCbor,
} from "../offchain/src/datum.js";
import { accountNftName, mintAccountRedeemerToCbor } from "../offchain/src/accountNft.js";
import { beaconIndexAt, redeemable } from "../offchain/src/vested.js";
import { RATE_ROOT_MAX, TRIM_FLOOR, epochWindow } from "../offchain/src/constants.js";
import type { BeaconDatum, ClaimAccountDatum, TreasuryDatum } from "../offchain/src/types.js";

type Verdict = "QUA" | "SCRIPT-TỪ-CHỐI" | "LỖI-KHÁC";
interface Row { family: string; name: string; expect: "QUA" | "TỪ-CHỐI"; got: Verdict; note: string }
const rows: Row[] = [];

/** Phân loại lỗi của `complete()`. Chỉ lỗi do đánh giá script mới đếm là "script từ chối". */
function classify(e: unknown): { v: Verdict; note: string } {
  const msg = e instanceof Error ? e.message : String(e);
  const flat = msg.replace(/\s+/g, " ");
  const isScript = /evaluat|uplc|script.*(fail|error)|validator|trace|redeemer|ExBudget|machine/i.test(flat);
  return { v: isScript ? "SCRIPT-TỪ-CHỐI" : "LỖI-KHÁC", note: flat.slice(0, 180) };
}

async function probe(family: string, name: string, expect: "QUA" | "TỪ-CHỐI", build: () => TxBuilder): Promise<boolean> {
  try {
    await build().complete();
    rows.push({ family, name, expect, got: "QUA", note: "" });
    return true;
  } catch (e) {
    const c = classify(e);
    rows.push({ family, name, expect, got: c.v, note: c.note });
    return false;
  }
}

/** Chạy một họ: bản đúng trước; qua mới chạy đột biến. */
async function family<M extends string>(
  name: string, mutations: readonly M[], build: (m: M | null) => TxBuilder,
): Promise<void> {
  const ok = await probe(name, "BẢN-ĐÚNG", "QUA", () => build(null));
  if (!ok) {
    console.log(`⚠ ${name}: bản đúng KHÔNG qua ⇒ cả họ KHÔNG ĐO ĐƯỢC ở trạng thái hiện tại, bỏ đột biến.`);
    return;
  }
  for (const m of mutations) await probe(name, m, "TỪ-CHỐI", () => build(m));
}

const find = async (lucid: LucidEvolution, addr: string, unit: string): Promise<UTxO> => {
  const u = (await lucid.utxosAt(addr)).find((x) => (x.assets[unit] ?? 0n) === 1n);
  if (!u) throw new Error(`REJECT-000: không thấy UTxO mang ${unit} tại ${addr}`);
  return u;
};

async function main(): Promise<void> {
  const FAMILY = (process.env.FAMILY ?? "all").trim();
  const state = await loadDeployed();
  if (!state.testLamp || !state.beaconNftPolicy) throw new Error("REJECT-001: deployed.json thiếu testLamp/beaconNftPolicy.");
  const lucid = await makeLucid();
  const aPkh = await walletPkh(lucid);
  const { claimScript, beaconScript, treasuryScript, accountNftScript } = await reapplyValidators(state);
  const committee = state.committee.keyHashes;

  const w = epochWindow(MS_PER_EPOCH);
  const e = w.epoch;
  const lampUnit = toUnit(state.testLamp.policyId, state.testLamp.assetName);
  const trsyUnit = toUnit(state.params.treasuryNftPolicy, TREASURY_NFT_ASSET_NAME);
  const dropUnit = toUnit(state.beaconNftPolicy, DROP_ASSET_NAME);
  const treU = await find(lucid, state.treasury.address, trsyUnit);
  const bcnU = await find(lucid, state.beacon.address, dropUnit);
  const tre = decodeTreasuryDatum(Data.from(treU.datum!));
  const bcn = decodeBeaconDatum(Data.from(bcnU.datum!));
  const keyAddr = (pkh: string): string => credentialToAddress(NETWORK, keyHashToCredential(pkh));

  console.log(`=== 07_reject (${NETWORK}) · cửa sổ ${e} · beacon nhãn ${bcn.epoch} · kho ${treU.txHash.slice(0, 10)}… ===\n`);

  // ── Họ 1: cấp quyền, đường CREATE, cho một chủ chưa có tài khoản ────────────
  if (FAMILY === "grant" || FAMILY === "all") {
    const owner = "c1".repeat(28);
    const amount = 10_000_000n;
    const aNow = beaconIndexAt(bcn, e);
    const pool = treU.assets[lampUnit] ?? 0n;
    const muts = [
      "start_epoch-lùi-1", "index_at_start+1", "drops_per_epoch=2", "redeemed=1",
      "sổ-nợ-thiếu-1", "total_redeemed+1", "khoảng-hiệu-lực-vắt-2-cửa-sổ", "thiếu-beacon-tham-chiếu",
      "cấp-vượt-kho", "tên-NFT-của-chủ-khác", "thiếu-chữ-ký-committee",
    ] as const;
    await family("grant", muts, (m) => {
      const amt = m === "cấp-vượt-kho" ? pool - tre.outstanding_entitlement + 1n : amount;
      const acc: ClaimAccountDatum = {
        owner, entitlement: amt, redeemed: m === "redeemed=1" ? 1n : 0n,
        start_epoch: m === "start_epoch-lùi-1" ? e - 1n : e,
        drops_per_epoch: m === "drops_per_epoch=2" ? 2n : 1n,
        index_at_start: m === "index_at_start+1" ? aNow + 1n : aNow,
      };
      const treOut: TreasuryDatum = {
        committee_hash: tre.committee_hash,
        outstanding_entitlement: tre.outstanding_entitlement + amt - (m === "sổ-nợ-thiếu-1" ? 1n : 0n),
        total_redeemed: tre.total_redeemed + (m === "total_redeemed+1" ? 1n : 0n),
      };
      const nftUnit = toUnit(
        state.params.accountNftPolicy,
        accountNftName(m === "tên-NFT-của-chủ-khác" ? "c2".repeat(28) : owner),
      );
      let t = lucid.newTx()
        .mintAssets({ [nftUnit]: 1n }, mintAccountRedeemerToCbor())
        .attach.MintingPolicy(accountNftScript)
        .pay.ToAddressWithData(state.claimAccount.address,
          { kind: "inline", value: claimAccountDatumToCbor(acc) }, { lovelace: 2_000_000n, [nftUnit]: 1n })
        .collectFrom([treU], grantEntitlementRedeemerToCbor())
        .attach.SpendingValidator(treasuryScript)
        .pay.ToAddressWithData(treU.address,
          { kind: "inline", value: treasuryDatumToCbor(treOut) }, { ...treU.assets });
      if (m !== "thiếu-beacon-tham-chiếu") t = t.readFrom([bcnU]);
      if (m !== "thiếu-chữ-ký-committee") for (const k of committee) t = t.addSignerKey(k);
      const hi = m === "khoảng-hiệu-lực-vắt-2-cửa-sổ" ? w.hiMs + MS_PER_EPOCH : w.hiMs;
      return t.validFrom(Number(w.loMs)).validTo(Number(hi));
    });
  }

  // ── Họ 2: Refill singleton, nạp thêm 1 LAMP ───────────────────────────────
  if (FAMILY === "refill" || FAMILY === "all") {
    const dep = 1_000_000n;
    const muts = [
      "sổ-nợ+1", "total_redeemed+1", "committee_hash-khác", "TRSY-rời-kho",
      "rút-1-LAMP-thay-vì-nạp", "hai-output-tại-kho", "thiếu-chữ-ký-committee",
    ] as const;
    await family("refill", muts, (m) => {
      const out: TreasuryDatum = {
        committee_hash: m === "committee_hash-khác" ? "ab".repeat(28) : tre.committee_hash,
        outstanding_entitlement: tre.outstanding_entitlement + (m === "sổ-nợ+1" ? 1n : 0n),
        total_redeemed: tre.total_redeemed + (m === "total_redeemed+1" ? 1n : 0n),
      };
      const lampIn = treU.assets[lampUnit] ?? 0n;
      const v: Record<string, bigint> = { ...treU.assets, [lampUnit]: lampIn + (m === "rút-1-LAMP-thay-vì-nạp" ? -1n : dep) };
      if (m === "TRSY-rời-kho") delete v[trsyUnit];
      let t = lucid.newTx()
        .collectFrom([treU], refillRedeemerToCbor())
        .attach.SpendingValidator(treasuryScript)
        .pay.ToAddressWithData(treU.address, { kind: "inline", value: treasuryDatumToCbor(out) }, v);
      if (m === "TRSY-rời-kho") t = t.pay.ToAddress(keyAddr(aPkh), { lovelace: 2_000_000n, [trsyUnit]: 1n });
      if (m === "hai-output-tại-kho") {
        t = t.pay.ToAddressWithData(treU.address, { kind: "inline", value: treasuryDatumToCbor(out) }, { lovelace: 2_000_000n });
      }
      if (m !== "thiếu-chữ-ký-committee") for (const k of committee) t = t.addSignerKey(k);
      return t;
    });
  }

  // ── Họ 3: post beacon cho cửa sổ hiện tại ─────────────────────────────────
  if (FAMILY === "beacon" || FAMILY === "all") {
    const muts = [
      "index+1", "nhãn-tương-lai", "rate_root-giảm-1", "rate_root-vượt-trần",
      "rate_root-tăng-quá-10%", "NFT-rời-beacon", "thiếu-chữ-ký-committee",
    ] as const;
    await family("beacon", muts, (m) => {
      const label = m === "nhãn-tương-lai" ? e + 1n : e;
      const nb: BeaconDatum = {
        ...bcn, epoch: label,
        index: beaconIndexAt(bcn, label) + (m === "index+1" ? 1n : 0n),
        rate_root: m === "rate_root-giảm-1" ? bcn.rate_root - 1n
          : m === "rate_root-vượt-trần" ? RATE_ROOT_MAX + 1n
          : m === "rate_root-tăng-quá-10%" ? bcn.rate_root + bcn.rate_root / 10n + 1n
          : bcn.rate_root,
      };
      const v: Record<string, bigint> = { ...bcnU.assets };
      if (m === "NFT-rời-beacon") delete v[dropUnit];
      let t = lucid.newTx()
        .collectFrom([bcnU], beaconRedeemerToCbor())
        .attach.SpendingValidator(beaconScript)
        .pay.ToAddressWithData(bcnU.address, { kind: "inline", value: beaconDatumToCbor(nb) }, v);
      if (m === "NFT-rời-beacon") t = t.pay.ToAddress(keyAddr(aPkh), { lovelace: 2_000_000n, [dropUnit]: 1n });
      if (m !== "thiếu-chữ-ký-committee") for (const k of committee) t = t.addSignerKey(k);
      return t.validFrom(Number(w.loMs)).validTo(Number(w.hiMs));
    });
  }

  // ── Họ 4: rút, tài khoản A (và tài khoản B cho ca "ký thay chủ") ───────────
  if (FAMILY === "redeem" || FAMILY === "all") {
    const accs = (await lucid.utxosAt(state.claimAccount.address)).filter((u) => !!u.datum);
    const pick = (pkh: string): UTxO | undefined => accs.find((u) => {
      try { return decodeClaimAccountDatum(Data.from(u.datum!)).owner.toLowerCase() === pkh.toLowerCase(); }
      catch { return false; }
    });
    // Ưu tiên A; A đã rút hết thì lấy tài khoản khác còn phần rút được. Bước này chỉ đánh giá,
    // không ký, nên chủ tài khoản không cần là ví đang chạy — chữ ký chỉ được KHAI (required signer).
    const withAmt = (u: UTxO | undefined) => {
      if (!u) return undefined;
      const d = decodeClaimAccountDatum(Data.from(u.datum!));
      return { u, d, amt: redeemable(d, bcn, tre, e, TRIM_FLOOR) };
    };
    const cands = [withAmt(pick(aPkh)), ...accs.map(withAmt)].filter((c) => !!c && c.amt > 0n);
    const chosen = cands[0];
    if (!chosen) {
      console.log("⚠ redeem: không tài khoản nào còn phần rút được ở cửa sổ này ⇒ KHÔNG ĐO ĐƯỢC.");
      rows.push({ family: "redeem", name: "BẢN-ĐÚNG", expect: "QUA", got: "LỖI-KHÁC", note: "không tài khoản nào còn phần rút được" });
    } else {
      const accA = chosen.u;
      const da = chosen.d;
      const amt0 = chosen.amt;
      console.log(`redeem: dùng tài khoản chủ ${da.owner.slice(0, 10)}… · rút được ${amt0} oildrop`);
      const muts = [
        "amount+1", "trả-LAMP-cho-ví-khác", "total_redeemed-không-tăng", "sổ-nợ-không-giảm",
        "index_at_start-đổi", "thiếu-chữ-ký-chủ", "thiếu-beacon-tham-chiếu",
      ] as const;
      await family("redeem", muts, (m) => {
        const amt = amt0 + (m === "amount+1" ? 1n : 0n);
        const accOut: ClaimAccountDatum = {
          ...da, redeemed: da.redeemed + amt,
          index_at_start: da.index_at_start + (m === "index_at_start-đổi" ? 1n : 0n),
        };
        const treOut: TreasuryDatum = {
          committee_hash: tre.committee_hash,
          outstanding_entitlement: tre.outstanding_entitlement - (m === "sổ-nợ-không-giảm" ? 0n : amt),
          total_redeemed: tre.total_redeemed + (m === "total_redeemed-không-tăng" ? 0n : amt),
        };
        const lampIn = treU.assets[lampUnit] ?? 0n;
        const dest = m === "trả-LAMP-cho-ví-khác" ? keyAddr("d0".repeat(28)) : keyAddr(da.owner);
        let t = lucid.newTx()
          .collectFrom([accA], redeemRedeemerToCbor(amt))
          .attach.SpendingValidator(claimScript)
          .collectFrom([treU], treasuryRedeemerToCbor())
          .attach.SpendingValidator(treasuryScript)
          .pay.ToAddressWithData(accA.address, { kind: "inline", value: claimAccountDatumToCbor(accOut) }, { ...accA.assets })
          .pay.ToAddressWithData(treU.address, { kind: "inline", value: treasuryDatumToCbor(treOut) },
            { ...treU.assets, [lampUnit]: lampIn - amt })
          .pay.ToAddress(dest, { lovelace: 2_000_000n, [lampUnit]: amt });
        if (m !== "thiếu-beacon-tham-chiếu") t = t.readFrom([bcnU]);
        if (m !== "thiếu-chữ-ký-chủ") t = t.addSignerKey(da.owner);
        return t.validFrom(Number(w.loMs));
      });
    }
  }

  // ── Bảng kết quả ───────────────────────────────────────────────────────────
  console.log("\n| họ | ca | kỳ vọng | kết quả | ĐẠT? | ghi chú |\n|---|---|---|---|---|---|");
  let pass = 0, fail = 0, blind = 0;
  for (const r of rows) {
    const ok = (r.expect === "QUA" && r.got === "QUA") || (r.expect === "TỪ-CHỐI" && r.got === "SCRIPT-TỪ-CHỐI");
    const unmeasured = r.got === "LỖI-KHÁC";
    if (ok) pass++; else if (unmeasured) blind++; else fail++;
    console.log(`| ${r.family} | ${r.name} | ${r.expect} | ${r.got} | ${ok ? "ĐẠT" : unmeasured ? "KHÔNG ĐO ĐƯỢC" : "HỎNG"} | ${r.note.slice(0, 110)} |`);
  }
  console.log(`\nTổng: ${rows.length} ca · ĐẠT ${pass} · HỎNG ${fail} · KHÔNG ĐO ĐƯỢC ${blind}.`);
  if (fail > 0 || blind > 0) process.exit(1);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
