-- Track Facebook posts on job leads so we can show "already posted" state
-- and avoid duplicate posts.

ALTER TABLE job_leads
  ADD COLUMN IF NOT EXISTS fb_post_id TEXT,
  ADD COLUMN IF NOT EXISTS fb_posted_at TIMESTAMPTZ;

COMMENT ON COLUMN job_leads.fb_post_id     IS 'Facebook Graph API post ID after posting to the page';
COMMENT ON COLUMN job_leads.fb_posted_at   IS 'Timestamp of the most recent Facebook post for this lead';
