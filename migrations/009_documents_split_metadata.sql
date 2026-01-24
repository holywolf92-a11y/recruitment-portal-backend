-- Add split-and-categorize metadata to documents
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS pages JSONB,
  ADD COLUMN IF NOT EXISTS confidence FLOAT,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN documents.pages IS 'Page indices from split-and-categorize e.g. [0,1,2]';
COMMENT ON COLUMN documents.metadata IS 'split_strategy, engine_used, needs_review, etc.';
