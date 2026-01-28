"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfToImage = pdfToImage;
exports.pdfUrlToImage = pdfUrlToImage;
exports.saveImageToStorage = saveImageToStorage;
exports.extractAndSavePhotoFromPdf = extractAndSavePhotoFromPdf;
const puppeteer_1 = __importDefault(require("puppeteer"));
const database_1 = require("../config/database");
const uuid_1 = require("uuid");
/**
 * Convert PDF to image using Puppeteer
 * Takes the first page and renders it as a screenshot
 */
async function pdfToImage(pdfUrl) {
    let browser;
    try {
        console.log(`[PDF to Image] Converting: ${pdfUrl.substring(0, 80)}...`);
        // Launch headless browser
        browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        // Set viewport for good quality
        await page.setViewport({ width: 800, height: 1000 });
        // Navigate to PDF
        await page.goto(`file://${pdfUrl}`, {
            waitUntil: 'networkidle0',
            timeout: 30000,
        });
        // Take screenshot
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 90 });
        console.log(`[PDF to Image] Successfully converted (${screenshot.length} bytes)`);
        return screenshot;
    }
    catch (e) {
        console.error(`[PDF to Image] Error:`, e);
        return null;
    }
    finally {
        if (browser) {
            await browser.close();
        }
    }
}
/**
 * Download PDF from URL and render as image
 */
async function pdfUrlToImage(pdfUrl) {
    let browser;
    try {
        console.log(`[PDF URL to Image] Converting: ${pdfUrl.substring(0, 80)}...`);
        // Launch headless browser
        browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        // Set viewport for good quality
        await page.setViewport({ width: 800, height: 1000 });
        // Navigate to PDF URL
        await page.goto(pdfUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000,
        });
        // Take screenshot of first page
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: false });
        console.log(`[PDF URL to Image] Successfully converted (${screenshot.length} bytes)`);
        return screenshot;
    }
    catch (e) {
        console.error(`[PDF URL to Image] Error:`, e);
        return null;
    }
    finally {
        if (browser) {
            await browser.close();
        }
    }
}
/**
 * Save image to Supabase storage
 */
async function saveImageToStorage(candidateId, imageBuffer) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const filename = `extracted_${Date.now()}_${(0, uuid_1.v4)()}.jpg`;
        const storagePath = `candidates/${candidateId}/profile_photos/${filename}`;
        console.log(`[Save Image] Saving to: documents/${storagePath}`);
        // Upload to storage
        const { error: uploadError } = await db.storage
            .from('documents')
            .upload(storagePath, imageBuffer, {
            contentType: 'image/jpeg',
            upsert: false,
        });
        if (uploadError) {
            console.error(`[Save Image] Upload error:`, uploadError);
            return null;
        }
        // Generate signed URL (10 minutes)
        const { data: signedData, error: signError } = await db.storage
            .from('documents')
            .createSignedUrl(storagePath, 600);
        if (signError || !signedData) {
            console.error(`[Save Image] Sign error:`, signError);
            return null;
        }
        console.log(`[Save Image] Successfully saved and signed`);
        return signedData.signedUrl;
    }
    catch (e) {
        console.error(`[Save Image] Error:`, e);
        return null;
    }
}
/**
 * Complete pipeline: Convert PDF to image and save
 */
async function extractAndSavePhotoFromPdf(candidateId, pdfUrl) {
    try {
        // Convert PDF to image
        const imageBuffer = await pdfUrlToImage(pdfUrl);
        if (!imageBuffer) {
            console.warn(`[Extract Photo] Failed to convert PDF to image`);
            return null;
        }
        // Save to storage
        const signedUrl = await saveImageToStorage(candidateId, imageBuffer);
        return signedUrl;
    }
    catch (e) {
        console.error(`[Extract Photo] Pipeline error:`, e);
        return null;
    }
}
