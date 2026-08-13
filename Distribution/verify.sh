#!/usr/bin/env bash
# LampDistribution — chạy toàn bộ test (onchain Aiken + offchain vitest).
# Cách dùng: bash Distribution/verify.sh
#
# ⚠️ pipefail BẮT BUỘC. Bản trước chỉ có `set -e` rồi `... | grep | head` / `... | tail`:
# exit code của pipeline là exit code của LỆNH CUỐI (head/tail) — luôn 0 — nên test ĐỎ
# vẫn báo xanh. Đừng bỏ `-o pipefail`, và đừng đưa lệnh test vào giữa một pipeline.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$(mktemp -d)"
trap 'rm -rf "$LOG"' EXIT

echo "════════════════════════════════════════════"
echo "  ONCHAIN — aiken check (lib + validators)"
echo "════════════════════════════════════════════"
cd "$ROOT/onchain"
# Chạy TRƯỚC, giữ nguyên exit code; lọc để in sau. Không nhét test vào giữa pipeline.
if aiken check >"$LOG/aiken.txt" 2>&1; then
  grep -E '"total"|"passed"|"failed"' "$LOG/aiken.txt" | head -3 || true
else
  echo "🔴 aiken check THẤT BẠI (exit $?) — toàn văn:"
  cat "$LOG/aiken.txt"
  exit 1
fi

if aiken build >"$LOG/build.txt" 2>&1; then
  echo "blueprint: plutus.json OK"
else
  echo "🔴 aiken build THẤT BẠI — toàn văn:"
  cat "$LOG/build.txt"
  exit 1
fi

echo
echo "════════════════════════════════════════════"
echo "  OFFCHAIN — vitest (foundation + builders)"
echo "════════════════════════════════════════════"
cd "$ROOT/offchain"
[ -d node_modules ] || npm install --silent --no-audit --no-fund
if npm test >"$LOG/vitest.txt" 2>&1; then
  tail -6 "$LOG/vitest.txt"
else
  echo "🔴 vitest THẤT BẠI — toàn văn:"
  cat "$LOG/vitest.txt"
  exit 1
fi

echo
echo "✅ TẤT CẢ XANH (onchain + offchain)."
