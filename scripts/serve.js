// 本地试用入口：静态文件服务器，每次请求直读磁盘，不做内存缓存。
// 修改代码后浏览器直接刷新即为最新内容（手动热重载），无需重启本进程。
// 用法：npm run serve，地址 http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const PORT = 8080;
const root = process.cwd();
const contentTypes = {
    ".html": "text/html;charset=utf-8",
    ".js": "text/javascript;charset=utf-8",
    ".mjs": "text/javascript;charset=utf-8",
    ".css": "text/css;charset=utf-8",
    ".json": "application/json;charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
    try {
        let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (pathname.endsWith("/")) {
            pathname += "index.html";
        }
        const file = normalize(join(root, pathname));
        // 必须落在 root 目录内（追加分隔符，避免同级的 root-xxx 目录通过校验）
        if (!file.startsWith(root + sep) && file !== root) {
            response.writeHead(403);
            response.end();
            return;
        }
        const data = await readFile(file);
        response.writeHead(200, {
            "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
            // 不缓存：刷新始终取磁盘最新文件
            "Cache-Control": "no-cache",
        });
        response.end(data);
    } catch {
        response.writeHead(404);
        response.end("404 Not Found");
    }
});

server.listen(PORT, () => {
    console.log(`http://localhost:${PORT}/`);
});
