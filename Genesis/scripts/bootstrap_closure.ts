// bootstrap_closure.ts — đóng VĨNH VIỄN policy LAMP bản mồi, và diễn tập việc đó trên testnet.
//
//   tsx bootstrap_closure.ts <lệnh> --network <Preprod|Preview|Mainnet> [--confirm-mainnet-closure]
//
//   bootstrap      (chỉ testnet) dựng lại trạng thái mainnet bằng CÙNG mã: đúc thread NFT one-shot,
//                  khởi SupplyState {0,0,cap,cap} ở supply_state, rồi DistributionVest 1.000.000 LAMP
//                  vào kho dist_treasury — đúng hình dạng hai UTxO của tx mainnet `db0610c2…`.
//   close-mint     tx1: đúc nốt dist_cap − dist_minted vào kho (DistributionVest) ⇒ quota cạn.
//   close-lock     tx2: tiêu MỌI UTxO kho mang LAMP → MỘT output ở lock_vault mang toàn bộ LAMP.
//   verify-closed  đọc chuỗi + thử evaluate ba giao dịch phải bị từ chối (không gửi).
//
// Mã on-chain lấy từ `Genesis/bootstrap-closure/onchain` (bản sao nguyên văn 457f312/60f7e3a).
// Mọi lệnh, mọi mạng, đều tái dựng policy-id mainnet từ blueprint đó trước — lệch là dừng.
//
// Bí mật nhận qua biến môi trường (xem config.ts). SUBMIT≠true ⇒ dựng giao dịch, in phí, KHÔNG gửi.
// Mainnet: đòi --confirm-mainnet-closure (cổng ở `_bootstrapClosure.ts`), bootstrap bị cấm hẳn.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Constr, Data, toUnit, validatorToAddress, validatorToScriptHash, mintingPolicyToId,
  type LucidEvolution, type UTxO, type Validator, type MintingPolicy, type TxSignBuilder,
} from "@lucid-evolution/lucid";
import { LAMP_MAINNET } from "../offchain/src/deployed.js";
import {
  parseArgs, assertNetworkAllowed, readFrozenBlueprint, assertFrozenReproducesMainnet, applyFrozen,
  frozenCaps, mintParamsData, mainnetMintParams, supplyStateToCbor, supplyStateFromCbor, closureDelta,
  CLOSURE_TOKEN_NAME, SUPPLY_NFT_NAME, DEAD_METER_POLICY, METER_NAME, BOOTSTRAP_MINT_OIL,
  type MintParams, type SupplyState, type ClosureNetwork,
} from "./_bootstrapClosure.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Cổng: đọc lệnh + chặn Mainnet TRƯỚC khi nạp ví hay gọi mạng ────────────────
const args = parseArgs(process.argv.slice(2));
assertNetworkAllowed(args);
if (process.env.NETWORK && process.env.NETWORK !== args.network) {
  throw new Error(`CLOSE-ARG-004: NETWORK=${process.env.NETWORK} trong môi trường khác --network ${args.network}.`);
}
process.env.NETWORK = args.network;
const cfg = await import("./config.js");
const { SUBMIT, makeLucid, walletPkh, explorerTx } = cfg;

const REDEEMER_UNIT = Data.to(new Constr(0, []));  // MintGenesis / Advance / DistributionVest — cùng Constr 0 []
const RESERVE_DRAW = Data.to(new Constr(1, []));

class DryRunStop extends Error {}

// ── Trạng thái lượt diễn tập (testnet) — tệp gitignored `deployed.*.json` ─────
interface RehearsalState {
  network: ClosureNetwork;
  authorityPkh: string;
  genesisRef: { txHash: string; index: number };
  txs: Record<string, { hash: string; fee: string; size: number }>;
}
const statePath = (n: ClosureNetwork) => resolve(HERE, `deployed.bootstrap-closure.${n.toLowerCase()}.json`);
function loadState(n: ClosureNetwork): RehearsalState | null {
  const p = statePath(n);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as RehearsalState;
}
function saveState(s: RehearsalState): void {
  writeFileSync(statePath(s.network), JSON.stringify(s, null, 2) + "\n");
}

// ── Bộ script theo mạng ───────────────────────────────────────────────────────
interface Scripts {
  params: MintParams;
  lampPolicy: MintingPolicy; lampPid: string; lampUnit: string;
  threadPolicy: MintingPolicy | null; threadUnit: string;
  supplyState: Validator; ssAddr: string;
  kho: Validator; khoAddr: string;
  lockVault: Validator; lockAddr: string;
}

const bp = readFrozenBlueprint();
const mainnetPid = assertFrozenReproducesMainnet(bp, LAMP_MAINNET);
console.log(`▸ Tái dựng: blueprint đóng băng + 8 tham số deployed.ts ⇒ ${mainnetPid} (khớp mainnet)`);
const caps = frozenCaps();

function v3(script: string): Validator { return { type: "PlutusV3", script }; }

function buildScripts(network: ClosureNetwork, authority: string, genesisRef: RehearsalState["genesisRef"] | null): Scripts {
  let threadPolicy: MintingPolicy | null = null;
  let threadPid: string;
  if (network === "Mainnet") {
    threadPid = mainnetMintParams(LAMP_MAINNET).threadNftPolicy;
  } else {
    if (!genesisRef) throw new Error("CLOSE-STATE-010: thiếu genesis_ref — chạy `bootstrap` trước.");
    threadPolicy = v3(applyFrozen(bp, "thread_nft.thread_nft.mint",
      [new Constr(0, [genesisRef.txHash, BigInt(genesisRef.index)])]));
    threadPid = mintingPolicyToId(threadPolicy);
  }
  const kho = v3(applyFrozen(bp, "dist_treasury.dist_treasury.spend", [authority]));
  const params: MintParams = network === "Mainnet" ? mainnetMintParams(LAMP_MAINNET) : {
    threadNftPolicy: threadPid, threadNftName: SUPPLY_NFT_NAME, tokenName: CLOSURE_TOKEN_NAME,
    distAuthority: [authority], authThreshold: 1n, distDest: validatorToScriptHash(kho),
    meterNftPolicy: DEAD_METER_POLICY, meterNftName: METER_NAME,
  };
  const lampPolicy = v3(applyFrozen(bp, "lamp_mint.lamp_mint.mint", mintParamsData(params)));
  const lampPid = mintingPolicyToId(lampPolicy);
  const supplyState = v3(applyFrozen(bp, "supply_state.supply_state.spend", [lampPid, threadPid, params.tokenName]));
  const lockVault = v3(applyFrozen(bp, "lock_vault.lock_vault.spend", []));
  if (network === "Mainnet") {
    // Ba định danh mainnet phải khớp deployed.ts — nếu không, đang nhắm nhầm chỗ.
    const got = { pid: lampPid, ss: validatorToScriptHash(supplyState), kho: validatorToScriptHash(kho) };
    const want = { pid: LAMP_MAINNET.policyId, ss: LAMP_MAINNET.supplyStateHash, kho: LAMP_MAINNET.khoHash };
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(`CLOSE-REBUILD-002: định danh mainnet lệch deployed.ts: ${JSON.stringify(got)}`);
    }
  }
  if (params.distDest !== validatorToScriptHash(kho)) {
    throw new Error(`CLOSE-REBUILD-003: dist_dest ${params.distDest} không phải kho dựng từ authority.`);
  }
  return {
    params, lampPolicy, lampPid, lampUnit: toUnit(lampPid, params.tokenName),
    threadPolicy, threadUnit: toUnit(threadPid, SUPPLY_NFT_NAME),
    supplyState, ssAddr: validatorToAddress(network, supplyState),
    kho, khoAddr: validatorToAddress(network, kho),
    lockVault, lockAddr: validatorToAddress(network, lockVault),
  };
}

// ── Tiện ích chuỗi ────────────────────────────────────────────────────────────
function feeOf(tx: TxSignBuilder): { fee: bigint; size: number } {
  return { fee: tx.toTransaction().body().fee(), size: tx.toCBOR().length / 2 };
}

/** Ký + gửi, sau cổng SUBMIT. Chạy khô ⇒ in phí + CBOR rồi dừng cả lượt. */
async function send(lucid: LucidEvolution, label: string, tx: TxSignBuilder): Promise<{ hash: string; fee: string; size: number }> {
  const { fee, size } = feeOf(tx);
  console.log(`  ${label}: phí ${fee} lovelace (${Number(fee) / 1e6} ADA) · ${size} byte`);
  if (!SUBMIT) {
    console.log(`  SUBMIT≠true → KHÔNG gửi ${label}. CBOR:\n  ${tx.toCBOR()}`);
    throw new DryRunStop();
  }
  const signed = await tx.sign.withWallet().complete();
  const hash = await signed.submit();
  console.log(`  📤 ${label}: ${hash}  ${explorerTx(hash)}`);
  const ok = await lucid.awaitTx(hash, 5_000);
  if (!ok) throw new Error(`CLOSE-WAIT-001: ${label} ${hash} chưa xác nhận.`);
  return { hash, fee: fee.toString(), size };
}

/** Chờ nhà cung cấp lập chỉ mục UTxO mới. Hết giờ ⇒ ném (không đọc được ≠ không có). */
async function waitUtxos(lucid: LucidEvolution, addr: string, pred: (u: UTxO) => boolean, what: string): Promise<UTxO[]> {
  for (let i = 0; i < 60; i++) {
    const us = (await lucid.utxosAt(addr)).filter(pred);
    if (us.length) return us;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`CLOSE-WAIT-002: sau 300 s vẫn không thấy ${what} tại ${addr}.`);
}

/** Đúng MỘT UTxO SupplyState (mang thread NFT). 0 hay ≥2 ⇒ ném. */
async function findSupplyState(lucid: LucidEvolution, s: Scripts): Promise<{ utxo: UTxO; state: SupplyState }> {
  const us = (await lucid.utxosAt(s.ssAddr)).filter((u) => (u.assets[s.threadUnit] ?? 0n) === 1n);
  if (us.length !== 1) throw new Error(`CLOSE-STATE-011: thấy ${us.length} UTxO SupplyState tại ${s.ssAddr}, cần đúng 1.`);
  if (!us[0].datum) throw new Error(`CLOSE-STATE-012: UTxO SupplyState không có datum inline.`);
  return { utxo: us[0], state: supplyStateFromCbor(us[0].datum) };
}

async function bf<T>(path: string): Promise<T | null> {
  const r = await fetch(`${cfg.BLOCKFROST_URL}${path}`, { headers: { project_id: cfg.BLOCKFROST_KEY } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`CLOSE-BF-001: ${path} → HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

// ── Dựng giao dịch — dùng CHUNG cho lượt thật và phép thử âm ───────────────────
function distVestTx(lucid: LucidEvolution, s: Scripts, ss: { utxo: UTxO; state: SupplyState }, qty: bigint, authority: string) {
  const s2: SupplyState = { ...ss.state, distMinted: ss.state.distMinted + qty };
  return lucid.newTx()
    .collectFrom([ss.utxo], REDEEMER_UNIT).attach.SpendingValidator(s.supplyState)
    .mintAssets({ [s.lampUnit]: qty }, REDEEMER_UNIT).attach.MintingPolicy(s.lampPolicy)
    .pay.ToContract(s.ssAddr, { kind: "inline", value: supplyStateToCbor(s2) }, ss.utxo.assets)
    .pay.ToAddress(s.khoAddr, { [s.lampUnit]: qty })   // A-DEST: vào kho, không datum — đúng hình dạng mainnet
    .addSignerKey(authority);
}

function reserveDrawTx(lucid: LucidEvolution, s: Scripts, ss: { utxo: UTxO; state: SupplyState }, qty: bigint, to: string) {
  const s2: SupplyState = { ...ss.state, reserveMinted: ss.state.reserveMinted + qty };
  return lucid.newTx()
    .collectFrom([ss.utxo], REDEEMER_UNIT).attach.SpendingValidator(s.supplyState)
    .mintAssets({ [s.lampUnit]: qty }, RESERVE_DRAW).attach.MintingPolicy(s.lampPolicy)
    .pay.ToContract(s.ssAddr, { kind: "inline", value: supplyStateToCbor(s2) }, ss.utxo.assets)
    .pay.ToAddress(to, { [s.lampUnit]: qty });
}

// ── Lệnh ─────────────────────────────────────────────────────────────────────
async function cmdBootstrap(lucid: LucidEvolution, authority: string): Promise<void> {
  let st = loadState(args.network);
  if (st && st.authorityPkh !== authority) {
    throw new Error(`CLOSE-BOOT-004: tệp trạng thái ghi authority ${st.authorityPkh}, ví đang là ${authority}.`);
  }
  if (st?.txs.bootstrapMint) throw new Error(`CLOSE-BOOT-001: đã mồi xong (${st.txs.bootstrapMint.hash}). Xoá tệp trạng thái nếu muốn dựng lượt mới.`);
  if (!st) {
    const seed = (await lucid.wallet().getUtxos())
      .filter((u) => Object.keys(u.assets).length === 1 && (u.assets.lovelace ?? 0n) >= 5_000_000n)[0];
    if (!seed) throw new Error("CLOSE-BOOT-002: ví không có UTxO thuần ADA ≥ 5 ADA làm genesis_ref.");
    const genesisRef = { txHash: seed.txHash, index: seed.outputIndex };
    const s = buildScripts(args.network, authority, genesisRef);
    console.log(`  genesis_ref ${genesisRef.txHash}#${genesisRef.index}\n  policy ${s.lampPid}\n  supply_state ${s.ssAddr}\n  kho ${s.khoAddr}`);
    const s0: SupplyState = { distMinted: 0n, reserveMinted: 0n, distCap: caps.distCap, reserveCap: caps.reserveCap };
    const txA = await lucid.newTx()
      .collectFrom([seed])
      .mintAssets({ [s.threadUnit]: 1n }, REDEEMER_UNIT).attach.MintingPolicy(s.threadPolicy!)
      .pay.ToContract(s.ssAddr, { kind: "inline", value: supplyStateToCbor(s0) }, { lovelace: 2_000_000n, [s.threadUnit]: 1n })
      .complete();
    st = { network: args.network, authorityPkh: authority, genesisRef, txs: {} };
    if (SUBMIT) saveState(st);   // genesis_ref phải nằm trên đĩa TRƯỚC khi tiêu nó
    st.txs.bootstrapThread = await send(lucid, "bootstrap tx A (thread NFT + SupplyState)", txA);
    saveState(st);
  }
  const s = buildScripts(args.network, st.authorityPkh, st.genesisRef);
  await waitUtxos(lucid, s.ssAddr, (u) => (u.assets[s.threadUnit] ?? 0n) === 1n, "SupplyState");
  const ss = await findSupplyState(lucid, s);
  if (ss.state.distMinted !== 0n) throw new Error(`CLOSE-BOOT-003: SupplyState đã có dist_minted=${ss.state.distMinted}.`);
  const txB = await distVestTx(lucid, s, ss, BOOTSTRAP_MINT_OIL, authority).complete();
  st.txs.bootstrapMint = await send(lucid, "bootstrap tx B (DistributionVest 1.000.000 LAMP → kho)", txB);
  saveState(st);
}

async function cmdCloseMint(lucid: LucidEvolution, s: Scripts, authority: string, st: RehearsalState | null): Promise<void> {
  const ss = await findSupplyState(lucid, s);
  const delta = closureDelta(ss.state, caps);
  console.log(`  SupplyState trước: dist_minted=${ss.state.distMinted} reserve_minted=${ss.state.reserveMinted} dist_cap=${ss.state.distCap}`);
  console.log(`  đúc nốt Δ = ${delta} oildrop (${delta / 1_000_000n} LAMP) → kho ${s.khoAddr}`);
  const tx = await distVestTx(lucid, s, ss, delta, authority).complete();
  const r = await send(lucid, "tx1 close-mint", tx);
  if (st) { st.txs.closeMint = r; saveState(st); }
}

async function cmdCloseLock(lucid: LucidEvolution, s: Scripts, authority: string, st: RehearsalState | null): Promise<void> {
  const ss = await findSupplyState(lucid, s);
  if (ss.state.distMinted !== ss.state.distCap) {
    throw new Error(`CLOSE-LOCK-001: dist_minted=${ss.state.distMinted} ≠ dist_cap — chạy close-mint trước. Khoá kho khi quota còn là khoá một nửa.`);
  }
  const khoUtxos = (await lucid.utxosAt(s.khoAddr)).filter((u) => (u.assets[s.lampUnit] ?? 0n) > 0n);
  const total = khoUtxos.reduce((a, u) => a + u.assets[s.lampUnit], 0n);
  const minted = ss.state.distMinted + ss.state.reserveMinted;
  console.log(`  kho: ${khoUtxos.length} UTxO mang LAMP, tổng ${total} oildrop; SupplyState ghi đã đúc ${minted}`);
  if (total !== minted) {
    throw new Error(`CLOSE-LOCK-002: kho giữ ${total} nhưng đã đúc ${minted} — có LAMP nằm ngoài kho. Dừng: lệnh này chỉ đúng khi mọi LAMP còn trong kho.`);
  }
  const tx = await lucid.newTx()
    .collectFrom(khoUtxos, REDEEMER_UNIT).attach.SpendingValidator(s.kho)
    .pay.ToContract(s.lockAddr, { kind: "inline", value: Data.void() }, { [s.lampUnit]: total })
    .addSignerKey(authority)
    .complete();
  const r = await send(lucid, "tx2 close-lock", tx);
  if (st) { st.txs.closeLock = r; saveState(st); }
}

/**
 * Đường evaluate của NÚT MẠNG (Ogmios qua Blockfrost `/utils/txs/evaluate`, gửi CBOR thô).
 *
 * Vì sao không dùng `evaluateTx` sẵn của provider: đo 2026-09-27 trên Preprod, bản 0.4.34 gửi
 * kèm `additionalUtxoSet` và Ogmios trả `failed to decode payload from base64 or base16` cho MỌI
 * giao dịch — kể cả giao dịch hợp lệ. Một lỗi như thế đọc thành "bị từ chối" thì phép thử âm xanh
 * mà không đo gì. Ở đây chỉ `EvaluationFailure` mới là từ chối; mọi hình dạng khác ⇒ ném lỗi
 * mang mã riêng để `tryEvaluate` xếp vào "không đo được".
 */
//
// Dùng khuôn Ogmios v6 (`?version=6`): khuôn v5 mặc định trả `{"ScriptFailures":{}}` RỖNG khi
// script hỏng (đo cùng ngày) — không nói script nào, không nói vì sao. v6 trả mã 3010 kèm từng
// validator hỏng và `validationError` của máy UPLC.
function useNodeEvaluation(lucid: LucidEvolution): void {
  const provider = lucid.config().provider as unknown as { evaluateTx: (tx: string) => Promise<unknown> };
  const purposes = new Set(["spend", "mint", "publish", "withdraw", "vote", "propose"]);
  provider.evaluateTx = async (tx: string) => {
    const r = await fetch(`${cfg.BLOCKFROST_URL}/utils/txs/evaluate?version=6`, {
      method: "POST", headers: { "Content-Type": "application/cbor", project_id: cfg.BLOCKFROST_KEY }, body: tx,
    });
    const body = await r.text();
    type V6 = {
      result?: { validator: { index: number; purpose: string }; budget: { memory: number; cpu: number } }[];
      error?: { code: number; data?: unknown };
    };
    let j: V6;
    try { j = JSON.parse(body); } catch { throw new Error(`NODE-EVAL-UNREADABLE: HTTP ${r.status} ${body}`); }
    if (j.error?.code === 3010) throw new Error(`NODE-REJECT: ${JSON.stringify(j.error.data)}`);
    if (!Array.isArray(j.result)) throw new Error(`NODE-EVAL-UNREADABLE: HTTP ${r.status} ${body}`);
    return j.result.map((x) => {
      if (!purposes.has(x.validator?.purpose)) throw new Error(`NODE-EVAL-UNREADABLE: purpose lạ ${JSON.stringify(x)}`);
      return { redeemer_tag: x.validator.purpose, redeemer_index: x.validator.index,
        ex_units: { mem: Number(x.budget.memory), steps: Number(x.budget.cpu) } };
    });
  };
}

/** Lời từ chối mang dấu của CHÍNH SCRIPT — cục bộ hoặc nút mạng (mã 3010). Mọi lỗi khác không phải bằng chứng. */
const SCRIPT_REJECTION = /failed script execution|NODE-REJECT: /;

/**
 * Thử dựng + evaluate một giao dịch trên hai đường (UPLC cục bộ, nút mạng). Không ký, không gửi.
 * Ba trạng thái: được chấp nhận (🔴) · bị SCRIPT từ chối (✅) · hỏng vì lý do khác (⚪, không đo được).
 * Chỉ trả true khi CẢ HAI đường là ✅.
 */
async function tryEvaluate(label: string, build: (localUPLCEval: boolean) => Promise<unknown>): Promise<boolean> {
  let rejected = true;
  for (const local of [true, false]) {
    const where = local ? "UPLC cục bộ" : "nút mạng (Ogmios qua Blockfrost)";
    try {
      await build(local);
      console.log(`  🔴 ${label} · ${where}: ĐƯỢC CHẤP NHẬN`);
      rejected = false;
    } catch (e) {
      const msg = String((e as Error)?.message ?? JSON.stringify(e));
      const byScript = SCRIPT_REJECTION.test(msg);
      if (!byScript) rejected = false;
      console.log(`  ${byScript ? "✅" : "⚪"} ${label} · ${where}: ${byScript ? "BỊ SCRIPT TỪ CHỐI" : "KHÔNG ĐO ĐƯỢC (lỗi không phải của script)"} — nguyên văn:\n     ${msg.slice(0, 1500).replace(/\n/g, "\n     ")}`);
    }
  }
  return rejected;
}

async function cmdVerify(lucid: LucidEvolution, s: Scripts, authority: string, walletAddr: string): Promise<boolean> {
  const ss = await findSupplyState(lucid, s);
  const quotaFull = ss.state.distMinted === ss.state.distCap;
  console.log(`  SupplyState: dist_minted=${ss.state.distMinted} dist_cap=${ss.state.distCap} ⇒ dist_minted==dist_cap: ${quotaFull}`);
  console.log(`               reserve_minted=${ss.state.reserveMinted} reserve_cap=${ss.state.reserveCap}`);

  const asset = await bf<{ quantity: string }>(`/assets/${s.lampUnit}`);
  if (!asset) throw new Error(`CLOSE-VERIFY-001: nhà cung cấp không biết asset ${s.lampUnit}.`);
  const supply = BigInt(asset.quantity);
  const names = (await bf<{ asset: string }[]>(`/assets/policy/${s.lampPid}`)) ?? [];
  const holders = (await bf<{ address: string; quantity: string }[]>(`/assets/${s.lampUnit}/addresses?count=100`)) ?? [];
  const atLock = holders.filter((h) => h.address === s.lockAddr).reduce((a, h) => a + BigInt(h.quantity), 0n);
  const elsewhere = holders.filter((h) => h.address !== s.lockAddr);
  console.log(`  tổng cung on-chain (${s.lampUnit}): ${supply}`);
  console.log(`  số asset name dưới policy: ${names.length} (${names.map((n) => n.asset.slice(56)).join(",")})`);
  console.log(`  LAMP ở lock_vault ${s.lockAddr}: ${atLock}`);
  console.log(`  LAMP ở nơi khác: ${elsewhere.length ? elsewhere.map((h) => `${h.address}=${h.quantity}`).join("; ") : "0 (không địa chỉ nào)"}`);
  if (holders.length >= 100) throw new Error("CLOSE-VERIFY-002: ≥100 địa chỉ nắm — trang đầu không phủ hết, không kết luận.");

  console.log("  Phép thử âm (chỉ evaluate, không ký, không gửi):");
  const negVest = await tryEvaluate("DistributionVest 1 oildrop", (l) =>
    distVestTx(lucid, s, ss, 1n, authority).complete({ localUPLCEval: l }));
  const negReserve = await tryEvaluate("ReserveDraw 1 oildrop", (l) =>
    reserveDrawTx(lucid, s, ss, 1n, walletAddr).complete({ localUPLCEval: l }));
  const lockUtxos = (await lucid.utxosAt(s.lockAddr)).filter((u) => (u.assets[s.lampUnit] ?? 0n) > 0n);
  let negLock = false;
  if (!lockUtxos.length) console.log("  ⚪ spend lock_vault: KHÔNG ĐO ĐƯỢC — chưa có UTxO LAMP ở lock_vault.");
  else negLock = await tryEvaluate("spend lock_vault", (l) =>
    lucid.newTx().collectFrom(lockUtxos, REDEEMER_UNIT).attach.SpendingValidator(s.lockVault)
      .pay.ToAddress(walletAddr, { [s.lampUnit]: 1n }).complete({ localUPLCEval: l }));

  const closed = quotaFull && supply === ss.state.distCap && atLock === supply && elsewhere.length === 0 &&
    names.length === 1 && negVest && negReserve && negLock;
  console.log(closed
    ? "  KẾT LUẬN: ĐÃ ĐÓNG — quota cạn, mọi LAMP ở lock_vault, ba phép thử âm đều bị từ chối."
    : "  KẾT LUẬN: CHƯA ĐÓNG — xem các dòng 🔴/⚪/false ở trên.");
  return closed;
}

// ── Chạy ─────────────────────────────────────────────────────────────────────
console.log(`Mạng: ${args.network} · lệnh: ${args.command} · SUBMIT=${SUBMIT}`);
const lucid = await makeLucid();
useNodeEvaluation(lucid);
const walletAddr = await lucid.wallet().address();
const pkh = await walletPkh(lucid);   // Mainnet: WALLET-001 đòi EXPECTED_WALLET_ADDR
console.log(`Ví: ${walletAddr} (pkh ${pkh})`);

let exitCode = 0;
try {
  if (args.command === "bootstrap") {
    await cmdBootstrap(lucid, pkh);
  } else {
    const st = args.network === "Mainnet" ? null : loadState(args.network);
    if (args.network !== "Mainnet" && !st) throw new Error("CLOSE-STATE-013: chưa có tệp trạng thái — chạy `bootstrap` trước.");
    const authority = args.network === "Mainnet" ? mainnetMintParams(LAMP_MAINNET).distAuthority[0] : st!.authorityPkh;
    if (pkh !== authority) {
      throw new Error(`CLOSE-AUTH-001: ví ${pkh} không phải dist_authority ${authority} — không ký được tx1/tx2.`);
    }
    const s = buildScripts(args.network, authority, st?.genesisRef ?? null);
    console.log(`policy ${s.lampPid} · supply_state ${s.ssAddr} · kho ${s.khoAddr} · lock_vault ${s.lockAddr}`);
    if (args.command === "close-mint") await cmdCloseMint(lucid, s, authority, st);
    else if (args.command === "close-lock") await cmdCloseLock(lucid, s, authority, st);
    else exitCode = (await cmdVerify(lucid, s, authority, walletAddr)) ? 0 : 1;
  }
} catch (e) {
  if (!(e instanceof DryRunStop)) throw e;
  console.log("Chạy khô xong (không gửi gì).");
}
process.exit(exitCode);
