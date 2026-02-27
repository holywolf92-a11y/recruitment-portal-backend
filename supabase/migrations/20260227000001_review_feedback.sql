-- Review feedback table for internal (1–3 star) submissions
CREATE TABLE IF NOT EXISTS review_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip_address  text,
  user_agent  text
);

-- Track all review page visits / star selections for analytics
CREATE TABLE IF NOT EXISTS review_analytics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event        text NOT NULL,   -- 'page_view' | 'star_select' | 'template_select' | 'redirect_google' | 'feedback_submit'
  rating       smallint,
  template_idx smallint,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS review_feedback_created_at_idx ON review_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS review_analytics_event_idx     ON review_analytics (event);
CREATE INDEX IF NOT EXISTS review_analytics_created_at_idx ON review_analytics (created_at DESC);

-- Row-level security: no select by default (admin queries only via service key)
ALTER TABLE review_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_analytics ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (backend uses service key, bypasses RLS automatically)
