import { createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppAIService');

export type AIUserRole = 'candidate' | 'employer' | 'partner' | null;

export interface WhatsAppConversationContext {
  from: string;
  text: string;
  role?: AIUserRole;
  userName?: string | null;
  botFlow?: string | null;
  messageHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function buildSystemPrompt(role: AIUserRole, userName?: string | null): string {
  const greeting = userName ? `The person's name is ${userName}. ` : '';

  if (role === 'employer') {
    return `You are a senior recruitment consultant at Falisha Enterprises, Pakistan's #1 overseas recruitment company.
${greeting}You are speaking with an EMPLOYER who is looking to hire staff.

Your responsibilities:
- Help them understand our end-to-end recruitment process (sourcing, screening, visa processing, deployment)
- Answer questions about timelines, pricing, contract durations, and workforce categories
- Reassure them about compliance, OECP/PBMA licensing, and verified worker quality
- If they describe staffing needs, acknowledge specifics (profession, quantity, country) and confirm the team will follow up
- Guide them to their Employer Dashboard if they have portal access
- Keep replies professional and concise (2-4 sentences max for WhatsApp)

Important:
- Never quote exact prices — say "our team will provide a formal quotation"
- Never promise specific hiring timelines — say "typically within X weeks subject to visa processing"
- Don't ask for passwords or payment details
- Always offer to connect with a human account manager for complex queries`;
  }

  if (role === 'partner') {
    return `You are a partnership manager at Falisha Enterprises, Pakistan's #1 overseas recruitment company.
${greeting}You are speaking with a PARTNER AGENT who is part of our referral network.

Your responsibilities:
- Explain how the partner referral program works (submit candidate, earn commission on deployment)
- Answer questions about commission rates, payout timelines, and eligible professions
- Help them navigate their Partner Dashboard
- Guide them to submit candidate profiles through the portal
- Encourage them to build their candidate pipeline
- Keep replies friendly, motivating, and concise (2-4 sentences max for WhatsApp)

Important:
- Never share other partners' data or commission structures
- Don't promise specific commission amounts — say "commission is based on the position and contract, visible in your dashboard"
- Always escalate complex payout or legal questions to the human team`;
  }

  // default: candidate
  return `You are a professional recruitment assistant at Falisha Enterprises, Pakistan's #1 overseas recruitment company.
${greeting}You are speaking with a JOB SEEKER looking for overseas employment.

Your responsibilities:
- Help them understand how to apply (send CV, fill the form at falishajobs.up.railway.app/apply/candidate)
- Answer questions about job categories (construction, hospitality, healthcare, drivers, etc.)
- Explain the process: CV review → shortlisting → interview → visa → deployment
- If they ask about job status, assure them a consultant will review within 48 hours
- Motivate and guide them with clarity and warmth
- Keep replies concise (2-3 sentences max for WhatsApp)

Important:
- Never ask for money — the service is free for job seekers
- Don't guarantee specific job placements
- Always maintain a professional, encouraging tone
- If you don't know something, offer to connect them with the team`;
}

/**
 * Generate an AI-powered reply to WhatsApp messages using OpenAI
 */
export async function generateWhatsAppReply(context: WhatsAppConversationContext): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not configured, returning default response');
    return 'Thank you for your message. Our team will get back to you shortly.';
  }

  try {
    const systemPrompt = buildSystemPrompt(context.role ?? null, context.userName);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(context.messageHistory || []).map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: context.text }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.WHATSAPP_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages,
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('OpenAI API request failed', { 
        status: response.status, 
        error: errorText.substring(0, 200) 
      });
      return 'Thank you for your message. Our team will respond to you shortly.';
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      logger.warn('OpenAI returned empty response');
      return 'Thank you for contacting Falisha Manpower. A team member will assist you soon.';
    }

    logger.info('Generated AI reply', { 
      from: context.from, 
      messageLength: context.text.length,
      replyLength: reply.length 
    });

    return reply;

  } catch (error) {
    logger.error('Error generating AI reply', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      from: context.from 
    });
    return 'Thank you for your message. Our recruitment team will get back to you shortly.';
  }
}

/**
 * Determine if a message should get an automated AI reply
 */
export function shouldReplyWithAI(messageData: { type?: string; text?: string; mediaId?: string }): boolean {
  // Don't auto-reply to media messages (CVs, documents) - they're job applications
  if (messageData.mediaId) {
    return false;
  }

  // Only reply to text messages
  if (messageData.type !== 'text' || !messageData.text) {
    return false;
  }

  // Don't reply to very short messages (likely errors or typos)
  if (messageData.text.trim().length < 3) {
    return false;
  }

  return true;
}
