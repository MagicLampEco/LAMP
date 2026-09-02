// Genesis/scripts/_print_deployed_lamp.ts — in JSON của LAMP_MAINNET ra stdout.
//
// VÌ SAO CÓ TỆP NÀY: verify_deployed_bytes.sh là bash, bash không import được module
// TypeScript. Trước đây người viết CHÉP TAY 8 tham số + 3 hash từ deployed.ts sang bash
// — hệ quả: đổi deployed.ts mà quên sửa script thì script tự so với giá trị CŨ, vẫn xanh.
// Tệp này là cầu nối: import trực tiếp `LAMP_MAINNET` (NƠI GIỮ DUY NHẤT), in JSON, để bash
// đọc lại bằng `python3 -c "import json..."`. Không chép giá trị — chỉ chuyển định dạng.
//
// Chạy: npx tsx Genesis/scripts/_print_deployed_lamp.ts
import { LAMP_MAINNET } from "../offchain/src/deployed.js";

process.stdout.write(JSON.stringify(LAMP_MAINNET));
