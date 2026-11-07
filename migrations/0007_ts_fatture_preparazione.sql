-- Preparazione controllata fatture per Sistema TS: NESSUN INVIO, nessuna modifica ai documenti originali.
-- Applicare una sola volta dopo 0006_righe_fattura.sql.
CREATE TABLE IF NOT EXISTS sm_ts_invoice_preparations (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL UNIQUE REFERENCES sm_invoices(id) ON DELETE RESTRICT,
 payment_id TEXT NOT NULL REFERENCES sm_invoice_payments(id) ON DELETE RESTRICT,
 opposition INTEGER NOT NULL CHECK(opposition IN (0,1)),
 expense_types_json TEXT NOT NULL,
 reviewed_by TEXT NOT NULL DEFAULT 'ADMIN',
 review_confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 status TEXT NOT NULL DEFAULT 'da_verificare' CHECK(status IN ('da_verificare','opposizione_registrata')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sm_ts_prep_status ON sm_ts_invoice_preparations(status,created_at);
CREATE TABLE IF NOT EXISTS sm_ts_invoice_prep_events (
 id TEXT PRIMARY KEY,
 preparation_id TEXT NOT NULL REFERENCES sm_ts_invoice_preparations(id) ON DELETE RESTRICT,
 action TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
