-- ============================================================================
-- Clear All Data Script
-- ============================================================================
-- This script deletes ALL data from the database while preserving the schema.
-- 
-- ⚠️  WARNING: This will permanently delete all data!
-- 
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================================

-- Clear child tables first (those with foreign keys)
TRUNCATE TABLE document_verification_logs CASCADE;
TRUNCATE TABLE unmatched_documents CASCADE;
TRUNCATE TABLE candidate_documents CASCADE;
TRUNCATE TABLE documents CASCADE;
TRUNCATE TABLE parsing_jobs CASCADE;
TRUNCATE TABLE inbox_attachments CASCADE;
TRUNCATE TABLE communication_log CASCADE;
TRUNCATE TABLE job_candidate_matches CASCADE;
TRUNCATE TABLE cv_versions CASCADE;
TRUNCATE TABLE share_links CASCADE;
TRUNCATE TABLE candidate_timeline CASCADE;
TRUNCATE TABLE form_submissions CASCADE;
TRUNCATE TABLE idempotency_keys CASCADE;
TRUNCATE TABLE audit_log CASCADE;

-- Clear parent tables
TRUNCATE TABLE candidates CASCADE;
TRUNCATE TABLE inbox_messages CASCADE;
TRUNCATE TABLE job_orders CASCADE;
TRUNCATE TABLE employers CASCADE;
TRUNCATE TABLE communication_templates CASCADE;
TRUNCATE TABLE matching_runs CASCADE;

-- Note: 'users' table is NOT cleared by default
-- Uncomment the line below if you want to clear users too:
-- TRUNCATE TABLE users CASCADE;

-- ============================================================================
-- Verification Query (run after clearing to verify)
-- ============================================================================
-- Uncomment to check record counts (should all be 0):
/*
SELECT 
  'candidates' as table_name, COUNT(*) as count FROM candidates
UNION ALL
SELECT 'documents', COUNT(*) FROM documents
UNION ALL
SELECT 'candidate_documents', COUNT(*) FROM candidate_documents
UNION ALL
SELECT 'inbox_attachments', COUNT(*) FROM inbox_attachments
UNION ALL
SELECT 'inbox_messages', COUNT(*) FROM inbox_messages
UNION ALL
SELECT 'job_orders', COUNT(*) FROM job_orders
UNION ALL
SELECT 'employers', COUNT(*) FROM employers
UNION ALL
SELECT 'communication_templates', COUNT(*) FROM communication_templates
UNION ALL
SELECT 'matching_runs', COUNT(*) FROM matching_runs
UNION ALL
SELECT 'document_verification_logs', COUNT(*) FROM document_verification_logs
UNION ALL
SELECT 'unmatched_documents', COUNT(*) FROM unmatched_documents
UNION ALL
SELECT 'parsing_jobs', COUNT(*) FROM parsing_jobs
UNION ALL
SELECT 'communication_log', COUNT(*) FROM communication_log
UNION ALL
SELECT 'job_candidate_matches', COUNT(*) FROM job_candidate_matches
UNION ALL
SELECT 'cv_versions', COUNT(*) FROM cv_versions
UNION ALL
SELECT 'share_links', COUNT(*) FROM share_links
UNION ALL
SELECT 'candidate_timeline', COUNT(*) FROM candidate_timeline
UNION ALL
SELECT 'form_submissions', COUNT(*) FROM form_submissions
UNION ALL
SELECT 'idempotency_keys', COUNT(*) FROM idempotency_keys
UNION ALL
SELECT 'audit_log', COUNT(*) FROM audit_log;
*/

-- ============================================================================
-- Alternative: If TRUNCATE doesn't work, use DELETE instead
-- ============================================================================
-- Uncomment the section below if TRUNCATE fails due to constraints:
/*
DELETE FROM document_verification_logs;
DELETE FROM unmatched_documents;
DELETE FROM candidate_documents;
DELETE FROM documents;
DELETE FROM parsing_jobs;
DELETE FROM inbox_attachments;
DELETE FROM communication_log;
DELETE FROM job_candidate_matches;
DELETE FROM cv_versions;
DELETE FROM share_links;
DELETE FROM candidate_timeline;
DELETE FROM form_submissions;
DELETE FROM idempotency_keys;
DELETE FROM audit_log;
DELETE FROM candidates;
DELETE FROM inbox_messages;
DELETE FROM job_orders;
DELETE FROM employers;
DELETE FROM communication_templates;
DELETE FROM matching_runs;
*/
