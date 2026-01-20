
import fs from 'fs';

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REDIRECT_URI = "http://localhost:51121/oauth-callback";
const VERIFIER = "DsRCLGEd_YNDqVj7Dcg7qGuILF96wKA31pUK-i1imSiRlS5_usgV8mIiwuA21Cug01xxi_2m0X6-L9uDjtABMA";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const CODE = process.argv[2];
if (!CODE) { console.error("Provide code as arg 1"); process.exit(1); }

console.log('Exchanging code...');
try {
    const resp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: CODE,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
            code_verifier: VERIFIER
        })
    });

    if (!resp.ok) {
        console.error('Exchange failed:', await resp.text());
        process.exit(1);
    }

    const tokens = await resp.json();
    console.log('Got tokens!');

    const OAUTH_PATH = '/home/node/.clawdbot/credentials/oauth.json';

    // Get email
    let email = 'unknown';
    try {
        const emailResp = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        if (emailResp.ok) {
            const emailData = await emailResp.json();
            email = emailData.email;
        }
    } catch (e) { console.error('Email fetch failed', e); }
    console.log('Email:', email);

    const projectId = "rising-fact-p41fc"; // Default

    const creds = {
        refresh: tokens.refresh_token,
        access: tokens.access_token,
        expires: Date.now() + tokens.expires_in * 1000 - 300000,
        projectId,
        email
    };

    let storage = {};
    if (fs.existsSync(OAUTH_PATH)) {
        storage = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
    } else {
        const dir = OAUTH_PATH.substring(0, OAUTH_PATH.lastIndexOf('/'));
        fs.mkdirSync(dir, { recursive: true });
    }
    storage['google-antigravity'] = creds;
    fs.writeFileSync(OAUTH_PATH, JSON.stringify(storage, null, 2));
    console.log('SAVED to', OAUTH_PATH);
} catch (e) {
    console.error('Fatal error', e);
}
