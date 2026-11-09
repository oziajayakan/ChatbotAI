import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chatHandler from "./api/chat.js";
import historyHandler from "./api/history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local atau .env jika ada
for (const envFile of [".env.local", ".env"]) {
  const fullPath = path.join(__dirname, envFile);
  if (fs.existsSync(fullPath)) {
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const PORT = process.env.PORT || 3000;

function augmentRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  augmentRes(res);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Parse body untuk POST/PUT/PATCH/DELETE
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    req.body = raw;
    if (raw) {
      try {
        req.body = JSON.parse(raw);
      } catch {}
    }
  }

  if (url.pathname === "/api/chat") {
    return chatHandler(req, res);
  }
  if (url.pathname === "/api/history") {
    return historyHandler(req, res);
  }

  // Serve static files dari public/
  let filePath = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, "public", "index.html");
  }

  try {
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    res.statusCode = 200;
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 NOVA AI Server berjalan di http://localhost:${PORT}`);
});
