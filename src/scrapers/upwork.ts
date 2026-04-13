import type { Page } from 'puppeteer';
import { launchBrowser, randomDelay } from './utils.js';
import type { RawListing } from '../types/index.js';

const UPWORK_SEARCH_URL = 'https://www.upwork.com/nx/search/jobs';
const MAX_PAGES = 3;
const DELAY_MIN_MS = 5000;
const DELAY_MAX_MS = 8000;
const SELECTOR_TIMEOUT_MS = 15000;

interface UpworkConfig {
  search_queries: string[];
  category?: string;
}

/** Build the Upwork search URL for a given query and page */
function buildSearchUrl(query: string, page: number, category?: string): string {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    per_page: '20',
    sort: 'recency',
  });
  if (category) {
    params.set('category2_uid', category);
  }
  return `${UPWORK_SEARCH_URL}?${params.toString()}`;
}

/** Extract job listings from the current Upwork search results page */
async function extractJobCards(page: Page): Promise<RawListing[]> {
  return page.evaluate(() => {
    const listings: RawListing[] = [];

    // Upwork renders job cards in sections with data-test="JobTile"
    // or article elements within the job feed
    const cards = document.querySelectorAll(
      'article[data-test="JobTile"], ' +
      'section[data-test="JobTile"], ' +
      'div[data-test="job-tile-list"] > div'
    );

    for (const card of cards) {
      try {
        // Title and URL
        const titleEl = card.querySelector(
          'a[data-test="job-tile-title-link"], ' +
          'h2 a, ' +
          'a.job-tile-title-link'
        );
        const title = titleEl?.textContent?.trim() || '';
        const href = titleEl?.getAttribute('href') || '';
        if (!title || !href) continue;

        const url = href.startsWith('http') ? href : `https://www.upwork.com${href}`;

        // External ID from URL slug (e.g., /jobs/~01abc123)
        const idMatch = href.match(/~([a-zA-Z0-9]+)/);
        const externalId = idMatch ? idMatch[1] : href;

        // Description
        const descEl = card.querySelector(
          '[data-test="job-description-text"], ' +
          '[data-test="UpCLineClamp JobDescription"] span, ' +
          'p.mb-0'
        );
        const description = descEl?.textContent?.trim() || '';

        // Budget
        const budgetEl = card.querySelector(
          '[data-test="job-type-label"], ' +
          '[data-test="is-fixed-price"], ' +
          'strong[data-test="budget"]'
        );
        const budgetText = budgetEl?.textContent?.trim() || '';

        let budgetMin: number | null = null;
        let budgetMax: number | null = null;
        let budgetType: 'fixed' | 'hourly' | 'not_specified' = 'not_specified';

        if (budgetText) {
          const amounts = budgetText.match(/\$[\d,]+\.?\d*/g);
          if (amounts) {
            const parsed = amounts.map((a) =>
              parseFloat(a.replace(/[$,]/g, ''))
            );
            budgetMin = parsed[0] || null;
            budgetMax = parsed[1] || parsed[0] || null;
          }
          if (/hourly/i.test(budgetText)) {
            budgetType = 'hourly';
          } else if (/fixed/i.test(budgetText) || amounts) {
            budgetType = 'fixed';
          }
        }

        // Skills/tags
        const skillEls = card.querySelectorAll(
          '[data-test="token"] span, ' +
          'a[data-test="attr-item"], ' +
          '.air3-badge span'
        );
        const skillsRequired = Array.from(skillEls)
          .map((el) => el.textContent?.trim() || '')
          .filter(Boolean);

        // Client info
        const clientSpending = card.querySelector(
          '[data-test="client-spendings"], ' +
          '[data-test="total-spent"]'
        );
        const clientRating = card.querySelector(
          '[data-test="client-rating"] .air3-rating-value-text'
        );

        const clientInfo: Record<string, unknown> = {};
        if (clientSpending?.textContent) {
          clientInfo.totalSpent = clientSpending.textContent.trim();
        }
        if (clientRating?.textContent) {
          clientInfo.rating = clientRating.textContent.trim();
        }

        // Posted time
        const timeEl = card.querySelector(
          '[data-test="job-pubilshed-date"], ' +
          '[data-test="posted-on"] span, ' +
          'small[data-test="job-pubilshed-date"]'
        );
        const postedAt = timeEl?.textContent?.trim() || null;

        listings.push({
          platformId: '', // Set after return
          externalId,
          title,
          description,
          url,
          budgetMin,
          budgetMax,
          budgetType,
          skillsRequired,
          clientInfo,
          postedAt,
        });
      } catch {
        // Skip malformed cards
        continue;
      }
    }

    return listings;
  });
}

/** Scrape Upwork job listings using Puppeteer stealth */
export async function scrapeUpwork(
  config: UpworkConfig,
  platformId: string
): Promise<RawListing[]> {
  const allListings: RawListing[] = [];
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    for (const query of config.search_queries) {
      console.log(`  Searching Upwork for: "${query}"`);

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url = buildSearchUrl(query, pageNum, config.category);
        console.log(`    Page ${pageNum}/${MAX_PAGES}...`);

        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

          // Wait for job cards to render
          await page.waitForSelector(
            'article[data-test="JobTile"], section[data-test="JobTile"], div[data-test="job-tile-list"]',
            { timeout: SELECTOR_TIMEOUT_MS }
          ).catch(() => {
            console.log(`    No job cards found on page ${pageNum}, skipping.`);
          });

          const listings = await extractJobCards(page);

          // Set platformId on each listing
          for (const listing of listings) {
            listing.platformId = platformId;
          }

          allListings.push(...listings);
          console.log(`    Found ${listings.length} listings`);

          // Check if there's a next page
          const hasNext = await page.evaluate(() => {
            const nextBtn = document.querySelector(
              'button[data-test="pagination-next"], ' +
              'a[aria-label="Next"]'
            );
            return nextBtn !== null && !(nextBtn as HTMLButtonElement).disabled;
          });

          if (!hasNext) {
            console.log(`    No more pages for "${query}"`);
            break;
          }
        } catch (err) {
          console.error(`    Error on page ${pageNum}:`, err instanceof Error ? err.message : err);
        }

        // Rate limit between page loads
        if (pageNum < MAX_PAGES) {
          await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
        }
      }

      // Rate limit between queries
      await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
    }
  } finally {
    await browser.close();
  }

  // Deduplicate by externalId within this batch
  const seen = new Set<string>();
  const unique = allListings.filter((l) => {
    if (seen.has(l.externalId)) return false;
    seen.add(l.externalId);
    return true;
  });

  console.log(`  Upwork total: ${unique.length} unique listings`);
  return unique;
}

// ── Standalone test ─────────────────────────────────────────
if (process.argv[1]?.endsWith('upwork.ts') || process.argv[1]?.endsWith('upwork.js')) {
  const testConfig: UpworkConfig = {
    search_queries: ['AI app contractor', 'chatbot small business'],
  };

  console.log('Running Upwork scraper standalone test...\n');
  scrapeUpwork(testConfig, 'test-platform-id')
    .then((listings) => {
      console.log(`\n=== Results: ${listings.length} listings ===\n`);
      for (const l of listings.slice(0, 5)) {
        console.log(`Title: ${l.title}`);
        console.log(`URL:   ${l.url}`);
        console.log(`Budget: $${l.budgetMin ?? '?'} - $${l.budgetMax ?? '?'} (${l.budgetType})`);
        console.log(`Skills: ${l.skillsRequired.join(', ') || 'none listed'}`);
        console.log('---');
      }
    })
    .catch((err) => {
      console.error('Scraper failed:', err);
      process.exit(1);
    });
}
