import { SYSTEM_PROMPT } from "./system-prompt.js";
import { getSqlite } from "./db.js";

// Vercel Serverless Function (Node.js) — streaming ke browser via SSE + SQLite persistence
export const config = { maxDuration: 60 };

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
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
  } catch (e) {
    return res.status(502).json({ error: "Gagal menghubungi Gemini API." });
  }

  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      detail = (await upstream.json())?.error?.message || "";
    } catch {}
    return res
      .status(upstream.status || 502)
      .json({ error: detail || `Gemini error (${upstream.status})` });
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
