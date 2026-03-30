"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const node_fetch_1 = __importDefault(require("node-fetch"));
const errorHandling_1 = require("../utils/errorHandling");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const router = (0, express_1.Router)();
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4310';
function getBridgeBaseUrl() {
    return (process.env.WHATSAPP_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
}
async function proxyBridge(pathname, options) {
    const response = await (0, node_fetch_1.default)(`${getBridgeBaseUrl()}${pathname}`, {
        method: options?.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options?.body,
    });
    const text = await response.text();
    return {
        status: response.status,
        body: text,
        contentType: response.headers.get('content-type') || 'application/json',
    };
}
router.use(auth_1.authenticate);
router.use((0, rbac_1.requireRole)('admin', 'manager'));
router.get('/status', (0, errorHandling_1.asyncHandler)(async (_req, res) => {
    try {
        const result = await proxyBridge('/status');
        res.status(result.status).type(result.contentType).send(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
}));
router.get('/sessions/:accountId/qr', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const accountId = encodeURIComponent(req.params.accountId);
    try {
        const result = await proxyBridge(`/sessions/${accountId}/qr`);
        res.status(result.status).type(result.contentType).send(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
}));
router.post('/sessions/:accountId/pairing-code', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const accountId = encodeURIComponent(req.params.accountId);
    const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : '';
    try {
        const result = await proxyBridge(`/sessions/${accountId}/pairing-code`, {
            method: 'POST',
            body: JSON.stringify({ phoneNumber }),
        });
        res.status(result.status).type(result.contentType).send(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
}));
router.post('/sessions/:accountId/connect', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const accountId = encodeURIComponent(req.params.accountId);
    try {
        const result = await proxyBridge(`/sessions/${accountId}/connect`, {
            method: 'POST',
        });
        res.status(result.status).type(result.contentType).send(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
}));
router.post('/sessions/:accountId/restart', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const accountId = encodeURIComponent(req.params.accountId);
    try {
        const result = await proxyBridge(`/sessions/${accountId}/restart`, {
            method: 'POST',
        });
        res.status(result.status).type(result.contentType).send(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
}));
router.post('/sessions/:accountId/cancel', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const accountId = encodeURIComponent(req.params.accountId);
    try {
        const result = await proxyBridge(`/sessions/${accountId}/cancel`, {
            method: 'POST',
        });
        res.status(result.status).type(result.contentType).send(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ ok: false, error: 'bridge_unreachable', message });
    }
}));
exports.default = router;
