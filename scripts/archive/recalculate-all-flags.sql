-- ============================================================================
-- Recalculate Document Flags for All Candidates (SQL Version)
-- ============================================================================
-- This SQL script recalculates document flags based on actual documents
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================================

-- Function to recalculate flags for a single candidate
DO $$
DECLARE
  candidate_record RECORD;
  doc_count INTEGER;
  cv_found BOOLEAN;
  passport_found BOOLEAN;
  cnic_found BOOLEAN;
  certificate_found BOOLEAN;
  photo_found BOOLEAN;
  medical_found BOOLEAN;
  visa_found BOOLEAN;
BEGIN
  -- Loop through all candidates
  FOR candidate_record IN SELECT id FROM candidates LOOP
    -- Reset flags
    cv_found := false;
    passport_found := false;
    cnic_found := false;
    certificate_found := false;
    photo_found := false;
    medical_found := false;
    visa_found := false;
    
    -- Check candidate_documents
    SELECT COUNT(*) INTO doc_count
    FROM candidate_documents
    WHERE candidate_id = candidate_record.id
      AND (
        category = 'cv_resume' OR
        category = 'passport' OR
        category = 'certificates' OR
        category = 'photos' OR
        category = 'medical_reports'
      );
    
    -- Check for CV
    SELECT EXISTS(
      SELECT 1 FROM candidate_documents
      WHERE candidate_id = candidate_record.id
        AND category = 'cv_resume'
    ) INTO cv_found;
    
    IF NOT cv_found THEN
      SELECT EXISTS(
        SELECT 1 FROM inbox_attachments
        WHERE (candidate_id = candidate_record.id OR linked_candidate_id = candidate_record.id)
          AND (attachment_kind = 'cv' OR document_type = 'cv')
      ) INTO cv_found;
    END IF;
    
    -- Check for Passport
    SELECT EXISTS(
      SELECT 1 FROM candidate_documents
      WHERE candidate_id = candidate_record.id
        AND category = 'passport'
    ) INTO passport_found;
    
    IF NOT passport_found THEN
      SELECT EXISTS(
        SELECT 1 FROM inbox_attachments
        WHERE (candidate_id = candidate_record.id OR linked_candidate_id = candidate_record.id)
          AND document_type = 'passport'
      ) INTO passport_found;
    END IF;
    
    -- Check for CNIC
    SELECT EXISTS(
      SELECT 1 FROM candidate_documents
      WHERE candidate_id = candidate_record.id
        AND document_type = 'cnic'
    ) INTO cnic_found;
    
    IF NOT cnic_found THEN
      SELECT EXISTS(
        SELECT 1 FROM inbox_attachments
        WHERE (candidate_id = candidate_record.id OR linked_candidate_id = candidate_record.id)
          AND document_type = 'cnic'
      ) INTO cnic_found;
    END IF;
    
    -- Check for Certificate/Degree
    SELECT EXISTS(
      SELECT 1 FROM candidate_documents
      WHERE candidate_id = candidate_record.id
        AND (category = 'certificates' OR document_type IN ('certificate', 'degree'))
    ) INTO certificate_found;
    
    -- Check for Photo
    SELECT EXISTS(
      SELECT 1 FROM candidate_documents
      WHERE candidate_id = candidate_record.id
        AND category = 'photos'
    ) INTO photo_found;
    
    -- Check for Medical
    SELECT EXISTS(
      SELECT 1 FROM candidate_documents
      WHERE candidate_id = candidate_record.id
        AND category = 'medical_reports'
    ) INTO medical_found;
    
    -- Check for Visa
    SELECT EXISTS(
      SELECT 1 FROM candidate_documents
      WHERE candidate_id = candidate_record.id
        AND document_type = 'visa'
    ) INTO visa_found;
    
    -- Update candidate flags
    UPDATE candidates
    SET
      cv_received = cv_found,
      cv_received_at = CASE WHEN cv_found THEN NOW() ELSE NULL END,
      passport_received = passport_found,
      passport_received_at = CASE WHEN passport_found THEN NOW() ELSE NULL END,
      cnic_received = cnic_found,
      cnic_received_at = CASE WHEN cnic_found THEN NOW() ELSE NULL END,
      certificate_received = certificate_found,
      certificate_received_at = CASE WHEN certificate_found THEN NOW() ELSE NULL END,
      degree_received = certificate_found,
      degree_received_at = CASE WHEN certificate_found THEN NOW() ELSE NULL END,
      photo_received = photo_found,
      photo_received_at = CASE WHEN photo_found THEN NOW() ELSE NULL END,
      medical_received = medical_found,
      medical_received_at = CASE WHEN medical_found THEN NOW() ELSE NULL END,
      visa_received = visa_found,
      visa_received_at = CASE WHEN visa_found THEN NOW() ELSE NULL END
    WHERE id = candidate_record.id;
    
  END LOOP;
  
  RAISE NOTICE 'Flag recalculation complete for all candidates';
END $$;

-- Verify the results
SELECT 
  id,
  name,
  candidate_code,
  cv_received,
  passport_received,
  certificate_received,
  photo_received,
  medical_received
FROM candidates
ORDER BY created_at DESC
LIMIT 10;
