import puppeteer, { Browser } from 'puppeteer';

export type ViewportSpec = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renderPdfPageToJpeg(args: {
  pdfUrl: string;
  pageNumber: number;
  viewport: ViewportSpec;
  timeoutMs?: number;
}): Promise<{ jpeg: Buffer; viewport: Required<ViewportSpec> }> {
  const timeoutMs = args.timeoutMs ?? 30000;
  const viewport: Required<ViewportSpec> = {
    width: args.viewport.width,
    height: args.viewport.height,
    deviceScaleFactor: args.viewport.deviceScaleFactor ?? 2,
  };

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
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
    })) as Buffer;

    return { jpeg, viewport };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function renderPdfPageCropToJpeg(args: {
  pdfUrl: string;
  pageNumber: number;
  viewport: ViewportSpec;
  clip: { x: number; y: number; width: number; height: number };
  timeoutMs?: number;
}): Promise<{ jpeg: Buffer; viewport: Required<ViewportSpec> }> {
  const timeoutMs = args.timeoutMs ?? 30000;
  const viewport: Required<ViewportSpec> = {
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

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
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
    })) as Buffer;

    return { jpeg, viewport };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
