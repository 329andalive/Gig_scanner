import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());

/** Launch a stealth browser instance with explicit logging */
export async function launchBrowser(): Promise<Browser> {
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  console.log(`  [Browser] Launching Chromium...${execPath ? ` (path: ${execPath})` : ''}`);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: execPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--single-process',
      ],
    });

    const version = await browser.version();
    console.log(`  [Browser] Launched: ${version}`);
    return browser as unknown as Browser;
  } catch (err) {
    console.error(`  [Browser] FAILED to launch: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

/** Random delay between min and max milliseconds */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Truncate text to a max length */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
