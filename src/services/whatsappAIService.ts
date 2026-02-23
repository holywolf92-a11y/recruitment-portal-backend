import { createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppAIService');

export interface WhatsAppConversationContext {
  from: string;
  text: string;
  messageHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
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
    const systemPrompt = `You are a professional recruitment assistant for Falisha Manpower.

Your role:
- Help candidates with job applications and CV submissions
- Answer questions about job opportunities, requirements, and the application process
- Be polite, professional, and helpful
- Keep responses concise (2-3 sentences max for WhatsApp)
- If a candidate wants to apply, guide them to send their CV as a document/image
- If they ask about job status, assure them that a team member will contact them

Important:
- Never ask for sensitive information like passwords or credit cards
- Don't make promises about job placement or guarantees
- Always maintain a professional, friendly tone
- If you don't know something, say so and offer to connect them with a team member`;

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
