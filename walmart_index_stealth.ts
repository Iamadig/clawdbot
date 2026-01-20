#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import fs from "fs/promises";
import path from "path";

// Add stealth plugin
const puppeteer = puppeteerExtra.default || puppeteerExtra;
(puppeteer as any).use(StealthPlugin());

const SKILL_DIR = path.dirname(new URL(import.meta.url).pathname);
const COOKIES_FILE_JSON = path.join(SKILL_DIR, "..", "cookies.json");
const COOKIES_FILE_TXT = path.join(SKILL_DIR, "..", "cookies_js.txt");

let browser: Browser | null = null;
let page: Page | null = null;

async function loadCookies() {
    // Try JSON first
    try {
        const jsonStr = await fs.readFile(COOKIES_FILE_JSON, "utf-8");
        const cookies = JSON.parse(jsonStr);
        if (Array.isArray(cookies)) {
            console.error("Loaded " + cookies.length + " cookies from JSON");
            return cookies.map(c => ({
                name: c.name,
                value: c.value,
                domain: c.domain || ".walmart.ca",
                path: c.path || "/",
                secure: c.secure,
                httpOnly: c.httpOnly,
                sameSite: c.sameSite
            }));
        }
    } catch (e) {
        // Ignore JSON error, try text
    }

    // Fallback to Text
    try {
        const cookieStr = await fs.readFile(COOKIES_FILE_TXT, "utf-8");
        const cookies = cookieStr.split(";").map(c => {
            const [name, ...valueParts] = c.trim().split("=");
            return {
                name: name.trim(),
                value: valueParts.join("="),
                domain: ".walmart.ca",
                path: "/",
            };
        }).filter(c => c.name && c.value);
        console.error("Loaded " + cookies.length + " cookies from TXT");
        return cookies;
    } catch (e) {
        console.error("No cookies found");
        return [];
    }
}

async function getPage() {
    if (page) return page;

    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
    }

    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();

    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    const cookies = await loadCookies();
    if (cookies.length > 0) {
        await page.setCookie(...cookies);
        console.error("Cookies set successfully");
    }

    return page;
}

const server = new Server(
    { name: "walmart-skill", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

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
            await pg.waitForSelector("[data-testid=\"item-stack\"]", { timeout: 15000 });
        } catch (e) {
            // Check if blocked
            const title = await pg.title();
            if (title.includes("Verify") || title.includes("Robot")) {
                return { content: [{ type: "text", text: "BLOCKED by Bot Detection: " + title }] };
            }
            return { content: [{ type: "text", text: "No results found or timed out." }] };
        }

        const results = await pg.evaluate(() => {
            const items = Array.from(document.querySelectorAll("[data-testid=\"item-stack\"] div[role=\"group\"]"));
            return items.slice(0, 5).map(item => {
                const titleEl = item.querySelector("span[data-automation-id=\"product-title\"]");
                const priceEl = item.querySelector("div[data-automation-id=\"product-price\"]");
                return {
                    title: titleEl?.textContent?.trim(),
                    price: priceEl?.textContent?.trim()
                };
            });
        });

        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
    }

    if (request.params.name === "walmart_inspect_cart") {
        console.error("Navigating to cart...");
        await pg.goto("https://www.walmart.ca/cart", { waitUntil: "networkidle2" });

        // Check for block
        const title = await pg.title();
        if (title.includes("Verify") || title.includes("Robot")) {
            const cLen = (await loadCookies()).length;
            return {
                content: [{ type: "text", text: "❌ BLOCKED: " + title + "\nCookies loaded: " + cLen }]
            };
        }

        const pageContent = await pg.evaluate(() => {
            const cartItems = Array.from(document.querySelectorAll("[data-testid=\"cart-item\"]"));
            if (cartItems.length > 0) {
                return cartItems.map(item => {
                    const title = item.querySelector("[data-testid=\"cart-item-name\"]")?.textContent?.trim();
                    const price = item.querySelector("[data-testid=\"cart-item-price\"]")?.textContent?.trim();
                    const qty = item.querySelector("[data-testid=\"cart-item-quantity\"]")?.textContent?.trim();
                    return { title, price, qty };
                });
            }
            return {
                title: document.title,
                bodyText: document.body.innerText.substring(0, 500)
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
