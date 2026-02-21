-- WhatsApp media-level idempotency + audit/dedupe helpers

-- Store WhatsApp identifiers on the attachment row so we can enforce uniqueness.
ALTER TABLE public.inbox_attachments
ADD COLUMN IF NOT EXISTS whatsapp_wamid text,
ADD COLUMN IF NOT EXISTS whatsapp_media_id text;

-- Enforce media-level idempotency (same WhatsApp message media should only create one attachment)
CREATE UNIQUE INDEX IF NOT EXISTS inbox_attachments_unique_whatsapp_media
ON public.inbox_attachments (whatsapp_wamid, whatsapp_media_id)
WHERE whatsapp_wamid IS NOT NULL AND whatsapp_media_id IS NOT NULL;

-- Hash lookup index (sha256 already stored); helps audit/dedupe queries without enforcing uniqueness.
CREATE INDEX IF NOT EXISTS idx_inbox_attachments_sha256
ON public.inbox_attachments (sha256)
WHERE sha256 IS NOT NULL;
