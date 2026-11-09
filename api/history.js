import { getSqlite } from "./db.js";

/**
 * Endpoint CRUD SQLite untuk Riwayat Chatbot AI
 * Mendukung operasi:
 * - GET    /api/history              -> Ambil daftar semua percakapan (READ)
 * - GET    /api/history?id=<conv_id> -> Ambil detail 1 percakapan beserta pesan-pesannya (READ)
 * - POST   /api/history              -> Buat percakapan baru atau simpan pesan baru (CREATE)
 * - PUT    /api/history              -> Ubah judul percakapan atau isi pesan (UPDATE)
 * - DELETE /api/history?id=<conv_id> -> Hapus 1 percakapan / pesan / semua riwayat (DELETE)
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  let db;
  try {
    db = await getSqlite();
  } catch (e) {
    return res.status(500).json({ error: "Gagal menginisialisasi database SQLite: " + e.message });
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const id = url.searchParams.get("id") || req.query?.id;
  const messageId = url.searchParams.get("messageId") || req.query?.messageId;
  const clearAll = url.searchParams.get("all") || req.query?.all;

  let body = req.body;
  if (typeof body === "string" && body.trim()) {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  } else if (!body || typeof body !== "object") {
    body = {};
  }

  try {
    // 1. READ (GET)
    if (req.method === "GET") {
      if (id) {
        const conv = db.getConversation(id);
        if (!conv) {
          return res.status(404).json({ error: "Percakapan tidak ditemukan." });
        }
        return res.status(200).json({ engine: db.engine, conversation: conv });
      }
      const conversations = db.listConversations();
      return res.status(200).json({ engine: db.engine, conversations });
    }

    // 2. CREATE (POST)
    if (req.method === "POST") {
      const { action, conversationId, title, role, content, messages } = body;

      // Tambah 1 pesan ke percakapan
      if (action === "add_message" || (conversationId && role && typeof content === "string")) {
        const msg = db.addMessage(conversationId, { role, content });
        const conv = db.getConversation(conversationId);
        return res.status(201).json({ engine: db.engine, message: msg, conversation: conv });
      }

      // Sinkronisasi / buat percakapan beserta array messages
      const conv = db.createConversation({ id: conversationId || body.id, title: title || "Percakapan Baru" });
      if (Array.isArray(messages) && messages.length > 0) {
        for (const m of messages) {
          if (m && m.role && typeof m.content === "string") {
            db.addMessage(conv.id, { role: m.role, content: m.content });
          }
        }
      }
      const updated = db.getConversation(conv.id);
      return res.status(201).json({ engine: db.engine, conversation: updated });
    }

    // 3. UPDATE (PUT / PATCH)
    if (req.method === "PUT" || req.method === "PATCH") {
      const targetMsgId = messageId || body.messageId;
      if (targetMsgId) {
        if (typeof body.content !== "string" || !body.content.trim()) {
          return res.status(400).json({ error: "Konten pesan baru tidak boleh kosong." });
        }
        const ok = db.updateMessage(targetMsgId, { content: body.content.trim() });
        if (!ok) return res.status(404).json({ error: "Pesan tidak ditemukan." });
        return res.status(200).json({ engine: db.engine, updated: true, messageId: Number(targetMsgId) });
      }

      const targetId = id || body.id || body.conversationId;
      if (!targetId || typeof body.title !== "string" || !body.title.trim()) {
        return res.status(400).json({ error: "ID percakapan dan title baru wajib diisi." });
      }
      const updated = db.updateConversation(targetId, { title: body.title.trim() });
      if (!updated) {
        // Jika belum ada di DB (misal karena cold start), buat otomatis
        const created = db.createConversation({ id: targetId, title: body.title.trim() });
        return res.status(200).json({ engine: db.engine, conversation: created });
      }
      return res.status(200).json({ engine: db.engine, conversation: updated });
    }

    // 4. DELETE (DELETE)
    if (req.method === "DELETE") {
      if (clearAll === "true" || body.all === true) {
        db.clearAllConversations();
        return res.status(200).json({ engine: db.engine, cleared: true });
      }

      const targetMsgId = messageId || body.messageId;
      if (targetMsgId) {
        const deleted = db.deleteMessage(targetMsgId);
        return res.status(200).json({ engine: db.engine, deleted, messageId: Number(targetMsgId) });
      }

      const targetId = id || body.id || body.conversationId;
      if (!targetId) {
        return res.status(400).json({ error: "Parameter id percakapan diperlukan untuk menghapus." });
      }
      const deleted = db.deleteConversation(targetId);
      return res.status(200).json({ engine: db.engine, deleted, id: targetId });
    }

    res.setHeader("Allow", "GET, POST, PUT, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error pada SQLite CRUD" });
  }
}
