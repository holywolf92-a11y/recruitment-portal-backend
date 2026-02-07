type JsonSchema = Record<string, any>;

type OpenAIJsonSchemaFormat = {
  type: 'json_schema';
  name: string;
  strict: true;
  schema: JsonSchema;
};

type OpenAIResponse = {
  output?: Array<{
    type: string;
    role?: string;
    content?: Array<{ type: string; text?: string; refusal?: string }>;
  }>;
};

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export async function openaiCreateJsonSchemaResponse<T>(args: {
  model: string;
  prompt: string;
  imageDataUrl: string;
  schemaName: string;
  schema: JsonSchema;
  timeoutMs?: number;
  detail?: 'low' | 'high' | 'auto';
}): Promise<T> {
  const apiKey = getEnv('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const timeoutMs = args.timeoutMs ?? Number(getEnv('OPENAI_TIMEOUT_MS') || 20000);
  const detail = args.detail ?? ((getEnv('OPENAI_VISION_DETAIL') as any) || 'high');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const format: OpenAIJsonSchemaFormat = {
      type: 'json_schema',
      name: args.schemaName,
      strict: true,
      schema: args.schema,
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: args.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: args.prompt },
              { type: 'input_image', image_url: args.imageDataUrl, detail },
            ],
          },
        ],
        text: {
          format,
        },
      }),
      signal: controller.signal,
    });

    const text = await r.text();
    if (!r.ok) {
      throw new Error(`OpenAI request failed (${r.status}): ${text.substring(0, 500)}`);
    }

    const data = JSON.parse(text) as OpenAIResponse;
    const msg = data.output?.find((o) => o.type === 'message');
    const refusal = msg?.content?.find((c) => c.type === 'refusal')?.refusal;
    if (refusal) {
      throw new Error(`OpenAI refused: ${refusal}`);
    }
    const out = msg?.content?.find((c) => c.type === 'output_text')?.text;
    if (!out) {
      throw new Error('OpenAI response missing output_text');
    }

    return JSON.parse(out) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function openaiCreateJsonSchemaTextResponse<T>(args: {
  model: string;
  prompt: string;
  schemaName: string;
  schema: JsonSchema;
  timeoutMs?: number;
}): Promise<T> {
  const apiKey = getEnv('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const timeoutMs = args.timeoutMs ?? Number(getEnv('OPENAI_TIMEOUT_MS') || 20000);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const format: OpenAIJsonSchemaFormat = {
      type: 'json_schema',
      name: args.schemaName,
      strict: true,
      schema: args.schema,
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: args.model,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: args.prompt }],
          },
        ],
        text: {
          format,
        },
      }),
      signal: controller.signal,
    });

    const text = await r.text();
    if (!r.ok) {
      throw new Error(`OpenAI request failed (${r.status}): ${text.substring(0, 500)}`);
    }

    const data = JSON.parse(text) as OpenAIResponse;
    const msg = data.output?.find((o) => o.type === 'message');
    const refusal = msg?.content?.find((c) => c.type === 'refusal')?.refusal;
    if (refusal) {
      throw new Error(`OpenAI refused: ${refusal}`);
    }
    const out = msg?.content?.find((c) => c.type === 'output_text')?.text;
    if (!out) {
      throw new Error('OpenAI response missing output_text');
    }

    return JSON.parse(out) as T;
  } finally {
    clearTimeout(t);
  }
}
