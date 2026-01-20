#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
const SKILL_DIR = path.dirname(new URL(import.meta.url).pathname);
const COOKIES_FILE = path.join(SKILL_DIR, "..", "cookies_js.txt");
let browser = null;
let page = null;
async function loadCookies() {
    try {
        const cookieStr = await fs.readFile(COOKIES_FILE, "utf-8");
        // Parse cookie string format: name=value; name2=value2
        const cookies = cookieStr.split(";").map(c => {
            const [name, ...valueParts] = c.trim().split("=");
            return {
                name: name.trim(),
                value: valueParts.join("="),
                domain: ".walmart.ca",
                path: "/",
            };
        }).filter(c => c.name && c.value);
        console.error("Loaded " + cookies.length + " cookies");
        return cookies;
    }
    catch (e) {
        console.error("No cookies found:", e);
        return [];
    }
}
async function getPage() {
    if (page)
        return page;
    if (!browser) {
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
        });
    }
    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    // Load cookies before any navigation
    const cookies = await loadCookies();
    if (cookies.length > 0) {
        await page.setCookie(...cookies);
        console.error("Cookies set successfully");
    }
    return page;
}
const server = new Server({ name: "walmart-skill", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "walmart_search",
                description: "Search for products on Walmart.ca",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Product name to search for" },
                    },
                    required: ["query"],
                },
            },
            {
                name: "walmart_inspect_cart",
                description: "View items currently in the Walmart cart",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "walmart_add_to_cart",
                description: "Add a product to the cart using its URL",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: { type: "string", description: "Product page URL" }
                    },
                    required: ["url"]
                },
            }
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const pg = await getPage();
    if (request.params.name === "walmart_search") {
        const query = String(request.params.arguments?.query);
        console.error("Searching for: " + query);
        await pg.goto("https://www.walmart.ca/en/search?q=" + encodeURIComponent(query));
        try {
            await pg.waitForSelector("[data-testid=\"item-stack\"]", { timeout: 10000 });
        }
        catch (e) {
            return { content: [{ type: "text", text: "No results found or timed out." }] };
        }
        const results = await pg.evaluate(() => {
            const items = Array.from(document.querySelectorAll("[data-testid=\"item-stack\"] div[role=\"group\"]"));
            return items.slice(0, 5).map(item => {
                const titleEl = item.querySelector("span[data-automation-id=\"product-title\"]");
                const priceEl = item.querySelector("div[data-automation-id=\"product-price\"]");
                const linkEl = item.querySelector("a");
                return {
                    title: titleEl?.textContent?.trim(),
                    price: priceEl?.textContent?.trim(),
                    url: linkEl?.href
                };
            });
        });
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
    }
    if (request.params.name === "walmart_add_to_cart") {
        const url = String(request.params.arguments?.url);
        console.error("Adding to cart: " + url);
        await pg.goto(url, { waitUntil: "networkidle2" });
        try {
            // Find "Add to cart" button.
            // PROBLEM: Generic selectors pick up "Add" buttons in "Sponsored" sidebars.
            // FIX: Search for the specific text "Add to cart" which distinguishes the main button.
            // Wait for any button-like element first
            await pg.waitForSelector("button", { timeout: 10000 });
            // Use XPath to find the button containing exact text "Add to cart"
            // Note: Puppeteer supports xpath selector starting with "xpath/"
            const xpath = "//button[contains(., 'Add to cart')]";
            const selector = "xpath/" + xpath;
            await pg.waitForSelector(selector, { timeout: 5000 });
            const elements = await pg.$$(selector);
            if (elements.length === 0)
                throw new Error("Could not find 'Add to cart' button");
            const btn = elements[0]; // First matching element is usually the main one in DOM order
            // VISUAL DEBUG: Highlight the button in RED so user sees it
            await pg.evaluate((el) => {
                el.style.border = "5px solid red";
                el.style.backgroundColor = "yellow";
                el.scrollIntoView({ behavior: "smooth", block: "center" });
            }, btn);
            // Wait a moment for scroll and user to see
            await new Promise(r => setTimeout(r, 2000));
            // ROBUST CLICK: Get coordinates and click with mouse
            const box = await btn.boundingBox();
            if (!box)
                throw new Error("Button is not visible (no bounding box)");
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            console.error(`Clicking at ${x}, ${y}`);
            await pg.mouse.move(x, y);
            await new Promise(r => setTimeout(r, 500)); // Hover effect
            await pg.mouse.down();
            await new Promise(r => setTimeout(r, 100)); // Human-like press duration
            await pg.mouse.up();
            // Wait for potential side-effects (spinner, cart count update)
            await new Promise(r => setTimeout(r, 4000));
            return { content: [{ type: "text", text: `Clicked at (${x}, ${y}). Please check if cart updated.` }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: "Failed to add to cart: " + e.message }] };
        }
    }
    if (request.params.name === "walmart_inspect_cart") {
        console.error("Navigating to cart...");
        await pg.goto("https://www.walmart.ca/cart", { waitUntil: "networkidle2" });
        const pageContent = await pg.evaluate(() => {
            // Try to get cart items
            const cartItems = Array.from(document.querySelectorAll("[data-testid=\"cart-item\"]"));
            if (cartItems.length > 0) {
                return cartItems.map(item => {
                    const title = item.querySelector("[data-testid=\"cart-item-name\"]")?.textContent?.trim();
                    const price = item.querySelector("[data-testid=\"cart-item-price\"]")?.textContent?.trim();
                    const qty = item.querySelector("[data-testid=\"cart-item-quantity\"]")?.textContent?.trim();
                    return { title, price, qty };
                });
            }
            // Fallback: return page title and any visible text
            return {
                title: document.title,
                bodyText: document.body.innerText, // Using body.innerText for cleaner text
                cartStatus: document.body.innerText.includes("Your cart is empty") ? "Empty" : "Unknown"
            };
        });
        return {
            content: [{ type: "text", text: JSON.stringify(pageContent, null, 2) }],
        };
    }
    throw new Error("Tool not found");
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Walmart Skill Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
