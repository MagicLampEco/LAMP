// _distributionScripts.ts — dựng lại hai script Distribution mà `rehydrate()` KHÔNG trả về, và
// chọn UTxO kho canonical. Dùng chung cho `28_beacon_grant_redeem.ts` và
// `30_feeder_accounts.ts`.
//
// VÌ SAO TÁCH RA. Hai runner cùng dựng `claim_account` + `claim_account_nft` từ blueprint rồi
// cùng đối chiếu hash với wiring. Hai bản sao của cùng một phép apply-param là hai chỗ trôi
// riêng: một bản sửa thứ tự tham số, bản kia không, và bản kia ra một địa chỉ khác mà không
// gì đỏ — Cardano không chạy validator lúc TẠO output.
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyParamsToScript, validatorToScriptHash,
  type UTxO, type Validator, type MintingPolicy,
} from "@lucid-evolution/lucid";

import {
  canonicalCommittee, CANONICAL_COMMITTEE_THRESHOLD, MS_PER_EPOCH,
} from "./_canonical_v2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const refKey = (u: { txHash: string; outputIndex: number }) => `${u.txHash}#${u.outputIndex}`;

export interface ClaimScripts {
  accountNft: MintingPolicy;
  accountPid: string;
  claim:      Validator;
  claimHash:  string;
}

/**
 * Dựng `claim_account_nft` [committee, threshold, khoPid] và `claim_account` [committee,
 * threshold, MS_PER_EPOCH, lampPid, tokenName, beaconPid, khoPid, accountPid] từ
 * `Distribution/onchain/plutus.json`. Phía gọi PHẢI đối chiếu kết quả với wiring
 * (`assertClaimScriptsMatch`) trước khi dựng giao dịch.
 */
export async function claimScripts(pkh: string, khoPid: string, lampPid: string,
                                   tokenName: string, beaconPid: string): Promise<ClaimScripts> {
  const p = resolve(__dirname, "../../Distribution/onchain/plutus.json");
  const vs = (JSON.parse(await readFile(p, "utf8")) as {
    validators: { title: string; compiledCode: string; parameters?: unknown[] }[];
  }).validators;
  const find = (title: string) => {
    const v = vs.find((x) => x.title === title);
    if (!v) throw new Error(`Không thấy '${title}' trong Distribution/onchain/plutus.json — chạy 'aiken build'.`);
    if (!Array.isArray(v.parameters)) throw new Error(`APPLY-001: blueprint không khai 'parameters' cho '${title}'.`);
    return v;
  };
  const apply = (title: string, params: unknown[]) => {
    const v = find(title);
    if (v.parameters!.length !== params.length) {
      throw new Error(
        `APPLY-002: '${title}' khai ${v.parameters!.length} tham số, truyền ${params.length}. ` +
        `applyParamsToScript KHÔNG ném khi thiếu — nó trả một script hash KHÁC, im lặng.`,
      );
    }
    return { type: "PlutusV3" as const, script: applyParamsToScript(v.compiledCode, params as never) };
  };

  const committee = canonicalCommittee(pkh);
  const threshold = CANONICAL_COMMITTEE_THRESHOLD;
  const accountNft: MintingPolicy = apply("claim_account_nft.claim_account_nft.mint",
    [committee, threshold, khoPid]);
  const accountPid = validatorToScriptHash(accountNft as Validator);
  const claim: Validator = apply("claim_account.claim_account.spend", [
    committee, threshold, MS_PER_EPOCH, lampPid, tokenName, beaconPid, khoPid, accountPid,
  ]);
  return { accountNft, accountPid, claim, claimHash: validatorToScriptHash(claim) };
}

/** APPLY-003: script dựng lại phải trùng hash đã ghi trong wiring, cả hai. */
export function assertClaimScriptsMatch(cs: ClaimScripts,
                                        wiring: { claimHash: string; accountPid: string }): void {
  if (cs.claimHash !== wiring.claimHash) {
    throw new Error(`APPLY-003: claim_account dựng lại ra hash ${cs.claimHash}, state ghi ${wiring.claimHash}.`);
  }
  if (cs.accountPid !== wiring.accountPid) {
    throw new Error(`APPLY-003: claim_account_nft dựng lại ra pid ${cs.accountPid}, state ghi ${wiring.accountPid}.`);
  }
}

/** UTxO kho canonical = cái mang ĐÚNG 1 NFT "TRSY". Địa chỉ kho công khai, ai cũng đỗ được vào. */
export function pickTreasury(all: UTxO[], khoUnit: string): UTxO {
  const carriers = all.filter((u) => (u.assets[khoUnit] ?? 0n) === 1n);
  if (carriers.length !== 1) {
    throw new Error(
      `TRSY-001: cần ĐÚNG 1 UTxO mang NFT "TRSY" ở địa chỉ kho, đếm ${carriers.length}. ` +
      `Nhiều hơn 1 hoặc 0 ⇒ dừng; gộp bằng 27_refill_treasury.ts trước.`,
    );
  }
  const u = carriers[0]!;
  if (!u.datum) throw new Error(`TRSY-002: UTxO kho ${refKey(u)} không có inline datum.`);
  return u;
}
