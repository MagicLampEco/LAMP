#!/usr/bin/env bash
# CỔNG PHIÊN BẢN TRÌNH BIÊN DỊCH — chặn được, không phải ghi chú.
#
# VÌ SAO CÓ TỆP NÀY: hash của script Plutus biên dịch ra CHÍNH LÀ địa chỉ trên chuỗi. Đổi
# phiên bản aiken có thể đổi bytecode ⇒ đổi hash ⇒ ra một địa chỉ KHÁC. Nên phiên bản
# compiler là dữ kiện sống-chết, không phải chi tiết môi trường.
#
# ĐO ĐƯỢC (2026-08-27, aiken v1.1.21+42babe5, đã chạy thật, không suy đoán):
#   - `compiler` trong aiken.toml LỆCH với binary  ⇒ aiken chỉ IN CẢNH BÁO rồi exit 0.
#   - `compiler` VẮNG hoàn toàn                     ⇒ aiken IM LẶNG TUYỆT ĐỐI, 0 warning.
#   - Gõ SAI TÊN TRƯỜNG (`compilerr = "v1.1.20"`)   ⇒ aiken IM LẶNG TUYỆT ĐỐI, 0 warning.
#     (ca này nguy hơn ca vắng: nhìn vào file thì tưởng đã ghim, thực ra không ghim gì)
#   - Giá trị không phải semver (`"abc"`)           ⇒ aiken lỗi hẳn, exit 1.
# Ba ca im lặng đầu là lý do tồn tại của tệp này. Aiken KHÔNG chặn; tệp này chặn.
#
# HAI NGUỒN PHẢI KHỚP, và đây là chỗ tinh tế:
#   (1) `aiken --version`                        → "aiken v1.1.21+42babe5"
#   (2) `plutus.json` → preamble.compiler.version → "v1.1.21+42babe5"
# Nguồn (2) là bằng chứng ĐÚNG NHẤT (nó do chính lần build ghi ra), NHƯNG `plutus.json` bị
# .gitignore (dòng 7 và 9) ⇒ bằng chứng đó KHÔNG nằm trong git, và `git status` vẫn sạch khi
# một lần build ghi đè nó. Vì vậy cổng này KHÔNG dựa vào plutus.json để quyết định — nó chỉ
# đối chiếu thêm khi tệp có mặt. Mốc kỳ vọng nằm ở hằng EXPECTED_AIKEN_FULL ngay dưới đây:
# đó là bản chép CÓ NHÃN (giá trị + ngày đo + cách đo lại), và nó NẰM TRONG GIT.
#
# VÌ SAO PHẢI GÁC CẢ HẬU TỐ COMMIT: trường `compiler` của aiken.toml chỉ chịu được semver
# lõi — ghim "v1.1.21+42babe5" vào đó thì chính aiken lại kêu lệch ("demands v1.1.21+42babe5,
# but you are using v1.1.21"). Nên aiken.toml ghim LÕI, còn hậu tố commit được gác ở ĐÚNG MỘT
# chỗ là hằng dưới đây. Bỏ hằng này đi thì hai bản build khác nhau của cùng v1.1.21 sẽ đi lọt.
#
# NÂNG PHIÊN BẢN AIKEN = sửa hằng dưới đây + 9 dòng `compiler` trong các aiken.toml, rồi
# build lại và công bố hash mới. Cổng kêu to là ĐÚNG CHỦ ĐÍCH, không phải phiền toái.
#
# Chạy:  bash Genesis/scripts/verify_toolchain.sh
# Mã thoát: 0 = mọi thứ khớp · 1 = lệch, hoặc thiếu ghim, hoặc KHÔNG ĐO ĐƯỢC.

set -uo pipefail

# ── Mốc kỳ vọng — bản chép CÓ NHÃN ──────────────────────────────────────────────
# Nguồn: `aiken --version` trên máy build, đo 2026-08-27.
# Đối chiếu lại: mọi <Project>/onchain/plutus.json → .preamble.compiler.version
EXPECTED_AIKEN_FULL="v1.1.21+42babe5"
# stdlib PHẢI ghim bằng SHA commit, KHÔNG bằng tag: tag di dời được, SHA thì không.
# stdlib khác ⇒ bytecode khác ⇒ hash khác ⇒ ĐỊA CHỈ KHÁC, y hệt đổi compiler.
EXPECTED_STDLIB_SHA="7d5cee54b2bb4eea211ae3bd806c7c39e5fd899d"
# ────────────────────────────────────────────────────────────────────────────────

# Lõi semver (bỏ hậu tố build "+..."): đây là dạng DUY NHẤT aiken.toml chấp nhận mà không kêu.
EXPECTED_CORE="${EXPECTED_AIKEN_FULL%%+*}"

RED=''; GRN=''; YEL=''; OFF=''
if [ -t 1 ]; then RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'; fi

fail_hard() { printf '%s\n' "${RED}✗ CỔNG ĐỎ:${OFF} $*"; exit 1; }

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

echo "═══ CỔNG PHIÊN BẢN TRÌNH BIÊN DỊCH AIKEN ═══"
echo "Kho:        $REPO_ROOT"
echo "Kỳ vọng:    $EXPECTED_AIKEN_FULL  (lõi ghim vào aiken.toml: $EXPECTED_CORE)"
echo

# ── Trạng thái thứ ba: KHÔNG ĐO ĐƯỢC. Phải kêu TO HƠN trạng thái "lệch". ────────
# Đây là cổng kiểm khẳng định, không phải hook chặn thao tác ⇒ chiều hỏng là FAIL-SAFE.
if ! command -v aiken >/dev/null 2>&1; then
  fail_hard "CỔNG KHÔNG CHẠY ĐƯỢC — không tìm thấy lệnh 'aiken' trên PATH.
           Không có phép đo nào được thực hiện. Đây KHÔNG phải màu xanh."
fi

RAW_VERSION="$(aiken --version 2>&1)"
# Dạng đã đo: "aiken v1.1.21+42babe5"
ACTUAL_FULL="$(printf '%s' "$RAW_VERSION" | awk '{print $NF}')"
case "$ACTUAL_FULL" in
  v[0-9]*) : ;;
  *) fail_hard "CỔNG KHÔNG CHẠY ĐƯỢC — không đọc nổi phiên bản từ 'aiken --version'.
           Nhận về nguyên văn: [$RAW_VERSION]" ;;
esac

echo "aiken --version → $RAW_VERSION"
if [ "$ACTUAL_FULL" != "$EXPECTED_AIKEN_FULL" ]; then
  printf '%s\n' "${RED}  ✗ binary LỆCH mốc kỳ vọng${OFF}"
  echo "     binary thật : $ACTUAL_FULL"
  echo "     mốc kỳ vọng : $EXPECTED_AIKEN_FULL  (hằng EXPECTED_AIKEN_FULL trong chính tệp này)"
  echo "     Hash script build ra bằng binary này có thể KHÁC hash đã công bố."
  exit 1
fi
printf '%s\n' "${GRN}  ✓ binary khớp mốc kỳ vọng (kể cả hậu tố commit)${OFF}"
echo

# ── Quét MỌI project aiken trong kho ────────────────────────────────────────────
# Loại trừ: build/packages/* (đó là thư viện của bên khác, không phải project của kho này)
#           node_modules (không liên quan)
TOMLS="$(cd "$REPO_ROOT" && find . -name aiken.toml \
          -not -path "*/node_modules/*" \
          -not -path "*/build/packages/*" \
        | LC_ALL=C sort)"

COUNT="$(printf '%s\n' "$TOMLS" | grep -c . || true)"
if [ "$COUNT" -eq 0 ]; then
  # Thư mục rỗng cũng phải kêu — "không tìm thấy gì" KHÔNG được đọc thành "mọi thứ ổn".
  fail_hard "CỔNG KHÔNG CHẠY ĐƯỢC — không tìm thấy aiken.toml nào để kiểm.
           Sai đường dẫn kho, hoặc cây nguồn đã bị dời. Đây KHÔNG phải màu xanh."
fi
echo "Tìm thấy $COUNT project aiken (đã loại build/packages, node_modules):"
echo

BAD=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  f="$REPO_ROOT/${rel#./}"

  # Parse TOML top-level: một key chỉ thuộc bảng gốc khi nó đứng TRƯỚC mọi dòng "[...]".
  # Đặt `compiler` sau [[dependencies]] thì aiken KHÔNG đọc nó — bắt luôn ca đó.
  parsed="$(awk '
    BEGIN { intable=0; found=0; misplaced=0; val="" }
    /^[[:space:]]*#/  { next }
    /^[[:space:]]*\[/ { intable=1; next }
    /^[[:space:]]*compiler[[:space:]]*=/ {
      if (intable) { misplaced=1; next }
      line=$0
      sub(/^[^=]*=[[:space:]]*/, "", line)
      gsub(/^"|"[[:space:]]*$|^'"'"'|'"'"'[[:space:]]*$/, "", line)
      sub(/[[:space:]]*#.*$/, "", line)
      val=line; found=1
    }
    END { print found "|" misplaced "|" val }
  ' "$f")"

  found="${parsed%%|*}"; rest="${parsed#*|}"
  misplaced="${rest%%|*}"; val="${rest#*|}"

  if [ "$found" = "0" ] && [ "$misplaced" = "1" ]; then
    printf '%s %s\n' "${RED}✗ ĐẶT SAI CHỖ${OFF}" "$rel"
    echo "     'compiler' nằm DƯỚI một [section] ⇒ aiken KHÔNG đọc nó (im lặng, tưởng đã ghim)."
    echo "     Sửa: chuyển dòng compiler lên trước dòng [[dependencies]] đầu tiên."
    BAD=$((BAD+1)); continue
  fi

  if [ "$found" = "0" ]; then
    # CA B — aiken im lặng tuyệt đối ở ca này. Chính là ca cổng phải bù.
    printf '%s %s\n' "${RED}✗ THIẾU GHIM${OFF}" "$rel"
    echo "     Không có trường 'compiler'. aiken KHÔNG cảnh báo gì ở ca này ⇒ phiên bản"
    echo "     biên dịch hoàn toàn không bị ràng buộc. Thêm: compiler = \"$EXPECTED_CORE\""
    BAD=$((BAD+1)); continue
  fi

  if [ "$val" = "$EXPECTED_CORE" ]; then
    printf '%s %-42s compiler = "%s"\n' "${GRN}✓${OFF}" "$rel" "$val"
  elif [ "$val" = "$EXPECTED_AIKEN_FULL" ]; then
    # Chặt hơn mức cần, nhưng chính aiken lại kêu lệch mỗi lần build ⇒ nhãn riêng, không im.
    printf '%s %-42s compiler = "%s"\n' "${YEL}⚠${OFF}" "$rel" "$val"
    echo "     Ghim cả hậu tố commit. Đúng phiên bản, NHƯNG aiken sẽ in cảnh báo lệch mỗi lần"
    echo "     build (nó so với \"$EXPECTED_CORE\"). Nên đổi về \"$EXPECTED_CORE\"."
  else
    # CA A — aiken chỉ warning rồi exit 0 ở ca này.
    printf '%s %s\n' "${RED}✗ LỆCH${OFF}" "$rel"
    echo "     ghim  : \"$val\""
    echo "     thật  : \"$ACTUAL_FULL\"  (lõi: \"$EXPECTED_CORE\")"
    echo "     aiken chỉ CẢNH BÁO ở ca này rồi exit 0 — bytecode vẫn được sinh ra bằng"
    echo "     binary đang cài, không phải bằng phiên bản đã ghim."
    BAD=$((BAD+1))
  fi
done <<< "$TOMLS"

echo
# ── Đối chiếu phụ: plutus.json (bằng chứng do chính lần build ghi ra) ────────────
# KHÔNG load-bearing: tệp này bị gitignore nên có thể vắng, hoặc cũ. Vắng thì nói là VẮNG,
# không đọc thành "khớp".
if command -v python3 >/dev/null 2>&1; then
  echo "Đối chiếu phụ — preamble trong plutus.json (bị .gitignore, có thể vắng/cũ):"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    pj="$REPO_ROOT/$(dirname "${rel#./}")/plutus.json"
    proj="$(dirname "${rel#./}")"
    if [ ! -f "$pj" ]; then
      printf '  %-32s %s\n' "$proj" "— chưa build, KHÔNG ĐO ĐƯỢC (không phải 'khớp')"
      continue
    fi
    pv="$(python3 -c "
import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(d['preamble']['compiler']['version'])
except Exception as e:
    print('LỖI-ĐỌC:'+type(e).__name__)
" "$pj" 2>/dev/null)"
    if [ "$pv" = "$EXPECTED_AIKEN_FULL" ]; then
      printf '  %-32s %s\n' "$proj" "${GRN}✓${OFF} $pv"
    else
      printf '  %-32s %s\n' "$proj" "${RED}✗ $pv${OFF} (kỳ vọng $EXPECTED_AIKEN_FULL)"
      echo "     Bản build trên đĩa sinh ra bởi binary KHÁC. Build lại rồi công bố lại hash."
      BAD=$((BAD+1))
    fi
  done <<< "$TOMLS"
  echo
else
  echo "${YEL}⚠ Không có python3 ⇒ BỎ QUA đối chiếu plutus.json (không đo được, không phải khớp).${OFF}"
  echo
fi

# ── Gác THƯ VIỆN: aiken.toml và aiken.lock phải cùng ghim đúng MỘT SHA ──────────
echo "Ghim thư viện aiken-lang/stdlib (SHA commit, không phải tag):"
while IFS= read -r t; do
  [ -n "$t" ] || continue
  proj="$(dirname "$t")"
  lock="$proj/aiken.lock"

  # SHA khai trong aiken.toml: dòng version= NGAY SAU name="aiken-lang/stdlib".
  tv="$(cd "$REPO_ROOT" && awk '
    /name[[:space:]]*=[[:space:]]*"aiken-lang\/stdlib"/ { hit=1; next }
    hit && /version[[:space:]]*=/ { gsub(/.*=[[:space:]]*"/,""); gsub(/".*/,""); print; exit }
  ' "$t")"

  if [ -z "$tv" ]; then
    printf '  %-40s %s\n' "$t" "${RED}✗ KHÔNG khai stdlib${OFF}"; BAD=$((BAD+1)); continue
  fi
  if [ "$tv" != "$EXPECTED_STDLIB_SHA" ]; then
    printf '  %-40s %s\n' "$t" "${RED}✗ toml ghim $tv${OFF}"
    echo "     kỳ vọng: $EXPECTED_STDLIB_SHA"
    case "$tv" in v*) echo "     (đây là TAG, không phải SHA — tag di dời được, ghim tag không tái lập được hash.)";; esac
    BAD=$((BAD+1)); continue
  fi

  if [ ! -f "$REPO_ROOT/$lock" ]; then
    printf '  %-40s %s\n' "$t" "${RED}✗ thiếu aiken.lock${OFF}"; BAD=$((BAD+1)); continue
  fi
  # Lock lệch toml = thứ THẬT SỰ tải về khác thứ đang khai. Chỉ soi các dòng version
  # THUỘC stdlib (dòng ngay sau name="aiken-lang/stdlib"), không soi mọi version trong
  # tệp — nếu không, thêm một thư viện thứ hai là cổng báo động giả, mà cổng kêu oan
  # thì người ta tắt nó đi.
  lock_vs="$(cd "$REPO_ROOT" && awk '
    /name[[:space:]]*=[[:space:]]*"aiken-lang\/stdlib"/ { hit=1; next }
    hit && /version[[:space:]]*=/ { gsub(/.*=[[:space:]]*"/,""); gsub(/".*/,""); print; hit=0 }
  ' "$lock")"
  if [ -z "$lock_vs" ]; then
    printf '  %-40s %s\n' "$t" "${RED}✗ aiken.lock KHÔNG khai stdlib${OFF}"; BAD=$((BAD+1)); continue
  fi
  bad_lock="$(printf '%s\n' "$lock_vs" | grep -cv "^${EXPECTED_STDLIB_SHA}$" || true)"
  if [ "$bad_lock" -ne 0 ]; then
    printf '  %-40s %s\n' "$t" "${RED}✗ aiken.lock lệch toml ($bad_lock/$(printf '%s\n' "$lock_vs" | grep -c .) dòng)${OFF}"
    printf '%s\n' "$lock_vs" | grep -v "^${EXPECTED_STDLIB_SHA}$" | sed 's/^/     lock ghim: /'
    echo "     toml ghim: $tv"
    BAD=$((BAD+1)); continue
  fi
  printf '  %-40s %s\n' "$t" "${GRN}✓ toml + lock cùng ${EXPECTED_STDLIB_SHA:0:12}…${OFF}"
done <<< "$TOMLS"
echo

if [ "$BAD" -ne 0 ]; then
  printf '%s\n' "${RED}✗ CỔNG ĐỎ — $BAD chỗ lệch/thiếu ghim trên $COUNT project.${OFF}"
  echo "  Đừng build để deploy cho tới khi xanh: hash sinh ra không tái lập được từ git."
  exit 1
fi

printf '%s\n' "${GRN}✓ CỔNG XANH — $COUNT/$COUNT project ghim đúng $EXPECTED_CORE + stdlib ${EXPECTED_STDLIB_SHA:0:12}…, binary đúng $EXPECTED_AIKEN_FULL.${OFF}"
exit 0
