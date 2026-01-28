"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPdfPageToJpeg = renderPdfPageToJpeg;
exports.renderPdfPageCropToJpeg = renderPdfPageCropToJpeg;
const puppeteer_1 = __importDefault(require("puppeteer"));
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function renderPdfPageToJpeg(args) {
    const timeoutMs = args.timeoutMs ?? 30000;
    const viewport = {
        width: args.viewport.width,
        height: args.viewport.height,
        deviceScaleFactor: args.viewport.deviceScaleFactor ?? 2,
    };
    let browser;
    try {
        browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport(viewport);
        const url = args.pdfUrl.includes('#')
            ? args.pdfUrl
            : `${args.pdfUrl}#page=${Math.max(1, args.pageNumber)}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
        // Give the built-in PDF viewer a beat to finish painting.
        await sleep(800);
        const jpeg = (await page.screenshot({
            type: 'jpeg',
            quality: 90,
            fullPage: false,
        }));
        return { jpeg, viewport };
    }
    finally {
        if (browser) {
            await browser.close();
        }
    }
}
async function renderPdfPageCropToJpeg(args) {
    const timeoutMs = args.timeoutMs ?? 30000;
    const viewport = {
        width: args.viewport.width,
        height: args.viewport.height,
        deviceScaleFactor: args.viewport.deviceScaleFactor ?? 2,
    };
    const clip = {
        x: Math.max(0, Math.floor(args.clip.x)),
        y: Math.max(0, Math.floor(args.clip.y)),
        width: Math.max(1, Math.floor(args.clip.width)),
        height: Math.max(1, Math.floor(args.clip.height)),
    };
    // Clamp clip to viewport.
    clip.width = Math.min(clip.width, viewport.width - clip.x);
    clip.height = Math.min(clip.height, viewport.height - clip.y);
    let browser;
    try {
        browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport(viewport);
        const url = args.pdfUrl.includes('#')
            ? args.pdfUrl
            : `${args.pdfUrl}#page=${Math.max(1, args.pageNumber)}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
        await sleep(800);
        const jpeg = (await page.screenshot({
            type: 'jpeg',
            quality: 92,
            fullPage: false,
            clip,
        }));
        return { jpeg, viewport };
    }
    finally {
        if (browser) {
            await browser.close();
        }
    }
}
