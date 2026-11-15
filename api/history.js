import { getSqlite } from "./db.js";

/**
 * Endpoint REST API CRUD untuk Riwayat Chatbot AI
 * - GET    /api/history              -> Daftar percakapan (READ)
 * - GET    /api/history?id=<id>      -> Isi percakapan & pesan (READ)
 * - POST   /api/history              -> Buat percakapan / tambah pesan (CREATE)
 * - PUT    /api/history              -> Edit judul atau isi pesan (UPDATE)
 * - DELETE /api/history?id=<id>      -> Hapus 1 percakapan / pesan / semua (DELETE)
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  let db;
  try {
    db = await getSqlite();
  } catch (e) {
    return res.status(500).json({ error: "Gagal menginisialisasi database: " + e.message });
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
        const conv = await db.getConversation(id);
        if (!conv) {
          return res.status(404).json({ error: "Percakapan tidak ditemukan." });
        }
        return res.status(200).json({ engine: db.engine, isCloud: db.isCloud, conversation: conv });
      }
      const conversations = await db.listConversations();
      return res.status(200).json({ engine: db.engine, isCloud: db.isCloud, conversations });
    }

    // 2. CREATE (POST)
    if (req.method === "POST") {
      const { action, conversationId, title, role, content, messages } = body;

      // Tambah 1 pesan ke percakapan
      if (action === "add_message" || (conversationId && role && typeof content === "string")) {
        const msg = await db.addMessage(conversationId, { role, content });
        const conv = await db.getConversation(conversationId);
        return res.status(201).json({ engine: db.engine, isCloud: db.isCloud, message: msg, conversation: conv });
      }

      // Buat percakapan baru
      const conv = await db.createConversation({ id: conversationId || body.id, title: title || "Percakapan Baru" });
      if (Array.isArray(messages) && messages.length > 0) {
        for (const m of messages) {
          if (m && m.role && typeof m.content === "string") {
            await db.addMessage(conv.id, { role: m.role, content: m.content });
          }
        }
      }
      const updated = await db.getConversation(conv.id);
      return res.status(201).json({ engine: db.engine, isCloud: db.isCloud, conversation: updated });
    }

    // 3. UPDATE (PUT / PATCH)
    if (req.method === "PUT" || req.method === "PATCH") {
      const targetMsgId = messageId || body.messageId;
      if (targetMsgId) {
        if (typeof body.content !== "string" || !body.content.trim()) {
          return res.status(400).json({ error: "Konten pesan baru tidak boleh kosong." });
        }
        const ok = await db.updateMessage(targetMsgId, { content: body.content.trim() });
        if (!ok) return res.status(404).json({ error: "Pesan tidak ditemukan." });
        return res.status(200).json({ engine: db.engine, updated: true, messageId: Number(targetMsgId) });
      }

      const targetId = id || body.id || body.conversationId;
      if (!targetId || typeof body.title !== "string" || !body.title.trim()) {
        return res.status(400).json({ error: "ID percakapan dan title baru wajib diisi." });
      }
      const updated = await db.updateConversation(targetId, { title: body.title.trim() });
      if (!updated) {
        const created = await db.createConversation({ id: targetId, title: body.title.trim() });
        return res.status(200).json({ engine: db.engine, conversation: created });
      }
      return res.status(200).json({ engine: db.engine, conversation: updated });
    }

    // 4. DELETE (DELETE)
    if (req.method === "DELETE") {
      if (clearAll === "true" || body.all === true) {
        await db.clearAllConversations();
        return res.status(200).json({ engine: db.engine, cleared: true });
      }

      const targetMsgId = messageId || body.messageId;
      if (targetMsgId) {
        const deleted = await db.deleteMessage(targetMsgId);
        return res.status(200).json({ engine: db.engine, deleted, messageId: Number(targetMsgId) });
      }

      const targetId = id || body.id || body.conversationId;
      if (!targetId) {
        return res.status(400).json({ error: "Parameter id percakapan diperlukan untuk menghapus." });
      }
      const deleted = await db.deleteConversation(targetId);
      return res.status(200).json({ engine: db.engine, deleted, id: targetId });
    }

    res.setHeader("Allow", "GET, POST, PUT, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error pada Database CRUD" });
  }
}
