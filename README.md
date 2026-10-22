
# Vault Server (Node.js, local storage)

Backend for the Vault app: upload documents, process them (extract, chunk, embed), and answer questions with citations (RAG).
Everything runs **locally and free**: SQLite database file + uploaded files on disk + a local embedding model + a local LLM (Ollama) for answers. Optionally switch the answers to the Claude API with one setting.

## 1. Requirements

- Node.js 20 or newer (22 LTS recommended)
- [Ollama](https://ollama.com) installed, for the free local AI that writes answers (or an Anthropic API key if you prefer Claude)
- 8 GB RAM or more is recommended for the default local model (`llama3.2`, about 2 GB download)
- ~90 MB disk for the embedding model (downloaded once, cached in `data/models/`)

## 2. Run it

```bash
# 1. Local AI (one time)
ollama pull llama3.2          # then make sure Ollama is running (it starts automatically after install on most systems)

# 2. Server
npm install
cp .env.example .env          # defaults already work: DEV_AUTH=true, LLM_PROVIDER=ollama
npm run dev
```

No API key and no Firebase are needed to run locally. Keep `DEV_AUTH=true` while building.
The first start downloads the embedding model, so the first upload is slower. Watch for `Embedding model ready` in the console.

### Choosing the AI that answers

| `LLM_PROVIDER` | Cost | Setup |
|---|---|---|
| `ollama` (default) | Free | Install Ollama, `ollama pull llama3.2`. Change the model with `OLLAMA_MODEL` (use the exact name you pulled, e.g. `qwen2.5:3b`). |
| `anthropic` | Paid | Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`). |

Small local models write weaker answers and follow the "cite [1]" and "Not found" rules less reliably than Claude. Good enough to build and test the whole app; switch to Claude later for quality.

If Ollama is not running or the model is missing, `/ask` returns `503` with the exact command to fix it (for example `ollama pull llama3.2`).

## 3. How local storage works

| What | Where | Notes |
|---|---|---|
| Database | `data/vault.db` (SQLite, WAL mode) | users, documents, chunks (+ embeddings as BLOB), conversations, messages, question_log |
| Uploaded files | `uploads/<userId>/<random-uuid>.pdf` | Original names are never used on disk. DB stores the path **relative** to the project root. |
| Embedding model | `data/models/` | Runs on your machine. No key, no cost. 384-dimension vectors. |

Backup = copy `data/` and `uploads/`. Reset = delete both folders.

## 4. Project structure

```
src/
  index.js              app setup, routes, startup
  config.js             env settings
  db.js                 SQLite schema
  utils.js              helpers (paths, vectors, dates)
  middleware/
    auth.js             Firebase token check (+ DEV_AUTH shortcut)
    errors.js           HttpError, asyncHandler, JSON error responses
  routes/
    auth.js             POST /auth/verify
    documents.js        upload, list, detail, status, chunks, reindex, delete, folders
    chunks.js           GET /chunks/:id   (Source Viewer)
    ask.js              POST /ask         (RAG + SSE streaming)
    conversations.js    list, messages, delete
    account.js          DELETE /account   (Apple requirement)
  services/
    extract.js          PDF/TXT/MD -> text per page
    chunk.js            sliding window chunking
    embed.js            local MiniLM embeddings
    ingest.js           background queue: extract -> chunk -> embed -> store
    retrieve.js         similarity search (top-k)
    llm.js              LLM call with streaming (Ollama or Claude)
flutter-integration/    Dio client + repository + notes for the Flutter app
```

## 5. The pipeline (what happens)

**Upload** `POST /documents` (multipart, field `file`)
1. multer saves the file to `uploads/<userId>/<uuid>.ext` (PDF, TXT, MD only, size limit from `.env`).
2. A `documents` row is created with status `uploaded`. The response returns immediately.
3. A background queue (one document at a time) sets `processing`, then:
   extract text per page, chunk (180 words, 30 overlap), embed each chunk, save chunks, set `ready`.
4. Any error sets `failed` with a readable message (for example "No readable text found (scanned PDF?)").
5. The app polls `GET /documents/:id/status`.

**Ask** `POST /ask` -> Server-Sent Events
1. Validate, check the daily limit, create or reuse the conversation.
2. Embed the question, find the top-k chunks (only this user's ready documents, optionally limited to a folder or one document).
3. If nothing is similar enough, answer "Not found in your documents." without calling the LLM.
4. Otherwise send the chunks + question to the LLM (Ollama by default, or Claude) with a strict "answer only from context, cite [n]" system prompt, and stream the answer.
5. Events: `meta` (conversationId + citations) -> many `delta` -> `done` or `error`.
6. The turn is saved only when it completes.

## 6. API reference

All routes except `/health` need auth: `Authorization: Bearer <Firebase ID token>`, or `x-dev-user: <name>` when `DEV_AUTH=true`.

```
GET    /health
POST   /auth/verify
GET    /documents?folder=&status=&q=&limit=&offset=
GET    /documents/folders
POST   /documents                  multipart: file, title?, folder?
GET    /documents/:id
GET    /documents/:id/status
GET    /documents/:id/chunks?limit=&offset=
POST   /documents/:id/reindex
DELETE /documents/:id
GET    /chunks/:id
POST   /ask                        { question, conversationId?, scope? }
GET    /conversations
GET    /conversations/:id/messages
DELETE /conversations/:id
DELETE /account
```

`scope` is `{"type":"all"}`, `{"type":"folder","value":"Flutter"}` or `{"type":"document","value":3}`.

Errors are JSON: `{ "error": "code", "message": "..." }` (400 validation, 401 auth, 404 not found, 413 too large, 429 daily limit).

## 7. Test with curl

```bash
H="x-dev-user: marwa"

curl -H "$H" -F file=@notes.pdf -F folder=Flutter http://localhost:3000/documents
curl -H "$H" http://localhost:3000/documents/1/status          # wait for "ready"
curl -H "$H" http://localhost:3000/documents/1/chunks

curl -N -H "$H" -H "Content-Type: application/json" \
  -d '{"question":"What is the difference between Cubit and BLoC?"}' \
  http://localhost:3000/ask
```

## 8. Switch to real Firebase auth

1. Firebase console -> Project settings -> Service accounts -> Generate new private key.
2. Save it as `firebase-service-account.json` in the project root (it is git-ignored).
3. In `.env`: `DEV_AUTH=false` and `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json`.
4. The Flutter app sends `await FirebaseAuth.instance.currentUser!.getIdToken()` as the bearer token (already done in `flutter-integration/api_client.dart`).

The server refuses to start if `DEV_AUTH=true` while `NODE_ENV=production`.

## 9. Settings you can tune (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | ollama | `ollama` or `anthropic` |
| `OLLAMA_URL` / `OLLAMA_MODEL` | http://localhost:11434 / llama3.2 | where Ollama runs and which model to use |
| `TOP_K` | 5 | chunks sent to the LLM |
| `MIN_SCORE` | 0.2 | minimum similarity; raise it for stricter "Not found" answers |
| `CHUNK_WORDS` / `CHUNK_OVERLAP` | 180 / 30 | chunk size and overlap |
| `DAILY_QUESTION_LIMIT` | 50 | per user per day |
| `MAX_UPLOAD_MB` | 20 | upload size limit |
| `EMBEDDING_PROVIDER` | local | `fake` = offline testing only, results are not meaningful |

Chunks are 180 words because the local MiniLM model only reads about 256 tokens per chunk. If you switch to a larger embedding model later, increase `CHUNK_WORDS`.

## 10. Known limitations (v1)

- Scanned PDFs have no text layer, so they end as `failed`. OCR comes later.
- Chunking joins words with single spaces, so paragraph breaks are lost.
- Follow-up questions use history for the LLM, but retrieval uses only the latest question.
- Similarity search compares against all of a user's chunks in memory. Fine for thousands of chunks. For much larger vaults, replace the one function in `services/retrieve.js` with pgvector.
- The processing queue lives in memory. Unfinished documents are re-queued on restart, but this is not a multi-server job system.
- Files are stored on local disk. A deployed server needs a persistent volume (or move uploads to object storage later).

## 11. Next steps

1. Connect the Flutter app (`flutter-integration/`).
2. Add tests (Vitest or `node:test`) for `chunk.js` and `retrieve.js`.
3. CI/CD: lint and test on every push, then build a Docker image and deploy with a persistent volume for `data/` and `uploads/`.
