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
# ⚠️ `aiken` CHỈ in chẩn đoán khi stdout là một terminal THẬT. Chuyển hướng ra tệp hay đẩy
# qua đường ống đều làm nó câm: 0 byte stdout, mã thoát 1, không một dòng nào nói vì sao.
# Bản trước của tệp này chạy `aiken check >"$LOG/aiken.txt" 2>&1`, nên nhánh 🔴 của nó
# `cat` ra đúng hai dòng "Compiling" — tức cái cổng tự khai là có nhật ký mà thật ra KHÔNG.
# Bộ bọc `run_with_tty.py` cấp một pty nên chẩn đoán đi ra bình thường, và `tee` giữ lại
# bản để lọc. Đo 2026-09-22 trên aiken v1.1.21 + v1.1.23.
#
# Vế `grep '"total"'` của bản trước đọc đầu ra dạng JSON mà `aiken check` KHÔNG in, và nó
# được che bằng `|| true` nên tìm không thấy gì cũng im. Nay lọc theo dòng `Summary` thật.
TTY_RUN="$ROOT/run_with_tty.py"
run_aiken() {  # $1 = nhãn, $2 = tệp log, còn lại = lệnh
  local nhan="$1" log="$2"; shift 2
  if python3 "$TTY_RUN" "$@" 2>&1 | tee "$log" >/dev/null; then
    grep -E 'Summary' "$log" || {
      echo "🔴 $nhan: KHÔNG ĐO ĐƯỢC — mã thoát 0 nhưng không có dòng Summary nào."
      echo "   Đây KHÔNG phải màu xanh: cổng đang nói 'tôi không biết' bằng giọng của 'ổn'."
      cat "$log"; exit 1
    }
  else
    echo "🔴 $nhan THẤT BẠI — toàn văn:"
    cat "$log"
    exit 1
  fi
}

run_aiken "aiken check" "$LOG/aiken.txt" aiken check
run_aiken "aiken build" "$LOG/build.txt" aiken build
echo "blueprint: plutus.json OK"

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
