// Genesis/scripts/01_genesis_4pots.ts — dựng genesis tx 4-POT trên Preview.
//
// Chạy:  SUBMIT=false npx tsx 01_genesis_4pots.ts   (mặc định build-only; anh chạy live)
//        SUBMIT=true  npx tsx 01_genesis_4pots.ts   (submit thật — chỉ sau khi anh audit)
//
// Trong 1 tx (mô hình trung thực thay "mint hết 1 pool phẳng"):
//   - genesis_mint (one-shot, param genesis_ref) mint ĐÚNG 36e15 oil tLAMP.
//   - 4 × genesis_pot (one-shot, param genesis_ref + pot_tag + custody_hash) mint 4 NFT pot,
//     mỗi pot 1 hash riêng (pot_tag khác → policy hash khác → tách thật).
//   - 4 custody output: Distribution 34.2 tỷ, Reserve 1.8 tỷ, Treasury 0, Deposits 0
//     (+ NFT pot + reserved min-ADA), inline CustodyDatum khớp seed invariant.
//
// LƯU Ý mô hình: custody SPEND validator thật là Treasury `custody` (module riêng). Ở build
// artifact self-contained này, mỗi pot nhận về ĐỊA CHỈ = hash genesis_pot tương ứng (4 hash
// phân biệt) để chứng minh tách-pot + dựng tx hợp lệ. Tích hợp live thay bằng địa chỉ Treasury
// custody (cùng schema CustodyDatum nên byte-perfect). Genesis_pot ép seed_datum_ok đúng.

import { Constr, Data, mintingPolicyToId } from "@lucid-evolution/lucid";
import {
  NETWORK, SUBMIT, makeLucid, walletPkh, loadBlueprint, findValidator, applied,
  scriptHash, explorerTx,
} from "./config.js";
import {
  buildGenesisTx, type PotCustody,
  POT_ID, type PotName, TLAMP_ASSET_NAME, TOTAL_SUPPLY_OIL,
} from "../offchain/src/index.js";

const POTS: PotName[] = ["Distribution", "Reserve", "Treasury", "Deposits"];
const RESERVED_MIN_ADA = 2_000_000n;

/** OutputReference param shape cho applyParamsToScript: Constr(0,[txHash, idx]). */
function outRefParam(txHash: string, index: number): Data {
  return new Constr(0, [txHash, BigInt(index)]);
}

async function main(): Promise<void> {
  console.log("=== Genesis 4-POT (Preview) ===\n");
  const lucid = await makeLucid();
  const pkh = await walletPkh(lucid);
  console.log(`Network: ${NETWORK}`);
  console.log(`Ví:      ${pkh}`);
  console.log(`SUBMIT:  ${SUBMIT} (false = chỉ build)\n`);

  // ── chọn genesis UTxO (one-shot anchor) ─────────────────────────────────
  const utxos = await lucid.wallet().getUtxos();
  if (utxos.length === 0) throw new Error("ví không có UTxO — nạp tADA từ faucet Preview trước.");
  const genesisUtxo = utxos[0]!;
  const gRef = { txHash: genesisUtxo.txHash, outputIndex: genesisUtxo.outputIndex };
  console.log(`Genesis ref: ${gRef.txHash}#${gRef.outputIndex}\n`);

  const bp = await loadBlueprint();
  const mintCode = findValidator(bp, "genesis_mint.genesis_mint.mint").compiledCode;
  const potCode  = findValidator(bp, "genesis_pot.genesis_pot.mint").compiledCode;

  // ── genesis_mint: mint A oil tLAMP ──────────────────────────────────────
  const genesisPolicy = applied(mintCode, [
    outRefParam(gRef.txHash, gRef.outputIndex),
    TLAMP_ASSET_NAME,
    TOTAL_SUPPLY_OIL,
  ]);

  // ── 4 × genesis_pot (mỗi pot 1 hash riêng) ──────────────────────────────
  // Áp 2 lần: lần 1 lấy script hash của chính genesis_pot (= custody address pot),
  // dùng nó làm custody_script_hash để seed check trỏ đúng địa chỉ → 1 hash ổn định.
  const custodies: PotCustody[] = POTS.map((pot) => {
    const tag = POT_ID[pot];
    // bước 1: custody_script_hash = #"" (placeholder) chỉ để derive hash sơ bộ — KHÔNG
    //         dùng. Thực tế tách-hash đến từ pot_tag (khác nhau mỗi pot) nên hash đã phân
    //         biệt; custody_script_hash trỏ về CHÍNH địa chỉ nhận (self-referential):
    const probe = applied(potCode, [outRefParam(gRef.txHash, gRef.outputIndex), "", tag]);
    const selfHash = scriptHash(probe);
    const script = applied(potCode, [outRefParam(gRef.txHash, gRef.outputIndex), selfHash, tag]);
    return { pot, script, minAda: RESERVED_MIN_ADA };
  });

  for (const c of custodies) {
    console.log(`  pot ${c.pot.padEnd(13)} hash ${scriptHash(c.script)}`);
  }
  console.log();

  // tLAMP policy = id của genesisPolicy (one-shot mint phát tLAMP).
  const tlampPolicyId = mintingPolicyToId(genesisPolicy);

  // ── dựng genesis tx (builder tự kiểm Σ==A + seed mỗi pot) ────────────────
  const res = await buildGenesisTx({
    lucid, network: NETWORK,
    genesisPolicy,
    mintRedeemer: Data.to(new Constr(0, [])), // MintSupply / SeedPot Constr 0
    custodies,
    tlamp: { policy: tlampPolicyId, name: TLAMP_ASSET_NAME },
    governanceRef: pkh,            // MVP: ví deploy làm governance ref (DAO thật sau)
    cutBps: 0n,                    // genesis chưa thu phí
    epoch: 0n,
    reservedMinAda: RESERVED_MIN_ADA,
  });

  console.log(res.summary);
  console.log();

  const complete = res.tx;
  if (SUBMIT) {
    const signed = await complete.sign.withWallet().complete();
    const txHash = await signed.submit();
    console.log(`✅ Submitted: ${txHash}`);
    console.log(`   Explorer:  ${explorerTx(txHash)}`);
  } else {
    const built = await complete.toCBOR?.() ?? "(tx đã build)";
    console.log("✅ Build-only (SUBMIT=false). Tx CBOR length:", built.length);
    console.log("   Bật SUBMIT=true để submit live sau khi audit.");
  }
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); });
