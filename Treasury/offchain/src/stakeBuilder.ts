// Apply-param cho `treasury_stake` + dựng ĐỊA CHỈ KHO dạng base (payment + stake).
//
// VÌ SAO Ở ĐÂY chứ không ở `scripts/`: khe `reward_cred` là một `Credential`, tức một
// `Constr`. `applyParamsToScript` chỉ nhận Constr dựng bằng CHÍNH bản lucid của nó — dựng
// ở `scripts/` rồi truyền sang là hai class khác danh tính, và lỗi hiện ra dưới dạng
// "Could not serialize: Unsupported type", không nói gì về nguyên nhân. Cùng lý do đã buộc
// `applyCustodySeed` sống trong `seedBuilder.ts`.
//
// THỨ TỰ KHE viết ở ĐÚNG MỘT NƠI (`treasuryStakeParamList` dưới đây), khớp
// `Treasury/onchain/validators/treasury_stake.ak` ▸ `validator treasury_stake(...)`:
//   [instance_id: ByteArray, reward_cred: Credential, delegation_admin: ByteArray]
//
// ⚠ Cả ba khe nướng vào script hash ⇒ vào phần stake của địa chỉ kho. Sai một khe là một
// địa chỉ kho khác, và kho đã gieo thì không dời được.

import {
  applyParamsToScript, credentialToAddress, scriptHashToCredential, validatorToScriptHash,
  Constr, type Network as LucidNetwork, type Validator,
} from "@lucid-evolution/lucid";

/** `Credential` on-chain: VerificationKey = Constr 0, Script = Constr 1.
 *  Khớp `encodeCredential` ở `datum.ts` — cùng quy ước, hai chỗ dùng khác nhau. */
export type StakeRewardCredential =
  | { kind: "VerificationKey"; hash: string }
  | { kind: "Script"; hash: string };

export interface TreasuryStakeParams {
  /** Muối phân biệt instance. Validator từ chối chuỗi rỗng (`expect instance_id != #""`). */
  instanceId: string;
  /** Đích BẮT BUỘC của thưởng rút ra. Trỏ về chính credential thanh toán của kho ⇒ thưởng
   *  chỉ đi vào kho, và nhánh `StakeRewardIn` là đường duy nhất ghi nó vào sổ. */
  rewardCred: StakeRewardCredential;
  /** Khoá được phép đăng ký/uỷ quyền/huỷ-uỷ-quyền (nhánh `publish`). */
  delegationAdmin: string;
}

function normHex(s: string): string {
  const h = s.toLowerCase();
  if (!/^[0-9a-f]*$/.test(h)) throw new Error(`TSTAKE-001: chuỗi không phải hex: ${s}`);
  if (h.length % 2 !== 0) throw new Error(`TSTAKE-002: hex lẻ byte (${h.length} ký tự): ${s}`);
  return h;
}

/** Danh sách khe apply-param của `treasury_stake` — THỨ TỰ chỉ được viết ở đây. */
export function treasuryStakeParamList(p: TreasuryStakeParams): unknown[] {
  if (normHex(p.instanceId).length === 0) {
    throw new Error(
      "TSTAKE-003: instance_id RỖNG — validator `treasury_stake` từ chối nó ngay dòng đầu " +
      "(`expect instance_id != #\"\"`), nên script apply được mà mọi lần rút thưởng sẽ chết.",
    );
  }
  const credHash = normHex(p.rewardCred.hash);
  if (credHash.length !== 56) {
    throw new Error(`TSTAKE-004: reward_cred.hash phải 28 byte (56 hex), nhận ${credHash.length} ký tự.`);
  }
  const admin = normHex(p.delegationAdmin);
  if (admin.length !== 56) {
    throw new Error(`TSTAKE-005: delegation_admin phải 28 byte (56 hex), nhận ${admin.length} ký tự.`);
  }
  return [
    normHex(p.instanceId),
    new Constr(p.rewardCred.kind === "VerificationKey" ? 0 : 1, [credHash]),
    admin,
  ];
}

/** Apply `treasury_stake` → validator dùng làm STAKE credential của địa chỉ kho. */
export function applyTreasuryStake(compiledCode: string, p: TreasuryStakeParams): Validator {
  return {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode, treasuryStakeParamList(p) as never),
  };
}

export function treasuryStakeHash(stakeScript: Validator): string {
  return validatorToScriptHash(stakeScript);
}

/**
 * ĐỊA CHỈ KHO dạng BASE: payment = hash `custody`, stake = hash `treasury_stake`.
 *
 * Đây là điểm khác then chốt so với địa chỉ enterprise mà đường gieo cũ dựng. Cùng một
 * script hash cho ra HAI địa chỉ khác nhau (có phần stake / không), và `custody.ak` ghim
 * `cust_out.address == cust_in.address` — so ĐỊA CHỈ ĐẦY ĐỦ, kể cả phần stake. Nên gieo
 * vào địa chỉ enterprise là gieo vào một cái kho không bao giờ sinh được thưởng uỷ quyền,
 * và không có cách nào chuyển nó sang base sau đó.
 */
export function custodyBaseAddress(
  network: LucidNetwork, custodyScript: Validator, stakeScript: Validator,
): string {
  return credentialToAddress(
    network,
    scriptHashToCredential(validatorToScriptHash(custodyScript)),
    scriptHashToCredential(validatorToScriptHash(stakeScript)),
  );
}

/** Reward address (địa chỉ nhận thưởng) của phần stake — dùng để tra số thưởng đã tích. */
export function custodyRewardCredential(stakeScript: Validator): StakeRewardCredential {
  return { kind: "Script", hash: validatorToScriptHash(stakeScript) };
}
