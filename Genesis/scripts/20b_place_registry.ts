// 20b_place_registry.ts — dời REG NFT từ ví về `Script(regPid)`, kèm RegistryDatum.
//
// VÌ SAO CÓ BƯỚC NÀY (một phát hiện của chính màn diễn tập, không phải việc dọn dẹp)
//   Bản đầu của `20_canonical_genesis.ts` đặt REG NFT ở VÍ, và runbook chỉ ghi giới hạn là
//   "màn diễn tập chưa chứng minh được việc xoay khoá authority". Chạy thật trên Preprod thì
//   Tx B đỏ ngay:
//
//       failed script execution Mint[0] the validator crashed / exited prematurely
//
//   Nguyên nhân nằm ở `registry.ak::find_registry_datum`: nó lọc reference input theo NFT **và**
//   theo địa chỉ — `i.output.address.payment_credential == Script(policy)`. REG ở ví thì bộ lọc
//   ra rỗng ⇒ `find_registry_datum` trả `None` ⇒ cổng WHO đóng ⇒ không đúc được.
//
//   Chú thích tại chỗ nói rõ vì sao ràng buộc đó CỐ Ý và không được gỡ: reference input KHÔNG
//   cần chữ ký của ai, nên hễ registry NFT nằm ở một ví thì người giữ nó tự viết `entries` bất kỳ
//   — kể cả `authority = SinglePkh(ví_mình)` — và tự cấp quyền đúc LAMP. Bản v1 thiếu đúng mệnh
//   đề này và một PoC đã đúc LAMP không giới hạn từ anchor đặt ở ví thường.
//
//   Nói cách khác: giới hạn ghi trong runbook nhẹ hơn sự thật. Không phải "chưa chứng minh xoay
//   khoá" mà là "cổng WHO không mở được". Màn diễn tập bắt đúng loại lỗi nó sinh ra để bắt.
//
// ĐỊA CHỈ ĐÍCH: `oneshot_nft` là PlutusV3 một-script, policy-id nhánh mint ≡ script hash nhánh
// spend. Nên `Script(regPid)` là địa chỉ có thật và đúng bằng thứ bộ lọc đòi. Đổi lại: nhánh
// `else(_) { fail }` khiến UTxO ở đó KHÔNG BAO GIỜ tiêu được ⇒ bảng registry BẤT BIẾN. Với màn
// diễn tập là điều muốn có (không ai sửa lén bảng quyền); mainnet dùng `registry_write` — tiêu
// được, gác bằng TAAD/OrgDID — nên xoay khoá được mà không phát hành lại policy.
//
// Chạy: NETWORK=Preprod tsx 20b_place_registry.ts
import { type UTxO } from "@lucid-evolution/lucid";
import { NETWORK, makeLucid, walletPkh, explorerTx } from "./config.js";
import { rehydrate, registryDatum } from "./_canonical_v2.js";

const NFT_ADA = 2_000_000n;

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { wiring } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);

  console.log(`=== Dời REG NFT về Script(regPid) (${NETWORK}) ===`);
  console.log(`regPid:   ${wiring.markers.regPid}`);
  console.log(`đích:     ${wiring.regAddr}\n`);

  const at = (us: UTxO[]) => us.filter((u) => (u.assets[wiring.regUnit] ?? 0n) === 1n);
  if (at(await lucid.utxosAt(wiring.regAddr)).length === 1) {
    console.log("✓ REG đã nằm đúng chỗ — không cần làm gì.");
    return;
  }
  const inWallet = at(await lucid.wallet().getUtxos());
  if (inWallet.length !== 1) {
    throw new Error(`cần ĐÚNG 1 UTxO ví mang REG NFT, tìm thấy ${inWallet.length}.`);
  }

  const tx = await lucid.newTx()
    .collectFrom(inWallet)
    .pay.ToContract(wiring.regAddr, { kind: "inline", value: registryDatum(pkh) },
      { lovelace: NFT_ADA, [wiring.regUnit]: 1n })
    .complete();

  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(`📤 Tx: ${hash}\n   ${explorerTx(hash)}`);
  await lucid.awaitTx(hash);

  const now = at(await lucid.utxosAt(wiring.regAddr));
  if (now.length !== 1) throw new Error("REG chưa tới đích sau khi gửi.");
  console.log(`\n✓ REG NFT nay ở ${wiring.regAddr}, mang RegistryDatum.`);
  console.log(`  Bảng này từ giờ BẤT BIẾN (oneshot_nft else-fail), đúng ý cho màn diễn tập.`);
  console.log(`\n✅ Xong. Bước kế: tsx 21_vest_to_kho.ts`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
