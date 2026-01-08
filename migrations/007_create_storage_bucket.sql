-- Create storage bucket for documents
-- This should be run in Supabase SQL Editor or via Supabase Dashboard

-- Create the documents bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for documents bucket
-- Allow authenticated users to upload
CREATE POLICY "Allow authenticated uploads" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

-- Allow authenticated users to read their documents
CREATE POLICY "Allow authenticated reads" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

-- Allow authenticated users to delete their documents
CREATE POLICY "Allow authenticated deletes" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'documents');

-- Allow service role full access
CREATE POLICY "Service role full access" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'documents');
