// scriptUse — đính kèm script hoặc đọc qua reference script (CIP-33), theo `config.scriptRefs`.

import type { Script, TxBuilder, UTxO } from "@lucid-evolution/lucid";

import { scriptSource, type GovernanceConfig, type ScriptKind } from "./config.js";

function scriptOf(cfg: GovernanceConfig, k: ScriptKind): Script {
  switch (k) {
    case "governance": return cfg.governanceScript;
    case "tally": return cfg.tallyScript;
    case "vote": return cfg.voteScript;
    case "nullifier": return cfg.nullifierPolicy;
    case "tallyNft": return cfg.tallyNftPolicy;
    case "weightParamNft": {
      if (!cfg.weightParamNft) throw new Error("GOV-REF-003: config không có weightParamNft");
      return cfg.weightParamNft.policy;
    }
  }
}

/**
 * Với mỗi (loại, vai): đính kèm script vào `txb`, hoặc — nếu config đã gắn reference script —
 * trả UTxO đó để builder đưa vào `readFrom`. Trả về builder và danh sách reference input phát sinh.
 */
export function useScripts(
  txb: TxBuilder,
  cfg: GovernanceConfig,
  uses: readonly { kind: ScriptKind; role: "mint" | "spend" }[],
): { txb: TxBuilder; refs: UTxO[] } {
  const refs: UTxO[] = [];
  let t = txb;
  for (const u of uses) {
    const src = scriptSource(cfg, u.kind);
    if ("ref" in src) {
      refs.push(src.ref);
    } else {
      const s = scriptOf(cfg, u.kind);
      t = u.role === "mint" ? t.attach.MintingPolicy(s) : t.attach.SpendingValidator(s);
    }
  }
  return { txb: t, refs };
}

/** Gộp reference input, bỏ trùng theo outref (giữ thứ tự xuất hiện đầu). */
export function uniqueRefs(...groups: readonly (readonly UTxO[])[]): UTxO[] {
  const seen = new Set<string>();
  const out: UTxO[] = [];
  for (const g of groups) for (const u of g) {
    const k = `${u.txHash}#${u.outputIndex}`;
    if (!seen.has(k)) { seen.add(k); out.push(u); }
  }
  return out;
}
