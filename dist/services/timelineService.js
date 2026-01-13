"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventTypes = exports.EventCategories = void 0;
exports.createTimelineEvent = createTimelineEvent;
exports.getCandidateTimeline = getCandidateTimeline;
exports.getTimelineEvent = getTimelineEvent;
exports.deleteTimelineEvent = deleteTimelineEvent;
exports.logProfileCreated = logProfileCreated;
exports.logProfileUpdated = logProfileUpdated;
exports.logDocumentUploaded = logDocumentUploaded;
exports.logDocumentDeleted = logDocumentDeleted;
exports.logStatusChanged = logStatusChanged;
exports.logEmailSent = logEmailSent;
const database_1 = require("../config/database");
/**
 * Event categories and types for standardization
 */
exports.EventCategories = {
    PROFILE: 'profile',
    DOCUMENT: 'document',
    APPLICATION: 'application',
    COMMUNICATION: 'communication',
    STATUS: 'status',
    SYSTEM: 'system',
};
exports.EventTypes = {
    // Profile events
    PROFILE_CREATED: 'profile.created',
    PROFILE_UPDATED: 'profile.updated',
    PROFILE_DELETED: 'profile.deleted',
    // Document events
    DOCUMENT_UPLOADED: 'document.uploaded',
    DOCUMENT_DELETED: 'document.deleted',
    CV_PARSED: 'cv.parsed',
    // Application events
    APPLICATION_CREATED: 'application.created',
    APPLICATION_SUBMITTED: 'application.submitted',
    APPLICATION_WITHDRAWN: 'application.withdrawn',
    // Communication events
    EMAIL_SENT: 'email.sent',
    SMS_SENT: 'sms.sent',
    CALL_LOGGED: 'call.logged',
    // Status events
    STATUS_CHANGED: 'status.changed',
    STAGE_CHANGED: 'stage.changed',
    // System events
    DUPLICATE_DETECTED: 'system.duplicate_detected',
    AUTO_MATCHED: 'system.auto_matched',
};
/**
 * Create a timeline event
 */
async function createTimelineEvent(data) {
    const db = (0, database_1.supabaseAdminClient)();
    // `candidate_timeline.actor_user_id` is typically a UUID. Some system flows
    // (e.g., background workers) may provide a non-UUID actor label ("system").
    // In that case, store it in metadata and omit `actor_user_id` to avoid DB errors.
    const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const actorUserId = data.actor_user_id && isUuid(data.actor_user_id) ? data.actor_user_id : undefined;
    const actorLabel = data.actor_user_id && !actorUserId ? data.actor_user_id : undefined;
    const eventData = {
        candidate_id: data.candidate_id,
        event_category: data.event_category,
        event_type: data.event_type,
        actor_user_id: actorUserId,
        metadata: {
            ...(data.metadata || {}),
            ...(actorLabel ? { actor_label: actorLabel } : {}),
        },
    };
    const { data: event, error } = await db
        .from('candidate_timeline')
        .insert(eventData)
        .select()
        .single();
    if (error)
        throw error;
    return event;
}
/**
 * Get timeline events for a candidate
 */
async function getCandidateTimeline(candidateId, options = {}) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db
        .from('candidate_timeline')
        .select('*', { count: 'exact' })
        .eq('candidate_id', candidateId);
    // Apply filters
    if (options.category) {
        query = query.eq('event_category', options.category);
    }
    if (options.startDate) {
        query = query.gte('occurred_at', options.startDate);
    }
    if (options.endDate) {
        query = query.lte('occurred_at', options.endDate);
    }
    // Apply pagination
    if (options.limit && options.offset !== undefined) {
        query = query.range(options.offset, options.offset + options.limit - 1);
    }
    else if (options.limit) {
        query = query.limit(options.limit);
    }
    // Order by most recent first
    query = query.order('occurred_at', { ascending: false });
    const { data, error, count } = await query;
    if (error)
        throw error;
    return {
        events: data || [],
        total: count || 0,
    };
}
/**
 * Get a single timeline event
 */
async function getTimelineEvent(id) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidate_timeline')
        .select('*')
        .eq('id', id)
        .single();
    if (error)
        throw error;
    return data;
}
/**
 * Delete timeline events (admin only - should be rare)
 */
async function deleteTimelineEvent(id) {
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db
        .from('candidate_timeline')
        .delete()
        .eq('id', id);
    if (error)
        throw error;
}
/**
 * Helper functions to log common events
 */
async function logProfileCreated(candidateId, userId, metadata) {
    return createTimelineEvent({
        candidate_id: candidateId,
        event_category: exports.EventCategories.PROFILE,
        event_type: exports.EventTypes.PROFILE_CREATED,
        actor_user_id: userId,
        metadata: {
            ...metadata,
            timestamp: new Date().toISOString(),
        },
    });
}
async function logProfileUpdated(candidateId, userId, changes) {
    return createTimelineEvent({
        candidate_id: candidateId,
        event_category: exports.EventCategories.PROFILE,
        event_type: exports.EventTypes.PROFILE_UPDATED,
        actor_user_id: userId,
        metadata: {
            changes,
            timestamp: new Date().toISOString(),
        },
    });
}
async function logDocumentUploaded(candidateId, userId, documentData) {
    return createTimelineEvent({
        candidate_id: candidateId,
        event_category: exports.EventCategories.DOCUMENT,
        event_type: exports.EventTypes.DOCUMENT_UPLOADED,
        actor_user_id: userId,
        metadata: {
            ...documentData,
            timestamp: new Date().toISOString(),
        },
    });
}
async function logDocumentDeleted(candidateId, userId, documentData) {
    return createTimelineEvent({
        candidate_id: candidateId,
        event_category: exports.EventCategories.DOCUMENT,
        event_type: exports.EventTypes.DOCUMENT_DELETED,
        actor_user_id: userId,
        metadata: {
            ...documentData,
            timestamp: new Date().toISOString(),
        },
    });
}
async function logStatusChanged(candidateId, userId, statusChange) {
    return createTimelineEvent({
        candidate_id: candidateId,
        event_category: exports.EventCategories.STATUS,
        event_type: exports.EventTypes.STATUS_CHANGED,
        actor_user_id: userId,
        metadata: {
            ...statusChange,
            timestamp: new Date().toISOString(),
        },
    });
}
async function logEmailSent(candidateId, userId, emailData) {
    return createTimelineEvent({
        candidate_id: candidateId,
        event_category: exports.EventCategories.COMMUNICATION,
        event_type: exports.EventTypes.EMAIL_SENT,
        actor_user_id: userId,
        metadata: {
            ...emailData,
            timestamp: new Date().toISOString(),
        },
    });
}
