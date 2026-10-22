import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import cron from "node-cron";
import { Zalo, LoginQRCallbackEventType } from "zca-js";

// Đường dẫn tính theo thư mục chứa bot.js, chạy từ đâu cũng được
const BOT_DIR = import.meta.dirname;
const CONFIG_FILE = path.join(BOT_DIR, "config.json");
const CREDENTIALS_FILE = path.join(BOT_DIR, "credentials.json");
const QR_FILE = path.join(BOT_DIR, "qr.png");
const LOG_DIR = path.join(BOT_DIR, "logs");

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));

// In ra màn hình và ghi thêm vào logs/bot-YYYY-MM.log (mỗi tháng 1 file)
function log(...args) {
    const now = new Date();
    const line = `[${now.toLocaleString("vi-VN", { timeZone: config.timezone })}] ${args.join(" ")}`;
    console.log(line);
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const month = now.toLocaleDateString("sv-SE", { timeZone: config.timezone }).slice(0, 7);
        fs.appendFileSync(path.join(LOG_DIR, `bot-${month}.log`), line + "\n");
    } catch (err) {
        console.log("Không ghi được file log:", err.message);
    }
}

// Ngày đá gần nhất kể từ hôm nay (tính cả hôm nay), theo giờ Việt Nam
// playDay: 0 = Chủ nhật, 1 = thứ 2, 2 = thứ 3, ..., 6 = thứ 7
function nextPlayDate(playDay) {
    const vn = new Date(Date.now() + 7 * 3600 * 1000);
    const daysToAdd = (playDay - vn.getUTCDay() + 7) % 7;
    vn.setUTCDate(vn.getUTCDate() + daysToAdd);
    const dd = String(vn.getUTCDate()).padStart(2, "0");
    const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
}

// Đăng nhập bằng QR lần đầu, lưu cookie để các lần sau không phải quét lại
async function loginByQR() {
    const zalo = new Zalo();
    const api = await zalo.loginQR({}, async (event) => {
        switch (event.type) {
            case LoginQRCallbackEventType.QRCodeGenerated:
                await event.actions.saveToFile(QR_FILE);
                log(`Mở file ${QR_FILE} và quét bằng app Zalo để đăng nhập...`);
                break;
            case LoginQRCallbackEventType.QRCodeExpired:
                log("QR hết hạn, tạo QR mới...");
                event.actions.retry();
                break;
            case LoginQRCallbackEventType.QRCodeDeclined:
                log("Bạn đã từ chối đăng nhập trên điện thoại.");
                break;
            case LoginQRCallbackEventType.GotLoginInfo:
                fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(event.data, null, 2));
                log(`Đã lưu thông tin đăng nhập vào ${CREDENTIALS_FILE}`);
                break;
        }
    });
    if (fs.existsSync(QR_FILE)) fs.unlinkSync(QR_FILE);
    return api;
}

async function loginByCookie() {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
        throw new Error(`Chưa có ${CREDENTIALS_FILE}. Chạy "npm run login" trước.`);
    }
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
    return new Zalo().login(credentials);
}

async function listGroups() {
    const api = await loginByCookie();
    const { gridVerMap } = await api.getAllGroups();
    const groupIds = Object.keys(gridVerMap);
    if (groupIds.length === 0) {
        log("Tài khoản chưa ở trong group nào.");
        return;
    }
    const { gridInfoMap } = await api.getGroupInfo(groupIds);
    for (const id of groupIds) {
        console.log(`${id}  ${gridInfoMap[id]?.name ?? ""}`);
    }
    log('Copy groupId của group cần tạo vote vào config.json');
}

// Bỏ qua khối chưa điền groupId
const polls = config.polls.filter((poll) => poll.groupId);

async function createVote(poll) {
    const api = await loginByCookie();
    const question = poll.titleTemplate.replace("{date}", nextPlayDate(poll.playDay ?? 2));
    await api.createPoll(
        {
            question,
            options: poll.options,
            allowMultiChoices: false,
            allowAddNewOption: false,
            hideVotePreview: false,
            isAnonymous: false,
        },
        poll.groupId,
    );
    log(`Đã tạo vote ở group ${poll.groupId}: "${question}"`);
}

async function runJob(poll) {
    try {
        await createVote(poll);
    } catch (err) {
        log(`Tạo vote ở group ${poll.groupId} thất bại:`, err?.message ?? err);
    }
}

const command = process.argv[2];

switch (command) {
    case "login":
        await loginByQR();
        log('Đăng nhập xong. Tiếp theo chạy "npm run groups".');
        process.exit(0);
    case "groups":
        await listGroups();
        process.exit(0);
    case "now":
        // Tạo vote ngay cho tất cả group, không chờ lịch
        for (const poll of polls) await runJob(poll);
        process.exit(0);
    default:
        // Chỉ cho 1 bot chạy lịch, tránh 2 bản cùng chạy làm tạo vote 2 lần
        net.createServer()
            .on("error", () => {
                log("Bot đã đang chạy rồi (có thể đang chạy ngầm). Thoát để tránh tạo vote 2 lần.");
                process.exit(1);
            })
            .listen(47821, "127.0.0.1");

        if (polls.length === 0) throw new Error('Chưa có group nào có "groupId" trong config.json. Chạy "npm run groups" để lấy.');
        for (const poll of polls) {
            if (!cron.validate(poll.cron)) throw new Error(`Cron không hợp lệ ở group ${poll.groupId}: ${poll.cron}`);
            cron.schedule(poll.cron, () => runJob(poll), { timezone: config.timezone });
            log(`Group ${poll.groupId}: lịch "${poll.cron}"`);
        }
        // Mỗi giờ ghi 1 dòng để biết bot vẫn còn sống
        cron.schedule("0 * * * *", () => log(`Bot vẫn đang chạy (${polls.length} lịch vote)`), { timezone: config.timezone });
        log(`Bot đang chạy (${config.timezone}). Ctrl+C để dừng.`);
}
