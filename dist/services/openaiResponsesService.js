"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openaiCreateJsonSchemaResponse = openaiCreateJsonSchemaResponse;
exports.openaiCreateJsonSchemaTextResponse = openaiCreateJsonSchemaTextResponse;
function getEnv(name) {
    const v = process.env[name];
    return v && v.trim().length > 0 ? v.trim() : undefined;
}
async function openaiCreateJsonSchemaResponse(args) {
    const apiKey = getEnv('OPENAI_API_KEY');
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY missing');
    }
    const timeoutMs = args.timeoutMs ?? Number(getEnv('OPENAI_TIMEOUT_MS') || 20000);
    const detail = args.detail ?? (getEnv('OPENAI_VISION_DETAIL') || 'high');
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const format = {
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
        const data = JSON.parse(text);
        const msg = data.output?.find((o) => o.type === 'message');
        const refusal = msg?.content?.find((c) => c.type === 'refusal')?.refusal;
        if (refusal) {
            throw new Error(`OpenAI refused: ${refusal}`);
        }
        const out = msg?.content?.find((c) => c.type === 'output_text')?.text;
        if (!out) {
            throw new Error('OpenAI response missing output_text');
        }
        return JSON.parse(out);
    }
    finally {
        clearTimeout(t);
    }
}
async function openaiCreateJsonSchemaTextResponse(args) {
    const apiKey = getEnv('OPENAI_API_KEY');
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY missing');
    }
    const timeoutMs = args.timeoutMs ?? Number(getEnv('OPENAI_TIMEOUT_MS') || 20000);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const format = {
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
        const data = JSON.parse(text);
        const msg = data.output?.find((o) => o.type === 'message');
        const refusal = msg?.content?.find((c) => c.type === 'refusal')?.refusal;
        if (refusal) {
            throw new Error(`OpenAI refused: ${refusal}`);
        }
        const out = msg?.content?.find((c) => c.type === 'output_text')?.text;
        if (!out) {
            throw new Error('OpenAI response missing output_text');
        }
        return JSON.parse(out);
    }
    finally {
        clearTimeout(t);
    }
}
