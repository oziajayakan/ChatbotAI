import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Helper Database SQLite untuk Riwayat Chatbot AI (CRUD)
 * Mendukung Node.js built-in `node:sqlite` (Node >= 22 / Vercel Node 22.x)
 * serta fallback otomatis ke JSONite file-backed SQLite emulator jika dijalankan di Node < 22.
 * Di lingkungan Vercel Serverless, file disimpan di `/tmp/nova_chatbot.db` (writable directory).
 */

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DB_DIR = isVercel ? os.tmpdir() : path.join(process.cwd(), ".tmp");
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(DB_DIR, "nova_chatbot.db");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let sqliteInstance = null;

async function getSqlite() {
  if (sqliteInstance) return sqliteInstance;

  try {
    // Gunakan built-in SQLite resmi Node.js (DatabaseSync)
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(DB_PATH);

    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    `);

    sqliteInstance = {
      engine: "node:sqlite (SQLite3)",
      dbPath: DB_PATH,

      // READ ALL CONVERSATIONS
      listConversations() {
        const stmt = db.prepare(`
          SELECT c.id, c.title, c.created_at, c.updated_at,
                 COUNT(m.id) AS message_count
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id
          GROUP BY c.id
          ORDER BY c.updated_at DESC
        `);
        return stmt.all();
      },

      // READ ONE CONVERSATION WITH MESSAGES
      getConversation(id) {
        const convStmt = db.prepare(`SELECT * FROM conversations WHERE id = ?`);
        const conv = convStmt.get(id);
        if (!conv) return null;

        const msgStmt = db.prepare(`
          SELECT id, conversation_id, role, content, created_at
          FROM messages
          WHERE conversation_id = ?
          ORDER BY id ASC
        `);
        const messages = msgStmt.all(id);
        return { ...conv, messages };
      },

      // CREATE CONVERSATION
      createConversation({ id, title = "Percakapan Baru" }) {
        const now = new Date().toISOString();
        const convId = id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const stmt = db.prepare(`
          INSERT INTO conversations (id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
        `);
        stmt.run(convId, title.slice(0, 120), now, now);
        return this.getConversation(convId);
      },

      // UPDATE CONVERSATION (Title)
      updateConversation(id, { title }) {
        const now = new Date().toISOString();
        const stmt = db.prepare(`
          UPDATE conversations
          SET title = ?, updated_at = ?
          WHERE id = ?
        `);
        const res = stmt.run(title.slice(0, 120), now, id);
        if (res.changes === 0) return null;
        return this.getConversation(id);
      },

      // DELETE CONVERSATION
      deleteConversation(id) {
        const delMsgs = db.prepare(`DELETE FROM messages WHERE conversation_id = ?`);
        delMsgs.run(id);
        const stmt = db.prepare(`DELETE FROM conversations WHERE id = ?`);
        const res = stmt.run(id);
        return res.changes > 0;
      },

      // DELETE ALL CONVERSATIONS
      clearAllConversations() {
        db.exec(`DELETE FROM messages; DELETE FROM conversations;`);
        return true;
      },

      // CREATE MESSAGE
      addMessage(conversationId, { role, content }) {
        const now = new Date().toISOString();
        // Pastikan conversation ada
        const check = db.prepare(`SELECT id FROM conversations WHERE id = ?`).get(conversationId);
        if (!check) {
          const autoTitle = content.slice(0, 50).trim() || "Percakapan Baru";
          db.prepare(`
            INSERT INTO conversations (id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?)
          `).run(conversationId, autoTitle, now, now);
        } else {
          db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
        }

        const stmt = db.prepare(`
          INSERT INTO messages (conversation_id, role, content, created_at)
          VALUES (?, ?, ?, ?)
        `);
        const res = stmt.run(conversationId, role, content, now);
        return {
          id: Number(res.lastInsertRowid),
          conversation_id: conversationId,
          role,
          content,
          created_at: now,
        };
      },

      // UPDATE MESSAGE
      updateMessage(messageId, { content }) {
        const stmt = db.prepare(`UPDATE messages SET content = ? WHERE id = ?`);
        const res = stmt.run(content, Number(messageId));
        return res.changes > 0;
      },

      // DELETE MESSAGE
      deleteMessage(messageId) {
        const stmt = db.prepare(`DELETE FROM messages WHERE id = ?`);
        const res = stmt.run(Number(messageId));
        return res.changes > 0;
      }
    };

    return sqliteInstance;
  } catch (err) {
    // Fallback jika environment Node < 22 tidak memiliki node:sqlite
    const jsonPath = `${DB_PATH}.json`;
    const loadStore = () => {
      try {
        if (fs.existsSync(jsonPath)) {
          return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        }
      } catch {}
      return { conversations: [], messages: [], seq: 1 };
    };
    const saveStore = (data) => {
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf8");
    };

    sqliteInstance = {
      engine: "sqlite-json-fallback",
      dbPath: jsonPath,
      listConversations() {
        const store = loadStore();
        return store.conversations
          .map((c) => ({
            ...c,
            message_count: store.messages.filter((m) => m.conversation_id === c.id).length,
          }))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      },
      getConversation(id) {
        const store = loadStore();
        const conv = store.conversations.find((c) => c.id === id);
        if (!conv) return null;
        const messages = store.messages
          .filter((m) => m.conversation_id === id)
          .sort((a, b) => a.id - b.id);
        return { ...conv, messages };
      },
      createConversation({ id, title = "Percakapan Baru" }) {
        const store = loadStore();
        const now = new Date().toISOString();
        const convId = id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let conv = store.conversations.find((c) => c.id === convId);
        if (!conv) {
          conv = { id: convId, title: title.slice(0, 120), created_at: now, updated_at: now };
          store.conversations.push(conv);
        } else {
          conv.updated_at = now;
        }
        saveStore(store);
        return this.getConversation(convId);
      },
      updateConversation(id, { title }) {
        const store = loadStore();
        const conv = store.conversations.find((c) => c.id === id);
        if (!conv) return null;
        conv.title = title.slice(0, 120);
        conv.updated_at = new Date().toISOString();
        saveStore(store);
        return this.getConversation(id);
      },
      deleteConversation(id) {
        const store = loadStore();
        const before = store.conversations.length;
        store.conversations = store.conversations.filter((c) => c.id !== id);
        store.messages = store.messages.filter((m) => m.conversation_id !== id);
        saveStore(store);
        return store.conversations.length < before;
      },
      clearAllConversations() {
        saveStore({ conversations: [], messages: [], seq: 1 });
        return true;
      },
      addMessage(conversationId, { role, content }) {
        const store = loadStore();
        const now = new Date().toISOString();
        let conv = store.conversations.find((c) => c.id === conversationId);
        if (!conv) {
          conv = {
            id: conversationId,
            title: content.slice(0, 50).trim() || "Percakapan Baru",
            created_at: now,
            updated_at: now,
          };
          store.conversations.push(conv);
        } else {
          conv.updated_at = now;
        }
        const msg = {
          id: store.seq++,
          conversation_id: conversationId,
          role,
          content,
          created_at: now,
        };
        store.messages.push(msg);
        saveStore(store);
        return msg;
      },
      updateMessage(messageId, { content }) {
        const store = loadStore();
        const msg = store.messages.find((m) => m.id === Number(messageId));
        if (!msg) return false;
        msg.content = content;
        saveStore(store);
        return true;
      },
      deleteMessage(messageId) {
        const store = loadStore();
        const before = store.messages.length;
        store.messages = store.messages.filter((m) => m.id !== Number(messageId));
        saveStore(store);
        return store.messages.length < before;
      },
    };
    return sqliteInstance;
  }
}

export { getSqlite };
