-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 011_invoices_billing.sql
-- Invoices, Invoice Items, Tax Invoices (ZATCA), Credit Notes
-- Blueprint Phase 4 (Supplier & Finance)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── INVOICES ─────────────────────────────────────────────────────────────
-- B2B / wholesale invoices — separate from POS receipts

CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_number    BIGINT UNIQUE DEFAULT nextval('seq_invoice_number'),
  invoice_type      VARCHAR(30) NOT NULL DEFAULT 'tax_invoice', -- tax_invoice | simplified | credit_note
  status            invoice_status NOT NULL DEFAULT 'draft',
  -- Parties
  customer_id       UUID REFERENCES customers(id),
  wholesale_customer_id UUID REFERENCES wholesale_customers(id),
  issued_by         UUID NOT NULL REFERENCES users(id),
  -- Reference
  transaction_id    UUID REFERENCES transactions(id),
  purchase_order_ref VARCHAR(100),
  -- Amounts
  currency          currency_code NOT NULL DEFAULT 'AED',
  subtotal          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_amount        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  -- VAT (UAE 5%)
  vat_rate          DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  vat_number        VARCHAR(50),                            -- buyer TRN
  -- ZATCA e-invoice fields (UAE)
  zatca_uuid        UUID,                                   -- ZATCA-assigned UUID
  zatca_hash        TEXT,                                   -- cryptographic stamp
  zatca_qr_code     TEXT,                                   -- ZATCA QR code payload
  zatca_status      VARCHAR(30) DEFAULT 'pending',          -- pending|submitted|accepted|rejected
  -- Delivery
  due_date          DATE,
  sent_at           TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  notes             TEXT,
  -- Audit
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_org        ON invoices(organization_id, created_at DESC);
CREATE INDEX idx_invoices_customer   ON invoices(customer_id);
CREATE INDEX idx_invoices_status     ON invoices(organization_id, status);
CREATE INDEX idx_invoices_due        ON invoices(due_date) WHERE status IN ('sent', 'viewed');
CREATE INDEX idx_invoices_zatca      ON invoices(zatca_uuid) WHERE zatca_uuid IS NOT NULL;

COMMENT ON TABLE invoices IS 'B2B and wholesale invoices with ZATCA UAE e-invoice support';

-- ── INVOICE ITEMS ─────────────────────────────────────────────────────────

CREATE TABLE invoice_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_variant_id UUID REFERENCES product_variants(id),
  description       TEXT NOT NULL,
  quantity          DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit_price        DECIMAL(14,2) NOT NULL,
  discount_percent  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  discount_amount   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_rate          DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  vat_amount        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  line_total        DECIMAL(14,2) NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ── TAX INVOICES (UAE ZATCA compliance) ──────────────────────────────────

CREATE TABLE tax_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  transaction_id    UUID REFERENCES transactions(id),
  -- ZATCA required fields
  seller_vat_number VARCHAR(50) NOT NULL,
  buyer_vat_number  VARCHAR(50),
  supply_date       DATE NOT NULL,
  supply_end_date   DATE,                                   -- for deferred supply
  invoice_total     DECIMAL(14,2) NOT NULL,
  vat_total         DECIMAL(14,2) NOT NULL,
  vat_category      CHAR(1) NOT NULL DEFAULT 'S',           -- S=standard, Z=zero-rated, E=exempt
  -- ZATCA submission
  submission_id     VARCHAR(100),
  clearance_status  VARCHAR(30) DEFAULT 'not_submitted',
  clearance_time    TIMESTAMPTZ,
  rejection_reason  TEXT,
  -- Cryptographic fields
  invoice_hash      TEXT,                                   -- SHA256 of invoice XML
  digital_signature TEXT,                                   -- ZATCA digital signature
  xml_payload       TEXT,                                   -- UBL 2.1 XML
  qr_value          TEXT,                                   -- Base64 TLV for QR
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(invoice_id)
);

CREATE INDEX idx_tax_invoices_org    ON tax_invoices(organization_id, created_at DESC);
CREATE INDEX idx_tax_invoices_status ON tax_invoices(clearance_status);

COMMENT ON TABLE tax_invoices IS 'UAE ZATCA e-invoice compliance — UBL 2.1 XML + digital signature';

-- ── CREDIT NOTES ──────────────────────────────────────────────────────────

CREATE TABLE credit_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  credit_note_number VARCHAR(30) NOT NULL UNIQUE,           -- CN-XXXXXX
  original_invoice_id UUID NOT NULL REFERENCES invoices(id),
  customer_id       UUID REFERENCES customers(id),
  reason            TEXT NOT NULL,
  -- Amounts
  subtotal          DECIMAL(14,2) NOT NULL,
  vat_amount        DECIMAL(14,2) NOT NULL,
  total             DECIMAL(14,2) NOT NULL,
  currency          currency_code NOT NULL DEFAULT 'AED',
  status            VARCHAR(30) NOT NULL DEFAULT 'draft',   -- draft|issued|applied|cancelled
  issued_at         TIMESTAMPTZ,
  applied_at        TIMESTAMPTZ,
  notes             TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_notes_org     ON credit_notes(organization_id);
CREATE INDEX idx_credit_notes_invoice ON credit_notes(original_invoice_id);
CREATE INDEX idx_credit_notes_customer ON credit_notes(customer_id);

COMMENT ON TABLE credit_notes IS 'Refund/credit notes linked to original invoices';
