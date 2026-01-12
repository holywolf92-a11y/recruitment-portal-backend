"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCandidateData = extractCandidateData;
exports.updateExtraction = updateExtraction;
exports.getExtractionHistory = getExtractionHistory;
const database_1 = require("../config/database");
/**
 * Extract candidate data from CV using Python parser
 */
async function extractCandidateData(candidateId, cvUrl, userId) {
    try {
        // Call Python CV parser
        const extractionResult = await callPythonParser(cvUrl);
        if (!extractionResult.success || !extractionResult.data) {
            throw new Error(extractionResult.error || 'Python parser failed');
        }
        const extractedData = extractionResult.data;
        // Update candidate with extracted data
        const db = (0, database_1.supabaseAdminClient)();
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
    }
    catch (error) {
        console.error('Extraction error:', error);
        throw error;
    }
}
/**
 * Call Python parser service to extract CV data
 */
async function callPythonParser(cvUrl) {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        // Path to Python script
        const pythonScript = require('path').join(__dirname, '../../..', 'python-parser', 'extract_cv.py');
        // If the CV URL is a storage path (not starting with http), convert to signed URL
        let extractUrl = cvUrl;
        if (!cvUrl.startsWith('http')) {
            const db = (0, database_1.supabaseAdminClient)();
            const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'candidate-documents';
            try {
                // Generate a 1-hour signed URL for the storage path
                const { data, error } = await db.storage
                    .from(STORAGE_BUCKET)
                    .createSignedUrl(cvUrl, 3600);
                if (error || !data.signedUrl) {
                    throw new Error(`Failed to generate signed URL: ${error?.message || 'Unknown error'}`);
                }
                extractUrl = data.signedUrl;
            }
            catch (urlError) {
                console.error('Failed to create signed URL:', urlError);
                throw new Error(`Failed to create signed URL for extraction: ${urlError.message}`);
            }
        }
        // Execute Python script
        const { stdout, stderr } = await execAsync(`python "${pythonScript}" "${extractUrl}"`);
        if (stderr) {
            console.error('Python parser stderr:', stderr);
        }
        // Parse result
        const result = JSON.parse(stdout);
        if (result.error) {
            return { success: false, error: result.error };
        }
        return { success: true, data: result };
    }
    catch (error) {
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
async function updateExtraction(candidateId, extractedData, approved, notes, userId) {
    try {
        // Update candidate record
        const db = (0, database_1.supabaseAdminClient)();
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
        await logExtractionHistory(candidateId, extractedData, approved ? 'human-reviewed' : 'rejected', userId, notes);
        return {
            success: true,
            data,
            message: approved ? 'Extraction approved and saved' : 'Extraction rejected'
        };
    }
    catch (error) {
        console.error('Update extraction error:', error);
        throw error;
    }
}
/**
 * Get extraction history for a candidate
 */
async function getExtractionHistory(candidateId, userId) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
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
    }
    catch (error) {
        console.error('Get extraction history error:', error);
        throw error;
    }
}
/**
 * Log extraction to history table
 */
async function logExtractionHistory(candidateId, extractedData, source, userId, notes) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
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
    }
    catch (error) {
        console.error('Log extraction history error:', error);
    }
}
