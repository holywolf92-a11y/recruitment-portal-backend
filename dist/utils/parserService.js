"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getParserBaseUrls = getParserBaseUrls;
exports.getPreferredParserBaseUrl = getPreferredParserBaseUrl;
exports.fetchParser = fetchParser;
const errorHandling_1 = require("./errorHandling");
const logger = (0, errorHandling_1.createLogger)('ParserService');
const DEFAULT_PUBLIC_PARSER_URL = 'https://recruitment-python-parser-production.up.railway.app';
const DEFAULT_INTERNAL_PARSER_URL = 'http://recruitment-python-parser.railway.internal:8000';
const DEFAULT_LOCAL_PARSER_URL = 'http://127.0.0.1:8000';
function normalizeBaseUrl(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    return normalized || null;
}
function isRailwayRuntime() {
    return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}
function getKnownPublicParserUrls() {
    const railwayServiceParserHost = normalizeBaseUrl(process.env.RAILWAY_SERVICE_RECRUITMENT_PYTHON_PARSER_URL);
    return Array.from(new Set([
        DEFAULT_PUBLIC_PARSER_URL,
        railwayServiceParserHost,
        railwayServiceParserHost ? normalizeBaseUrl(`https://${railwayServiceParserHost}`) : null,
    ].filter((value) => Boolean(value))));
}
function shouldTryInternalParserUrl(configuredUrls) {
    if (!isRailwayRuntime())
        return false;
    if (process.env.RAILWAY_SERVICE_NAME === 'recruitment-python-parser')
        return false;
    if (configuredUrls.length === 0)
        return true;
    const knownPublicParserUrls = new Set(getKnownPublicParserUrls());
    return configuredUrls.some((url) => knownPublicParserUrls.has(url));
}
function getParserBaseUrls() {
    const configuredUrls = [
        normalizeBaseUrl(process.env.PYTHON_CV_PARSER_URL),
        normalizeBaseUrl(process.env.PARSER_URL),
    ].filter((value) => Boolean(value));
    const baseUrls = [];
    if (shouldTryInternalParserUrl(configuredUrls)) {
        baseUrls.push(DEFAULT_INTERNAL_PARSER_URL);
    }
    if (configuredUrls.length > 0) {
        baseUrls.push(...configuredUrls);
    }
    else if (isRailwayRuntime()) {
        baseUrls.push(DEFAULT_PUBLIC_PARSER_URL);
    }
    else {
        baseUrls.push(DEFAULT_LOCAL_PARSER_URL);
    }
    return Array.from(new Set(baseUrls));
}
function getPreferredParserBaseUrl() {
    return getParserBaseUrls()[0] || DEFAULT_LOCAL_PARSER_URL;
}
async function fetchParser(pathname, init) {
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const baseUrls = getParserBaseUrls();
    let lastError;
    for (let index = 0; index < baseUrls.length; index += 1) {
        const baseUrl = baseUrls[index];
        const targetUrl = `${baseUrl}${path}`;
        try {
            return await fetch(targetUrl, init);
        }
        catch (error) {
            lastError = error;
            if (index < baseUrls.length - 1) {
                logger.warn('Parser request failed, trying fallback URL', {
                    targetUrl,
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Parser request failed');
}
