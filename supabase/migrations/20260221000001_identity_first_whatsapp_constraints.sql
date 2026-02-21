-- Identity-first WhatsApp binding support

-- 1) Track deterministic identity conflicts (CNIC/passport/email vs phone mismatch)
ALTER TABLE public.candidate_documents
ADD COLUMN IF NOT EXISTS identity_conflict boolean NOT NULL DEFAULT false;

-- 2) One-time cleanup: existing data may already contain duplicates for inbox_attachment_id.
-- Keep the most recent row per inbox_attachment_id and null out the others so we don't lose documents.
-- (The unique index below only applies when inbox_attachment_id IS NOT NULL.)
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM public.candidate_documents
		WHERE inbox_attachment_id IS NOT NULL
		GROUP BY inbox_attachment_id
		HAVING COUNT(*) > 1
	) THEN
		WITH ranked AS (
			SELECT
				id,
				inbox_attachment_id,
				ROW_NUMBER() OVER (
					PARTITION BY inbox_attachment_id
					ORDER BY created_at DESC, received_at DESC, updated_at DESC, id DESC
				) AS rn
			FROM public.candidate_documents
			WHERE inbox_attachment_id IS NOT NULL
		)
		UPDATE public.candidate_documents cd
		SET
			inbox_attachment_id = NULL,
			notes = CASE
				WHEN cd.notes IS NULL OR btrim(cd.notes) = ''
					THEN 'Deduped: inbox_attachment_id cleared to satisfy unique constraint'
				ELSE cd.notes || E'\n' || 'Deduped: inbox_attachment_id cleared to satisfy unique constraint'
			END,
			updated_at = NOW()
		FROM ranked r
		WHERE cd.id = r.id
			AND r.rn > 1;
	END IF;
END $$;

-- 2) Idempotency hardening: only one candidate_document can be created per inbox attachment
-- Use a partial unique index so NULLs are allowed (for rows not sourced from inbox attachments)
CREATE UNIQUE INDEX IF NOT EXISTS candidate_documents_unique_inbox_attachment_id
ON public.candidate_documents (inbox_attachment_id)
WHERE inbox_attachment_id IS NOT NULL;
