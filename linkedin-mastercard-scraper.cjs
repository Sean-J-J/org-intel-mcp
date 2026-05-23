const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = path.join(__dirname, '.linkedin-profile');

const SEARCHES = [
  // MPGS (Mastercard Payment Gateway Services) — product/tech track
  { query: 'Mastercard "MPGS" OR "Mastercard Payment Gateway" Middle East', label: 'MPGS_Product' },
  { query: 'Mastercard Payment Gateway Services director head Middle East', label: 'MPGS_Leadership' },
  { query: 'Mastercard "Payment Gateway" director head "Middle East" OR "UAE" OR "Dubai" OR "Saudi"', label: 'Gateway_Directors' },
  { query: 'Mastercard "Digital Payments" OR "Gateway" vice president regional head Middle East', label: 'Payments_Leadership' },
  // RM (Relationship Management) — account/business track
  { query: 'Mastercard "Relationship Management" OR "Account Management" director "Middle East"', label: 'RM_Directors' },
  { query: 'Mastercard "Country Manager" OR "Market Manager" OR "Business Head" Middle East', label: 'Country_Managers' },
  { query: 'Mastercard "Business Development" OR "Partnerships" director head Middle East UAE', label: 'BizDev' },
  // General Mastercard ME leadership
  { query: 'Mastercard "Middle East" vice president OR "general manager" OR "head of"', label: 'ME_Leadership' },
  { query: 'Mastercard "Division President" OR "Regional Head" Middle East Africa', label: 'Division_Leadership' },
  { query: 'Mastercard "Saudi Arabia" OR "UAE" director head', label: 'GCC_Heads' },
];

function cleanProfile(raw) {
  const lines = raw.text.split('\n').map(s => s.trim()).filter(Boolean);
  const name = lines[0]?.replace(/•.*$/, '').trim() || '';
  const title = lines[1] || '';
  return { name, title, profileUrl: raw.profileUrl };
}

async function main() {
  console.log('=== Mastercard Middle East LinkedIn Search ===');
  const isFirstRun = !fs.existsSync(USER_DATA_DIR);
  console.log(isFirstRun ? 'First run — will need login once.' : 'Reusing saved session.');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();

  // Login check
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  if (page.url().includes('login') || page.url().includes('auth')) {
    console.log('Please log in to LinkedIn...');
    for (let i = 0; i < 36; i++) {
      await page.waitForTimeout(5000);
      if (!page.url().includes('login') && !page.url().includes('auth')) {
        console.log('Logged in!\n');
        break;
      }
      if ((i + 1) % 12 === 0) console.log(`  ...${(i + 1) * 5}s`);
    }
  } else {
    console.log('Already logged in.\n');
  }

  const allResults = [];
  for (let idx = 0; idx < SEARCHES.length; idx++) {
    const { query, label } = SEARCHES[idx];
    console.log(`[${idx + 1}/${SEARCHES.length}] "${label}"`);

    const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);

      const rawProfiles = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/in/"]');
        const seen = new Set();
        const result = [];
        links.forEach(a => {
          const href = a.href.replace(/\?.*$/, '');
          if (seen.has(href)) return;
          seen.add(href);
          const text = (a.innerText || '').trim();
          if (text.length > 3) result.push({ text, profileUrl: href });
        });
        return result;
      });

      // Filter: Mastercard-relevant
      const mcKw = ['mastercard', 'mastercard'];
      const mcProfiles = rawProfiles
        .filter(p => mcKw.some(kw => p.text.toLowerCase().includes(kw)))
        .map(cleanProfile);

      console.log(`  → ${mcProfiles.length} Mastercard profiles`);
      mcProfiles.slice(0, 4).forEach(p => console.log(`     ${p.name} — ${p.title}`));
      allResults.push({ query, label, profiles: mcProfiles });
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
    }
    if (idx < SEARCHES.length - 1) await page.waitForTimeout(1500);
  }

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const batch of allResults) {
    for (const p of batch.profiles) {
      if (!seen.has(p.profileUrl)) {
        seen.add(p.profileUrl);
        unique.push(p);
      }
    }
  }

  const outPath = path.join(__dirname, 'mastercard-linkedin-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ searches: allResults, uniqueProfiles: unique }, null, 2), 'utf-8');

  console.log(`\nDone! ${unique.length} unique Mastercard profiles.`);
  console.log(`Results: ${outPath}`);
  await context.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
