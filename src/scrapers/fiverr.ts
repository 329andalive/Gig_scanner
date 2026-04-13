import type { Page } from 'puppeteer';
import { launchBrowser, randomDelay } from './utils.js';
import type { RawListing } from '../types/index.js';

const FIVERR_SEARCH_URL = 'https://www.fiverr.com/search/gigs';
const DEFAULT_MAX_PAGES = 3;
const DELAY_MIN_MS = 3000;
const DELAY_MAX_MS = 5000;
const SELECTOR_TIMEOUT_MS = 15000;

interface FiverrConfig {
  search_queries: string[];
  max_pages?: number;
}

/** Build Fiverr search URL for a given query and page */
function buildSearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    query,
    source: 'main_banner',
    page: String(page),
  });
  return `${FIVERR_SEARCH_URL}?${params.toString()}`;
}

/** Extract gig cards from the current Fiverr search results page */
async function extractGigCards(page: Page): Promise<RawListing[]> {
  return page.evaluate(() => {
    const listings: RawListing[] = [];

    // Fiverr renders gig cards in various container patterns
    const cards = document.querySelectorAll(
      'div[class*="gig-card-layout"], ' +
      'div[class*="GigCard"], ' +
      'div.gig-wrapper, ' +
      'a[data-testid="gig-card"]'
    );

    for (const card of cards) {
      try {
        // Title and URL
        const linkEl = card.querySelector(
          'a[href*="/"]'
        ) as HTMLAnchorElement | null;

        const titleEl = card.querySelector(
          'h3, p[class*="title"], [class*="gig-title"], ' +
          'a[class*="title"]'
        );
        const title = titleEl?.textContent?.trim() || '';
        const href = linkEl?.getAttribute('href') || '';
        if (!title || !href) continue;

        const url = href.startsWith('http') ? href : `https://www.fiverr.com${href}`;

        // External ID from URL slug
        // Fiverr URLs: /seller-name/i-will-do-something
        const slugMatch = href.match(/\/([^/]+\/[^/?]+)/);
        const externalId = slugMatch ? slugMatch[1].replace(/\//g, '_') : href;

        // Seller info
        const sellerEl = card.querySelector(
          '[class*="seller-name"], [class*="SellerName"], ' +
          'a[class*="seller"]'
        );
        const sellerLevel = card.querySelector(
          '[class*="level"], [class*="Level"], ' +
          '[class*="seller-level"]'
        );

        // Price (starting at)
        const priceEl = card.querySelector(
          '[class*="price"], a[class*="price"], ' +
          'span[class*="Price"]'
        );
        const priceText = priceEl?.textContent?.trim() || '';
        let budgetMin: number | null = null;
        const priceMatch = priceText.match(/\$[\d,]+\.?\d*/);
        if (priceMatch) {
          budgetMin = parseFloat(priceMatch[0].replace(/[$,]/g, ''));
        }

        // Rating
        const ratingEl = card.querySelector(
          '[class*="rating"], [class*="Rating"]'
        );
        const reviewCountEl = card.querySelector(
          '[class*="reviews"], [class*="review-count"]'
        );

        // Delivery time
        const deliveryEl = card.querySelector(
          '[class*="delivery"], [class*="Delivery"]'
        );

        // Description (Fiverr cards usually just show title, not full description)
        const descEl = card.querySelector(
          '[class*="description"], [class*="Description"]'
        );
        const description = descEl?.textContent?.trim() || title;

        const clientInfo: Record<string, unknown> = {};
        if (sellerEl?.textContent) clientInfo.sellerName = sellerEl.textContent.trim();
        if (sellerLevel?.textContent) clientInfo.sellerLevel = sellerLevel.textContent.trim();
        if (ratingEl?.textContent) clientInfo.rating = ratingEl.textContent.trim();
        if (reviewCountEl?.textContent) clientInfo.reviewCount = reviewCountEl.textContent.trim();
        if (deliveryEl?.textContent) clientInfo.deliveryTime = deliveryEl.textContent.trim();

        listings.push({
          platformId: '',
          externalId,
          title,
          description,
          url,
          budgetMin,
          budgetMax: null, // Fiverr shows "starting at" price only
          budgetType: 'fixed',
          skillsRequired: [], // Fiverr doesn't show skills on search cards
          clientInfo,
          postedAt: null, // Fiverr doesn't show post dates on search results
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
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Set extra headers to look more human
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    for (const query of config.search_queries) {
      console.log(`  Searching Fiverr for: "${query}"`);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = buildSearchUrl(query, pageNum);
        console.log(`    Page ${pageNum}/${maxPages}...`);

        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

          // Wait for gig cards to render
          await page.waitForSelector(
            'div[class*="gig-card-layout"], div[class*="GigCard"], div.gig-wrapper, a[data-testid="gig-card"]',
            { timeout: SELECTOR_TIMEOUT_MS }
          ).catch(() => {
            console.log(`    No gig cards found on page ${pageNum}, skipping.`);
          });

          // Scroll down to trigger lazy-loaded content
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 2);
          });
          await randomDelay(1000, 2000);
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await randomDelay(1000, 2000);

          const listings = await extractGigCards(page);

          for (const listing of listings) {
            listing.platformId = platformId;
          }

          allListings.push(...listings);
          console.log(`    Found ${listings.length} gigs`);

          // Check for next page
          const hasNext = await page.evaluate(() => {
            const nextBtn = document.querySelector(
              'a[rel="next"], button[aria-label="Next"], ' +
              'li.page-item:last-child:not(.disabled) a'
            );
            return nextBtn !== null;
          });

          if (!hasNext) {
            console.log(`    No more pages for "${query}"`);
            break;
          }
        } catch (err) {
          console.error(`    Error on page ${pageNum}:`, err instanceof Error ? err.message : err);
        }

        // Rate limit between pages
        if (pageNum < maxPages) {
          await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
        }
      }

      // Rate limit between queries
      await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
    }
  } finally {
    await browser.close();
  }

  // Deduplicate by externalId
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
    search_queries: ['ai chatbot', 'mvp app development'],
    max_pages: 2,
  };

  console.log('Running Fiverr scraper standalone test...\n');
  scrapeFiverr(testConfig, 'test-platform-id')
    .then((listings) => {
      console.log(`\n=== Results: ${listings.length} gigs ===\n`);
      for (const l of listings.slice(0, 5)) {
        console.log(`Title:  ${l.title}`);
        console.log(`URL:    ${l.url}`);
        console.log(`Price:  $${l.budgetMin ?? '?'} (starting at)`);
        console.log(`Seller: ${(l.clientInfo as Record<string, string>).sellerName || 'unknown'}`);
        console.log('---');
      }
    })
    .catch((err) => {
      console.error('Scraper failed:', err);
      process.exit(1);
    });
}
