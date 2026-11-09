import { SYSTEM_PROMPT } from "./system-prompt.js";
import { getSqlite } from "./db.js";

// Vercel Serverless Function (Node.js) — streaming ke browser via SSE + SQLite persistence
export const config = { maxDuration: 60 };

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache model yang terakhir sukses + batas waktu tunggu respons awal per model
let workingModel = null;
const CONNECT_TIMEOUT_MS = 12000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY belum diset di Environment Variables Vercel / .env.local." });
  }

  // Body bisa berupa object (auto-parse Vercel) atau string
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const conversationId = body?.conversationId || null;
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-30) : [];
  if (messages.length === 0) {
    return res.status(400).json({ error: "messages kosong" });
  }

  const contents = messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, 8000) }],
    }));

  if (contents.length === 0) {
    return res.status(400).json({ error: "Tidak ada pesan valid untuk dikirim." });
  }

  // Simpan pesan user terakhir ke SQLite jika conversationId disertakan
  let db = null;
  try {
    if (conversationId) {
      db = await getSqlite();
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "user" && lastMsg.content) {
        db.addMessage(conversationId, { role: "user", content: lastMsg.content });
      }
    }
  } catch {
    // Jangan gagalkan chat jika SQLite mengalami kendala I/O
  }

  // Model yang terakhir berhasil dicoba lebih dulu (tetap hangat antar request di instance yang sama)
  const candidateModels = [...new Set([workingModel, DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
  let upstream = null;
  let lastErrorDetail = "";
  let lastStatus = 502;

  for (const modelName of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse`;
    const ac = new AbortController();
    const connectTimer = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 2048 },
        }),
      });

      clearTimeout(connectTimer);

      if (resp.ok && resp.body) {
        upstream = resp;
        workingModel = modelName;
        break;
      }

      lastStatus = resp.status || 502;
      try {
        lastErrorDetail = (await resp.json())?.error?.message || "";
      } catch {}

      // Retry / lanjut ke model fallback jika model deprecated (404), rate-limited (429), atau server sibuk / high demand (500, 502, 503, 504)
      const isRetryable =
        [404, 429, 500, 502, 503, 504].includes(resp.status) ||
        /no longer available|high demand|overloaded|unavailable|resource exhausted|try again/i.test(lastErrorDetail);

      if (!isRetryable) {
        break;
      }

      // Jeda singkat sebelum beralih ke model cadangan berikutnya
      await sleep(250);
    } catch {
      clearTimeout(connectTimer);
      lastErrorDetail = "Gagal menghubungi Gemini API (timeout atau koneksi putus).";
      if (workingModel === modelName) workingModel = null;
      await sleep(250);
    }
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    return res
      .status(lastStatus)
      .json({ error: lastErrorDetail || `Gemini error (${lastStatus})` });
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });

  // Parse SSE dari Gemini, kirim teks polos ke client
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullReply = "";

  const processLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return;
    const json = line.slice(5).trim();
    if (!json || json === "[DONE]") return;
    try {
      const parts = JSON.parse(json)?.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.text) {
          fullReply += p.text;
          res.write(p.text);
        }
      }
    } catch {
      /* abaikan chunk tidak lengkap */
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        processLine(line);
      }
    }
    // Flush sisa buffer terakhir jika tidak diakhiri newline
    buffer += decoder.decode();
    if (buffer.trim()) {
      processLine(buffer);
    }
  } catch (e) {
    res.write("\n\n⚠️ Koneksi terputus.");
  }

  // Simpan balasan AI ke SQLite
  try {
    if (db && conversationId && fullReply.trim()) {
      db.addMessage(conversationId, { role: "assistant", content: fullReply });
    }
  } catch {}

  res.end();
}
