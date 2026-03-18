"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitFeedbackController = submitFeedbackController;
exports.trackAnalyticsController = trackAnalyticsController;
exports.listFeedbackController = listFeedbackController;
exports.getReviewStatsController = getReviewStatsController;
const database_1 = require("../config/database");
// POST /api/review/feedback — store internal feedback for 1–3 star ratings
async function submitFeedbackController(req, res) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { rating, message } = req.body;
        if (typeof rating !== 'number' || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'rating must be a number between 1 and 5' });
        }
        // Only accept low ratings for internal feedback (4-5 should go to Google)
        if (rating > 3) {
            return res.status(400).json({ error: 'High ratings should redirect to Google, not submit here' });
        }
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
        const userAgent = req.headers['user-agent'] || null;
        const { data, error } = await db
            .from('review_feedback')
            .insert({ rating, message: message?.trim() || null, ip_address: ip, user_agent: userAgent })
            .select('id')
            .single();
        if (error) {
            console.error('[ReviewController] Insert feedback error:', error);
            return res.status(500).json({ error: 'Failed to save feedback' });
        }
        return res.status(201).json({ success: true, id: data.id });
    }
    catch (err) {
        console.error('[ReviewController] Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
// POST /api/review/analytics — lightweight event tracking
async function trackAnalyticsController(req, res) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { event, rating, template_idx } = req.body;
        const validEvents = ['page_view', 'star_select', 'template_select', 'redirect_google', 'feedback_submit'];
        if (!event || !validEvents.includes(event)) {
            return res.status(400).json({ error: `event must be one of: ${validEvents.join(', ')}` });
        }
        const { error } = await db
            .from('review_analytics')
            .insert({ event, rating: rating ?? null, template_idx: template_idx ?? null });
        if (error) {
            console.error('[ReviewController] Track analytics error:', error);
            // Non-fatal — don't fail the response over analytics
        }
        return res.status(200).json({ success: true });
    }
    catch (err) {
        console.error('[ReviewController] Analytics unexpected error:', err);
        return res.status(200).json({ success: true }); // silent fail for analytics
    }
}
// GET /api/review/admin/feedback — admin view of all internal feedback
async function listFeedbackController(req, res) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Number(req.query.offset) || 0;
        const { data, error, count } = await db
            .from('review_feedback')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) {
            console.error('[ReviewController] List feedback error:', error);
            return res.status(500).json({ error: 'Failed to fetch feedback' });
        }
        return res.json({ feedback: data, total: count });
    }
    catch (err) {
        console.error('[ReviewController] List feedback unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
// GET /api/review/admin/stats — summary stats for dashboard
async function getReviewStatsController(req, res) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        // Total feedback counts by rating
        const { data: feedbackData, error: feedbackError } = await db
            .from('review_feedback')
            .select('rating');
        if (feedbackError) {
            return res.status(500).json({ error: 'Failed to fetch stats' });
        }
        const ratingCounts = { 1: 0, 2: 0, 3: 0 };
        (feedbackData || []).forEach((row) => {
            if (row.rating in ratingCounts)
                ratingCounts[row.rating]++;
        });
        // Total Google redirects from analytics
        const { count: googleRedirects } = await db
            .from('review_analytics')
            .select('*', { count: 'exact', head: true })
            .eq('event', 'redirect_google');
        // Page views
        const { count: pageViews } = await db
            .from('review_analytics')
            .select('*', { count: 'exact', head: true })
            .eq('event', 'page_view');
        return res.json({
            internal_feedback: {
                total: feedbackData?.length || 0,
                by_rating: ratingCounts,
            },
            google_redirects: googleRedirects || 0,
            page_views: pageViews || 0,
        });
    }
    catch (err) {
        console.error('[ReviewController] Stats unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
