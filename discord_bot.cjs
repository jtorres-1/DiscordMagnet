require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const POSTED_PATH = "./posted_servers.json";
const BANNED_PATH = "./banned_servers.json";
const LOG_PATH = "./discord_bot.log";
const MAX_POSTS_PER_CYCLE = 25;
const MIN_DELAY_MS = 3 * 60 * 1000;
const MAX_DELAY_MS = 5 * 60 * 1000;
const CYCLE_INTERVAL_MS = 5 * 60 * 60 * 1000;
const POST_COOLDOWN_DAYS = 3;
const PROMO_CHANNEL_NAMES = [
  "promote","self-promo","self-promotion","promo",
  "for-hire","hire-me","hiring","jobs","freelance",
  "services","advertising","ads","marketplace",
  "shameless-plug","plug","showcase",
  "share-your-work","projects","opportunities","gigs",
  "self-advertise","advertise","promotion","promotions",
  "share","collab","collaboration","networking",
];
const DEVHIRE_POSTS = [
  `hey, python developer in LA available for freelance work. i build websites, scrapers, automation bots, and AI integrations. flat fee, 48 hour delivery. recent work: claudiascleaningla.com and mapzap.org. DM me a scope`,
  `python dev available now. websites, automation, scrapers, bots, AI integrations. 48hr turnaround, flat fee. $500 websites, $800 automation. DM me what you need`,
  `available for freelance this week. python and node.js developer, LA based. scrapers, automation pipelines, bots, web apps, AI integrations. flat fee only. DM me a scope`,
  `dev for hire. python, flask, node.js, puppeteer, openai API, stripe. built live production projects including a google maps SaaS and cold email pipeline. 48hr delivery, flat fee. DM me`,
];
const MAPZAP_POSTS = [
  `built a tool that pulls 100 local business leads from Google Maps in 60 seconds as a CSV. type a business type and city, get names, phones, addresses, websites, and emails where available instantly. $19.99/month unlimited searches, free preview at mapzap.org`,
  `mapzap.org pulls 100 local business leads in 60 seconds. name, phone, address, website, email as a downloadable CSV. $19.99/month unlimited, free preview no card needed. useful for cold outreach, prospecting, agency lead gen`,
  `sharing something useful for anyone doing cold outreach or lead gen. mapzap.org scrapes 100 local businesses from Google Maps in 60 seconds, emails included. CSV with name, phone, address, website. $19.99/month unlimited`,
  `built mapzap.org for cold outreach prospecting. type any business niche and city, get 100 leads as a CSV instantly with emails where available. $19.99/month unlimited, free preview available`,
];
const FLOWMATE_POSTS = [
  `built something for local service businesses, plumbers, HVAC, roofers, electricians. roughly 78% of customers go with whoever responds first, so slow follow up loses leads to competitors. flowmate.live automatically texts and emails every new lead within 60 seconds, runs 24/7. i build it and run it for you. $297 first month, $797/month after. flowmate.live`,
  `if you run a local service business and aren't responding to leads instantly, you're losing most of them. flowmate.live fixes that, automated text and email follow up within 60 seconds, done for you, no software to learn. $297 first month, $797/month after.`,
  `sharing flowmate.live for contractors and local service businesses. auto texts and emails every new lead within 60 seconds so you stop losing business to whoever calls back first. think of it like a GoHighLevel setup except i build and run it for you. $297 first month, $797/month ongoing.`,
  `this solves a lead response problem, not a marketing problem. flowmate.live texts and emails every new lead within 60 seconds, 24/7, done for you. $297 to try the first month, $797/month after. flowmate.live`,
];
const AUTOSUB_POSTS = [
  `built a tool called AutoSub that automates your Reddit outreach. connect your Reddit account, set your offer and target keywords, it finds buyers posting on Reddit and DMs them automatically 24/7. 200+ targeted messages per day. $19.99/month, cancel anytime. autosub.online`,
  `if you do cold outreach on Reddit manually this might save you hours every day. AutoSub finds people actively posting about needing what you sell and DMs them for you automatically. set it up once, runs forever. $19.99/month at autosub.online`,
  `sharing something for agency owners and freelancers doing Reddit outreach. AutoSub automates the whole thing. scrapes Reddit globally for buyer intent posts, sends your DM automatically, shows you replies in a live dashboard. $19.99/month. autosub.online`,
  `AutoSub runs your Reddit DM outreach on autopilot. you set your keywords and offer, it finds people who need what you sell and messages them 24/7. built it myself and use it for all my products. $19.99/month at autosub.online`,
];
const PRODUCT_POOLS = [DEVHIRE_POSTS, MAPZAP_POSTS, FLOWMATE_POSTS, AUTOSUB_POSTS];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function log(tag, msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
}
function loadPosted() {
  if (!fs.existsSync(POSTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(POSTED_PATH)); } catch { return {}; }
}
function savePosted(posted) {
  fs.writeFileSync(POSTED_PATH, JSON.stringify(posted, null, 2));
}
function loadBanned() {
  if (!fs.existsSync(BANNED_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BANNED_PATH)); } catch { return []; }
}
function saveBanned(banned) {
  fs.writeFileSync(BANNED_PATH, JSON.stringify(banned, null, 2));
}
function wasPostedRecently(posted, key) {
  if (!posted[key]) return false;
  const diffDays = (new Date() - new Date(posted[key])) / (1000 * 60 * 60 * 24);
  return diffDays < POST_COOLDOWN_DAYS;
}
async function loadSession(page) {
  await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(rand(4000, 6000));
  if (page.url().includes("login") || page.url().includes("welcome")) {
    throw new Error("Session expired. Run discord_login.cjs again.");
  }
  log("INFO", "Session loaded.");
}
async function getJoinedServers(page) {
  log("INFO", "Getting list of joined servers...");
  await page.evaluate(() => {
    const sidebar = document.querySelector('[class*="guilds"], [aria-label="Servers sidebar"]');
    if (sidebar) sidebar.scrollTop = 99999;
  });
  await page.waitForFunction(() => {
    return document.querySelectorAll('[data-list-item-id^="guildsnav___"]').length > 5;
  }, { timeout: 10000 }).catch(() => {});
  const servers = await page.evaluate(() => {
    const results = [];
    const items = Array.from(document.querySelectorAll('[data-list-item-id^="guildsnav___"]'));
    for (const item of items) {
      const rawId = item.getAttribute('data-list-item-id');
      const serverId = rawId.replace('guildsnav___', '');
      if (!serverId || serverId === 'home' || serverId.length < 5) continue;
      const nameEl = item.querySelector('[aria-label], [class*="name"]');
      const name = nameEl?.getAttribute('aria-label') || nameEl?.innerText || serverId;
      if (!results.find(r => r.id === serverId)) {
        results.push({ id: serverId, name });
      }
    }
    return results;
  });
  log("INFO", `Found ${servers.length} joined servers`);
  return servers;
}
async function findAndPostInServer(page, server, postText, posted) {
  try {
    const serverUrl = `https://discord.com/channels/${server.id}`;
    await page.goto(serverUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(rand(2000, 4000));
    const promoChannel = await page.evaluate((promoNames) => {
      const links = Array.from(document.querySelectorAll('a[href*="/channels/"]'));
      for (const link of links) {
        const label = (link.getAttribute('aria-label') || '').toLowerCase();
        const text = (link.innerText || '').toLowerCase().trim();
        const name = label || text;
        if (promoNames.some(p => name.includes(p))) {
          return { href: link.href, name };
        }
      }
      return null;
    }, PROMO_CHANNEL_NAMES);
    if (!promoChannel) return "no_channel";
    if (wasPostedRecently(posted, promoChannel.href)) return "cooldown";
    await page.goto(promoChannel.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(rand(2000, 3000));
    const canPost = await page.evaluate(() => {
      const input = document.querySelector('[data-slate-editor="true"]') ||
                    document.querySelector('[contenteditable="true"][role="textbox"]');
      return !!input;
    });
    if (!canPost) return "read_only";
    const inputHandle = await page.evaluateHandle(() =>
      document.querySelector('[data-slate-editor="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      null
    );
    const input = inputHandle.asElement();
    if (!input) return "no_input";
    await input.click();
    await sleep(rand(1000, 2000));
    await page.keyboard.type(postText, { delay: rand(20, 50) });
    await sleep(rand(1500, 2500));
    await page.keyboard.press('Enter');
    await sleep(rand(2000, 4000));
    log("POSTED", `${server.name} → #${promoChannel.name}`);
    posted[promoChannel.href] = new Date().toISOString();
    savePosted(posted);
    return "posted";
  } catch (err) {
    log("ERROR", `Failed for ${server.name}: ${err.message}`);
    return "error";
  }
}
async function runCycle() {
  const posted = loadPosted();
  const banned = loadBanned();
  let postsThisCycle = 0;
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    userDataDir: './discord_profile',
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  try {
    await loadSession(page);
    let servers = await getJoinedServers(page);
    servers = servers.filter(s => !banned.includes(s.id));
    servers.sort(() => Math.random() - 0.5);
    for (const server of servers) {
      if (postsThisCycle >= MAX_POSTS_PER_CYCLE) {
        log("INFO", `Hit max posts (${MAX_POSTS_PER_CYCLE}). Stopping.`);
        break;
      }
      // Rotate DEVHIRE, MAPZAP, FLOWMATE, AUTOSUB evenly. PRODUCT_POOLS.length keeps
      // this in sync automatically if a product is ever added or removed again.
      const rotation = postsThisCycle % PRODUCT_POOLS.length;
      const postText = pick(PRODUCT_POOLS[rotation]);
      const result = await findAndPostInServer(page, server, postText, posted);
      if (result === "posted") {
        postsThisCycle++;
        log("INFO", `${postsThisCycle}/${MAX_POSTS_PER_CYCLE} posts. Waiting ${Math.round(MIN_DELAY_MS/60000)} to ${Math.round(MAX_DELAY_MS/60000)}min...`);
        await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
      } else if (result === "error") {
        if (!banned.includes(server.id)) {
          banned.push(server.id);
          saveBanned(banned);
          log("BANNED", `Marking ${server.name} as banned/unreachable, skipping in future cycles`);
        }
      }
      await sleep(rand(2000, 4000));
    }
  } catch (err) {
    log("ERROR", `Cycle failed: ${err.message}`);
  }
  await browser.close();
  log("INFO", `Cycle complete. Posted to ${postsThisCycle} servers.`);
}
(async () => {
  console.log("=".repeat(60));
  console.log("DiscordMagnet -- Server Poster");
  console.log("=".repeat(60));
  while (true) {
    await runCycle();
    log("INFO", `Next cycle in ${Math.round(CYCLE_INTERVAL_MS/3600000)} hours.`);
    await sleep(CYCLE_INTERVAL_MS);
  }
})();
