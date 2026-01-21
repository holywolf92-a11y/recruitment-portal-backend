"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentVerificationQueue = exports.cvParsingQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("./redis");
exports.cvParsingQueue = new bullmq_1.Queue('cv-parsing', {
    connection: redis_1.redis,
});
exports.documentVerificationQueue = new bullmq_1.Queue('document-verification', {
    connection: redis_1.redis,
});
