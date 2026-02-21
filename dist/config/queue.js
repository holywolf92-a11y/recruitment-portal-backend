"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappAttachmentVerificationQueue = exports.whatsappMediaQueue = exports.documentVerificationQueue = exports.cvParsingQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("./redis");
exports.cvParsingQueue = new bullmq_1.Queue('cv-parsing', {
    connection: redis_1.redis,
});
exports.documentVerificationQueue = new bullmq_1.Queue('document-verification', {
    connection: redis_1.redis,
});
exports.whatsappMediaQueue = new bullmq_1.Queue('whatsapp-media', {
    connection: redis_1.redis,
});
// Identity-first WhatsApp flow: verify/extract identity from inbox_attachments BEFORE linking/binding.
exports.whatsappAttachmentVerificationQueue = new bullmq_1.Queue('whatsapp-attachment-verification', {
    connection: redis_1.redis,
});
