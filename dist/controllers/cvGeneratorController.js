"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCVStatusController = exports.generateBulkCVsController = exports.downloadCVController = exports.generateSingleCVController = void 0;
const cvGeneratorService_1 = require("../services/cvGeneratorService");
const errorHandling_1 = require("../utils/errorHandling");
/**
 * Generate a single CV for a candidate
 * GET /api/cv-generator/:candidateId?format=employer-safe
 */
exports.generateSingleCVController = (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.id || 'system';
    const { candidateId } = req.params;
    const format = req.query.format || 'employer-safe';
    const forceRegenerate = req.query.force === 'true';
    if (!candidateId) {
        return res.status(400).json({ error: 'Candidate ID is required' });
    }
    if (!['standard', 'employer-safe', 'internal'].includes(format)) {
        return res.status(400).json({ error: 'Invalid format. Must be "standard", "employer-safe", or "internal"' });
    }
    const result = await (0, cvGeneratorService_1.generateCV)({
        candidateId,
        format: format,
        forceRegenerate,
        userId,
    });
    res.json({
        cv_url: result.cv_url,
        cached: result.cached,
        version_hash: result.version_hash,
        file_size: result.file_size,
    });
});
/**
 * Download CV for a candidate (redirects to signed URL)
 * GET /api/cv-generator/:candidateId/download?format=employer-safe&force=true
 */
exports.downloadCVController = (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.id || 'system';
    const { candidateId } = req.params;
    const format = req.query.format || 'employer-safe';
    const forceRegenerate = req.query.force === 'true';
    if (!candidateId) {
        return res.status(400).json({ error: 'Candidate ID is required' });
    }
    if (!['standard', 'employer-safe', 'internal'].includes(format)) {
        return res.status(400).json({ error: 'Invalid format. Must be "standard", "employer-safe", or "internal"' });
    }
    const result = await (0, cvGeneratorService_1.generateCV)({
        candidateId,
        format: format,
        forceRegenerate,
        userId,
    });
    return res.redirect(302, result.cv_url);
});
/**
 * Generate CVs for multiple candidates (bulk operation)
 * POST /api/cv-generator/bulk
 */
exports.generateBulkCVsController = (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.id || 'system';
    const request = req.body;
    if (!request.candidate_ids || !Array.isArray(request.candidate_ids) || request.candidate_ids.length === 0) {
        return res.status(400).json({ error: 'candidate_ids array is required and must not be empty' });
    }
    if (request.candidate_ids.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 candidates allowed per bulk request' });
    }
    const results = await (0, cvGeneratorService_1.generateBulkCVs)(request, userId);
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    res.json({
        results,
        summary: {
            total: results.length,
            success: successCount,
            failed: failureCount,
        },
    });
});
/**
 * Get CV generation status for a candidate
 * GET /api/cv-generator/:candidateId/status
 */
exports.getCVStatusController = (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { candidateId } = req.params;
    const format = req.query.format || 'employer-safe';
    if (!candidateId) {
        return res.status(400).json({ error: 'Candidate ID is required' });
    }
    // Import supabase client
    const { supabaseAdminClient } = await Promise.resolve().then(() => __importStar(require('../config/database')));
    const db = supabaseAdminClient();
    // Check if CV exists in cache
    const { data: cached, error } = await db
        .from('generated_cvs')
        .select('version_hash, generated_at, file_size, access_count')
        .eq('candidate_id', candidateId)
        .eq('format', format)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        throw error;
    }
    if (!cached) {
        return res.json({
            exists: false,
            cached: false,
        });
    }
    // Note: To check if cached CV is still valid, we'd need to calculate current version hash
    // For now, return the cached CV status
    res.json({
        exists: true,
        cached: true,
        version_hash: cached.version_hash,
        generated_at: cached.generated_at,
        file_size: cached.file_size,
        access_count: cached.access_count,
    });
});
