-- Fase TS successiva a 0007. Revisione interna, non abilita alcun invio.
CREATE TABLE IF NOT EXISTS sm_ts_invoice_reviews (
 preparation_id TEXT PRIMARY KEY REFERENCES sm_ts_invoice_preparations(id) ON DELETE RESTRICT,
 invoice_fingerprint TEXT NOT NULL CHECK(length(invoice_fingerprint)=64),
 reviewer TEXT NOT NULL DEFAULT 'ADMIN',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
