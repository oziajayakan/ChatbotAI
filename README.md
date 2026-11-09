# NOVA — Chatbot AI Gemini + SQLite CRUD untuk Vercel

Chatbot AI modern berbasis **Google Gemini API** dengan streaming balasan (Server-Sent Events), penyimpanan riwayat percakapan **Database SQLite (CRUD)**, UI Glassmorphism (Dark/Light mode), render Markdown, dan highlight kode.

🔗 **Source Code GitHub**: [https://github.com/oziajayakan/ChatbotAI.git](https://github.com/oziajayakan/ChatbotAI.git)  
☕ **Dukung via Saweria**: [https://saweria.co/kokbisaya](https://saweria.co/kokbisaya)

---

## Fitur Utama
- **Streaming Respons Real-time (SSE)**: Balasan AI muncul kata demi kata secara instan.
- **Database SQLite CRUD Riwayat Chat**:
  - **Create**: Membuat sesi percakapan baru & menyimpan setiap pesan user/assistant ke tabel SQLite (`conversations` & `messages`).
  - **Read**: Menampilkan daftar riwayat percakapan di sidebar serta memuat ulang isi percakapan.
  - **Update**: Mengubah judul percakapan langsung dari sidebar.
  - **Delete**: Menghapus satu percakapan tertentu atau membersihkan seluruh riwayat percakapan.
- **Siap Deploy ke Vercel (Serverless)**: Menggunakan `node:sqlite` (Node.js >= 22) dengan penyimpanan di direktori writable `/tmp/nova_chatbot.db` pada Vercel Serverless Function dan `.tmp/nova_chatbot.db` saat dijalankan lokal.
- **Keamanan Credential**: API Key hanya diakses di sisi backend serverless (`api/chat.js`) dan tidak pernah terekspos ke browser.

---

## Struktur Proyek
```
ChatbotAI/
├─ api/
│  ├─ chat.js           ← Serverless function (streaming Gemini API + auto-save SQLite)
│  ├─ history.js        ← Serverless endpoint REST API CRUD untuk riwayat SQLite
│  ├─ db.js             ← Modul koneksi & query SQLite (conversations & messages)
│  └─ system-prompt.js  ← Konfigurasi kepribadian & instruksi sistem NOVA
├─ public/
│  └─ index.html        ← Antarmuka pengguna (UI Chat, Sidebar Riwayat CRUD, Link GitHub & Saweria)
├─ server.js            ← Server lokal untuk development & pengujian tanpa Vercel CLI
├─ vercel.json          ← Konfigurasi routing & serverless functions untuk Vercel
├─ package.json
└─ .env.example
```

---

## Cara Menjalankan Lokal
1. Salin `.env.example` menjadi `.env.local` dan isi `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env.local
   ```
2. Jalankan server pengembangan lokal:
   ```bash
   npm run dev
   ```
3. Buka `http://localhost:3000` di browser.

---

## Cara Deploy ke Vercel
1. Push repositori ini ke GitHub (`https://github.com/oziajayakan/ChatbotAI.git`).
2. Buka dashboard **Vercel**, klik **Add New → Project**, lalu import repositori GitHub tersebut.
3. Pada bagian **Environment Variables**, tambahkan:
   - `GEMINI_API_KEY` = API key dari Google AI Studio (`https://aistudio.google.com/apikey`)
   - `GEMINI_MODEL` = `gemini-2.5-flash` (opsional)
4. Klik **Deploy**. Proyek langsung online! ✅
