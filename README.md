# Nexavault

> Local-first synchronization & backup engine for Obsidian vaults.

Nexavault is an **Obsidian plugin** that gives you:
- 🔄 **GitHub live sync** — commit-batched, incremental
- ☁️ **S3-compatible backups** — AWS S3, Cloudflare R2, Backblaze B2, MinIO
- 🧬 **Incremental sync** — SHA-256 hashes, only changed bytes transfer
- ⚔️ **Conflict detection & resolution** — three-way merge for text, safe binary handling
- 📡 **Offline queue + retry** — persistent queue with exponential backoff
- 🔐 **Client-side encryption** — AES-256-GCM (WebCrypto, no native modules)
- ♻️ **Backup restore & version history** — preview → confirm → restore
- 🛟 **Data-safety first** — never silently overwrites; tombstones, dry runs, delete-safety warnings

---

## 📦 Install

### Option A — Clone straight into the vault (works out of the box)

```bash
git clone https://github.com/suryaprakash251201/nexavault.git \
  "<YourVault>/.obsidian/plugins/nexavault"
```

The repo root **is** a complete plugin folder (`main.js` + `manifest.json` committed).

### Option B — Copy the release folder

```bash
git clone https://github.com/suryaprakash251201/nexavault.git
mkdir -p "<YourVault>/.obsidian/plugins/nexavault"
cp -r nexavault/release/nexavault/* "<YourVault>/.obsidian/plugins/nexavault/"
```

### Enable

1. Restart Obsidian (or reload app)
2. Settings → Community plugins → **Enable Nexavault**
3. Open the Nexavault settings tab (General → GitHub → S3) and configure

> If enabling ever shows "failed to load plugin", open **Help → Show debug console** and check for the red error line.

---

## 🚀 Usage

| Command | Description |
|---|---|
| `Nexavault: Sync now` | Full incremental sync (push + pull) |
| `Nexavault: Pull changes` | Download remote changes |
| `Nexavault: Push changes` | Upload local changes |
| `Nexavault: Backup now` | S3 snapshot backup + retention prune |
| `Nexavault: Restore backup` | Preview & restore a backup |
| `Nexavault: Open sync dashboard` | Status, backends, activity |
| `Nexavault: Resolve conflicts` | Conflict resolution UI |
| `Nexavault: Pause / Resume sync` | Stop/start automatic sync |

The **status bar** shows the live sync state (✓ synced, ↑ syncing, ⚠ conflict, ⟳ offline, ✕ error). Click it to open the dashboard.

Sync is automatic and **debounced** (default 3 s), so typing in a note triggers at most one sync operation.

---

## ⚙️ Configuration

### General
- Auto-sync toggle, debounce period (500 ms–10 s)
- Sync on startup / on network reconnect
- Periodic sync interval
- Concurrency limit (default 3), large-file threshold

### GitHub
| Setting | Description |
|---|---|
| Repository | `owner/repo` |
| Branch | any branch (not hard-coded) |
| Sync path | subfolder inside the repo |
| Token | stored in the credential store, never logged |
| Commit message | template, e.g. `vault: sync {count} files ({action})` |
| Push interval | minutes between automatic pushes |

### S3
| Setting | Description |
|---|---|
| Provider | AWS, R2, B2, MinIO, custom |
| Endpoint / Region / Bucket / Prefix | standard S3 addressing |
| Retention | daily / weekly / monthly / total caps |
| Multipart | threshold + chunk size for large files |

### Encryption
- AES-256-GCM via WebCrypto (PBKDF2-SHA256 key derivation — **no native modules**, Obsidian-safe)
- The password is never stored; only a verification hash + salt
- ⚠️ **Lost password = unrecoverable backups.** No backdoor exists by design.

### Exclusions
- Paths & glob patterns (`*.tmp`, `.DS_Store`, `Thumbs.db`…)
- `.obsidian/workspace*.json` excluded by default; plugins/themes opt-in

### Advanced
- Log level, retry policy (backoff + jitter, Retry-After aware)
- Hash verification after upload/download
- Rename detection threshold, delete-safety threshold
- Crash recovery

---

## 🏗️ Architecture

```
Obsidian Vault
      │
      ▼
Change Detector (debounced)
      │
      ▼
Sync Engine          ← central orchestrator (backends never talk to each other)
   /        \
GitHubBackend      S3Backend
(commit batches)   (incremental + snapshots + retention)
```

```
src/
├── main.ts                  Plugin entry, DI wiring, commands
├── core/                    SyncEngine, ChangeDetector, ChangeQueue,
│                            ManifestManager, HashManager, RetryManager,
│                            ConflictResolver, SyncScheduler
├── backends/                SyncBackend (interface), GitHubBackend, S3Backend
├── providers/               AWS / R2 / B2 / MinIO provider configs
├── crypto/                  EncryptionService, KeyDerivation, SecureCredentialStore
├── storage/                 StateStore, ManifestStore (persisted via plugin data)
├── models/                  Types: Change, Conflict, Manifest, Settings, …
├── ui/                      Dashboard, Conflicts, Backups, Restore, Settings
└── utils/                   Logger (secret-redacting), pathUtils, network/retry
```

Adding a backend later (GitLab, Gitea, WebDAV…) = implement `SyncBackend` and register it — the engine doesn't change.

### Backup model (S3)
```
bucket/
├── <prefix>/…                 vault file objects (incremental)
└── metadata/
    └── backups/
        └── backup-<ts>.json   verified snapshot manifests
```
`Backup now` = ① upload changed files → ② write snapshot manifest (**verified before reporting success**) → ③ prune per retention (newest backup is never deleted).

### Data safety
- Files are marked synced **only after** backend confirmation + hash verify
- Both-modified conflicts are never silently overwritten — resolved via UI (Keep Local / Keep Remote / Merge / Save Both)
- Mass-detection (e.g. 842 files "deleted") triggers a review dialog
- Restore is always **Preview → Confirm → Restore**

---

## 🧪 Development

```bash
npm install
npm run dev              # watch mode → dist/main.js
npm run build            # production → dist/, release/nexavault/ (and repo-root main.js)
npm test                 # vitest unit tests
npm run typecheck        # tsc --noEmit
```

The bundle is fully **Obsidian-safe**: no native modules (argon2 replaced with WebCrypto PBKDF2), heavy SDKs (AWS, Octokit) are lazily imported so **zero third-party code executes during plugin load**, output is a single ES2020 CJS `main.js`.

### Verified
- Hostile-sandbox load test (no `window`/`process`/`fetch`/`TextEncoder` at load) ✅
- Loader simulation: onload → vault events → sync → onunload ✅
- Unit tests: HashManager, Change, RetryManager ✅

---

## 🔒 Security notes
- Credentials live in an encrypted store (machine-local key obfuscation; Obsidian exposes no keychain API) and are **redacted from all logs**
- Path-traversal/sanitized paths, no execution of vault content
- No telemetry; debug mode is opt-in

## License
MIT