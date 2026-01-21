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
exports.getVerificationLogsByRequestId = getVerificationLogsByRequestId;
exports.getVerificationLogsByDocumentId = getVerificationLogsByDocumentId;
exports.getVerificationLogsByCandidateId = getVerificationLogsByCandidateId;
exports.getVerificationTimeline = getVerificationTimeline;
exports.getVerificationStatsByCandidate = getVerificationStatsByCandidate;
const documentVerificationLogService_1 = require("../services/documentVerificationLogService");
/**
 * Get verification logs by request_id
 */
async function getVerificationLogsByRequestId(req, res) {
    try {
        const { requestId } = req.params;
        if (!requestId) {
            return res.status(400).json({
                success: false,
                error: 'request_id is required',
            });
        }
        const logs = await documentVerificationLogService_1.documentVerificationLogService.getLogsByRequestId(requestId);
        return res.json({
            success: true,
            request_id: requestId,
            total_events: logs.length,
            logs,
        });
    }
    catch (error) {
        console.error('[getVerificationLogsByRequestId] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch verification logs',
            message: error.message,
        });
    }
}
/**
 * Get verification logs by document_id
 */
async function getVerificationLogsByDocumentId(req, res) {
    try {
        const { documentId } = req.params;
        if (!documentId) {
            return res.status(400).json({
                success: false,
                error: 'document_id is required',
            });
        }
        const logs = await documentVerificationLogService_1.documentVerificationLogService.getLogsByDocumentId(documentId);
        return res.json({
            success: true,
            document_id: documentId,
            total_events: logs.length,
            logs,
        });
    }
    catch (error) {
        console.error('[getVerificationLogsByDocumentId] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch verification logs',
            message: error.message,
        });
    }
}
/**
 * Get verification logs by candidate_id
 */
async function getVerificationLogsByCandidateId(req, res) {
    try {
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({
                success: false,
                error: 'candidate_id is required',
            });
        }
        const logs = await documentVerificationLogService_1.documentVerificationLogService.getLogsByCandidateId(candidateId);
        return res.json({
            success: true,
            candidate_id: candidateId,
            total_events: logs.length,
            logs,
        });
    }
    catch (error) {
        console.error('[getVerificationLogsByCandidateId] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch verification logs',
            message: error.message,
        });
    }
}
/**
 * Get verification timeline view (aggregated view with processing durations)
 */
async function getVerificationTimeline(req, res) {
    try {
        const { candidateId, documentId, limit = '50' } = req.query;
        const limitNum = parseInt(limit, 10);
        // Build query for document_verification_timeline view
        const db = (await Promise.resolve().then(() => __importStar(require('../config/database')))).supabaseAdminClient();
        let query = db
            .from('document_verification_timeline')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limitNum);
        if (candidateId) {
            query = query.eq('candidate_id', candidateId);
        }
        if (documentId) {
            query = query.eq('document_id', documentId);
        }
        const { data: timeline, error } = await query;
        if (error) {
            throw new Error(`Database error: ${error.message}`);
        }
        return res.json({
            success: true,
            total: timeline?.length || 0,
            filters: { candidateId, documentId, limit: limitNum },
            logs: timeline || [], // Test expects 'logs' not 'timeline'
            timeline: timeline || [],
        });
    }
    catch (error) {
        console.error('[getVerificationTimeline] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch verification timeline',
            message: error.message,
        });
    }
}
/**
 * Get verification statistics for a candidate
 */
async function getVerificationStatsByCandidate(req, res) {
    try {
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({
                success: false,
                error: 'candidate_id is required',
            });
        }
        const db = (await Promise.resolve().then(() => __importStar(require('../config/database')))).supabaseAdminClient();
        // Get document counts by verification status
        const { data: documents, error: docsError } = await db
            .from('candidate_documents')
            .select('id, verification_status, category')
            .eq('candidate_id', candidateId);
        if (docsError) {
            throw new Error(`Database error: ${docsError.message}`);
        }
        // Group by verification status
        const statusCounts = {};
        const categoryCounts = {};
        documents?.forEach((doc) => {
            const status = doc.verification_status || 'unknown';
            const category = doc.category || 'unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        });
        // Get recent verification events
        const { data: recentEvents, error: eventsError } = await db
            .from('document_verification_logs')
            .select('id, event_type, created_at, verification_status, reason_code')
            .eq('candidate_id', candidateId)
            .order('created_at', { ascending: false })
            .limit(10);
        if (eventsError) {
            throw new Error(`Events error: ${eventsError.message}`);
        }
        return res.json({
            success: true,
            candidate_id: candidateId,
            stats: {
                total_documents: documents?.length || 0,
                by_status: statusCounts,
                by_category: categoryCounts,
            },
            statistics: {
                total_documents: documents?.length || 0,
                by_status: statusCounts,
                by_category: categoryCounts,
            },
            recent_events: recentEvents || [],
        });
    }
    catch (error) {
        console.error('[getVerificationStatsByCandidate] Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch verification statistics',
            message: error.message,
        });
    }
}
