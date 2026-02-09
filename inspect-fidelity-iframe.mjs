import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'en-GB',
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage();

const searchUrl = 'https://www.fidelity.co.uk/search/?query=GB00BJS8SH10&host=www.fidelity.co.uk&referrerPageUrl=';
console.log('Navigating to:', searchUrl);
await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });

// Get the iframe
const iframeEl = await page.$('#answers-frame');
if (!iframeEl) {
  console.log('No #answers-frame iframe found');
  await browser.close();
  process.exit(1);
}

const frame = await iframeEl.contentFrame();
if (!frame) {
  console.log('Could not get content frame');
  await browser.close();
  process.exit(1);
}

console.log('Got iframe content frame');

// Wait for content to load inside iframe
await frame.waitForLoadState('networkidle');
await frame.waitForTimeout(3000);

// Get all text content
const bodyText = await frame.$eval('body', el => el.innerText);
console.log('\n=== IFRAME BODY TEXT ===');
console.log(bodyText.substring(0, 3000));

// Find links inside iframe
const links = await frame.$$eval('a', els => els.map(a => ({
  text: a.textContent?.trim()?.substring(0, 80),
  href: a.href,
  classes: a.className?.substring(0, 80),
  outerHTML: a.outerHTML.substring(0, 300),
})).filter(l => l.text && l.text.length > 0));
console.log('\n=== ALL LINKS IN IFRAME ===');
console.log(JSON.stringify(links, null, 2));

// Find anything related to factsheet
const factsheetEls = await frame.$$eval('*', els => {
  return els
    .filter(e => {
      const text = e.textContent?.toLowerCase() || '';
      const cls = e.className?.toString()?.toLowerCase() || '';
      return (text.includes('factsheet') || text.includes('view')) && 
             e.children.length < 5 && text.length < 200;
    })
    .slice(0, 20)
    .map(e => ({
      tag: e.tagName,
      text: e.textContent?.trim()?.substring(0, 100),
      classes: e.className?.toString()?.substring(0, 80),
      href: e.href || '',
      outerHTML: e.outerHTML.substring(0, 300),
    }));
});
console.log('\n=== FACTSHEET-RELATED ELEMENTS IN IFRAME ===');
console.log(JSON.stringify(factsheetEls, null, 2));

// Get full HTML of the iframe for analysis
const iframeHTML = await frame.$eval('body', el => el.innerHTML);
console.log('\n=== IFRAME HTML (first 5000 chars) ===');
console.log(iframeHTML.substring(0, 5000));

await browser.close();
