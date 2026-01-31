import { Router, Request, Response } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  downloadCVController,
  generateBulkCVsController,
  generateSingleCVController,
  getCVStatusController,
} from '../controllers/cvGeneratorController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Health check for Puppeteer
// GET /api/cv-generator/health
router.get('/health', async (req: Request, res: Response) => {
  try {
    const puppeteer = await import('puppeteer');
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    
    // Try to launch Puppeteer
    const launchOptions: any = {
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
  } catch (error: any) {
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
router.get('/:candidateId/download', downloadCVController);

// Generate single CV (returns JSON)
// GET /api/cv-generator/:candidateId?format=employer-safe&force=true
router.get('/:candidateId', generateSingleCVController);

// Get CV generation status
// GET /api/cv-generator/:candidateId/status?format=employer-safe
router.get('/:candidateId/status', getCVStatusController);

// Generate bulk CVs
// POST /api/cv-generator/bulk
router.post('/bulk', generateBulkCVsController);

export default router;
