// Cài / gỡ bot thành Windows Service tên "bot vote" (cần quyền admin)
// node service.js install | uninstall
import path from "node:path";
import nodeWindows from "node-windows";

const svc = new nodeWindows.Service({
    name: "bot vote",
    description: "Bot tạo vote hàng tuần trong group Zalo",
    script: path.join(import.meta.dirname, "bot.js"),
    workingDirectory: import.meta.dirname,
});

svc.on("install", () => {
    console.log('Đã cài service "bot vote", đang khởi động...');
    svc.start();
});
svc.on("alreadyinstalled", () => console.log('Service "bot vote" đã được cài từ trước.'));
svc.on("start", () => console.log('Service "bot vote" đã chạy.'));
svc.on("uninstall", () => console.log('Đã gỡ service "bot vote".'));
svc.on("error", (err) => console.log("Lỗi:", err));

if (process.argv[2] === "uninstall") svc.uninstall();
else svc.install();
