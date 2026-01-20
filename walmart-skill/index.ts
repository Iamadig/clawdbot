#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import fs from "fs/promises";
import path from "path";

const SKILL_DIR = path.dirname(new URL(import.meta.url).pathname);
// Keep cookies alongside the skill, not one directory up.
const COOKIES_FILE = path.join(SKILL_DIR, "cookies_js.txt");
const USER_DATA_DIR =
    process.env.WALMART_USER_DATA_DIR ?? path.join(SKILL_DIR, "..", "walmart-profile");
const DEBUG_DIR = process.env.WALMART_DEBUG_DIR ?? path.join(SKILL_DIR, "..", "debug");
const HEADLESS = process.env.WALMART_HEADLESS === "1";

const MAX_LOGS = 200;
const consoleLogs: string[] = [];
const pageErrors: string[] = [];
const requestFailures: string[] = [];

function pushLog(list: string[], line: string) {
    list.push(line);
    if (list.length > MAX_LOGS) list.shift();
}

function tsTag() {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, "-");
}

async function captureDebug(pg: Page, label: string) {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const tag = `${label}-${tsTag()}`;
    const screenshotPath = path.join(DEBUG_DIR, `${tag}.png`);
    const htmlPath = path.join(DEBUG_DIR, `${tag}.html`);
    const logPath = path.join(DEBUG_DIR, `${tag}.log.txt`);

    await pg.screenshot({ path: screenshotPath, fullPage: true });
    const html = await pg.content();
    await fs.writeFile(htmlPath, html, "utf-8");

    const lines = [
        `url: ${pg.url()}`,
        `title: ${await pg.title()}`,
        "",
        "console:",
        ...consoleLogs,
        "",
        "page errors:",
        ...pageErrors,
        "",
        "request failures:",
        ...requestFailures,
    ];
    await fs.writeFile(logPath, lines.join("\n"), "utf-8");

    return { screenshotPath, htmlPath, logPath };
}

async function dismissOverlays(pg: Page) {
    // Cookie banner close
    const closeSelectors = [
        'button[aria-label="close button"]',
        'button:has-text("Close dialogue")',
        'button:has-text("Close")',
        '[data-testid="gic-modal"] button:has-text("Close")'
    ];
    for (const sel of closeSelectors) {
        const el = await pg.$(sel);
        if (el) {
            try { await el.click({ timeout: 1000 }); } catch {}
        }
    }
}

let context: BrowserContext | null = null;
let page: Page | null = null;

async function loadCookies(): Promise<any[]> {
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
    } catch (e) {
        console.error("No cookies found:", e);
        return [];
    }
}

async function getPage(): Promise<Page> {
    if (page) return page;

    if (!context) {
        await fs.mkdir(USER_DATA_DIR, { recursive: true });
        context = await chromium.launchPersistentContext(USER_DATA_DIR, {
            headless: HEADLESS,
            viewport: null,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-crash-reporter",
                "--disable-breakpad",
            ],
        });

        const cookies = await loadCookies();
        if (cookies.length > 0) {
            await context.addCookies(cookies);
            console.error("Cookies set successfully");
        }
    }

    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    page.on("console", msg => pushLog(consoleLogs, `[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", err => pushLog(pageErrors, String(err)));
    page.on("requestfailed", req =>
        pushLog(
            requestFailures,
            `${req.url()} ${req.failure()?.errorText ?? "request failed"}`
        )
    );

    await page.setExtraHTTPHeaders({ "accept-language": "en-CA,en;q=0.9" });

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

        const resp = await pg.goto("https://www.walmart.ca/en/search?q=" + encodeURIComponent(query), {
            waitUntil: "domcontentloaded"
        });
        if (resp && resp.status() >= 400) {
            const debug = await captureDebug(pg, "search-failed");
            return {
                content: [
                    {
                        type: "text",
                        text: `Search page status ${resp.status()}. Debug: ${JSON.stringify(debug, null, 2)}`
                    }
                ]
            };
        }
        try {
            await pg.waitForSelector("[data-testid=\"item-stack\"]", { timeout: 10000 });
        } catch (e) {
            const debug = await captureDebug(pg, "search-timeout");
            return { content: [{ type: "text", text: "No results found or timed out.\nDebug: " + JSON.stringify(debug, null, 2) }] };
        }

        const results = await pg.evaluate(() => {
            const items = Array.from(document.querySelectorAll("[data-testid=\"item-stack\"] div[role=\"group\"]"));
            return items.slice(0, 5).map(item => {
                const titleEl = item.querySelector("span[data-automation-id=\"product-title\"]");
                const priceEl = item.querySelector("div[data-automation-id=\"product-price\"]");
                const linkEl = item.querySelector("a") as HTMLAnchorElement;
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
        await pg.goto(url, { waitUntil: "domcontentloaded" });
        await dismissOverlays(pg);

        try {
            // Target the primary buy-box add button; prefer buy-box data attribute
            const addBtn = pg
                .locator('button[data-dca-name="ItemBuyBoxAddToCartButton"]')
                .first()
                .or(
                    pg.locator("button").filter({
                        hasText: /add to cart/i,
                        hasNot: pg.locator("aside, [role='complementary'], [data-testid*='sponsored']"),
                    })
                )
                .first();

            await addBtn.waitFor({ timeout: 20000 });

            // VISUAL DEBUG: highlight
            await addBtn.evaluate((el: any) => {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.style.border = "4px solid red";
            });
            await pg.waitForTimeout(500);

            await addBtn.click({ timeout: 5000 });
            await pg.waitForTimeout(4000);

            // Verify by checking cart contents
            await pg.goto("https://www.walmart.ca/cart", { waitUntil: "domcontentloaded" });
            await dismissOverlays(pg);
            const cartItems = await pg.evaluate(() => {
                const items = Array.from(document.querySelectorAll("[data-testid=\"cart-item\"]"));
                return items.map(item => {
                    const title = item.querySelector("[data-testid=\"cart-item-name\"]")?.textContent?.trim();
                    return title ?? null;
                }).filter(Boolean);
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `Cart items: ${JSON.stringify(cartItems)}`,
                    },
                ],
            };
        } catch (e: any) {
            const debug = await captureDebug(pg, "add-to-cart-failed");
            return {
                content: [
                    {
                        type: "text",
                        text:
                            "Failed to add to cart: " +
                            e.message +
                            "\nDebug:\n" +
                            JSON.stringify(debug, null, 2),
                    },
                ],
            };
        }
    }

    if (request.params.name === "walmart_inspect_cart") {
        console.error("Navigating to cart...");
        await pg.goto("https://www.walmart.ca/cart", { waitUntil: "domcontentloaded" });
        await dismissOverlays(pg);

        // Wait for either items or empty state
        try {
            await pg.waitForSelector(
                '[data-testid="cart-item"], [data-testid="cart-item-card"], text="Your cart is empty"',
                { timeout: 10000 }
            );
        } catch {}

        const pageContent = await pg.evaluate(() => {
            const cartItems = Array.from(
                document.querySelectorAll(
                    `[data-testid="cart-item"], [data-testid="cart-item-card"]`
                )
            );
            if (cartItems.length > 0) {
                return {
                    items: cartItems.map(item => {
                        const title = item.querySelector(`[data-testid="cart-item-name"], [data-automation-id="cart-item-name"], .cart-item-name`)?.textContent?.trim();
                        const price = item.querySelector(`[data-testid="cart-item-price"], [data-automation-id="cart-item-price"], .cart-item-price`)?.textContent?.trim();
                        const qty = item.querySelector(`[data-testid="cart-item-quantity"], [data-automation-id="cart-item-quantity"], .cart-item-quantity`)?.textContent?.trim();
                        return { title, price, qty };
                    })
                };
            }
            return {
                title: document.title,
                bodyText: document.body.innerText,
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
