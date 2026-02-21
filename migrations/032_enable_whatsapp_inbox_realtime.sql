-- 032_enable_whatsapp_inbox_realtime.sql

-- Enable Supabase Realtime for the WhatsApp Inbox tables.
-- For Postgres changes to stream, tables must be added to the `supabase_realtime` publication.
-- We also set REPLICA IDENTITY FULL so UPDATE events include enough row data.

ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  END IF;
END $do$;
