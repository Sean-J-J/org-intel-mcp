const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = path.join(__dirname, '.linkedin-profile');

const SEARCHES = [
  { query: 'Saudi Central Bank payment systems', label: 'Payment_Systems' },
  { query: 'Saudi Central Bank fintech', label: 'Fintech' },
  { query: 'Saudi Central Bank banking supervision', label: 'Banking_Supervision' },
  { query: 'Saudi Central Bank payment service provider', label: 'PSP' },
  { query: 'SAMA deputy governor', label: 'Leadership' },
  { query: 'Saudi Central Bank regulatory sandbox', label: 'Sandbox' },
  { query: 'Saudi Central Bank licensing', label: 'Licensing' },
  { query: 'Saudi Central Bank director general payments', label: 'Director_General' },
];

function cleanProfile(raw) {
  // raw.text is the full innerText from the <a> tag — multiline with name, title, location, etc.
  const lines = raw.text.split('\n').map(s => s.trim()).filter(Boolean);
  const name = lines[0]?.replace(/•.*$/, '').trim() || '';
  // Try to find the job title line — usually after the name
  const title = lines[1] || '';
  return { name, title, profileUrl: raw.profileUrl };
}

async function main() {
  console.log(`Profile: ${USER_DATA_DIR}`);
  console.log(fs.existsSync(USER_DATA_DIR) ? 'Reusing saved session.' : 'First run — will need login once.');

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
    console.log('Please log in to LinkedIn (one-time only)...');
    for (let i = 0; i < 36; i++) {
      await page.waitForTimeout(5000);
      if (!page.url().includes('login') && !page.url().includes('auth')) {
        console.log('Logged in! Session saved.\n');
        break;
      }
      if ((i + 1) % 12 === 0) console.log(`  ...${(i + 1) * 5}s`);
    }
  } else {
    console.log('Already logged in.\n');
  }

  // Run searches
  const allResults = [];
  for (let idx = 0; idx < SEARCHES.length; idx++) {
    const { query, label } = SEARCHES[idx];
    console.log(`[${idx + 1}/${SEARCHES.length}] "${query}"`);

    const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);

      // Extract profile links with full innerText (used for SAMA keyword matching)
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

      // Filter: must mention SAMA in the full text (includes title, company, etc.)
      const samaKw = ['sama', 'saudi central bank', 'saudi arabian monetary', 'مؤسسة النقد'];
      const samaProfiles = rawProfiles
        .filter(p => samaKw.some(kw => p.text.toLowerCase().includes(kw)))
        .map(cleanProfile);

      console.log(`  → ${samaProfiles.length} profiles`);
      samaProfiles.slice(0, 3).forEach(p => console.log(`     ${p.name} — ${p.title}`));
      allResults.push({ query, label, profiles: samaProfiles });
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

  const outPath = path.join(__dirname, 'sama-linkedin-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ searches: allResults, uniqueProfiles: unique }, null, 2), 'utf-8');

  console.log(`\nDone! ${unique.length} unique SAMA profiles.`);
  console.log(`Results: ${outPath}`);
  console.log('Closing browser...');
  await context.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
