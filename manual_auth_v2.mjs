
// Force TTY for readline
process.stdout.isTTY = true;
process.stdin.isTTY = true;
// Mock setRawMode if needed
if (!process.stdin.setRawMode) {
    process.stdin.setRawMode = () => { };
}

import fs from 'fs';
import { getOAuthApiKey } from '/app/node_modules/@mariozechner/pi-ai/dist/utils/oauth/index.js';

const OAUTH_PATH = '/home/node/.clawdbot/credentials/oauth.json';

console.log('Loading OAuth storage from', OAUTH_PATH);
let storage = {};
if (fs.existsSync(OAUTH_PATH)) {
    storage = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
} else {
    // Ensure dir exists
    const dir = OAUTH_PATH.substring(0, OAUTH_PATH.lastIndexOf('/'));
    fs.mkdirSync(dir, { recursive: true });
}

console.log('Starting auth for google-antigravity...');
try {
    // Pass storage object. keys are providers.
    // FORCE NEW AUTH by passing empty storage
    const result = await getOAuthApiKey('google-antigravity', {});
    if (result && result.newCredentials) {
        storage['google-antigravity'] = result.newCredentials;
        fs.writeFileSync(OAUTH_PATH, JSON.stringify(storage, null, 2));
        console.log('---SUCCESS---');
        console.log('Token saved!');
    } else {
        console.log('Auth completed but no credentials returned (or existing valid?):', result);
    }
} catch (e) {
    console.error('Auth error:', e);
}
