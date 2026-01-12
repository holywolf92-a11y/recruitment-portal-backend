"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashString = hashString;
exports.hashRequest = hashRequest;
exports.hashFile = hashFile;
const crypto_1 = __importDefault(require("crypto"));
// Deterministic stringify to avoid hash drift from key ordering
function stableStringify(value) {
    if (value === null || value === undefined)
        return String(value);
    if (value instanceof Date)
        return value.toISOString();
    if (Buffer.isBuffer(value))
        return value.toString('base64');
    const valueType = typeof value;
    if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
        return String(value);
    }
    if (valueType === 'string')
        return value;
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    if (valueType === 'object') {
        const keys = Object.keys(value).sort();
        const serialized = keys.map((key) => `${key}:${stableStringify(value[key])}`).join(',');
        return `{${serialized}}`;
    }
    return String(value);
}
function hashString(input) {
    return crypto_1.default.createHash('sha256').update(input || '').digest('hex');
}
function hashRequest(payload) {
    const serialized = stableStringify(payload ?? {});
    return hashString(serialized);
}
function hashFile(fileBuffer) {
    return crypto_1.default.createHash('sha256').update(fileBuffer).digest('hex');
}
