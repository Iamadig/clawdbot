import { chromium } from "playwright";
import path from "path";
import fs from "fs/promises";

const cwd = process.cwd();
const userDataDir = path.join(cwd, "walmart-profile");
const debugDir = path.join(cwd, "debug");
await fs.mkdir(debugDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: null,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-crash-reporter",
    "--disable-breakpad",
    "--crash-dumps-dir=" + path.join(cwd, "tmp-crash"),
  ],
});

const page = context.pages()[0] ?? await context.newPage();
page.on("console", (m) => console.log("PAGE LOG:", m.type(), m.text()));
await page.setExtraHTTPHeaders({ "accept-language": "en-CA,en;q=0.9" });

await page.goto("https://www.walmart.ca/", { waitUntil: "domcontentloaded" });
console.log("\nIf press-and-hold shows, solve it in the Chrome window, then press Enter here to continue...");
await new Promise((res) => process.stdin.once("data", res));

await page.waitForSelector('input[aria-label="Search Walmart.ca"]', { timeout: 30000 });
await page.fill('input[aria-label="Search Walmart.ca"]', "coke zero");
await page.keyboard.press("Enter");
await page.waitForSelector('[data-testid="item-stack"] [data-testid="product-tile"] a[href]', { timeout: 20000 });
const first = await page.$eval('[data-testid="item-stack"] [data-testid="product-tile"] a[href]', (el: any) => el.href);
console.log("First product:", first);

await page.goto(first, { waitUntil: "domcontentloaded" });
const add = await page.$("//button[contains(., 'Add to cart')]");
if (!add) throw new Error("No add button");
await add.evaluate((e: any) => {
  e.scrollIntoView({ behavior: "smooth", block: "center" });
  e.style.border = "4px solid red";
});
await page.waitForTimeout(600);
await add.click();
await page.waitForTimeout(4000);

await page.goto("https://www.walmart.ca/cart", { waitUntil: "domcontentloaded" });
const cart = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid="cart-item-name"]')).map((e) => e.textContent?.trim())
);
console.log("Cart items:", cart);
await page.screenshot({ path: path.join(debugDir, "cart.png"), fullPage: true }).catch(() => {});
await context.close();
