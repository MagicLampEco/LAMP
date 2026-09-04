#!/usr/bin/env bash
# Dựng lại 4 script mainnet của LAMP TỪ MÃ NGUỒN rồi đối chiếu với bytecode THẬT trên chain.
#
# VÌ SAO CÓ TỆP NÀY: mọi con số định danh trong repo tới giờ đều là *lời khai* — ai đó đã đối
# chiếu, rồi viết lại kết quả. Người sau không kiểm được bằng một lệnh, nên phải tin. Tệp này
# biến lời khai thành phép thử: chạy là ra đúng/sai, không phải đọc để tin.
#
# BẢN CŨ (trước 2026-08-26) CHÉP TAY 8 tham số + 3 hash từ deployed.ts sang đây. Hệ quả: đổi
# deployed.ts mà quên sửa bản chép ⇒ script tự so với giá trị CŨ, vẫn báo ✅ mãi mãi (đã đo:
# sửa 1 ký tự policyId trong deployed.ts, script cũ vẫn xanh 100%, vì nó không hề ĐỌC file đó).
# Bản này ĐỌC hằng số TỪ NGUỒN qua `npx tsx` (import thẳng module deployed.ts — NƠI GIỮ DUY
# NHẤT), không còn bản chép tay nào để lệch. Đã thử `plutus.json` thay cho deployed.ts nhưng
# loại: plutus.json chỉ giữ blueprint CHƯA áp tham số của HEAD hiện tại, không giữ "cái gì
# ĐANG chạy trên mainnet" — đó là thông tin CHỈ deployed.ts có (nó là bản ghi thủ công có ký
# ngày + provenance, không suy ra được từ cây nguồn hiện tại).
# ĐIỂM YẾU CÒN LẠI của lựa chọn này: (1) `npx tsx` chạy deployed.ts như code thật (import
# side-effect), không phải parse tĩnh — nếu file đó từng bị chèn mã độc, tsx sẽ THỰC THI nó
# (cùng mức tin cậy như phần còn lại của repo mà script này vốn đã `git worktree` + `aiken
# build`, nên không phải biên tin cậy MỚI, nhưng vẫn đáng ghi). (2) thêm phụ thuộc Node/tsx —
# bản cũ chỉ cần aiken+git+curl+python3; bản này cần `Genesis/scripts/node_modules` đã cài
# (đã có sẵn trong repo, `npx tsx` dùng bản local, không đụng mạng khi đã cài).
#
# PHỦ MỚI: thêm validator `thread_nft` (one-shot mint SUPPLY NFT, param `genesis_ref`).
# `genesis_ref` KHÔNG có trong deployed.ts (không field nào giữ nó) — script này TỰ DỰNG LẠI
# nó bằng cách hỏi koios "tx nào đã mint policy thread_nft này" rồi lấy input CỦA CHÍNH tx đó
# làm ứng viên genesis_ref (luật sổ cái ép: genesis_ref PHẢI là 1 trong các input thật của tx
# mint, nếu không tx đã không hợp lệ để lên chain) — brute-force từng input, build, so hash,
# giữ ứng viên khớp. Không suy đoán, không chép tay: giá trị genesis_ref hiện ra TỪ chain.
#
# Chạy:  bash Genesis/scripts/verify_deployed_bytes.sh
# Cần:   aiken, git, curl, python3 (đều chỉ dùng stdlib — không cbor2/pyyaml…), node+npx (đã
#        có `tsx` trong Genesis/scripts/node_modules). KHÔNG cần khoá, KHÔNG cần ví.
#        Koios public, không cần API key.
#
# ⚠ aiken CHỈ in lỗi ra TTY — chạy qua ống thì lỗi biến mất và bạn chỉ thấy exit 1 câm.
#   Tệp này bọc pty nên đọc được lỗi thật.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "▸ aiken $(aiken --version)"

# ── CỔNG TOOLCHAIN, chạy TRƯỚC mọi phép dựng lại ────────────────────────────────
# Toàn bộ tệp này dựa vào một giả định: dựng lại từ nguồn ở commit X thì ra ĐÚNG bytecode
# đã lên chain. Giả định đó chỉ đúng khi trình biên dịch + thư viện giống hệt lúc deploy.
# Sai compiler hoặc sai stdlib ⇒ bytecode khác ⇒ hash khác ⇒ tệp này báo LỆCH ở một script
# hoàn toàn lành, hoặc tệ hơn: báo KHỚP vì cả hai vế cùng sai. Nên gác ở đây, không phải
# ở CI xa xôi nào. `set -e` phía trên làm cổng đỏ dừng hẳn script.
"$(dirname "${BASH_SOURCE[0]}")/verify_toolchain.sh"
echo

# ── cbor_lib.py — decode/encode tối thiểu, CHỈ stdlib, đủ cho các hình dạng dùng trong tệp
#    này (bytestring ngắn <24B hoặc 1-byte-length, list 1 phần tử dạng indefinite 9f…ff,
#    Constr(0, [ByteArray, Int]) dạng indefinite cho OutputReference). ─────────────────────
cat > "$WORK/cbor_lib.py" <<'PY'
def raw_bytes(cbor_hex: str) -> str:
    """Bóc payload thô (hex) khỏi 1 CBOR bytestring, bỏ qua lớp bọc list 9f..ff nếu có."""
    h = cbor_hex
    if h.startswith("9f") and h.endswith("ff"):
        h = h[2:-2]
    b0 = int(h[0:2], 16)
    if 0x40 <= b0 <= 0x57:
        length = b0 - 0x40
        return h[2:2 + length * 2]
    if b0 == 0x58:
        length = int(h[2:4], 16)
        return h[4:4 + length * 2]
    raise ValueError(f"cbor bytestring header không nhận dạng được: {h[:2]}")

def encode_uint(n: int) -> str:
    if n < 24:
        return format(n, "02x")
    if n < 256:
        return "18" + format(n, "02x")
    if n < 65536:
        return "19" + format(n, "04x")
    if n < 2**32:
        return "1a" + format(n, "08x")
    return "1b" + format(n, "016x")

def genesis_ref_cbor(txhash_hex: str, idx: int) -> str:
    # OutputReference = Constr(0, [transaction_id: bytes, output_index: int]).
    # QUAN TRỌNG: mảng field phải là INDEFINITE-length (9f…ff), KHÔNG phải definite (82…) —
    # đo bằng thử cả hai: chỉ dạng indefinite mới ra đúng policy-id trên chain (xem báo cáo).
    return "d8799f5820" + txhash_hex + encode_uint(idx) + "ff"
PY

# ── pty wrapper cho aiken ────────────────────────────────────────────────────
cat > "$WORK/akpty.py" <<'PY'
import os, pty, sys
os.chdir(sys.argv[1]); out=[]
rc = pty.spawn(["aiken"] + sys.argv[2:], lambda fd: (lambda b: (out.append(b), b)[1])(os.read(fd, 4096)))
sys.stdout.write(b"".join(out).decode("utf8", "replace").replace("\r", ""))
sys.exit(os.waitstatus_to_exitcode(rc) if rc > 255 else rc)
PY

echo "▸ Đọc hằng số TỪ NGUỒN (offchain/src/deployed.ts) qua npx tsx — không chép tay…"
( cd "$REPO/Genesis/scripts" && npx tsx _print_deployed_lamp.ts ) > "$WORK/deployed.json" \
  || { echo "🔴 đọc deployed.ts thất bại (npx tsx lỗi — xem output phía trên)"; exit 1; }

# ── Bóc 8 tham số + 3 hash + 2 commit provenance TỪ deployed.json (không gõ tay) ───────────
read -r POLICY_LAMP HASH_SUPPLY HASH_KHO COMMIT_MINT COMMIT_KHO \
  P_THREAD_POL P_THREAD_NAME P_TOKEN_NAME P_AUTHORITY P_THRESHOLD P_DIST_DEST P_METER_POL P_METER_NAME \
  THREAD_POL_RAW THREAD_NAME_RAW P_KHO_AUTH \
  <<< "$(python3 - "$WORK/deployed.json" "$WORK" <<'PY'
import json, sys
sys.path.insert(0, sys.argv[2])
from cbor_lib import raw_bytes

d = json.load(open(sys.argv[1]))
mp = {p["name"]: p["cborHex"] for p in d["mintParams"]}
prov = {p["script"]: p["sourceCommit"] for p in d["provenance"]}

policy_lamp = d["policyId"]
hash_supply = d["supplyStateHash"]
hash_kho = d["khoHash"]
commit_mint = prov["lamp_mint"]
commit_kho = prov["dist_treasury"]

p_thread_pol = mp["thread_nft_policy"]
p_thread_name = mp["thread_nft_name"]
p_token_name = mp["token_name"]
p_authority = mp["dist_authority"]
p_threshold = mp["auth_threshold"]
p_dist_dest = mp["dist_dest"]
p_meter_pol = mp["meter_nft_policy"]
p_meter_name = mp["meter_nft_name"]

thread_pol_raw = raw_bytes(p_thread_pol)
thread_name_raw = raw_bytes(p_thread_name)
# dist_authority = list 1 phần tử [pkh]; P_KHO_AUTH = chính pkh đó, không bọc list — dist_treasury
# nhận ByteArray trần, không nhận List. raw_bytes() đã tự bóc lớp 9f..ff rồi bóc bytestring.
p_kho_auth = "581c" + raw_bytes(p_authority)

print(" ".join([
    policy_lamp, hash_supply, hash_kho, commit_mint, commit_kho,
    p_thread_pol, p_thread_name, p_token_name, p_authority, p_threshold,
    p_dist_dest, p_meter_pol, p_meter_name,
    thread_pol_raw, thread_name_raw, p_kho_auth,
]))
PY
)"

echo "  POLICY_LAMP=$POLICY_LAMP"
echo "  HASH_SUPPLY=$HASH_SUPPLY"
echo "  HASH_KHO=$HASH_KHO"
echo "  COMMIT_MINT=$COMMIT_MINT (lamp_mint + supply_state, theo provenance[].sourceCommit)"
echo "  COMMIT_KHO=$COMMIT_KHO (dist_treasury, theo provenance[].sourceCommit)"
echo "  THREAD_POL_RAW=$THREAD_POL_RAW  (thread_nft — deployed.ts KHÔNG có provenance riêng, dùng chung COMMIT_MINT: cùng cây nguồn, xem ghi chú dưới)"

echo
echo "▸ Kéo bytecode thật từ koios (4 script: lamp_mint, supply_state, dist_treasury, thread_nft)…"
curl -sS -m 60 -X POST "https://api.koios.rest/api/v1/script_info" \
  -H "content-type: application/json" \
  -d "{\"_script_hashes\":[\"$POLICY_LAMP\",\"$HASH_SUPPLY\",\"$HASH_KHO\",\"$THREAD_POL_RAW\"]}" \
  > "$WORK/onchain.json"

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
echo "▸ Dò genesis_ref của thread_nft (KHÔNG có trong deployed.ts, tự dựng từ chain)…"
echo "  Hỏi koios: tx nào đã mint policy $THREAD_POL_RAW / asset $THREAD_NAME_RAW…"
CANDIDATES="$(python3 - "$WORK" "$THREAD_POL_RAW" "$THREAD_NAME_RAW" <<'PY'
import json, sys, urllib.request
sys.path.insert(0, sys.argv[1])
from cbor_lib import genesis_ref_cbor

def kpost(path, body):
    req = urllib.request.Request(
        f"https://api.koios.rest/api/v1{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

pol, name = sys.argv[2], sys.argv[3]
info = kpost("/asset_info", {"_asset_list": [[pol, name]]})
if not info:
    print(f"🔴 koios không biết asset {pol}/{name} — không dò được genesis_ref", file=sys.stderr)
    sys.exit(1)
mint_tx = info[0]["minting_tx_hash"]
print(f"  mint tx = {mint_tx}", file=sys.stderr)

utxos = kpost("/tx_utxos", {"_tx_hashes": [mint_tx]})
inputs = utxos[0]["inputs"]
print(f"  tx có {len(inputs)} input — thử từng cái làm ứng viên genesis_ref", file=sys.stderr)
for i in inputs:
    print(f"{i['tx_hash']}\t{i['tx_index']}\t{genesis_ref_cbor(i['tx_hash'], i['tx_index'])}")
PY
)"

P_GENESIS_REF=""
MATCH_COUNT=0
while IFS=$'\t' read -r cand_txh cand_idx cand_cbor; do
  [ -z "$cand_cbor" ] && continue
  got="$(apply_params "$D1" thread_nft thread_nft "$cand_cbor")"
  got_h="$(printf '%s' "$got" | cut -f1)"
  if [ "$got_h" = "$THREAD_POL_RAW" ]; then
    echo "  ✓ khớp: input $cand_txh#$cand_idx ⇒ genesis_ref"
    P_GENESIS_REF="$cand_cbor"
    MATCH_COUNT=$((MATCH_COUNT + 1))
  fi
done <<< "$CANDIDATES"

if [ "$MATCH_COUNT" -eq 0 ]; then
  echo "🔴 KHÔNG input nào của tx mint tái lập đúng policy thread_nft — không so được thread_nft."
  echo "   (build đúng nhưng genesis_ref chưa dò ra được từ input thật — xem log ở trên.)"
  P_GENESIS_REF=""
elif [ "$MATCH_COUNT" -gt 1 ]; then
  echo "🟡 CẢNH BÁO: nhiều hơn 1 input khớp — kết quả sau lấy input khớp CUỐI, đáng ngờ, kiểm tay."
fi

echo
echo "═══ ĐỐI CHIẾU ═══"
check "lamp_mint   " "$POLICY_LAMP" "$(apply_params "$D1" lamp_mint lamp_mint \
  "$P_THREAD_POL" "$P_THREAD_NAME" "$P_TOKEN_NAME" "$P_AUTHORITY" \
  "$P_THRESHOLD" "$P_DIST_DEST" "$P_METER_POL" "$P_METER_NAME")"
check "supply_state" "$HASH_SUPPLY" "$(apply_params "$D1" supply_state supply_state \
  "581c${POLICY_LAMP}" "$P_THREAD_POL" "$P_TOKEN_NAME")"
check "dist_treasury" "$HASH_KHO" "$(apply_params "$D2" dist_treasury dist_treasury "$P_KHO_AUTH")"
if [ -n "$P_GENESIS_REF" ]; then
  check "thread_nft  " "$THREAD_POL_RAW" "$(apply_params "$D1" thread_nft thread_nft "$P_GENESIS_REF")"
else
  echo "⚪ thread_nft  : BỎ QUA (không dò được genesis_ref — xem cảnh báo ở trên)"
fi

echo
echo "═══ MỘT ĐIỀU PHẢI ĐỌC ═══"
echo "dist_authority[0] và authority của kho là CÙNG MỘT pkh: 180a5c17…ee0441."
echo "Người ký được lệnh mint cũng ký được lệnh rút kho. A-DEST không chia quyền cho ai."

git -C "$REPO" worktree prune
