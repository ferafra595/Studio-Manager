-- Eseguire una volta su D1; non contiene credenziali TS.
CREATE TABLE IF NOT EXISTS sm_ts_documents (
 id TEXT PRIMARY KEY,
 patient_id TEXT NOT NULL REFERENCES sm_patients(id),
 appointment_id TEXT REFERENCES sm_appointments(id),
 document_number TEXT NOT NULL,
 document_date TEXT NOT NULL,
 payment_date TEXT NOT NULL,
 payment_method TEXT NOT NULL CHECK(payment_method IN ('contanti','tracciabile','altro')),
 total_cents INTEGER NOT NULL CHECK(total_cents>0),
 expense_type TEXT NOT NULL,
 opposition INTEGER NOT NULL DEFAULT 0 CHECK(opposition IN (0,1)),
 status TEXT NOT NULL DEFAULT 'bozza' CHECK(status IN ('bozza','da_verificare','pronto_test','inviato','accettato','scartato','da_riconciliare')),
 protocol TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(document_number,document_date)
);
CREATE TABLE IF NOT EXISTS sm_ts_events (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES sm_ts_documents(id),
 event_type TEXT NOT NULL,
 outcome TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sm_ts_status ON sm_ts_documents(status,created_at);
