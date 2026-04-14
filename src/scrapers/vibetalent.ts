import type { Page } from 'puppeteer';
import { launchBrowser, randomDelay } from './utils.js';
import type { RawListing } from '../types/index.js';

const VIBETALENT_BASE = 'https://www.vibetalent.work';
const DELAY_MIN_MS = 2000;
const DELAY_MAX_MS = 4000;
const SELECTOR_TIMEOUT_MS = 15000;

interface VibeTalentConfig {
  search_queries: string[];
  browse_mode?: boolean;
}

// ── Fetch-first approach ────────────────────────────────────
// VibeTalent is newer and may serve data as embedded JSON or
// have a simple API. We try fetch before reaching for Puppeteer.

/** Attempt to scrape via plain fetch + HTML/JSON parsing */
async function tryFetchApproach(config: VibeTalentConfig): Promise<RawListing[] | null> {
  try {
    // Try the browse/search page for embedded JSON data
    const searchUrl = config.browse_mode
      ? `${VIBETALENT_BASE}/projects`
      : `${VIBETALENT_BASE}/search?q=${encodeURIComponent(config.search_queries[0])}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Look for embedded JSON data (Next.js __NEXT_DATA__, Nuxt __NUXT__, or generic JSON-LD)
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      console.log('    Found __NEXT_DATA__, parsing embedded JSON...');
      const data = JSON.parse(nextDataMatch[1]);
      return extractFromNextData(data);
    }

    const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
    if (nuxtMatch) {
      console.log('    Found __NUXT__ data, parsing...');
      // Nuxt data is JS, not pure JSON — skip and fall back to Puppeteer
      return null;
    }

    // Try to find an API endpoint in the HTML
    const apiMatch = html.match(/["'](\/api\/[^"']+(?:projects|jobs|listings)[^"']*)["']/);
    if (apiMatch) {
      console.log(`    Found API endpoint: ${apiMatch[1]}, fetching...`);
      const apiResponse = await fetch(`${VIBETALENT_BASE}${apiMatch[1]}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (apiResponse.ok) {
        const apiData = await apiResponse.json();
        return extractFromApiData(apiData);
      }
    }

    // If we got HTML but no embedded data, check if there's meaningful content
    // in the static HTML (server-rendered listings)
    if (html.includes('project') || html.includes('listing') || html.includes('gig')) {
      console.log('    HTML has content but no embedded JSON — falling back to Puppeteer.');
    }

    return null; // Fall back to Puppeteer
  } catch (err) {
    console.log(`    Fetch approach failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Extract listings from Next.js __NEXT_DATA__ payload */
function extractFromNextData(data: Record<string, unknown>): RawListing[] {
  const listings: RawListing[] = [];

  // Walk the data tree looking for arrays of project/job objects
  function walk(obj: unknown, depth = 0): void {
    if (depth > 8 || !obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      // Check if this array looks like listings
      for (const item of obj) {
        if (item && typeof item === 'object' && 'title' in item) {
          const rec = item as Record<string, unknown>;
          listings.push({
            platformId: '',
            externalId: String(rec.id || rec.slug || rec.title),
            title: String(rec.title || ''),
            description: String(rec.description || rec.summary || rec.body || ''),
            url: rec.url
              ? String(rec.url).startsWith('http') ? String(rec.url) : `${VIBETALENT_BASE}${rec.url}`
              : rec.slug ? `${VIBETALENT_BASE}/projects/${rec.slug}` : VIBETALENT_BASE,
            budgetMin: typeof rec.budget === 'number' ? rec.budget
              : typeof rec.budget_min === 'number' ? rec.budget_min
              : typeof rec.price === 'number' ? rec.price : null,
            budgetMax: typeof rec.budget_max === 'number' ? rec.budget_max : null,
            budgetType: rec.budget_type === 'hourly' ? 'hourly'
              : rec.budget_type === 'fixed' ? 'fixed' : 'not_specified',
            skillsRequired: Array.isArray(rec.skills) ? rec.skills.map(String)
              : Array.isArray(rec.tags) ? rec.tags.map(String) : [],
            clientInfo: {
              ...(rec.client ? { client: rec.client } : {}),
              ...(rec.company ? { company: rec.company } : {}),
            },
            postedAt: rec.created_at ? String(rec.created_at)
              : rec.posted_at ? String(rec.posted_at) : null,
          });
        }
      }
      return;
    }

    for (const value of Object.values(obj as Record<string, unknown>)) {
      walk(value, depth + 1);
    }
  }

  walk(data);
  return listings;
}

/** Extract listings from a JSON API response */
function extractFromApiData(data: unknown): RawListing[] {
  // Handle { data: [...] } or { results: [...] } or bare array
  const items = Array.isArray(data) ? data
    : (data as Record<string, unknown>).data && Array.isArray((data as Record<string, unknown>).data)
      ? (data as Record<string, unknown>).data as unknown[]
    : (data as Record<string, unknown>).results && Array.isArray((data as Record<string, unknown>).results)
      ? (data as Record<string, unknown>).results as unknown[]
    : [];

  return extractFromNextData({ items } as Record<string, unknown>);
}

// ── Puppeteer fallback ──────────────────────────────────────

/** Extract listings from VibeTalent using Puppeteer */
async function extractWithPuppeteer(page: Page): Promise<RawListing[]> {
  return page.evaluate((baseUrl) => {
    const listings: RawListing[] = [];

    // Try common card/listing selectors
    const cards = document.querySelectorAll(
      '[class*="project-card"], [class*="ProjectCard"], ' +
      '[class*="job-card"], [class*="JobCard"], ' +
      '[class*="listing-card"], [class*="ListingCard"], ' +
      '[class*="gig-card"], [class*="GigCard"], ' +
      'article, .card'
    );

    for (const card of cards) {
      try {
        const titleEl = card.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]');
        const title = titleEl?.textContent?.trim() || '';
        if (!title) continue;

        const linkEl = card.querySelector('a[href]') as HTMLAnchorElement | null;
        const href = linkEl?.getAttribute('href') || '';
        const url = href.startsWith('http') ? href : `${baseUrl}${href}`;

        const externalId = href.replace(/^\//, '').replace(/\//g, '_') || title.replace(/\s+/g, '_').toLowerCase();

        const descEl = card.querySelector('p, [class*="description"], [class*="Description"], [class*="summary"]');
        const description = descEl?.textContent?.trim() || '';

        const priceEl = card.querySelector('[class*="price"], [class*="Price"], [class*="budget"], [class*="Budget"]');
        const priceText = priceEl?.textContent?.trim() || '';
        let budgetMin: number | null = null;
        let budgetMax: number | null = null;
        const amounts = priceText.match(/\$[\d,]+\.?\d*/g);
        if (amounts) {
          const parsed = amounts.map((a) => parseFloat(a.replace(/[$,]/g, '')));
          budgetMin = parsed[0] || null;
          budgetMax = parsed[1] || null;
        }

        const skillEls = card.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="skill"], [class*="Skill"], .badge');
        const skillsRequired = Array.from(skillEls)
          .map((el) => el.textContent?.trim() || '')
          .filter(Boolean);

        listings.push({
          platformId: '',
          externalId,
          title,
          description,
          url,
          budgetMin,
          budgetMax,
          budgetType: 'not_specified',
          skillsRequired,
          clientInfo: {},
          postedAt: null,
        });
      } catch {
        continue;
      }
    }

    return listings;
  }, VIBETALENT_BASE);
}

/** Scrape VibeTalent listings — fetch-first with Puppeteer fallback */
export async function scrapeVibeTalent(
  config: VibeTalentConfig,
  platformId: string
): Promise<RawListing[]> {
  // Try the fast fetch approach first
  console.log('  Trying fetch-first approach...');
  const fetchResults = await tryFetchApproach(config);

  if (fetchResults && fetchResults.length > 0) {
    console.log(`  Fetch succeeded: ${fetchResults.length} listings`);
    for (const listing of fetchResults) {
      listing.platformId = platformId;
    }
    return fetchResults;
  }

  // Fall back to Puppeteer
  console.log('  Falling back to Puppeteer...');
  const allListings: RawListing[] = [];
  let browser;

  try {
    browser = await launchBrowser();
  } catch {
    console.error('  VibeTalent: Browser launch failed, aborting scrape.');
    return [];
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Browse mode: go to main projects/listings page
    if (config.browse_mode) {
      const browseUrls = [
        `${VIBETALENT_BASE}/projects`,
        `${VIBETALENT_BASE}/jobs`,
        `${VIBETALENT_BASE}/gigs`,
        VIBETALENT_BASE,
      ];

      for (const url of browseUrls) {
        console.log(`    Trying: ${url}`);
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

          await page.waitForSelector(
            'article, .card, [class*="project"], [class*="job"], [class*="listing"]',
            { timeout: SELECTOR_TIMEOUT_MS }
          ).catch(() => null);

          // Scroll to load lazy content
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await randomDelay(1500, 2500);

          const listings = await extractWithPuppeteer(page);
          if (listings.length > 0) {
            for (const l of listings) l.platformId = platformId;
            allListings.push(...listings);
            console.log(`    Found ${listings.length} listings at ${url}`);
            break; // Found listings, no need to try other URLs
          }
        } catch {
          continue;
        }
      }
    }

    // Search mode: search for each query
    for (const query of config.search_queries) {
      if (allListings.length > 0 && config.browse_mode) break; // Already got results from browse

      console.log(`    Searching for: "${query}"`);

      const searchUrls = [
        `${VIBETALENT_BASE}/search?q=${encodeURIComponent(query)}`,
        `${VIBETALENT_BASE}/projects?search=${encodeURIComponent(query)}`,
      ];

      for (const url of searchUrls) {
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

          await page.waitForSelector(
            'article, .card, [class*="project"], [class*="job"], [class*="listing"]',
            { timeout: SELECTOR_TIMEOUT_MS }
          ).catch(() => null);

          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await randomDelay(1500, 2500);

          const listings = await extractWithPuppeteer(page);
          if (listings.length > 0) {
            for (const l of listings) l.platformId = platformId;
            allListings.push(...listings);
            console.log(`    Found ${listings.length} listings`);
            break;
          }
        } catch {
          continue;
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

  console.log(`  VibeTalent total: ${unique.length} unique listings`);
  return unique;
}

// ── Standalone test ─────────────────────────────────────────
if (process.argv[1]?.endsWith('vibetalent.ts') || process.argv[1]?.endsWith('vibetalent.js')) {
  const testConfig: VibeTalentConfig = {
    search_queries: ['AI', 'contractor', 'trades app'],
    browse_mode: true,
  };

  console.log('Running VibeTalent scraper standalone test...\n');
  scrapeVibeTalent(testConfig, 'test-platform-id')
    .then((listings) => {
      console.log(`\n=== Results: ${listings.length} listings ===\n`);
      for (const l of listings.slice(0, 5)) {
        console.log(`Title:  ${l.title}`);
        console.log(`URL:    ${l.url}`);
        console.log(`Budget: $${l.budgetMin ?? '?'} - $${l.budgetMax ?? '?'}`);
        console.log(`Skills: ${l.skillsRequired.join(', ') || 'none listed'}`);
        console.log('---');
      }
    })
    .catch((err) => {
      console.error('Scraper failed:', err);
      process.exit(1);
    });
}
