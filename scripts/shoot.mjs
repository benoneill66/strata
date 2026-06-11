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

async function gotoView(label) {
  for (const n of await page.$$(".nav-item")) {
    const t = await page.evaluate((el) => el.textContent, n);
    if (t?.includes(label)) { await n.click(); return; }
  }
}

await page.goto(URL, { waitUntil: "networkidle0" });
await sleep(400);

// open the connection dropdown and pick the first server → connects (demo)
await page.waitForSelector(".conn-trigger");
await page.click(".conn-trigger");
await page.waitForSelector(".conn-menu-item");
await page.click(".conn-menu-item");

// ----- Browse: open a meaty table to show the data grid -----
await page.waitForSelector(".tbl-item", { timeout: 8000 });
await sleep(500);
const tables = await page.$$(".tbl-item");
await (tables[1] ?? tables[0]).click(); // "orders"
await page.waitForSelector(".data-table", { timeout: 8000 });
await sleep(700);
await page.screenshot({ path: "docs/browse.png" });
console.log("wrote docs/browse.png");

// ----- Schema: the interactive ER diagram, with a table selected -----
await gotoView("Schema");
await page.waitForSelector(".erd-node", { timeout: 8000 });
await sleep(1400);
for (const nd of await page.$$(".erd-node")) {
  const t = await page.evaluate((el) => el.querySelector(".nm")?.textContent, nd);
  if (t === "users") { await nd.click(); break; }
}
await sleep(500);
await page.screenshot({ path: "docs/schema.png" });
console.log("wrote docs/schema.png");

// ----- Query: the AI ask bar + editor -----
await gotoView("Query");
await sleep(600);
const ai = await page.$('input[placeholder^="Ask a question"]');
if (ai) { await ai.click(); await ai.type("top 10 customers by revenue this month"); }
await sleep(300);
await page.screenshot({ path: "docs/query.png" });
console.log("wrote docs/query.png");

await browser.close();
