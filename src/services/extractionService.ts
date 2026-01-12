import { supabaseAdminClient } from '../config/database';

interface ExtractionData {
  nationality?: string;
  position?: string;
  experience_years?: number;
  country_of_interest?: string;
  skills?: string[];
  languages?: string[];
  education?: string;
  certifications?: string[];
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

    // Update candidate with extracted data
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('candidates')
      .update({
        ...extractedData,
        extraction_source: extractedData.extraction_source || 'python-parser-v1',
        extracted_at: new Date().toISOString()
      })
      .eq('id', candidateId)
      .eq('user_id', userId)
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
 * Call Python parser service to extract CV data
 */
async function callPythonParser(cvUrl: string): Promise<{ success: boolean; data?: ExtractionData; error?: string }> {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Path to Python script
    const pythonScript = require('path').join(__dirname, '../../..', 'python-parser', 'extract_cv.py');
    
    // Execute Python script
    const { stdout, stderr } = await execAsync(`python "${pythonScript}" "${cvUrl}"`);
    
    if (stderr) {
      console.error('Python parser stderr:', stderr);
    }
    
    // Parse result
    const result = JSON.parse(stdout);
    
    if (result.error) {
      return { success: false, error: result.error };
    }
    
    return { success: true, data: result };
    
  } catch (error: any) {
    console.error('Failed to call Python parser:', error);
    return { 
      success: false, 
      error: error.message || 'Python parser execution failed' 
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
      .eq('user_id', userId)
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
      .eq('user_id', userId)
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
    const { error } = await db
      .from('extraction_history')
      .insert({
        candidate_id: candidateId,
        extracted_data: extractedData,
        extraction_source: source,
        extraction_confidence: extractedData.extraction_confidence || {},
        notes,
        user_id: userId,
        extracted_at: new Date().toISOString()
      });

    if (error) {
      console.error('Failed to log extraction history:', error);
    }
  } catch (error) {
    console.error('Log extraction history error:', error);
  }
}
