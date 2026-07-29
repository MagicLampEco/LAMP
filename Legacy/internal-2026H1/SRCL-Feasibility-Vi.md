# SRCL — Đánh giá tính khả thi + hiệu ứng khi chạy SONG SONG Airdrop

> Bản đánh giá kỹ thuật, 2026-07-10. Trả lời trực tiếp các câu hỏi chủ dự án về việc
> triển khai SRCL (Staking Reward Contribution Launch) cùng lúc với Airdrop-v2.
> Nguồn cơ chế: [`SPEC/SRCL-Spec-Vi.md`](./SRCL-Spec-Vi.md) (bản B). Trạng thái code:
> PR #16 `SRCL/onchain/validators/srcl_stake.ak`, 64/64 test, Tuân duyệt, **chờ merge**.

---

## 0. Kết luận trước

SRCL bản B **khả thi cao**. Validator on-chain đã build và duyệt xong; phần còn lại là
pipeline đo-lường + deploy + tích hợp claim, không phải rủi ro thiết kế. Chạy song song
Airdrop **không xung đột**: hai cơ chế dùng chung tầng nhả LAMP (pool + Merkle SetRoot),
chỉ khác **nguồn entitlement** nạp vào. Câu chuyện "vốn gốc bất khả xâm phạm" là điểm mạnh
marketing + pháp lý mạnh nhất của cả đợt Launch.

---

## 1. SRCL cần những gì để "nhận staking reward NGAY về pool"

Mục đích: mỗi epoch, phần thưởng staking của người tham gia chảy **thẳng về pot** đợt
Launch, không qua tay người vận hành, không đụng vốn gốc. Để đạt điều đó cần 4 mảnh:

| Mảnh | Vai trò | Trạng thái |
|---|---|---|
| **Validator stake-withdraw** (`srcl_stake.ak`) | Nối stake credential → script; ép reward rút ra phải về pot | ✅ PR #16, 64/64 test, chờ merge |
| **Luồng ký-1-lần** (delegate-to-script + uỷ quyền PhoenixKey) | User nối phần ủy thác tới script, uỷ quyền ký các bước sau | ⏳ luồng ký chưa dựng offchain |
| **Pipeline đo reward → entitlement** | Đo ADA-reward mỗi người/epoch → chia LAMP ∝reward → Merkle root → SetRoot | ⏳ chưa dựng (ghi trong body #16) |
| **Tầng nhả LAMP** (pool + claim) | Nhả LAMP theo root, chống double-claim, PhoenixKey ký claim | ✅ tái dùng `srcl_pool.ak` (SetRoot/Claim/Sweep, đã test) |

Điểm mấu chốt: **script chỉ điều khiển phần ủy thác (stake), không điều khiển phần chi
tiêu (payment)**. Mạng Cardano trả reward vào "tài khoản thưởng" gắn stake credential;
script rút khoản đó về pot. Vốn ADA gốc nằm ở phần payment — script không chạm tới được.

---

## 2. "Chỉ cần user ký tham gia một lần" — đúng không?

**Đúng, với bản B.** Người tham gia ký **đúng một giao dịch** để:

1. **Nối phần ủy thác** (stake credential) của ví tới script SRCL của đợt (delegation +
   stake-registration cert trỏ về script hash).
2. **Uỷ quyền cho PhoenixKey** ký các bước claim LAMP sau này.

Sau chữ ký đó:
- Mỗi epoch, mạng tự trả reward vào reward-account của stake credential. Bất kỳ ai (keeper
  permissionless) cũng có thể phát tx rút reward → **ép về pot** (validator chặn mọi hướng
  khác). User **không thao tác gì thêm**.
- Vốn gốc **không chuyển đi đâu**. User vẫn tiêu ADA gốc bình thường bằng khoá payment.

**Luồng ký-1-lần (mô tả):**

```
Bước 1 (user, MỘT chữ ký trên ví Lace/Eternl):
   tx: [stake-registration/delegation cert] trỏ stake_credential → script_hash(SRCL đợt)
       + uỷ quyền PhoenixKey ký claim
   → phần payment KHÔNG đổi; vốn gốc bất động.

Bước 2..N (tự động, không cần user):
   mỗi epoch: keeper phát Withdraw tx
   → validator ép: (Σ out→pot) − (Σ in-từ-pot) ≥ Σ withdrawals   [NET, F1 đã vá]
   → reward về pot, không rẽ đi đâu.

Bước claim (PhoenixKey ký thay user):
   user nhận LAMP ∝reward đã đóng, nhả dần theo lịch đợt.
```

Lưu ý: để **thôi tham gia**, user chỉ cần re-delegate stake credential về pool/khoá của
mình như bình thường — đó là thao tác ví thông thường, không phải "chữ ký SRCL thứ hai".
Validator **cấm hẳn** dereg qua script (F2 đã vá — xem §6).

---

## 3. "Kiểm tra được sẽ nhận bao nhiêu LAMP" — checker công khai

**Khả thi.** Cơ chế tất định (ai cũng tính lại ra cùng kết quả) cho phép dựng checker
read-only: dán địa chỉ / stake address → trả về reward đã đóng góp + LAMP dự kiến.

- Giao diện: `affiso.net/launch/<đợt>` — người dùng dán địa chỉ, xem số liệu.
- Backend: endpoint kiểu `LaunchAPI/src/etd.ts` (ETD đã có `GET /v1/launch/etd/check`).
  SRCL thêm endpoint tương tự (`srcl/check`) — đọc reward-account per stake-cred qua
  Blockfrost/Koios, cộng dồn reward đã đóng, chia LAMP ∝reward theo snapshot đợt.
- Nguyên tắc: checker **chỉ đọc**, KHÔNG đụng LAMP đã mint, KHÔNG ký gì.

Điểm khác ETD: ETD tính ∝stake lịch sử (đã cutoff); SRCL tính ∝**reward đã đóng góp tích
luỹ** — số này tăng dần mỗi epoch tới khi hết `duration_epochs`, nên checker hiển thị cả
"đã đóng tới epoch e" + "dự phóng tới hết đợt".

---

## 4. "Check được mã nguồn validator ON-CHAIN công khai" — đánh giá

**Đạt.** `srcl_stake.ak` là **Aiken / PlutusV3** — mã nguồn cấp cao, không phải chỉ
offchain đóng. Cách công khai + verify:

| Bước | Việc | Bằng chứng |
|---|---|---|
| 1 | Public source | Link GitHub `MagicLampNetwork/LAMP` → `SRCL/onchain/validators/srcl_stake.ak` (sau merge PR #16) |
| 2 | Reproducible build | `aiken build` → `plutus.json` chứa CBOR compiled + `hash` (script hash) |
| 3 | Đối chiếu on-chain | Script hash trong `plutus.json` **khớp** script hash của địa chỉ SRCL trên explorer |
| 4 | Hướng dẫn verify | README đợt: "clone repo tại commit X → `aiken build` → so `hash` với địa chỉ trên cexplorer" |

Nhờ apply-param per-DID (salt `did_hash`): **1 DID = 1 script-hash = 1 reward-account**.
Mỗi người tham gia có script-hash riêng suy ra tất định từ DID + tham số đợt → ai cũng
tái tạo và đối chiếu được, không cần tin AffiSo.

> Đây là điểm bản B thắng bản A (native-margin): bản A phần reward-redirect nằm ở **kinh
> tế pool off-chain** (tin operator giữ đúng margin) — KHÔNG có validator để soi. Bản B
> ép "chỉ reward chuyển, gốc không đụng" **bằng contract công khai**.

---

## 5. Đánh giá KHẢ THI theo 4 trục

Validator đã build (64/64 test), Tuân duyệt, chờ merge → nền kỹ thuật vững.

**(a) Định hướng dài hạn.** Bản B đúng tầm nhìn "co-owner, không mua" + mục tiêu open-SDK.
"Vốn gốc bất khả xâm phạm" ép ON-CHAIN là câu chuyện bền, tái dùng cho mọi đợt sau
(GreenSun, RedBack…). Một cơ chế, nhiều pot.

**(b) First-principles.** Chỉ stake-withdraw script mới enforce "chỉ reward chuyển, gốc
không đụng" bằng hợp đồng. Tách payment/stake credential là bất biến gốc của Cardano —
SRCL dựa thẳng lên đó, không phát minh lại niềm tin.

**(c) Tối ưu.** So bản A: thêm 1 stake validator + ExUnit cao hơn cho Withdraw tx. Đo
reward/epoch phức tạp hơn (reward gộp 1 tài khoản per stake-cred) — đã giải bằng
apply-param per-DID (1 DID = 1 reward-account → đo sạch, không lẫn). Keeper permissionless
→ chi phí crank chia đều, không tập trung.

**(d) User + pháp lý.** Công bằng hơn (∝reward thật, không ∝stake). Pháp lý (SRCL §8):
- Tài sản mã hoá = **tài sản** tại VN (Luật CN Công nghệ số, 01/01/2026).
- Operator bán ADA thu về: **TNDN 20%** trên lãi, **miễn VAT** (TT 32/2026). Bán tài sản
  của chính mình ≠ vận hành sàn.
- LAMP chia = **ghi nhận đóng góp theo việc đã xảy ra**, không phải bán token đổi vốn →
  định vị tiện ích, không phải chứng khoán.
- Geofence theo quy chế từng đợt.

---

## 6. Đánh giá HIỆU ỨNG

**Lực hút:**
- Delegator tham gia mà **không bỏ vốn** — chỉ góp reward tương lai. Rào cản gần 0.
- Câu chuyện "vốn gốc bất khả xâm phạm, ký một lần" mạnh, dễ truyền thông, khác biệt rõ
  với mọi phương thức cũ (vốn khoá ADA hoặc tin operator).
- Cộng hưởng Airdrop: cùng một delegator vừa nhận Airdrop ∝stake, vừa có thể góp reward
  qua SRCL → hai lý do delegate, một luồng định danh PhoenixKey.

**Rủi ro (và trạng thái):**

| Rủi ro | Bản chất | Trạng thái |
|---|---|---|
| **F1 — NET check** | Value check GROSS không NET → pot-money quay vòng giả-thoả, reward chảy về change | ✅ đã vá: ép `(Σ out→pot)−(Σ in-từ-pot) ≥ Σ withdrawals` + test p4/n5 |
| **F2 — dereg bòn deposit** | `publish=True` cho UnRegCert → Conway hoàn stake-deposit vào pool → crank hốt về ví riêng | ✅ đã vá: `UnregisterCredential -> False` (cấm hẳn) |
| **Splitting** | Tách stake để nhân suất | Tự vô hiệu: reward gộp per stake-cred, tách chỉ làm loãng reward, không nhân |
| **Đo reward gộp** | 1 reward-account trộn nhiều nguồn | Giải bằng apply-param per-DID: 1 DID = 1 reward-account = 1 script-hash |

---

## 7. Việc CÒN LẠI để chạy (đường găng SRCL)

1. **Merge PR #16** (`srcl_stake.ak`) — Tuân đã duyệt, chờ anh bấm merge. *[GitHub — cần anh]*
2. **Pipeline đo-reward → entitlement ∝reward → SetRoot:** offchain đo ADA-reward mỗi
   stake-cred/epoch (Blockfrost/Koios) → chia LAMP largest-remainder ∝reward → dựng Merkle
   root → nạp `srcl_pool.ak` SetRoot mỗi epoch.
3. **Deploy Preview + evidence:** script deploy pool + SRCL script, chạy 1 vòng
   ký→withdraw→SetRoot→claim thật, chụp tx làm bằng chứng (như ETD E2E Preview).
4. **PhoenixKey claim integration:** user nhận LAMP nhả dần, PhoenixKey ký claim, chống
   double-claim qua marker.
5. **Freeze param đợt-1 GreenSun:** `pot_lamp=360M`, `duration_epochs=36`, beneficiary=pool
   GST, operator=GreenSun toàn quyền ADA. Chốt trước khi mở đăng ký.
6. **Public source link + hướng dẫn verify hash** (§4) trong README đợt + `affiso.net/launch`.

---

## 8. Song song với Airdrop — không xung đột

| | SRCL | Airdrop-v2 |
|---|---|---|
| Nguồn entitlement | ∝ reward staking đã đóng | ∝ stake đăng ký (delegator) + CS (SPO) |
| Validator on-chain | `srcl_stake.ak` (mới) + `srcl_pool.ak` (nhả) | `airdrop_pool.ak`/`nft`/`marker` (tái dùng) |
| Tầng nhả LAMP | SetRoot + Claim + marker | SetRoot + Claim + marker |
| Định danh + claim | PhoenixKey DID | PhoenixKey DID |
| Đo lường | keeper đo reward on-chain | AffiSo/ProofChat đo stake + D/A/G/R |

Cùng khuôn "1 pot on-chain, nguồn snapshot nạp vào SetRoot". Hai đợt chạy độc lập pot
riêng; chung hạ tầng claim + định danh → không tranh chấp code, chỉ cần deploy pool riêng.

---

*Xem bàn giao triển khai toàn bộ launch: [`HANDOFF-Tuan-Launch-2026-07-10.md`](./HANDOFF-Tuan-Launch-2026-07-10.md).*
