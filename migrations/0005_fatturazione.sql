-- FASE 6: gestione amministrativa in sviluppo. Eseguire dopo 0004.
-- Una sola P.IVA emittente. Non trasmette SdI/TS e non sostituisce la verifica fiscale.
CREATE TABLE IF NOT EXISTS sm_billing_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), legal_name TEXT NOT NULL DEFAULT '', vat_number TEXT NOT NULL DEFAULT '', tax_code TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', province TEXT NOT NULL DEFAULT '', pec TEXT NOT NULL DEFAULT '', sdi_code TEXT NOT NULL DEFAULT '', tax_regime TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO sm_billing_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS sm_invoices (
 id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES sm_patients(id), appointment_id TEXT REFERENCES sm_appointments(id), kind TEXT NOT NULL DEFAULT 'fattura' CHECK(kind IN ('fattura','nota_credito')), original_invoice_id TEXT REFERENCES sm_invoices(id),
 issue_date TEXT NOT NULL, year INTEGER NOT NULL, series TEXT NOT NULL DEFAULT 'A', sequence INTEGER,
 status TEXT NOT NULL DEFAULT 'bozza' CHECK(status IN ('bozza','emessa')),
 description TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity>0), unit_cents INTEGER NOT NULL CHECK(unit_cents>=0),
 vat_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK(vat_rate_bp BETWEEN 0 AND 10000), vat_nature TEXT NOT NULL DEFAULT '',
 stamp_cents INTEGER NOT NULL DEFAULT 0 CHECK(stamp_cents IN (0,200)),
 taxable_cents INTEGER NOT NULL, vat_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
 issuer_snapshot TEXT, customer_snapshot TEXT, issued_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((status='bozza' AND sequence IS NULL AND issued_at IS NULL) OR (status='emessa' AND sequence IS NOT NULL AND issued_at IS NOT NULL)),
 CHECK((kind='fattura' AND original_invoice_id IS NULL) OR (kind='nota_credito' AND original_invoice_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sm_invoice_number ON sm_invoices(year,series,sequence) WHERE sequence IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_invoice_patient ON sm_invoices(patient_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sm_invoice_appointment ON sm_invoices(appointment_id) WHERE appointment_id IS NOT NULL AND kind='fattura';
CREATE TABLE IF NOT EXISTS sm_invoice_payments (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES sm_invoices(id), paid_on TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), method TEXT NOT NULL CHECK(method IN ('contanti','carta','bonifico','assegno','altro')),
 reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sm_invoice_payments ON sm_invoice_payments(invoice_id,paid_on);
CREATE TABLE IF NOT EXISTS sm_invoice_events (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES sm_invoices(id), action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
