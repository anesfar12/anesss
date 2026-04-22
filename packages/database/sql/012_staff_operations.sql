-- ═══════════════════════════════════════════════════════════════════════════
-- LUXE POS v5.1 — Database Schema v10.0
-- File: 012_staff_operations.sql
-- Staff Commissions, Schedules, Targets, Clock Events, Performance Reviews
-- Blueprint Phase 3 (Manager Dashboard)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STAFF COMMISSIONS ────────────────────────────────────────────────────
-- Computed commission payouts per period, linked to staff_performance_snapshots

CREATE TABLE staff_commissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  location_id       UUID REFERENCES locations(id),
  -- Period
  period            VARCHAR(10) NOT NULL,                   -- 'monthly' | 'quarterly'
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  -- Calculation
  total_sales       DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  commission_rate   DECIMAL(5,4) NOT NULL,                  -- e.g. 0.03 = 3%
  commission_gross  DECIMAL(14,2) NOT NULL DEFAULT 0.00,    -- before deductions
  deductions        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  commission_net    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  -- Status
  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|paid|cancelled
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  payment_ref       TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, period, period_start)
);

CREATE INDEX idx_commissions_user   ON staff_commissions(user_id, period_start DESC);
CREATE INDEX idx_commissions_org    ON staff_commissions(organization_id, period_start DESC);
CREATE INDEX idx_commissions_status ON staff_commissions(organization_id, status);

COMMENT ON TABLE staff_commissions IS 'Monthly/quarterly commission payouts — computed from staff_performance_snapshots';

-- ── STAFF SCHEDULES ───────────────────────────────────────────────────────

CREATE TABLE staff_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  location_id       UUID NOT NULL REFERENCES locations(id),
  -- Shift
  shift_date        DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  break_minutes     INTEGER NOT NULL DEFAULT 60,
  -- Status
  status            VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled|confirmed|completed|absent|swapped
  notes             TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedules_user     ON staff_schedules(user_id, shift_date);
CREATE INDEX idx_schedules_location ON staff_schedules(location_id, shift_date);
CREATE INDEX idx_schedules_date     ON staff_schedules(organization_id, shift_date);

-- ── STAFF TARGETS ─────────────────────────────────────────────────────────

CREATE TABLE staff_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  location_id       UUID REFERENCES locations(id),
  -- Target period
  target_month      DATE NOT NULL,                          -- first day of month
  -- KPIs
  revenue_target    DECIMAL(14,2) NOT NULL DEFAULT 0.00,   -- monthly sales target
  units_target      INTEGER,                               -- optional unit target
  customer_target   INTEGER,                               -- new customers target
  black_book_target INTEGER,                               -- Black Book updates target
  -- Actuals (computed by pg_cron snapshot)
  revenue_actual    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  units_actual      INTEGER NOT NULL DEFAULT 0,
  customer_actual   INTEGER NOT NULL DEFAULT 0,
  -- Achievement
  achievement_pct   DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN revenue_target > 0
         THEN ROUND((revenue_actual / revenue_target) * 100, 2)
         ELSE NULL END
  ) STORED,
  -- Metadata
  set_by            UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, target_month)
);

CREATE INDEX idx_targets_user  ON staff_targets(user_id, target_month DESC);
CREATE INDEX idx_targets_org   ON staff_targets(organization_id, target_month DESC);

-- ── STAFF CLOCK EVENTS ───────────────────────────────────────────────────

CREATE TABLE staff_clock_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  location_id       UUID NOT NULL REFERENCES locations(id),
  schedule_id       UUID REFERENCES staff_schedules(id),
  event_type        VARCHAR(20) NOT NULL,                   -- clock_in|clock_out|break_start|break_end
  event_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_id         UUID REFERENCES pos_devices(id),
  ip_address        INET,
  notes             TEXT
);

CREATE INDEX idx_clock_user ON staff_clock_events(user_id, event_at DESC);
CREATE INDEX idx_clock_date ON staff_clock_events(organization_id, event_at DESC);

COMMENT ON TABLE staff_clock_events IS 'Immutable clock in/out log — never updated, only inserted';

-- ── PERFORMANCE REVIEWS ───────────────────────────────────────────────────

CREATE TABLE performance_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID NOT NULL REFERENCES users(id),    -- staff being reviewed
  reviewer_id       UUID NOT NULL REFERENCES users(id),    -- manager doing review
  review_period     VARCHAR(20) NOT NULL,                  -- 'Q1-2026', 'H1-2026' etc.
  review_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Scores (1-5)
  sales_score       DECIMAL(3,1),
  customer_score    DECIMAL(3,1),
  product_knowledge DECIMAL(3,1),
  teamwork_score    DECIMAL(3,1),
  attendance_score  DECIMAL(3,1),
  overall_score     DECIMAL(3,1) GENERATED ALWAYS AS (
    ROUND((COALESCE(sales_score,0) + COALESCE(customer_score,0) +
           COALESCE(product_knowledge,0) + COALESCE(teamwork_score,0) +
           COALESCE(attendance_score,0)) /
          NULLIF(
            (CASE WHEN sales_score IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN customer_score IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN product_knowledge IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN teamwork_score IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN attendance_score IS NOT NULL THEN 1 ELSE 0 END),
            0
          ), 1)
  ) STORED,
  -- Narrative
  strengths         TEXT,
  improvement_areas TEXT,
  goals_next_period TEXT,
  -- Acknowledgement
  staff_acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  staff_acknowledged_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, review_period)
);

CREATE INDEX idx_reviews_user     ON performance_reviews(user_id, review_date DESC);
CREATE INDEX idx_reviews_reviewer ON performance_reviews(reviewer_id);
CREATE INDEX idx_reviews_org      ON performance_reviews(organization_id, review_date DESC);
