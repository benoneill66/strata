// Capture marketing screenshots of Strata from the browser demo build
// (fictional data, no real database). Drives the running `bun run dev` server
// with the installed Chrome via puppeteer-core. Output → docs/*.png
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:1422";
const W = 1400, H = 880, SCALE = 2;

mkdirSync("docs", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [`--window-size=${W},${H}`, "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: W, height: H, deviceScaleFactor: SCALE },
});
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: "networkidle0" });
await sleep(400);

// click the first connection in the sidebar rail → connects (demo)
await page.waitForSelector(".conn-item");
await page.click(".conn-item");
// wait for tables to load, then open one to show the data grid
await page.waitForSelector(".tbl-item", { timeout: 8000 });
await sleep(500);
const tables = await page.$$(".tbl-item");
await (tables[1] ?? tables[0]).click();      // "orders" — a meaty table
await page.waitForSelector(".data-table", { timeout: 8000 });
await sleep(700);
await page.screenshot({ path: "docs/browse.png" });
console.log("wrote docs/browse.png");

// switch to Query view for the AI ask bar + editor shot
const navs = await page.$$(".nav-item");
for (const n of navs) {
  const label = await page.evaluate((el) => el.textContent, n);
  if (label?.includes("Query")) { await n.click(); break; }
}
await sleep(600);
// type a natural-language question into the AI bar (don't submit — demo has no model)
const ai = await page.$('input[placeholder^="Ask a question"]');
if (ai) { await ai.click(); await ai.type("top 10 customers by revenue this month"); }
await sleep(300);
await page.screenshot({ path: "docs/query.png" });
console.log("wrote docs/query.png");

await browser.close();
