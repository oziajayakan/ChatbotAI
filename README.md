# NOVA — Chatbot AI Gemini + SQLite CRUD untuk Vercel

Chatbot AI modern berbasis **Google Gemini API** dengan streaming balasan (Server-Sent Events), penyimpanan riwayat percakapan **Database SQLite (CRUD)**, UI bergaya HUD neon (vortex torus animasi, ribbon telemetri real-time, palet Pink/Matrix), render Markdown, dan highlight kode.

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
- **UI "Neural Core" bergaya HUD**:
  - **NOVA Neural Core**: berputar tenang saat idle, menyedot partikel saat *thinking*, memancarkan gelombang saat menjawab.
  - **Pipeline 6 tahap** (PARSER → RAG → REASONER → TOOLS → GUARD → SYNTH) menyala bergantian kiri ke kanan setiap pesan dikirim. Tahapnya mengikuti proses nyata (deteksi intent, jendela konteks, latensi model, panggilan API, aturan sistem, streaming), bukan RAG/tool eksternal sungguhan.
  - **Callout INTENT / DETECTED**: topik pesan (CODING, ANALYSIS, EXPLAIN, WRITING, MATH, TRANSLATE, CHAT) terdeteksi lokal secara otomatis, bahkan saat mengetik.
  - **Context Window Depth**: sisi kiri = token input, sisi kanan = memory/output (perkiraan karakter ÷ 4).
  - **Attention Matrix 8×8**: ilustrasi self-attention dari kata-kata terakhir (bukan bobot asli model).
  - **Reasoning Trace**: langkah proses ditampilkan baris demi baris; jika model mengirim ringkasan reasoning (`includeThoughts`), ringkasannya ikut tampil. Jika model/API tidak mendukungnya, backend otomatis mengulang tanpa parameter itu.
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
   - `GEMINI_MODEL` = `gemini-3.8-flash` (opsional, otomatis fallback ke `gemini-flash-latest`)
4. Klik **Deploy**. Proyek langsung online! ✅

---

## Kontributor
| Kontributor | Peran |
|---|---|
| [@oziajayakan](https://github.com/oziajayakan) | Pemilik & pengembang utama |
| [Devin](https://devin.ai) ([@devin-ai-integration](https://github.com/apps/devin-ai-integration)) | AI software engineer dari Cognition AI |
