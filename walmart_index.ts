#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";

// Configuration
const CONFIG_DIR = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || ".", ".config");
const CREDENTIALS_FILE = path.resolve("credentials.json");

let browser: Browser | null = null;
let page: Page | null = null;

async function getPage(): Promise<Page> {
    if (page) return page;

    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }

    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();

    // Set User Agent to look real
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    return page;
}

const server = new Server(
    {
        name: "walmart-skill",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
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
                description: "View items currently in the cart",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const page = await getPage();

    if (request.params.name === "walmart_search") {
        const query = String(request.params.arguments?.query);
        console.error('Searching for: ' + query);

        await page.goto('https://www.walmart.ca/en/search?q=' + encodeURIComponent(query));
        // Wait for item stack or no results
        try {
            await page.waitForSelector('[data-testid="item-stack"]', { timeout: 10000 });
        } catch (e) {
            return { content: [{ type: "text", text: "No results found or timed out." }] };
        }

        // Scrape results
        const results = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('[data-testid="item-stack"] div[role="group"]'));
            return items.slice(0, 5).map(item => {
                const titleEl = item.querySelector('span[data-automation-id="product-title"]');
                const priceEl = item.querySelector('div[data-automation-id="product-price"]');
                return {
                    title: titleEl?.textContent?.trim(),
                    price: priceEl?.textContent?.trim()
                };
            });
        });

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(results, null, 2),
                },
            ],
        };
    }

    if (request.params.name === "walmart_inspect_cart") {
        await page.goto('https://www.walmart.ca/cart');
        const title = await page.title();
        return {
            content: [{ type: "text", text: 'Currently on page: ' + title + ' (Cart scraping not fully implemented)' }]
        }
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
