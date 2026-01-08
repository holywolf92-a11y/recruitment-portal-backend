import { supabaseAdminClient } from '../config/database';

export interface CommunicationTemplate {
  id: string;
  name: string;
  channel: string;
  content: string;
  created_at: string;
}

export interface CreateTemplateData {
  name: string;
  channel: 'email' | 'sms' | 'whatsapp';
  content: string;
}

export interface TemplateFilters {
  search?: string;
  channel?: string;
  limit?: number;
  offset?: number;
}

/**
 * Create a communication template
 */
export async function createTemplate(data: CreateTemplateData, userId: string): Promise<CommunicationTemplate> {
  const db = supabaseAdminClient();

  // Validate required fields
  if (!data.name || data.name.trim().length === 0) {
    throw new Error('Template name is required');
  }

  if (!data.channel) {
    throw new Error('Channel is required');
  }

  if (!['email', 'sms', 'whatsapp'].includes(data.channel)) {
    throw new Error('Invalid channel. Must be email, sms, or whatsapp');
  }

  // Check for duplicate name
  const { data: existing } = await db
    .from('communication_templates')
    .select('id, name')
    .ilike('name', data.name.trim())
    .single();

  if (existing) {
    throw new Error(`Template with name "${existing.name}" already exists`);
  }

  const templateData = {
    name: data.name.trim(),
    channel: data.channel,
    content: data.content || '',
  };

  const { data: template, error } = await db
    .from('communication_templates')
    .insert(templateData)
    .select()
    .single();

  if (error) throw error;
  return template;
}

/**
 * Get template by ID
 */
export async function getTemplateById(id: string, userId: string): Promise<CommunicationTemplate> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('communication_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * List templates with filters
 */
export async function listTemplates(filters: TemplateFilters = {}, userId: string) {
  const db = supabaseAdminClient();
  let query = db.from('communication_templates').select('*', { count: 'exact' });

  // Apply search filter
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,content.ilike.%${filters.search}%`);
  }

  // Filter by channel
  if (filters.channel) {
    query = query.eq('channel', filters.channel);
  }

  // Apply pagination
  if (filters.limit && filters.offset !== undefined) {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (filters.limit) {
    query = query.limit(filters.limit);
  }

  // Order by name
  query = query.order('name', { ascending: true });

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    templates: data,
    total: count,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/**
 * Update template
 */
export async function updateTemplate(
  id: string,
  data: Partial<CreateTemplateData>,
  userId: string
): Promise<CommunicationTemplate> {
  const db = supabaseAdminClient();

  const updateData: any = {};

  if (data.name !== undefined) {
    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Template name cannot be empty');
    }

    // Check for duplicate name (excluding current template)
    const { data: existing } = await db
      .from('communication_templates')
      .select('id, name')
      .ilike('name', data.name.trim())
      .neq('id', id)
      .single();

    if (existing) {
      throw new Error(`Template with name "${existing.name}" already exists`);
    }

    updateData.name = data.name.trim();
  }

  if (data.channel !== undefined) {
    if (!['email', 'sms', 'whatsapp'].includes(data.channel)) {
      throw new Error('Invalid channel. Must be email, sms, or whatsapp');
    }
    updateData.channel = data.channel;
  }

  if (data.content !== undefined) {
    updateData.content = data.content;
  }

  const { data: template, error } = await db
    .from('communication_templates')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return template;
}

/**
 * Delete template
 */
export async function deleteTemplate(id: string, userId: string): Promise<void> {
  const db = supabaseAdminClient();

  const { error } = await db
    .from('communication_templates')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Send communication using template
 */
export async function sendTemplateMessage(
  templateId: string,
  candidateId: string,
  variables: Record<string, string>,
  userId: string
): Promise<{ success: boolean; message_id?: string }> {
  const db = supabaseAdminClient();

  // Get template
  const template = await getTemplateById(templateId, userId);

  // Get candidate
  const { data: candidate, error: candidateError } = await db
    .from('candidates')
    .select('*')
    .eq('id', candidateId)
    .single();

  if (candidateError || !candidate) {
    throw new Error('Candidate not found');
  }

  // Replace variables in content
  let content = template.content;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  // In a real implementation, this would:
  // 1. Send via the specified channel (email/SMS/WhatsApp)
  // 2. Log to communication_log table
  // 3. Update candidate timeline

  // Mock implementation
  await db.from('communication_log').insert({
    template_id: templateId,
    candidate_id: candidateId,
    status: 'sent',
  });

  return {
    success: true,
    message_id: `msg_${Date.now()}`,
  };
}
