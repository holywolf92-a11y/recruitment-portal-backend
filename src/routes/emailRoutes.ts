import express, { Router, Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';
import { emailService } from '../services/emailService';

export const emailRouter = Router();

// Allow text/plain bodies (some clients send text/plain for JSON).
// This is scoped to the email routes to avoid impacting other middleware.
emailRouter.use(express.text({ type: ['text/plain', 'text/*'], limit: '2mb' }));

function slugifyName(name?: string): string {
  if (!name) return 'candidate';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'candidate';
}

function resolveFrontendUrl(): string {
  const defaultFrontendUrl = 'https://falishamanpower.up.railway.app';
  let frontendUrl = (process.env.FRONTEND_URL || '').trim() || defaultFrontendUrl;

  // Normalize trailing slash to avoid double slashes in templates.
  frontendUrl = frontendUrl.replace(/\/$/, '');

  // Auto-correct legacy hosts if the env var wasn't updated.
  if (
    frontendUrl.includes('recruitment-portal-frontend-production.up.railway.app') ||
    frontendUrl.includes('exquisite-surprise-production.up.railway.app')
  ) {
    return defaultFrontendUrl;
  }

  return frontendUrl;
}

/**
 * Test Hostinger SMTP configuration
 * POST /api/email/test-email
 */
emailRouter.post('/test-email', async (req: Request, res: Response) => {
  try {
    const parsedBody = (() => {
      if (typeof req.body === 'string') {
        try {
          return JSON.parse(req.body);
        } catch {
          return {};
        }
      }
      return req.body || {};
    })();

    const to = parsedBody.to || (req.query.to as string | undefined);
    const subject = parsedBody.subject || 'Hostinger SMTP test email';
    const message = parsedBody.message || 'This is a test email from Falisha Jobs (support@falishajobs.com).';

    if (!to) {
      return res.status(400).json({ error: 'Please provide a recipient email via body.to or query ?to=' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({ error: 'Please provide a valid recipient email address' });
    }

    await emailService.sendEmail({
      to,
      subject,
      text: message,
      html: `<p>${message}</p>`,
    });

    return res.json({
      success: true,
      mode: process.env.RESEND_API_KEY ? 'resend' : 'hostinger-smtp',
      message: process.env.RESEND_API_KEY
        ? 'Test email sent successfully via Resend'
        : 'Test email sent successfully via Hostinger SMTP',
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Failed to send test email',
      mode: process.env.RESEND_API_KEY ? 'resend' : 'hostinger-smtp',
    });
  }
});

/**
 * Send candidate profiles to employer via email
 * POST /api/email/send-to-employer
 */
emailRouter.post('/send-to-employer', async (req: Request, res: Response) => {
  try {
    // Accept bodies that may arrive as strings (e.g., if any upstream middleware leaves raw text)
    const parsedBody = (() => {
      if (typeof req.body === 'string') {
        try {
          return JSON.parse(req.body);
        } catch (err) {
          console.warn('[EmailRouter] Failed to parse string body as JSON', err);
          return {};
        }
      }
      return req.body || {};
    })();

    console.log('\n\n========== EMAIL ROUTE HANDLER ==========');
    console.log('[EmailRouter] Full req.body:', JSON.stringify(parsedBody, null, 2));
    console.log('[EmailRouter] req.body type:', typeof parsedBody);
    console.log('[EmailRouter] req.body constructor:', parsedBody?.constructor?.name);
    console.log('[EmailRouter] req.body keys:', Object.keys(parsedBody || {}));
    
    const { candidateIds, employerEmail, employerId, message } = parsedBody as any;

    console.log('[EmailRouter] After destructuring:');
    console.log('[EmailRouter]   candidateIds:', candidateIds);
    console.log('[EmailRouter]   candidateIds type:', typeof candidateIds);
    console.log('[EmailRouter]   candidateIds is array?:', Array.isArray(candidateIds));
    console.log('[EmailRouter]   candidateIds length:', candidateIds?.length);
    console.log('[EmailRouter]   employerEmail:', employerEmail);
    console.log('[EmailRouter]   employerId:', employerId);
    console.log('[EmailRouter]   message:', message);
    console.log('========================================\n');

    // Validation
    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
      console.log('[EmailRouter] ❌ VALIDATION FAILED');
      console.log('[EmailRouter] Reason:', {
        candidateIdsExists: !!candidateIds,
        isArray: Array.isArray(candidateIds),
        length: candidateIds?.length
      });
      return res.status(400).json({ error: 'Please provide at least one candidate ID' });
    }
    
    console.log('[EmailRouter] ✅ VALIDATION PASSED - ', candidateIds.length, 'candidates');

    // Get employer email (from direct input or by looking up employer ID)
    let targetEmail = employerEmail;
    
    if (!targetEmail && employerId) {
      const supabase = supabaseAdminClient();
      const { data: employer, error: employerError } = await supabase
        .from('employers')
        .select('email')
        .eq('id', employerId)
        .single();

      if (employerError) {
        console.error('[EmailRouter] Error fetching employer:', employerError);
        return res.status(500).json({ error: 'Failed to fetch employer details' });
      }

      if (!employer?.email) {
        return res.status(400).json({ error: 'Selected employer has no email address. Please enter manually.' });
      }

      targetEmail = employer.email;
    }

    if (!targetEmail) {
      return res.status(400).json({ error: 'Please provide employer email address' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    // Fetch candidate details
    const supabase = supabaseAdminClient();
    const { data: candidates, error: fetchError } = await supabase
      .from('candidates')
      .select('id, name, position, date_of_birth, nationality')
      .in('id', candidateIds);

    if (fetchError) {
      console.error('[EmailRouter] Error fetching candidates:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch candidate data' });
    }

    if (!candidates || candidates.length === 0) {
      return res.status(404).json({ error: 'No candidates found with provided IDs' });
    }

    // Calculate age helper
    const calculateAge = (dateOfBirth?: string): number | undefined => {
      if (!dateOfBirth) return undefined;
      try {
        const birthDate = new Date(dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        return age;
      } catch {
        return undefined;
      }
    };

    // Detect primary position (most common position among selected candidates)
    const positionCounts: Record<string, number> = {};
    candidates.forEach(c => {
      if (c.position) {
        positionCounts[c.position] = (positionCounts[c.position] || 0) + 1;
      }
    });
    
    let primaryPosition: string | undefined;
    let maxCount = 0;
    Object.entries(positionCounts).forEach(([pos, count]) => {
      if (count > maxCount) {
        maxCount = count;
        primaryPosition = pos;
      }
    });

    // Build candidate data for email
    const frontendUrl = resolveFrontendUrl();
    const backendBaseUrl = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
    const apiBaseUrl = backendBaseUrl.replace(/\/$/, '').endsWith('/api')
      ? backendBaseUrl.replace(/\/$/, '')
      : `${backendBaseUrl.replace(/\/$/, '')}/api`;
    const candidateData = candidates.map(candidate => ({
      id: candidate.id,
      name: candidate.name || 'Unknown',
      age: calculateAge(candidate.date_of_birth),
      nationality: candidate.nationality,
      position: candidate.position,
      profileLink: `${frontendUrl}/profile/${candidate.id}/${slugifyName(candidate.name)}`,
      cvDownloadLink: `${apiBaseUrl}/cv-generator/${candidate.id}/download?format=employer-safe&force=true`,
    }));

    // Send email
    await emailService.sendCandidateProfilesToEmployer({
      employerEmail: targetEmail,
      candidates: candidateData,
      position: primaryPosition,
      message,
    });

    console.log(`[EmailRouter] Successfully sent ${candidates.length} candidate profiles to ${targetEmail}`);

    return res.status(200).json({
      success: true,
      message: `Email sent successfully to ${targetEmail}`,
      candidateCount: candidates.length,
    });

  } catch (error: any) {
    console.error('[EmailRouter] Error sending email:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to send email. Please try again.' 
    });
  }
});

/**
 * Get list of employers (for dropdown selection)
 * GET /api/email/employers
 */
emailRouter.get('/employers', async (req: Request, res: Response) => {
  try {
    const supabase = supabaseAdminClient();
    
    const { data: employers, error } = await supabase
      .from('employers')
      .select('id, company_name, email')
      .order('company_name', { ascending: true });

    if (error) {
      console.error('[EmailRouter] Error fetching employers:', error);
      return res.status(500).json({ error: 'Failed to fetch employers' });
    }

    return res.status(200).json({ 
      success: true,
      employers: employers || [] 
    });

  } catch (error: any) {
    console.error('[EmailRouter] Error fetching employers:', error);
    return res.status(500).json({ error: 'Failed to fetch employers' });
  }
});
/**
 * Manually trigger missing-documents email to one or all candidates.
 *
 * POST /api/email/send-missing-docs
 * Body (single):  { candidateId: string, force?: boolean }
 * Body (bulk):    { all: true, force?: boolean }
 *
 * Returns: { sent, skipped, errors, details[] }
 */
emailRouter.post('/send-missing-docs', async (req: Request, res: Response) => {
  try {
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
    const force = !!body.force;
    const { maybeSendMissingDataEmail } = await import('../services/missingDataEmailService');

    // ── Single candidate ─────────────────────────────────────────────────────
    if (body.candidateId) {
      const { candidateId } = body;

      const emailIdRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!emailIdRegex.test(candidateId)) {
        return res.status(400).json({ error: 'Invalid candidateId format (expected UUID)' });
      }

      const result = await maybeSendMissingDataEmail({ candidateId, trigger: 'manual_admin', force });

      return res.json({
        sent: result.sent ? 1 : 0,
        skipped: result.sent ? 0 : 1,
        errors: 0,
        details: [{ candidateId, ...result }],
      });
    }

    // ── Bulk: all eligible candidates ────────────────────────────────────────
    if (body.all === true) {
      const db = supabaseAdminClient();
      const { data: candidates, error: dbError } = await db
        .from('candidates')
        .select('id')
        .not('email', 'is', null)
        .not('missing_data_email_status', 'in', '("stopped","completed")');

      if (dbError) {
        console.error('[EmailRouter] send-missing-docs bulk query failed:', dbError);
        return res.status(500).json({ error: 'Failed to fetch candidates', detail: dbError.message });
      }

      let sent = 0, skipped = 0, errors = 0;
      const details: { candidateId: string; sent?: boolean; reason?: string; error?: string }[] = [];

      for (const candidate of (candidates || [])) {
        try {
          const result = await maybeSendMissingDataEmail({
            candidateId: candidate.id,
            trigger: 'manual_admin',
            force,
          });
          if (result.sent) {
            sent++;
            details.push({ candidateId: candidate.id, sent: true });
          } else {
            skipped++;
            details.push({ candidateId: candidate.id, sent: false, reason: result.reason });
          }
        } catch (err: any) {
          errors++;
          details.push({ candidateId: candidate.id, error: err?.message || 'Unknown error' });
          console.error('[EmailRouter] send-missing-docs error for', candidate.id, err);
        }
      }

      console.log(`[EmailRouter] send-missing-docs bulk: sent=${sent} skipped=${skipped} errors=${errors}`);
      return res.json({ sent, skipped, errors, details });
    }

    return res.status(400).json({ error: 'Provide either candidateId (string) or all: true in request body' });
  } catch (error: any) {
    console.error('[EmailRouter] send-missing-docs error:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});