// Capture an animated demo GIF of Strata from the browser demo build.
// Requires the demo server running (`bun run dev`, serves :1422), Chrome, and
// ffmpeg on PATH. Drives a short product tour, screenshots a frame sequence,
// then assembles → docs/demo.gif.
//
//   bun run demo-gif
import puppeteer from "puppeteer-core";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:1422";
const W = 1280, H = 800, SCALE = 1.5;
const FRAMES = "/tmp/strata-frames";

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync("docs", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [`--window-size=${W},${H}`, "--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: W, height: H, deviceScaleFactor: SCALE },
});
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let n = 0;
const shot = async () =>
  page.screenshot({ path: `${FRAMES}/f${String(++n).padStart(4, "0")}.png` });
// capture `count` frames spaced `gap`ms apart — used to "hold" on a moment
const hold = async (count, gap = 90) => { for (let i = 0; i < count; i++) { await shot(); await sleep(gap); } };

async function gotoView(label) {
  for (const el of await page.$$(".nav-item")) {
    const t = await page.evaluate((e) => e.textContent, el);
    if (t?.includes(label)) { await el.click(); return; }
  }
}

await page.goto(URL, { waitUntil: "networkidle0" });
await sleep(500);

// 1) Connect
await page.waitForSelector(".conn-trigger");
await page.click(".conn-trigger");
await page.waitForSelector(".conn-menu-item");
await hold(3);
await page.click(".conn-menu-item");

// 2) The core loop: click a table → data appears instantly
await page.waitForSelector(".tbl-item", { timeout: 8000 });
await hold(4);
const tables = await page.$$(".tbl-item");
await (tables[1] ?? tables[0]).click();
await page.waitForSelector(".data-table", { timeout: 8000 });
await hold(10);                 // dwell on the grid — the money shot
// click a second table to show the speed of switching
if (tables[2]) { await tables[2].click(); await sleep(250); await hold(8); }

// 3) Schema map
await gotoView("Schema");
await page.waitForSelector(".erd-node", { timeout: 8000 });
await hold(8, 110);
for (const nd of await page.$$(".erd-node")) {
  const t = await page.evaluate((e) => e.querySelector(".nm")?.textContent, nd);
  if (t === "users") { await nd.click(); break; }
}
await hold(8);

// 4) Ask AI → SQL
await gotoView("Query");
await sleep(400);
const ai = await page.$('input[placeholder^="Ask a question"]');
if (ai) {
  await ai.click();
  for (const ch of "top 10 customers by revenue") { await page.keyboard.type(ch); await shot(); }
}
await hold(10);

await browser.close();

// Assemble GIF (palette method for clean colors)
const frameCount = readdirSync(FRAMES).length;
console.log(`captured ${frameCount} frames → encoding docs/demo.gif`);
execFileSync("ffmpeg", [
  "-y", "-framerate", "12", "-i", `${FRAMES}/f%04d.png`,
  "-vf", "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer",
  "docs/demo.gif",
], { stdio: "inherit" });
console.log("wrote docs/demo.gif");
