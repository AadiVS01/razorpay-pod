-- ==============================================================================
-- ZeroClick Trust Ledger Events Table Migration
-- Enables durable, audit-compliant server-side event persistence on Supabase
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.trust_ledger_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  journey_id TEXT,
  session_id TEXT,
  cart_id TEXT,
  order_id TEXT,
  quote_id TEXT,
  product_id TEXT,
  policy_version TEXT,
  status TEXT,
  error_code TEXT,
  amount_paise INTEGER,
  currency TEXT DEFAULT 'INR',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optimized indexes for journey queries, policy version analytics & ledger feeds
CREATE INDEX IF NOT EXISTS idx_trust_ledger_events_journey_id ON public.trust_ledger_events(journey_id);
CREATE INDEX IF NOT EXISTS idx_trust_ledger_events_session_id ON public.trust_ledger_events(session_id);
CREATE INDEX IF NOT EXISTS idx_trust_ledger_events_order_id ON public.trust_ledger_events(order_id);
CREATE INDEX IF NOT EXISTS idx_trust_ledger_events_quote_id ON public.trust_ledger_events(quote_id);
CREATE INDEX IF NOT EXISTS idx_trust_ledger_events_policy_version ON public.trust_ledger_events(policy_version);
CREATE INDEX IF NOT EXISTS idx_trust_ledger_events_created_at ON public.trust_ledger_events(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.trust_ledger_events ENABLE ROW LEVEL SECURITY;

-- Allow public / authorized reads on trust_ledger_events for merchant dashboard feeds
CREATE POLICY "Allow public read on trust_ledger_events"
  ON public.trust_ledger_events FOR SELECT
  USING (true);

-- Allow service role full management on trust_ledger_events
CREATE POLICY "Allow service role full access on trust_ledger_events"
  ON public.trust_ledger_events FOR ALL
  USING (true)
  WITH CHECK (true);
