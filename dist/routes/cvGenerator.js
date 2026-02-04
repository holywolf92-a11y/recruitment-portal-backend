"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const cvGeneratorController_1 = require("../controllers/cvGeneratorController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Health check for Puppeteer
// GET /api/cv-generator/health
router.get('/health', async (req, res) => {
    try {
        const puppeteer = await Promise.resolve().then(() => __importStar(require('puppeteer')));
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        // Try to launch Puppeteer
        const launchOptions = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        };
        if (executablePath) {
            launchOptions.executablePath = executablePath;
        }
        const browser = await puppeteer.launch(launchOptions);
        await browser.close();
        res.json({
            status: 'ok',
            puppeteer: 'working',
            executablePath: executablePath || 'bundled',
            platform: process.platform,
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            puppeteer: 'failed',
            error: error.message,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            platform: process.platform,
        });
    }
});
// Download CV (redirect to signed URL)
// GET /api/cv-generator/:candidateId/download?format=employer-safe&force=true
router.get('/:candidateId/download', cvGeneratorController_1.downloadCVController);
// Generate single CV (returns JSON)
// GET /api/cv-generator/:candidateId?format=employer-safe&force=true
router.get('/:candidateId', cvGeneratorController_1.generateSingleCVController);
// Get CV generation status
// GET /api/cv-generator/:candidateId/status?format=employer-safe
router.get('/:candidateId/status', cvGeneratorController_1.getCVStatusController);
// Generate bulk CVs
// POST /api/cv-generator/bulk
router.post('/bulk', cvGeneratorController_1.generateBulkCVsController);
exports.default = router;
