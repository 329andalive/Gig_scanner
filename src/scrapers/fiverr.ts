import type { Page } from 'puppeteer';
import { launchBrowser, randomDelay } from './utils.js';
import type { RawListing } from '../types/index.js';

const FIVERR_SEARCH_URL = 'https://www.fiverr.com/search/gigs';
const DEFAULT_MAX_PAGES = 2;
const DELAY_MIN_MS = 3000;
const DELAY_MAX_MS = 5000;

interface FiverrConfig {
  search_queries: string[];
  max_pages?: number;
}

/** Build Fiverr search URL */
function buildSearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    query,
    source: 'main_banner',
    page: String(page),
  });
  return `${FIVERR_SEARCH_URL}?${params.toString()}`;
}

/** Extract gig cards using defensive, multi-strategy selectors */
async function extractGigCards(page: Page): Promise<RawListing[]> {
  // Debug: what's on the page?
  const pageInfo = await page.evaluate(() => {
    return {
      title: document.title,
      bodyLength: document.body?.innerHTML?.length || 0,
      hasCaptcha: /captcha|challenge|verify/i.test(document.body?.innerHTML || ''),
      linkCount: document.querySelectorAll('a[href*="/"]').length,
      // Look for gig-related content
      gigLinks: document.querySelectorAll('a[href*="fiverr.com/"], a[href^="/"]').length,
    };
  });

  console.log(`    Page: "${pageInfo.title}" | body: ${pageInfo.bodyLength} chars | ${pageInfo.gigLinks} links`);
  if (pageInfo.hasCaptcha) console.log(`    WARNING: Captcha/challenge detected!`);

  return page.evaluate(() => {
    const listings: RawListing[] = [];
    const seenUrls = new Set<string>();

    // Strategy: find all links that look like Fiverr gig URLs
    // Fiverr gig URLs follow pattern: /seller-name/i-will-do-something
    const allLinks = document.querySelectorAll('a[href]');

    for (const link of allLinks) {
      try {
        const href = link.getAttribute('href') || '';

        // Match Fiverr gig URL pattern: /username/i-will-something
        // But skip navigation links, categories, etc.
        const gigMatch = href.match(/^\/([a-z0-9_]+)\/(i-will-[a-z0-9-]+)/i)
          || href.match(/fiverr\.com\/([a-z0-9_]+)\/(i-will-[a-z0-9-]+)/i);

        if (!gigMatch) continue;

        const fullUrl = href.startsWith('http') ? href : `https://www.fiverr.com${href}`;
        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);

        const externalId = `${gigMatch[1]}_${gigMatch[2]}`;

        // Walk up to find the card container
        const container = link.closest('div[class*="card"], div[class*="gig"], article, li')
          || link.parentElement?.parentElement?.parentElement;

        let title = '';
        let budgetMin: number | null = null;
        const clientInfo: Record<string, unknown> = {
          sellerName: gigMatch[1],
        };

        if (container) {
          // Title — look for headings or title-like elements
          const heading = container.querySelector('h3, h2, h4, p[class*="title"], [class*="Title"]');
          title = heading?.textContent?.trim() || '';

          // If no heading found, use the link text
          if (!title) title = link.textContent?.trim() || '';

          // Clean up title — remove seller name if it got mixed in
          if (!title) title = gigMatch[2].replace(/i-will-/i, '').replace(/-/g, ' ');

          // Price
          const containerText = container.textContent || '';
          const priceMatch = containerText.match(/(?:From\s*)?\$[\d,]+(?:\.\d{2})?/);
          if (priceMatch) {
            budgetMin = parseFloat(priceMatch[0].replace(/[^0-9.]/g, ''));
          }

          // Rating
          const ratingMatch = containerText.match(/(\d+\.?\d*)\s*\((\d+[kK]?)\)/);
          if (ratingMatch) {
            clientInfo.rating = ratingMatch[1];
            clientInfo.reviewCount = ratingMatch[2];
          }

          // Seller level
          const levelMatch = containerText.match(/(Level\s*[12]|Top\s*Rated|Rising\s*Talent)/i);
          if (levelMatch) clientInfo.sellerLevel = levelMatch[1];
        } else {
          title = gigMatch[2].replace(/i-will-/i, '').replace(/-/g, ' ');
        }

        if (title.length < 3) continue;

        listings.push({
          platformId: '',
          externalId,
          title,
          description: title, // Fiverr cards don't show full descriptions
          url: fullUrl,
          budgetMin,
          budgetMax: null,
          budgetType: 'fixed',
          skillsRequired: [],
          clientInfo,
          postedAt: null,
        });
      } catch {
        continue;
      }
    }

    return listings;
  });
}

/** Scrape Fiverr gig listings using Puppeteer stealth */
export async function scrapeFiverr(
  config: FiverrConfig,
  platformId: string
): Promise<RawListing[]> {
  const allListings: RawListing[] = [];
  const maxPages = config.max_pages ?? DEFAULT_MAX_PAGES;
  let browser;

  try {
    browser = await launchBrowser();
  } catch {
    console.error(`  Fiverr: Browser launch failed, aborting scrape.`);
    return [];
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    for (const query of config.search_queries) {
      console.log(`  Searching Fiverr for: "${query}"`);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = buildSearchUrl(query, pageNum);
        console.log(`    Page ${pageNum}/${maxPages}: ${url}`);

        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

          // Wait for content
          const found = await Promise.race([
            page.waitForSelector('a[href*="i-will"]', { timeout: 15000 }).then(() => 'gig-links'),
            page.waitForSelector('div[class*="gig"], div[class*="card"]', { timeout: 15000 }).then(() => 'cards'),
            new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 15000)),
          ]);

          console.log(`    Selector result: ${found}`);

          if (found === 'timeout') {
            const snippet = await page.evaluate(() =>
              document.body?.innerText?.slice(0, 200)?.replace(/\n/g, ' ') || 'EMPTY'
            );
            console.log(`    Page preview: ${snippet}`);
            break;
          }

          // Scroll to trigger lazy loading
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
          await randomDelay(1000, 2000);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await randomDelay(1000, 2000);

          const listings = await extractGigCards(page);
          for (const l of listings) l.platformId = platformId;
          allListings.push(...listings);
          console.log(`    Extracted ${listings.length} gigs`);

          if (listings.length === 0) break;
        } catch (err) {
          console.error(`    Page ${pageNum} error: ${err instanceof Error ? err.message : err}`);
          break;
        }

        if (pageNum < maxPages) {
          await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
        }
      }

      await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
    }
  } finally {
    await browser.close();
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allListings.filter((l) => {
    if (seen.has(l.externalId)) return false;
    seen.add(l.externalId);
    return true;
  });

  console.log(`  Fiverr total: ${unique.length} unique gigs`);
  return unique;
}

// ── Standalone test ─────────────────────────────────────────
if (process.argv[1]?.endsWith('fiverr.ts') || process.argv[1]?.endsWith('fiverr.js')) {
  const testConfig: FiverrConfig = {
    search_queries: ['ai chatbot developer', 'mvp app development'],
    max_pages: 1,
  };

  console.log('Running Fiverr scraper standalone test...\n');
  scrapeFiverr(testConfig, 'test-platform-id')
    .then((listings) => {
      console.log(`\n=== Results: ${listings.length} gigs ===\n`);
      for (const l of listings.slice(0, 5)) {
        console.log(`Title:  ${l.title}`);
        console.log(`URL:    ${l.url}`);
        console.log(`Price:  $${l.budgetMin ?? '?'} (starting at)`);
        console.log('---');
      }
    })
    .catch((err) => {
      console.error('Scraper failed:', err);
      process.exit(1);
    });
}
