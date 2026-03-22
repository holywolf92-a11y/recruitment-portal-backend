import { supabaseAdminClient } from '../config/database';

interface ExtractionData {
  nationality?: string;
  father_name?: string;
  position?: string;
  experience_years?: number;
  country_of_interest?: string;
  skills?: string[];
  languages?: string[];
  education?: string;
  certifications?: string[];
  internships?: string[];
  previous_employment?: string;
  passport_expiry?: string;
  professional_summary?: string;
  extraction_confidence?: Record<string, number>;
  extraction_source?: string;
}

/**
 * Extract candidate data from CV using Python parser
 */
export async function extractCandidateData(
  candidateId: string,
  cvUrl: string,
  userId: string
) {
  try {
    // Call Python CV parser
    const extractionResult = await callPythonParser(cvUrl);
    
    if (!extractionResult.success || !extractionResult.data) {
      throw new Error(extractionResult.error || 'Python parser failed');
    }

    const extractedData: ExtractionData = extractionResult.data;

    // Normalize list fields for storage
    const normalizedData = {
      ...extractedData,
      certifications: Array.isArray(extractedData.certifications)
        ? extractedData.certifications.join(', ')
        : extractedData.certifications,
      internships: Array.isArray(extractedData.internships)
        ? extractedData.internships.join(', ')
        : extractedData.internships,
    };

    // Update candidate with extracted data
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('candidates')
      .update({
        ...normalizedData,
        extraction_source: extractedData.extraction_source || 'python-parser-v1',
        extracted_at: new Date().toISOString()
      })
      .eq('id', candidateId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update candidate: ${error.message}`);
    }

    // Log extraction to history
    await logExtractionHistory(candidateId, extractedData, 'automated', userId);

    return {
      success: true,
      data: extractedData,
      message: 'CV data extracted successfully'
    };
  } catch (error: any) {
    console.error('Extraction error:', error);
    throw error;
  }
}

/**
 * Call Python parser service to extract CV data via HTTP
 */
async function callPythonParser(cvUrl: string): Promise<{ success: boolean; data?: ExtractionData; error?: string }> {
  try {
    const PY_URL = process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-python-parser-production.up.railway.app';
    const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || '';
    const crypto = require('crypto');
    const sign = (body: string) =>
      crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
    
    // If the CV URL is a storage path (not starting with http), convert to signed URL
    let extractUrl = cvUrl;
    if (!cvUrl.startsWith('http')) {
      const db = supabaseAdminClient();
      // Use 'documents' bucket (same as candidateDocumentService uses)
      // This matches where files are actually stored: candidates/{id}/documents/{filename}
      const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'documents';
      
      try {
        // Generate a 1-hour signed URL for the storage path
        const { data, error } = await db.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(cvUrl, 3600);
        
        if (error || !data.signedUrl) {
          throw new Error(`Failed to generate signed URL: ${error?.message || 'Unknown error'}`);
        }
        
        extractUrl = data.signedUrl;
      } catch (urlError: any) {
        console.error('Failed to create signed URL:', urlError);
        throw new Error(`Failed to create signed URL for extraction: ${urlError.message}`);
      }
    }
    
    const payload = JSON.stringify({ file_url: extractUrl });

    // Call Python parser service via HTTP.
    // Fall back to /parse for deployments that do not expose /parse-cv.
    const response = await fetch(`${PY_URL}/parse-cv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sign(payload),
      },
      body: payload,
    });

    let parsed: any;
    if (response.ok) {
      parsed = await response.json();
    } else {
      const errorText = await response.text();
      const isMissingRoute = response.status === 404 && /Cannot POST \/parse-cv/i.test(errorText);
      if (!isMissingRoute) {
        throw new Error(`Python parser service error: ${response.status} ${errorText}`);
      }

      const fileResponse = await fetch(extractUrl);
      if (!fileResponse.ok) {
        throw new Error(`Failed to fetch CV for parser fallback: ${fileResponse.status} ${fileResponse.statusText}`);
      }

      const fileArrayBuffer = await fileResponse.arrayBuffer();
      const fileBuffer = Buffer.from(fileArrayBuffer);
      const fileBase64 = fileBuffer.toString('base64');
      const fileName = extractUrl.split('/').pop()?.split('?')[0] || 'cv.pdf';
      const lowerName = fileName.toLowerCase();
      const mimeType =
        lowerName.endsWith('.pdf')
          ? 'application/pdf'
          : lowerName.endsWith('.doc')
            ? 'application/msword'
            : lowerName.endsWith('.docx')
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'application/octet-stream';

      const fallbackPayload = JSON.stringify({
        file_content: fileBase64,
        file_name: fileName,
        mime_type: mimeType,
      });

      const fallbackResponse = await fetch(`${PY_URL}/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hmac-signature': sign(fallbackPayload),
        },
        body: fallbackPayload,
      });

      if (!fallbackResponse.ok) {
        const fallbackText = await fallbackResponse.text();
        throw new Error(`Python parser fallback error: ${fallbackResponse.status} ${fallbackText}`);
      }

      const fallbackParsed = await fallbackResponse.json();
      parsed = fallbackParsed?.data ?? fallbackParsed;
    }
    
    // Map the parsed data to ExtractionData format
    const candidateData = parsed.candidate || parsed;
    const extractedData: ExtractionData = {
      nationality: candidateData.nationality,
      father_name: candidateData.father_name,
      position: candidateData.position,
      experience_years: candidateData.experience_years,
      country_of_interest: candidateData.country_of_interest,
      skills: candidateData.skills || [],
      languages: candidateData.languages || [],
      education: candidateData.education,
      certifications: candidateData.certifications || [],
      internships: candidateData.internships || [],
      previous_employment: candidateData.previous_employment,
      passport_expiry: candidateData.passport_expiry,
      professional_summary: candidateData.professional_summary || candidateData.summary,
      extraction_confidence: candidateData.confidence || {},
      extraction_source: 'python-parser-v1',
    };
    
    return { success: true, data: extractedData };
    
  } catch (error: any) {
    console.error('Failed to call Python parser service:', error);
    return { 
      success: false, 
      error: error.message || 'Python parser service call failed' 
    };
  }
}

/**
 * Update candidate with reviewed extraction data
 */
export async function updateExtraction(
  candidateId: string,
  extractedData: ExtractionData,
  approved: boolean,
  notes: string | undefined,
  userId: string
) {
  try {
    // Update candidate record
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('candidates')
      .update({
        ...extractedData,
        extraction_source: approved ? 'human-reviewed' : 'rejected',
        extracted_at: new Date().toISOString()
      })
      .eq('id', candidateId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update candidate: ${error.message}`);
    }

    // Log to history
    await logExtractionHistory(
      candidateId,
      extractedData,
      approved ? 'human-reviewed' : 'rejected',
      userId,
      notes
    );

    return {
      success: true,
      data,
      message: approved ? 'Extraction approved and saved' : 'Extraction rejected'
    };
  } catch (error: any) {
    console.error('Update extraction error:', error);
    throw error;
  }
}

/**
 * Get extraction history for a candidate
 */
export async function getExtractionHistory(candidateId: string, userId: string) {
  try {
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('extraction_history')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('extracted_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch extraction history: ${error.message}`);
    }

    return data || [];
  } catch (error: any) {
    console.error('Get extraction history error:', error);
    throw error;
  }
}

/**
 * Log extraction to history table
 */
async function logExtractionHistory(
  candidateId: string,
  extractedData: ExtractionData,
  source: string,
  userId: string,
  notes?: string
) {
  try {
    const db = supabaseAdminClient();

    const payload: any = {
      candidate_id: candidateId,
      extracted_data: extractedData,
      confidence_scores: extractedData.extraction_confidence || {},
      notes,
      extracted_at: new Date().toISOString(),
    };

    if (source === 'human-reviewed') {
      payload.approved = true;
      payload.reviewed_at = new Date().toISOString();
    } else if (source === 'rejected') {
      payload.approved = false;
      payload.reviewed_at = new Date().toISOString();
    }

    const { error } = await db
      .from('extraction_history')
      .insert(payload);

    if (error) {
      console.error('Failed to log extraction history:', error);
    }
  } catch (error) {
    console.error('Log extraction history error:', error);
  }
}
