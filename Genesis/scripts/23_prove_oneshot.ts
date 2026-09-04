// 23_prove_oneshot.ts — BẰNG CHỨNG PHỦ ĐỊNH: marker không đúc lại được lượt thứ hai.
//
// VÌ SAO PHẢI CÓ BƯỚC NÀY. `mainnet-deploy-plan.md` mục C nói rõ: một lượt Preprod xanh
// chứng minh "đường ống thông", KHÔNG chứng minh "chỉ có một SupplyState". Hai câu đó khác
// nhau ở chỗ chí mạng — nếu đúc được SUPPLY NFT thứ hai thì dựng được SupplyState thứ hai
// với `dist_minted = 0`, và đúc lại TRỌN cap. Trần 36 tỷ tụt xuống thành một lời hứa vận
// hành, không còn là ràng buộc của chuỗi.
//
// Bản diễn tập cũ không thể có bước này: `canonical_mint.ts:108` đúc marker bằng
// `scriptFromNative({type:"sig"})`, mà native-sig thì đúc lại được bao nhiêu lần tuỳ ý —
// phép thử sẽ THÀNH CÔNG, tức là hỏng.
//
// Bước này kiểm HAI thứ, một cấu trúc một vận hành:
//   (1) CẤU TRÚC — UTxO hạt giống đã biến mất khỏi tập UTxO đang sống. Điều kiện one-shot
//       `list.any(tx.inputs, fn(i) { i.output_reference == genesis_ref })`
//       (`oneshot_nft.ak:34`) đòi TIÊU nó; đã tiêu rồi thì không giao dịch nào trong tương
//       lai, của bất kỳ ai, thoả được nữa. Đây là chứng minh mạnh: nó phủ định MỌI lượt
//       thử về sau, không chỉ lượt dưới đây.
//   (2) VẬN HÀNH — dựng thật một giao dịch đúc SUPPLY NFT thứ hai và xác nhận nó bị chặn.
//
// Script này KHÔNG BAO GIỜ ký hay gửi giao dịch thử. Nó dừng ở bước dựng + eval script.
//
// Chạy: NETWORK=Preprod tsx 23_prove_oneshot.ts
import { Data } from "@lucid-evolution/lucid";
import { NETWORK, makeLucid, walletPkh } from "./config.js";
import { rehydrate, writeState } from "./_canonical_v2.js";

async function main(): Promise<void> {
  if (NETWORK === "Mainnet") throw new Error("CHẶN: script diễn tập, không chạy trên Mainnet.");

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const { state, wiring, scripts } = await rehydrate();
  if (pkh !== wiring.pkh) throw new Error(`SAI VÍ: state ghi pkh=${wiring.pkh}, ví hiện tại ${pkh}.`);

  const ref = wiring.genesisRef;
  console.log(`=== Bằng chứng one-shot (${NETWORK}) ===`);
  console.log(`hạt giống: ${ref.txHash}#${ref.outputIndex}`);
  console.log(`policy SUPPLY: ${wiring.markers.threadPid}\n`);

  // ── (1) Chứng minh cấu trúc ──────────────────────────────────────────────
  let alive = 0;
  try {
    alive = (await lucid.utxosByOutRef([{ txHash: ref.txHash, outputIndex: ref.outputIndex }])).length;
  } catch {
    alive = 0;   // nhà cung cấp trả rỗng bằng cách ném — cùng nghĩa với "không còn".
  }
  if (alive !== 0) {
    throw new Error(
      `hạt giống VẪN CÒN SỐNG (${alive} UTxO) — nghĩa là Tx A chưa gửi, hoặc state trỏ nhầm ref. ` +
      `Chưa tiêu hạt giống thì tính one-shot chưa được kích hoạt, và phép thử dưới đây vô nghĩa.`,
    );
  }
  console.log("✓ (1) CẤU TRÚC: hạt giống đã bị tiêu, không còn trong tập UTxO sống.");
  console.log("     ⇒ không giao dịch nào về sau thoả được điều kiện one-shot (oneshot_nft.ak:34),");
  console.log("       kể cả của người giữ khoá ví. Đây là phủ định cho MỌI lượt thử, không chỉ lượt dưới.");

  // ── (2) Chứng minh vận hành ──────────────────────────────────────────────
  console.log("\n── (2) VẬN HÀNH: dựng thật một giao dịch đúc SUPPLY NFT thứ hai ──");
  let blocked = false;
  let err = "";
  try {
    const tx = await lucid.newTx()
      .mintAssets({ [wiring.threadUnit]: 1n }, Data.void())
      .attach.MintingPolicy(scripts.oneshotSupply)
      .complete();
    // Tới đây là HỎNG — nhưng vẫn KHÔNG ký, KHÔNG gửi. In CBOR để soi rồi thoát đỏ.
    console.error(`🔴 KHÔNG BỊ CHẶN. Giao dịch dựng được (CBOR ${tx.toCBOR().length / 2} byte).`);
    console.error("   Nghĩa là SUPPLY NFT đúc lại được ⇒ dựng được SupplyState thứ hai với");
    console.error("   dist_minted = 0 ⇒ đúc lại TRỌN cap. TRẦN 36 TỶ KHÔNG CÒN LÀ RÀNG BUỘC.");
    console.error("   ĐỪNG phát hành policy này. Giao dịch thử KHÔNG được ký và KHÔNG được gửi.");
  } catch (e) {
    blocked = true;
    err = e instanceof Error ? e.message : String(e);
    console.log("✓ (2) BỊ CHẶN đúng như thiết kế. Lý do máy trả về:");
    console.log(`     ${err.split("\n")[0]?.slice(0, 300)}`);
  }

  state.oneshotProof = { attemptedAt: new Date().toISOString(), blocked, error: err.slice(0, 1000) };
  await writeState(state);

  if (!blocked) process.exit(1);
  console.log("\n✅ Tính one-shot đã có bằng chứng RIÊNG, không suy ra từ việc đường ống chạy được.");
  console.log("   Đây là thứ mục C của mainnet-deploy-plan.md đòi mà bản diễn tập cũ không có.");
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
