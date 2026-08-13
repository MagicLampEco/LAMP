#!/usr/bin/env bash
# Dựng lại 3 script mainnet của LAMP TỪ MÃ NGUỒN rồi đối chiếu với bytecode THẬT trên chain.
#
# VÌ SAO CÓ TỆP NÀY: mọi con số định danh trong repo tới giờ đều là *lời khai* — ai đó đã đối
# chiếu, rồi viết lại kết quả. Người sau không kiểm được bằng một lệnh, nên phải tin. Tệp này
# biến lời khai thành phép thử: chạy là ra đúng/sai, không phải đọc để tin.
#
# Chạy:  bash Genesis/scripts/verify_deployed_bytes.sh
# Cần:   aiken (đã thử với v1.1.21), git, curl, python3. KHÔNG cần khoá, KHÔNG cần ví.
#        Koios public, không cần API key.
#
# ⚠ aiken CHỈ in lỗi ra TTY — chạy qua ống thì lỗi biến mất và bạn chỉ thấy exit 1 câm.
#   Tệp này bọc pty nên đọc được lỗi thật.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Sự thật cần đối chiếu ────────────────────────────────────────────────────
POLICY_LAMP="55d3e01bb6c469e02665e4b6573ce65bbaf7a50ad2024e247eb180f0"
HASH_SUPPLY="84f6d84f64468d0b201171ec10c22fd1124ec3fd803e853697b34084"
HASH_KHO="d5e80c9a5a885f56b36d915b4353c2e9e6797b38455d11d0014edbb6"
COMMIT_MINT="457f312"   # lamp_mint + supply_state
COMMIT_KHO="60f7e3a"    # dist_treasury (chưa tồn tại ở 457f312)

# 8 tham số, ĐÚNG thứ tự apply-param. Nguồn: đọc ngược bytecode trên chain (xem deployed.ts).
P_THREAD_POL="581c97213f2442271e01410abd26e0737982cf7d6b9b05e1ccddf0ae77f0"
P_THREAD_NAME="46535550504c59"                 # "SUPPLY"
P_TOKEN_NAME="444c414d50"                      # "LAMP"
P_AUTHORITY="9f581c180a5c176e47bd16c5ed63281f3fc5f4350f5b6a8f15271509ee0441ff"
P_THRESHOLD="01"
P_DIST_DEST="581c${HASH_KHO}"
P_METER_POL="581c00000000000000000000000000000000000000000000000000000000"
P_METER_NAME="434d4554"                        # "MET"
P_KHO_AUTH="581c180a5c176e47bd16c5ed63281f3fc5f4350f5b6a8f15271509ee0441"

echo "▸ Kéo bytecode thật từ koios…"
curl -sS -m 60 -X POST "https://api.koios.rest/api/v1/script_info" \
  -H "content-type: application/json" \
  -d "{\"_script_hashes\":[\"$POLICY_LAMP\",\"$HASH_SUPPLY\",\"$HASH_KHO\"]}" \
  > "$WORK/onchain.json"

# ── pty wrapper cho aiken ────────────────────────────────────────────────────
cat > "$WORK/akpty.py" <<'PY'
import os, pty, sys
os.chdir(sys.argv[1]); out=[]
rc = pty.spawn(["aiken"] + sys.argv[2:], lambda fd: (lambda b: (out.append(b), b)[1])(os.read(fd, 4096)))
sys.stdout.write(b"".join(out).decode("utf8", "replace").replace("\r", ""))
sys.exit(os.waitstatus_to_exitcode(rc) if rc > 255 else rc)
PY

build_at() {  # $1 = commit → in ra đường dẫn project đã build
  # NB: tách 2 dòng — `local a=$1 b="$a"` KHÔNG chạy, bash khai triển mọi đối số của builtin
  # `local` TRƯỚC khi gán, nên `$a` còn rỗng (và `set -u` bắt ngay).
  local c=$1
  local d="$WORK/src-$c"
  git -C "$REPO" worktree add --detach -q "$d" "$c"
  [ -d "$REPO/Genesis/onchain/build/packages" ] && cp -R "$REPO/Genesis/onchain/build" "$d/Genesis/onchain/" 2>/dev/null || true
  python3 "$WORK/akpty.py" "$d/Genesis/onchain" build >"$WORK/build-$c.log" 2>&1 \
    || { echo "🔴 build $c THẤT BẠI:"; cat "$WORK/build-$c.log"; exit 1; }
  echo "$d/Genesis/onchain"
}

apply_params() {  # $1=dir $2=module $3=validator $4..=params → in "hash<TAB>cbor"
  local d=$1
  local m=$2
  local v=$3
  shift 3
  cp "$d/plutus.json" "$WORK/bp.json"
  for p in "$@"; do
    ( cd "$d" && aiken blueprint apply -i "$WORK/bp.json" -o "$WORK/bp2.json" -m "$m" -v "$v" "$p" ) >/dev/null 2>&1 \
      || { echo "🔴 apply tham số thất bại: $p" >&2; exit 1; }
    mv "$WORK/bp2.json" "$WORK/bp.json"
  done
  python3 - "$WORK/bp.json" "$m.$v" <<'PY'
import json, sys
b = json.load(open(sys.argv[1]))
for v in b["validators"]:
    if v["title"].startswith(sys.argv[2]):
        print(v["hash"] + "\t" + v["compiledCode"]); break
PY
}

check() {  # $1=tên $2=hash mong đợi $3=hash+cbor thực tế
  local name=$1
  local want=$2
  local got_h
  local got_c
  got_h="$(printf '%s' "$3" | cut -f1)"; got_c="$(printf '%s' "$3" | cut -f2)"
  if [ "$got_h" != "$want" ]; then
    echo "🔴 $name: HASH LỆCH"; echo "   mong đợi: $want"; echo "   dựng ra : $got_h"; return 1
  fi
  python3 - "$WORK/onchain.json" "$want" "$got_c" "$name" <<'PY'
import json, sys
on = {s["script_hash"]: s.get("bytes") for s in json.load(open(sys.argv[1]))}
want, got, name = sys.argv[2], sys.argv[3].lower(), sys.argv[4]
b = on.get(want)
if not b:
    print(f"🟡 {name}: hash KHỚP, nhưng chain chưa có bytecode để so byte")
    print("   (trên Cardano byte của script chỉ lên chain khi nó được DÙNG — tức script này")
    print("    chưa từng bị tiêu lần nào.)")
else:
    ok = b.lower() == got
    print(f"{'✅' if ok else '🔴'} {name}: hash KHỚP · byte {'KHỚP' if ok else 'LỆCH'} "
          f"({len(b)//2} byte on-chain vs {len(got)//2} byte dựng lại)")
    sys.exit(0 if ok else 1)
PY
}

echo "▸ Dựng lại từ $COMMIT_MINT…"
D1="$(build_at "$COMMIT_MINT")"
echo "▸ Dựng lại từ $COMMIT_KHO…"
D2="$(build_at "$COMMIT_KHO")"

echo
echo "═══ ĐỐI CHIẾU ═══"
check "lamp_mint   " "$POLICY_LAMP" "$(apply_params "$D1" lamp_mint lamp_mint \
  "$P_THREAD_POL" "$P_THREAD_NAME" "$P_TOKEN_NAME" "$P_AUTHORITY" \
  "$P_THRESHOLD" "$P_DIST_DEST" "$P_METER_POL" "$P_METER_NAME")"
check "supply_state" "$HASH_SUPPLY" "$(apply_params "$D1" supply_state supply_state \
  "581c${POLICY_LAMP}" "$P_THREAD_POL" "$P_TOKEN_NAME")"
check "dist_treasury" "$HASH_KHO" "$(apply_params "$D2" dist_treasury dist_treasury "$P_KHO_AUTH")"

echo
echo "═══ MỘT ĐIỀU PHẢI ĐỌC ═══"
echo "dist_authority[0] và authority của kho là CÙNG MỘT pkh: 180a5c17…ee0441."
echo "Người ký được lệnh mint cũng ký được lệnh rút kho. A-DEST không chia quyền cho ai."

git -C "$REPO" worktree prune
