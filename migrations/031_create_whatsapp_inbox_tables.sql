-- 031_create_whatsapp_inbox_tables.sql

-- WhatsApp Inbox System tables

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL UNIQUE,
  display_name TEXT,
  candidate_id UUID,

  last_message_preview TEXT,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,

  unread_count INTEGER NOT NULL DEFAULT 0,

  reply_mode TEXT NOT NULL DEFAULT 'ai' CHECK (reply_mode IN ('ai', 'human')),
  taken_over_by UUID,
  taken_over_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_message_at ON whatsapp_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_phone_number ON whatsapp_conversations(phone_number);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,

  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'ai')),
  message_type TEXT NOT NULL DEFAULT 'text',

  from_number TEXT,
  to_number TEXT,
  body TEXT,

  meta_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',

  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  template_name TEXT,

  media_id TEXT,
  mime_type TEXT,
  file_name TEXT,

  raw JSONB,
  sent_by_user_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_meta_message_id ON whatsapp_messages(meta_message_id) WHERE meta_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_created_at ON whatsapp_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_direction ON whatsapp_messages(direction);

-- Enable RLS
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Read-only policies for staff roles (role stored in auth.user_metadata.role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_conversations' AND policyname = 'staff_select_whatsapp_conversations'
  ) THEN
    CREATE POLICY staff_select_whatsapp_conversations
      ON whatsapp_conversations
      FOR SELECT
      USING (
        COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') IN ('admin', 'manager', 'recruiter')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_messages' AND policyname = 'staff_select_whatsapp_messages'
  ) THEN
    CREATE POLICY staff_select_whatsapp_messages
      ON whatsapp_messages
      FOR SELECT
      USING (
        COALESCE((auth.jwt() -> 'user_metadata' ->> 'role'), '') IN ('admin', 'manager', 'recruiter')
      );
  END IF;
END $$;

-- updated_at trigger
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_whatsapp_conversations_updated_at') THEN
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_whatsapp_conversations_updated_at
      BEFORE UPDATE ON whatsapp_conversations
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $do$;
