-- Fase 9: righe fattura. Nessuna cancellazione o modifica delle fatture esistenti.
CREATE TABLE IF NOT EXISTS sm_invoice_lines (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES sm_invoices(id) ON DELETE RESTRICT,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 30),
 description TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
 unit_cents INTEGER NOT NULL CHECK(unit_cents >= 0),
 vat_rate_bp INTEGER NOT NULL CHECK(vat_rate_bp BETWEEN 0 AND 10000),
 vat_nature TEXT NOT NULL DEFAULT '',
 taxable_cents INTEGER NOT NULL CHECK(taxable_cents >= 0),
 vat_cents INTEGER NOT NULL CHECK(vat_cents >= 0),
 UNIQUE(invoice_id,position)
);
CREATE INDEX IF NOT EXISTS idx_sm_invoice_lines_invoice ON sm_invoice_lines(invoice_id,position);
-- Compatibilità con le fatture create prima della fase 9.
INSERT INTO sm_invoice_lines(id,invoice_id,position,description,quantity,unit_cents,vat_rate_bp,vat_nature,taxable_cents,vat_cents)
SELECT lower(hex(randomblob(16))),i.id,1,i.description,i.quantity,i.unit_cents,i.vat_rate_bp,i.vat_nature,i.taxable_cents,i.vat_cents
FROM sm_invoices i WHERE NOT EXISTS (SELECT 1 FROM sm_invoice_lines l WHERE l.invoice_id=i.id);
