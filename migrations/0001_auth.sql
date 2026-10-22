-- SOLO struttura per autenticazione. Nessun dato sanitario in questa fase.
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','segreteria','specialista')),
 password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 totp_secret TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_events (
 id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
