// Genesis Step 1 — Deploy lazy-mint trên Preview (SUBMIT=false mặc định).
//
// Chạy: npm run deploy            (build tx, in CBOR, KHÔNG gửi chain)
//       SUBMIT=true npm run deploy (gửi thật)
//
// Luồng (3 tầng, tuyến tính — CONTRACT §3):
//   (1) thread_nft policy   = apply(genesis_ref)         — one-shot SUPPLY NFT
//   (2) lamp_mint policy     = apply(thread_policy, SUPPLY, token_name, [auth], 1,
//       meter_pid, meter_nm) — token_name = "tLAMP" (testnet) / "LAMP" (mainnet) theo
//       NETWORK; ReserveDraw gate = spend ReserveMeter NFT (permissionless, KHÔNG chữ ký)
//   (3) supply_state spend   = apply(lamp_policy, thread_policy, token_name) — giữ SupplyState UTxO
//
// Tx A (deploy SupplyState): consume genesis_ref → mint 1 SUPPLY NFT → tạo SupplyState
//   UTxO tại (3) với datum genesisSupplyState() (dist_minted=0, reserve_minted=0, caps).
// Tx B (mint thử DistributionVest): spend SupplyState (Advance) + mint Δ tLAMP
//   (DistributionVest) → recreate SupplyState' (dist_minted += Δ) + trả Δ cho ví deploy.
//   Authority stub = ví deploy (1-of-1 self-test).
//
// SUBMIT=false: in CBOR tx (đã .complete() = đã eval script + cân phí) để kiểm logic,
// KHÔNG submit. Đây là bằng chứng tx hợp lệ on-chain trước khi tốn tADA thật.

import {
  Constr, Data, toUnit,
  credentialToAddress, scriptHashToCredential,
  type MintingPolicy, type Validator, type UTxO,
} from "@lucid-evolution/lucid";
import {
  NETWORK, SUBMIT, TOKEN_NAME, makeLucid, walletPkh,
  rawValidator, applyValidator, applyPolicy, scriptAddress, policyId, scriptHashOf,
  explorerTx,
} from "./config.js";
import { SUPPLY_NAME } from "../offchain/src/constants.js";
import {
  supplyStateToCbor, supplyStateRedeemerToCbor, mintRouteToCbor, threadNftRedeemerToCbor,
} from "../offchain/src/datum.js";
import { genesisSupplyState, applyMint } from "../offchain/src/supplyState.js";

const TEST_MINT_OILDROP = BigInt(process.env.TEST_MINT_OILDROP ?? "100000000"); // 100 tLAMP

function encodeOutputRef(txHash: string, index: number): Constr<Data> {
  // OutputReference = Constr(0, [transaction_id: bytes, output_index: int]).
  return new Constr(0, [txHash, BigInt(index)]);
}

async function main(): Promise<void> {
  console.log("=== Genesis Step 1: Deploy LAZY-MINT (Preview) ===\n");
  console.log(`Network: ${NETWORK}   SUBMIT=${SUBMIT}\n`);

  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  const myAddr = await lucid.wallet().address();
  console.log(`Wallet PKH: ${pkh}`);

  const utxos = await lucid.wallet().getUtxos();
  const balance = utxos.reduce((s, u) => s + (u.assets.lovelace ?? 0n), 0n);
  console.log(`tADA balance: ${balance / 1_000_000n} ADA`);
  if (utxos.length === 0) throw new Error("ví không có UTxO — cần fund tADA từ faucet Preview.");
  if (balance < 10_000_000n) throw new Error("cần ≥ 10 tADA — https://docs.cardano.org/cardano-testnet/tools/faucet");

  // ── genesis_ref = UTxO đầu tiên của ví (one-shot seed) ──────────────
  const seed = utxos[0]!;
  const genesisRef = encodeOutputRef(seed.txHash, seed.outputIndex);
  console.log(`\nGenesis seed UTxO: ${seed.txHash}#${seed.outputIndex}`);

  // ── Tầng 1: thread_nft policy = apply(genesis_ref) ──────────────────
  const threadRaw = await rawValidator("thread_nft.thread_nft.mint");
  const threadPolicy: MintingPolicy = applyPolicy(threadRaw.compiledCode, [genesisRef]);
  const threadPid = policyId(threadPolicy);
  console.log(`(1) thread_nft policy id: ${threadPid}`);

  // ── Tầng 2: lamp_mint policy = apply(thread_pid, SUPPLY, token_name, [pkh], 1, meter_pid, meter_nm) ──
  // token_name = asset name LAMP theo NETWORK (TOKEN_NAME): "tLAMP" testnet / "LAMP" mainnet.
  // Cùng 1 code deploy được cả 2 network mà KHÔNG mint nhầm nhãn; token_name là param ⇒
  // policyId KHÁC nhau giữa tLAMP và LAMP (2 token độc lập, đúng).
  // dist_authority stub MVP = ví deploy (1-of-1 self-test đường DistributionVest).
  // ĐƯỜNG ReserveDraw KHÔNG còn chữ ký: gate = spend ReserveMeter NFT (permissionless).
  // meter_nft_policy/name = ReserveMeter thread NFT (mint one-shot Ở MODULE Reserve trước
  // — EXEC M2). Tx B dưới chỉ test DistributionVest nên không cần meter thật; nhận từ env,
  // mặc định placeholder để harness typecheck. Deploy thật: điền METER_NFT_POLICY/NAME.
  const meterPid = process.env.METER_NFT_POLICY ?? "00".repeat(28);
  const meterNm = process.env.METER_NFT_NAME ?? "4d4554"; // "MET"
  // dist_dest = script hash KHO Distribution treasury. A-DEST: DistributionVest BẮT BUỘC
  // rót toàn bộ LAMP vào đây (authority không mint thẳng về ví). Deploy THẬT: PHẢI điền
  // DIST_DEST = hash treasury thật; placeholder 00*28 chỉ để harness typecheck (KHÔNG mint thật).
  // GUARD (audit TRUNG-2): chặn submit khi chưa set → tránh kẹt LAMP vào Script(00*28) bất khả spend.
  const distDest = process.env.DIST_DEST ?? "00".repeat(28);
  if (SUBMIT && !process.env.DIST_DEST) {
    throw new Error("DIST_DEST chưa set: A-DEST sẽ ép LAMP vào Script(00*28) KẸT vĩnh viễn (no-burn). Set DIST_DEST=hash kho treasury trước khi SUBMIT.");
  }
  const distDestAddr = credentialToAddress(NETWORK, scriptHashToCredential(distDest));
  const tlampRaw = await rawValidator("lamp_mint.lamp_mint.mint");
  const tlampPolicy: MintingPolicy = applyPolicy(tlampRaw.compiledCode, [
    threadPid,            // thread_nft_policy
    SUPPLY_NAME,          // thread_nft_name
    TOKEN_NAME,           // token_name (asset name LAMP: tLAMP testnet / LAMP mainnet)
    [pkh],                // dist_authority (List<ByteArray>)
    1n,                   // auth_threshold
    distDest,             // dist_dest (script hash KHO Distribution treasury)
    meterPid,             // meter_nft_policy (ReserveMeter thread NFT)
    meterNm,              // meter_nft_name
  ]);
  const tlampPid = policyId(tlampPolicy);
  console.log(`(2) lamp_mint policy id: ${tlampPid}  (token_name=${TOKEN_NAME})`);
  console.log(`    ReserveDraw gate = spend ReserveMeter NFT (meter_pid=${meterPid})`);

  // ── Tầng 3: supply_state spend = apply(lamp_pid, thread_pid, token_name) ───────
  // 3 param tuyến tính: lamp_policy (tầng 2, ủy quyền transition) + thread_nft_policy
  // (tầng 1, ghim UTxO spend mang SUPPLY NFT thật — D8-#3) + token_name (khớp lamp_mint
  // để đo Δ LAMP đúng nhãn). Cả ba đã biết tại đây.
  const ssRaw = await rawValidator("supply_state.supply_state.spend");
  const ssScript: Validator = applyValidator(ssRaw.compiledCode, [tlampPid, threadPid, TOKEN_NAME]);
  const ssHash = scriptHashOf(ssScript);
  const ssAddr = scriptAddress(ssScript);
  console.log(`(3) supply_state hash: ${ssHash}`);
  console.log(`    supply_state addr: ${ssAddr}\n`);

  const threadUnit = toUnit(threadPid, SUPPLY_NAME);
  const tlampUnit = toUnit(tlampPid, TOKEN_NAME);

  // ── Tx A: deploy SupplyState (mint thread NFT + tạo SupplyState UTxO) ──
  const s0 = genesisSupplyState();
  console.log("Tx A — deploy SupplyState:");
  console.log(`  SupplyState datum: dist_minted=0 reserve_minted=0 dist_cap=${s0.dist_cap} reserve_cap=${s0.reserve_cap}`);

  const txA = await lucid
    .newTx()
    .collectFrom([seed])                          // consume genesis_ref (one-shot)
    .mintAssets({ [threadUnit]: 1n }, threadNftRedeemerToCbor())
    .attach.MintingPolicy(threadPolicy)
    .pay.ToContract(
      ssAddr,
      { kind: "inline", value: supplyStateToCbor(s0) },
      { lovelace: 2_000_000n, [threadUnit]: 1n },
    )
    .complete();

  console.log(`  ✅ Tx A built (eval OK). CBOR len: ${txA.toCBOR().length}`);
  let supplyUtxo: UTxO | undefined;

  if (SUBMIT) {
    const signedA = await txA.sign.withWallet().complete();
    const hashA = await signedA.submit();
    console.log(`  📤 submitted: ${explorerTx(hashA)}`);
    await lucid.awaitTx(hashA);
    const atScript = await lucid.utxosAt(ssAddr);
    supplyUtxo = atScript.find((u) => (u.assets[threadUnit] ?? 0n) === 1n);
    if (!supplyUtxo) throw new Error("không tìm thấy SupplyState UTxO sau Tx A");
  } else {
    console.log("  (SUBMIT=false → KHÔNG gửi Tx A; bỏ qua Tx B vì chưa có SupplyState on-chain)\n");
  }

  // ── Tx B: mint thử DistributionVest ─────────────────────────────────
  console.log("\nTx B — mint thử DistributionVest:");
  const s1 = applyMint(s0, "DistributionVest", TEST_MINT_OILDROP);
  console.log(`  Δ = ${TEST_MINT_OILDROP} oildrop → dist_minted: 0 → ${s1.dist_minted}`);

  if (SUBMIT && supplyUtxo) {
    const txB = await lucid
      .newTx()
      .collectFrom([supplyUtxo], supplyStateRedeemerToCbor())
      .attach.SpendingValidator(ssScript)
      .mintAssets({ [tlampUnit]: TEST_MINT_OILDROP }, mintRouteToCbor("DistributionVest"))
      .attach.MintingPolicy(tlampPolicy)
      .pay.ToContract(
        ssAddr,
        { kind: "inline", value: supplyStateToCbor(s1) },
        { lovelace: 2_000_000n, [threadUnit]: 1n },
      )
      .pay.ToAddress(distDestAddr, { [tlampUnit]: TEST_MINT_OILDROP })  // A-DEST: LAMP vào KHO, không về ví
      .addSignerKey(pkh)
      .complete();

    console.log(`  ✅ Tx B built (eval OK). CBOR len: ${txB.toCBOR().length}`);
    const signedB = await txB.sign.withWallet().complete();
    const hashB = await signedB.submit();
    console.log(`  📤 submitted: ${explorerTx(hashB)}`);
    await lucid.awaitTx(hashB);
    console.log(`  ✅ Minted ${TEST_MINT_OILDROP} oildrop tLAMP qua DistributionVest`);
  } else {
    console.log("  (SUBMIT=false → cap math đã verify offchain qua applyMint; tx B cần SupplyState on-chain để build)");
  }

  console.log("\n=== Done. Scripts:");
  console.log(JSON.stringify({
    network: NETWORK,
    threadPolicy: threadPid,
    tlampPolicy: tlampPid,
    supplyState: { hash: ssHash, address: ssAddr },
    supplyName: SUPPLY_NAME,
    tokenName: TOKEN_NAME,
  }, null, 2));
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
