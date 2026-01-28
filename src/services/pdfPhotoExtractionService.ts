import puppeteer from 'puppeteer';
import { supabaseAdminClient } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * Convert PDF to image using Puppeteer
 * Takes the first page and renders it as a screenshot
 */
export async function pdfToImage(pdfUrl: string): Promise<Buffer | null> {
  let browser;
  try {
    console.log(`[PDF to Image] Converting: ${pdfUrl.substring(0, 80)}...`);
    
    // Launch headless browser
    browser = await puppeteer.launch({
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
    return screenshot as Buffer;
  } catch (e) {
    console.error(`[PDF to Image] Error:`, e);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Download PDF from URL and render as image
 */
export async function pdfUrlToImage(pdfUrl: string): Promise<Buffer | null> {
  let browser;
  try {
    console.log(`[PDF URL to Image] Converting: ${pdfUrl.substring(0, 80)}...`);
    
    // Launch headless browser
    browser = await puppeteer.launch({
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
    return screenshot as Buffer;
  } catch (e) {
    console.error(`[PDF URL to Image] Error:`, e);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Save image to Supabase storage
 */
export async function saveImageToStorage(
  candidateId: string,
  imageBuffer: Buffer
): Promise<string | null> {
  try {
    const db = supabaseAdminClient();
    const filename = `extracted_${Date.now()}_${uuidv4()}.jpg`;
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
    return (signedData as any).signedUrl;
  } catch (e) {
    console.error(`[Save Image] Error:`, e);
    return null;
  }
}

/**
 * Complete pipeline: Convert PDF to image and save
 */
export async function extractAndSavePhotoFromPdf(
  candidateId: string,
  pdfUrl: string
): Promise<string | null> {
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
  } catch (e) {
    console.error(`[Extract Photo] Pipeline error:`, e);
    return null;
  }
}

