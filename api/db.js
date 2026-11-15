import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Universal Database Manager untuk Riwayat Chatbot AI (CRUD):
 * 1. Cloud Database (Turso / LibSQL) jika TURSO_DATABASE_URL diatur (Persisten di Serverless/Vercel).
 * 2. SQLite bawaan (node:sqlite) untuk pengembangan lokal atau deployment berbasis file.
 * 3. JSON Store fallback jika environment Node < 22 tidak mendukung node:sqlite.
 */

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DB_DIR = isVercel ? os.tmpdir() : path.join(process.cwd(), ".tmp");
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(DB_DIR, "nova_chatbot.db");

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;

let dbInstance = null;

export async function getSqlite() {
  if (dbInstance) return dbInstance;

  // MODE 1: CLOUD DATABASE (Turso / LibSQL)
  if (TURSO_URL && !TURSO_URL.startsWith("file:")) {
    try {
      const { createClient } = await import("@libsql/client");
      const client = createClient({
        url: TURSO_URL,
        authToken: TURSO_AUTH_TOKEN,
      });

      // Inisialisasi tabel cloud jika belum ada
      await client.batch([
        `CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        `CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );`,
        `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);`
      ]);

      dbInstance = {
        engine: "Turso LibSQL (Cloud SQLite)",
        isCloud: true,

        async listConversations() {
          const res = await client.execute(`
            SELECT c.id, c.title, c.created_at, c.updated_at,
                   COUNT(m.id) AS message_count
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC
          `);
          return res.rows.map((r) => ({
            id: String(r.id),
            title: String(r.title),
            created_at: String(r.created_at),
            updated_at: String(r.updated_at),
            message_count: Number(r.message_count || 0),
          }));
        },

        async getConversation(id) {
          const convRes = await client.execute({
            sql: `SELECT * FROM conversations WHERE id = ?`,
            args: [id],
          });
          if (convRes.rows.length === 0) return null;
          const conv = convRes.rows[0];

          const msgRes = await client.execute({
            sql: `SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC`,
            args: [id],
          });

          return {
            id: String(conv.id),
            title: String(conv.title),
            created_at: String(conv.created_at),
            updated_at: String(conv.updated_at),
            messages: msgRes.rows.map((m) => ({
              id: Number(m.id),
              conversation_id: String(m.conversation_id),
              role: String(m.role),
              content: String(m.content),
              created_at: String(m.created_at),
            })),
          };
        },

        async createConversation({ id, title = "Percakapan Baru" }) {
          const now = new Date().toISOString();
          const convId = id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          await client.execute({
            sql: `INSERT INTO conversations (id, title, created_at, updated_at)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
            args: [convId, title.slice(0, 120), now, now],
          });
          return await this.getConversation(convId);
        },

        async updateConversation(id, { title }) {
          const now = new Date().toISOString();
          const res = await client.execute({
            sql: `UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`,
            args: [title.slice(0, 120), now, id],
          });
          if (res.rowsAffected === 0) return null;
          return await this.getConversation(id);
        },

        async deleteConversation(id) {
          await client.execute({ sql: `DELETE FROM messages WHERE conversation_id = ?`, args: [id] });
          const res = await client.execute({ sql: `DELETE FROM conversations WHERE id = ?`, args: [id] });
          return res.rowsAffected > 0;
        },

        async clearAllConversations() {
          await client.batch([
            `DELETE FROM messages;`,
            `DELETE FROM conversations;`
          ]);
          return true;
        },

        async addMessage(conversationId, { role, content }) {
          const now = new Date().toISOString();
          const check = await client.execute({
            sql: `SELECT id FROM conversations WHERE id = ?`,
            args: [conversationId],
          });

          if (check.rows.length === 0) {
            const autoTitle = content.slice(0, 50).trim() || "Percakapan Baru";
            await client.execute({
              sql: `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
              args: [conversationId, autoTitle, now, now],
            });
          } else {
            await client.execute({
              sql: `UPDATE conversations SET updated_at = ? WHERE id = ?`,
              args: [now, conversationId],
            });
          }

          const res = await client.execute({
            sql: `INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
            args: [conversationId, role, content, now],
          });

          return {
            id: Number(res.lastInsertRowid),
            conversation_id: conversationId,
            role,
            content,
            created_at: now,
          };
        },

        async updateMessage(messageId, { content }) {
          const res = await client.execute({
            sql: `UPDATE messages SET content = ? WHERE id = ?`,
            args: [content, Number(messageId)],
          });
          return res.rowsAffected > 0;
        },

        async deleteMessage(messageId) {
          const res = await client.execute({
            sql: `DELETE FROM messages WHERE id = ?`,
            args: [Number(messageId)],
          });
          return res.rowsAffected > 0;
        },
      };

      return dbInstance;
    } catch (tursoErr) {
      console.warn("Koneksi Turso Cloud gagal, beralih ke SQLite lokal:", tursoErr.message);
    }
  }

  // MODE 2: LOCAL SQLITE (node:sqlite)
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  try {
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

    dbInstance = {
      engine: "node:sqlite (Local SQLite3)",
      isCloud: false,
      dbPath: DB_PATH,

      async listConversations() {
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

      async getConversation(id) {
        const conv = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id);
        if (!conv) return null;
        const messages = db.prepare(`
          SELECT id, conversation_id, role, content, created_at
          FROM messages
          WHERE conversation_id = ?
          ORDER BY id ASC
        `).all(id);
        return { ...conv, messages };
      },

      async createConversation({ id, title = "Percakapan Baru" }) {
        const now = new Date().toISOString();
        const convId = id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const stmt = db.prepare(`
          INSERT INTO conversations (id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
        `);
        stmt.run(convId, title.slice(0, 120), now, now);
        return await this.getConversation(convId);
      },

      async updateConversation(id, { title }) {
        const now = new Date().toISOString();
        const res = db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
          .run(title.slice(0, 120), now, id);
        if (res.changes === 0) return null;
        return await this.getConversation(id);
      },

      async deleteConversation(id) {
        db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id);
        const res = db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
        return res.changes > 0;
      },

      async clearAllConversations() {
        db.exec(`DELETE FROM messages; DELETE FROM conversations;`);
        return true;
      },

      async addMessage(conversationId, { role, content }) {
        const now = new Date().toISOString();
        const check = db.prepare(`SELECT id FROM conversations WHERE id = ?`).get(conversationId);
        if (!check) {
          const autoTitle = content.slice(0, 50).trim() || "Percakapan Baru";
          db.prepare(`
            INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
          `).run(conversationId, autoTitle, now, now);
        } else {
          db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
        }

        const res = db.prepare(`
          INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)
        `).run(conversationId, role, content, now);

        return {
          id: Number(res.lastInsertRowid),
          conversation_id: conversationId,
          role,
          content,
          created_at: now,
        };
      },

      async updateMessage(messageId, { content }) {
        const res = db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(content, Number(messageId));
        return res.changes > 0;
      },

      async deleteMessage(messageId) {
        const res = db.prepare(`DELETE FROM messages WHERE id = ?`).run(Number(messageId));
        return res.changes > 0;
      },
    };

    return dbInstance;
  } catch (err) {
    // MODE 3: FALLBACK FILE JSON STORE
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

    dbInstance = {
      engine: "JSON File Fallback Store",
      isCloud: false,
      dbPath: jsonPath,

      async listConversations() {
        const store = loadStore();
        return store.conversations
          .map((c) => ({
            ...c,
            message_count: store.messages.filter((m) => m.conversation_id === c.id).length,
          }))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      },

      async getConversation(id) {
        const store = loadStore();
        const conv = store.conversations.find((c) => c.id === id);
        if (!conv) return null;
        const messages = store.messages
          .filter((m) => m.conversation_id === id)
          .sort((a, b) => a.id - b.id);
        return { ...conv, messages };
      },

      async createConversation({ id, title = "Percakapan Baru" }) {
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
        return await this.getConversation(convId);
      },

      async updateConversation(id, { title }) {
        const store = loadStore();
        const conv = store.conversations.find((c) => c.id === id);
        if (!conv) return null;
        conv.title = title.slice(0, 120);
        conv.updated_at = new Date().toISOString();
        saveStore(store);
        return await this.getConversation(id);
      },

      async deleteConversation(id) {
        const store = loadStore();
        const before = store.conversations.length;
        store.conversations = store.conversations.filter((c) => c.id !== id);
        store.messages = store.messages.filter((m) => m.conversation_id !== id);
        saveStore(store);
        return store.conversations.length < before;
      },

      async clearAllConversations() {
        saveStore({ conversations: [], messages: [], seq: 1 });
        return true;
      },

      async addMessage(conversationId, { role, content }) {
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

      async updateMessage(messageId, { content }) {
        const store = loadStore();
        const msg = store.messages.find((m) => m.id === Number(messageId));
        if (!msg) return false;
        msg.content = content;
        saveStore(store);
        return true;
      },

      async deleteMessage(messageId) {
        const store = loadStore();
        const before = store.messages.length;
        store.messages = store.messages.filter((m) => m.id !== Number(messageId));
        saveStore(store);
        return store.messages.length < before;
      },
    };

    return dbInstance;
  }
}
