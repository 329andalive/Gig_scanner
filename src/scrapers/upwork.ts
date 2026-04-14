import type { Page } from 'puppeteer';
import { launchBrowser, randomDelay } from './utils.js';
import type { RawListing } from '../types/index.js';

const UPWORK_SEARCH_URL = 'https://www.upwork.com/nx/search/jobs';
const MAX_PAGES = 3;
const DELAY_MIN_MS = 5000;
const DELAY_MAX_MS = 8000;

interface UpworkConfig {
  search_queries: string[];
  category?: string;
}

/** Build the Upwork search URL for a given query and page */
function buildSearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    per_page: '20',
    sort: 'recency',
  });
  return `${UPWORK_SEARCH_URL}?${params.toString()}`;
}

/**
 * Extract job listings from Upwork search page.
 * Uses multiple selector strategies since Upwork changes their DOM frequently.
 */
async function extractJobCards(page: Page): Promise<RawListing[]> {
  // First, let's see what's actually on the page for debugging
  const pageInfo = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      bodyLength: document.body?.innerHTML?.length || 0,
      // Check for common block/captcha indicators
      hasCaptcha: document.body?.innerHTML?.includes('captcha') ||
                  document.body?.innerHTML?.includes('CAPTCHA') ||
                  document.body?.innerHTML?.includes('challenge') || false,
      hasLogin: document.body?.innerHTML?.includes('Log In') &&
                document.body?.innerHTML?.includes('Sign Up') || false,
      // Sample some element counts
      articleCount: document.querySelectorAll('article').length,
      sectionCount: document.querySelectorAll('section').length,
      h2Count: document.querySelectorAll('h2').length,
      linkCount: document.querySelectorAll('a[href*="/jobs/"]').length,
    };
  });

  console.log(`    Page: "${pageInfo.title}" | body: ${pageInfo.bodyLength} chars`);
  console.log(`    Elements: ${pageInfo.articleCount} articles, ${pageInfo.h2Count} h2s, ${pageInfo.linkCount} job links`);
  if (pageInfo.hasCaptcha) console.log(`    WARNING: Captcha/challenge detected!`);
  if (pageInfo.hasLogin) console.log(`    WARNING: Login page detected — not authenticated`);

  return page.evaluate(() => {
    const listings: RawListing[] = [];

    // Strategy 1: Find all links to /jobs/ pages — most reliable signal
    const jobLinks = document.querySelectorAll('a[href*="/jobs/~"]');

    if (jobLinks.length === 0) {
      // Strategy 2: Try broader approach — any section/div that contains job-like content
      console.log('No /jobs/ links found, trying broader extraction...');
    }

    // Track seen URLs to avoid duplicates from the same page
    const seenUrls = new Set<string>();

    for (const link of jobLinks) {
      try {
        const href = link.getAttribute('href') || '';
        if (seenUrls.has(href)) continue;
        seenUrls.add(href);

        const url = href.startsWith('http') ? href : `https://www.upwork.com${href}`;

        // External ID from URL (e.g., /jobs/~01abc123)
        const idMatch = href.match(/~([a-zA-Z0-9]+)/);
        const externalId = idMatch ? idMatch[1] : '';
        if (!externalId) continue;

        // Title — the link text itself, or walk up to find a heading
        let title = link.textContent?.trim() || '';

        // If the link text is empty or very short, look for a nearby heading
        if (title.length < 5) {
          const parent = link.closest('article, section, div[class*="job"], div[class*="tile"]');
          if (parent) {
            const heading = parent.querySelector('h2, h3, h4');
            title = heading?.textContent?.trim() || title;
          }
        }

        if (!title || title.length < 3) continue;

        // Find the parent container for this job listing
        const container = link.closest('article, section, div[class*="job"], div[class*="tile"]')
          || link.parentElement?.parentElement?.parentElement;

        let description = '';
        let budgetMin: number | null = null;
        let budgetMax: number | null = null;
        let budgetType: 'fixed' | 'hourly' | 'not_specified' = 'not_specified';
        const skillsRequired: string[] = [];
        const clientInfo: Record<string, unknown> = {};

        if (container) {
          // Description — look for paragraph or span with substantial text
          const allText = container.querySelectorAll('p, span, div');
          for (const el of allText) {
            const text = el.textContent?.trim() || '';
            // Find the longest text block that isn't the title — likely the description
            if (text.length > description.length && text.length > 30 && text !== title) {
              description = text;
            }
          }

          // Budget — look for dollar amounts anywhere in the container
          const containerText = container.textContent || '';
          const amounts = containerText.match(/\$[\d,]+(?:\.\d{2})?/g);
          if (amounts) {
            const parsed = amounts.map((a) => parseFloat(a.replace(/[$,]/g, '')));
            budgetMin = parsed[0] || null;
            budgetMax = parsed.length > 1 ? parsed[1] : null;
          }

          // Budget type
          if (/\bhourly\b/i.test(containerText)) {
            budgetType = 'hourly';
          } else if (/\bfixed/i.test(containerText) || amounts) {
            budgetType = 'fixed';
          }

          // Skills/tags — look for badge-like elements
          const badges = container.querySelectorAll(
            'span[class*="badge"], span[class*="tag"], span[class*="skill"], ' +
            'a[class*="skill"], span[class*="token"], a[class*="token"]'
          );
          for (const badge of badges) {
            const skill = badge.textContent?.trim();
            if (skill && skill.length < 40 && skill.length > 1) {
              skillsRequired.push(skill);
            }
          }

          // Client info
          const spentMatch = containerText.match(/\$[\d,.]+[KkMm]?\s*(?:spent|total)/);
          if (spentMatch) clientInfo.totalSpent = spentMatch[0].trim();

          const ratingMatch = containerText.match(/(\d+\.?\d*)\s*(?:stars?|rating)/i);
          if (ratingMatch) clientInfo.rating = ratingMatch[1];
        }

        listings.push({
          platformId: '',
          externalId,
          title,
          description: description.slice(0, 2000),
          url,
          budgetMin,
          budgetMax,
          budgetType,
          skillsRequired: skillsRequired.slice(0, 15),
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

/** Scrape Upwork job listings using Puppeteer stealth */
export async function scrapeUpwork(
  config: UpworkConfig,
  platformId: string
): Promise<RawListing[]> {
  const allListings: RawListing[] = [];
  let browser;

  try {
    browser = await launchBrowser();
  } catch (err) {
    console.error(`  Upwork: Browser launch failed, aborting scrape.`);
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
    });

    for (const query of config.search_queries) {
      console.log(`  Searching Upwork for: "${query}"`);

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url = buildSearchUrl(query, pageNum);
        console.log(`    Page ${pageNum}/${MAX_PAGES}: ${url}`);

        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

          // Wait for page content to render — try multiple selectors
          const found = await Promise.race([
            page.waitForSelector('a[href*="/jobs/~"]', { timeout: 15000 }).then(() => 'job-links'),
            page.waitForSelector('article', { timeout: 15000 }).then(() => 'articles'),
            new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 15000)),
          ]);

          console.log(`    Selector result: ${found}`);

          if (found === 'timeout') {
            console.log(`    No recognizable content loaded on page ${pageNum}`);

            // Dump a snippet of the page for debugging
            const snippet = await page.evaluate(() => {
              return document.body?.innerText?.slice(0, 300) || 'EMPTY PAGE';
            });
            console.log(`    Page content preview: ${snippet.replace(/\n/g, ' ').slice(0, 200)}`);
            break;
          }

          // Scroll to trigger lazy loading
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
          await randomDelay(1000, 2000);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await randomDelay(1000, 2000);

          const listings = await extractJobCards(page);

          for (const listing of listings) {
            listing.platformId = platformId;
          }

          allListings.push(...listings);
          console.log(`    Extracted ${listings.length} listings`);

          if (listings.length === 0) {
            console.log(`    No listings extracted — stopping pagination for "${query}"`);
            break;
          }
        } catch (err) {
          console.error(`    Page ${pageNum} error: ${err instanceof Error ? err.message : err}`);
          break; // Don't keep trying pages if one fails hard
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
    search_queries: ['AI app', 'chatbot'],
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
