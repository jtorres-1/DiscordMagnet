require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");

const POSTED_PATH = "./posted_servers.json";
const LOG_PATH = "./discord_bot.log";

const MAX_POSTS_PER_CYCLE = 20;
const MIN_DELAY_MS = 3 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 1000;
const CYCLE_INTERVAL_MS = 5 * 60 * 60 * 1000;
const POST_COOLDOWN_DAYS = 3;

const DISCOVER_URLS = [
  "https://discord.com/servers?query=programming",
  "https://discord.com/servers?query=technology",
  "https://discord.com/servers?query=startup",
  "https://discord.com/servers?query=entrepreneur",
  "https://discord.com/servers?query=business",
  "https://discord.com/servers?query=marketing",
  "https://discord.com/servers?query=freelance",
  "https://discord.com/servers?query=developer",
  "https://discord.com/servers?query=agency",
  "https://discord.com/servers?query=saas",
  "https://discord.com/servers?query=python",
  "https://discord.com/servers?query=automation",
  "https://discord.com/servers?query=lead+generation",
  "https://discord.com/servers?query=cold+outreach",
  "https://discord.com/servers?query=web+development",
];

const PROMO_CHANNEL_NAMES = [
  "promote","self-promo","self-promotion","promo",
  "for-hire","hire-me","hiring","jobs","freelance",
  "services","advertising","ads","marketplace",
  "shameless-plug","plug","showcase",
  "share-your-work","share-your-project","projects",
  "opportunities","gigs","work",
];

const DEVHIRE_POSTS = [
  `hey, python developer in LA available for freelance work. i build websites, scrapers, automation bots, and AI integrations. flat fee, 48 hour delivery. recent work: claudiascleaningla.com and mapzap.org. DM me a scope`,
  `python dev available now. websites, automation, scrapers, bots, AI integrations. 48hr turnaround, flat fee. $500 websites, $800 automation. built mapzap.org (live SaaS) and claudiascleaningla.com. DM me what you need`,
  `available for freelance this week. python and node.js developer, LA based. i build scrapers, automation pipelines, bots, web apps, AI integrations. flat fee only. DM me a scope`,
  `dev for hire. python, flask, node.js, puppeteer, openai API, stripe. built live production projects including a google maps SaaS and cold email pipeline. 48hr delivery, flat fee. DM me`,
];

const MAPZAP_POSTS = [
  `built a tool that pulls 100 local business leads from Google Maps in 60 seconds as a CSV. type a business type and city, get names, phones, addresses, websites instantly. $49/month unlimited searches, free preview at mapzap.org`,
  `mapzap.org pulls 100 local business leads in 60 seconds. name, phone, address, website as a downloadable CSV. $49/month unlimited, free preview no card needed. useful for cold outreach, prospecting, agency lead gen`,
  `sharing something useful for anyone doing cold outreach or lead gen. mapzap.org scrapes 100 local businesses from Google Maps in 60 seconds. CSV with name, phone, address, website. $49/month unlimited searches`,
  `built mapzap.org for cold outreach prospecting. type any business niche and city, get 100 leads as a CSV instantly. $49/month unlimited, free preview available. useful for agencies, sales reps, freelancers`,
];

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

function wasPostedRecently(posted, key) {
  if (!posted[key]) return false;
  const diffDays = (new Date() - new Date(posted[key])) / (1000 * 60 * 60 * 24);
  return diffDays < POST_COOLDOWN_DAYS;
}

async function loadSession(page) {
  await page.goto("https://discord.com/channels/@me", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(rand(3000, 5000));
  if (page.url().includes("login") || page.url().includes("welcome")) {
    throw new Error("Session expired. Run discord_login.cjs again.");
  }
  log("INFO", "Session loaded.");
}

async function scrapeServerInvites(page, discoverUrl) {
  log("SEARCH", `Scraping: ${discoverUrl}`);
  try {
    await page.goto(discoverUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(rand(3000, 5000));
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await sleep(rand(1000, 2000));
    }
    const servers = await page.evaluate(() => {
      const results = [];
      const cards = Array.from(document.querySelectorAll('a[href*="/servers/"]'));
      for (const card of cards) {
        const match = card.href.match(/\/servers\/(\d+)/);
        if (match && !results.find(r => r.id === match[1])) {
          const name = card.querySelector('h2,h3,[class*="name"],[class*="title"]')?.innerText?.trim() || `server_${match[1]}`;
          results.push({ id: match[1], name, href: card.href });
        }
      }
      return results.slice(0, 15);
    });
    log("SEARCH", `Found ${servers.length} servers`);
    return servers;
  } catch (err) {
    log("ERROR", `Scrape failed: ${err.message}`);
    return [];
  }
}

async function joinAndPost(page, server, postText, posted) {
  try {
    await page.goto(`https://discord.com/servers/${server.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(rand(3000, 5000));

    const joinHandle = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.innerText?.toLowerCase().includes('join') && b.offsetParent !== null) || null;
    });
    const joinBtn = joinHandle.asElement();
    if (joinBtn) {
      log("JOIN", `Joining ${server.name}`);
      await joinBtn.click();
      await sleep(rand(3000, 5000));
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const dismiss = btns.find(b =>
          b.innerText?.toLowerCase().includes('get started') ||
          b.innerText?.toLowerCase().includes('browse channels') ||
          b.getAttribute('aria-label')?.toLowerCase().includes('close')
        );
        if (dismiss) dismiss.click();
      });
      await sleep(rand(2000, 3000));
    }

    const promoChannel = await page.evaluate((promoNames) => {
      const links = Array.from(document.querySelectorAll('a[href*="/channels/"]'));
      for (const link of links) {
        const name = (link.getAttribute('aria-label') || link.innerText || '').toLowerCase().trim();
        if (promoNames.some(p => name.includes(p))) return { href: link.href, name };
      }
      return null;
    }, PROMO_CHANNEL_NAMES);

    if (!promoChannel) { log("SKIP", `No promo channel in ${server.name}`); return "no_channel"; }
    if (wasPostedRecently(posted, promoChannel.href)) { log("SKIP", `Cooldown for #${promoChannel.name}`); return "cooldown"; }

    await page.goto(promoChannel.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(rand(2000, 3000));

    const inputHandle = await page.evaluateHandle(() =>
      document.querySelector('[data-slate-editor="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      null
    );
    const input = inputHandle.asElement();
    if (!input) { log("SKIP", `No input in #${promoChannel.name}`); return "no_input"; }

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
    const shuffled = [...DISCOVER_URLS].sort(() => Math.random() - 0.5);
    for (const discoverUrl of shuffled) {
      if (postsThisCycle >= MAX_POSTS_PER_CYCLE) { log("INFO", `Hit max posts. Stopping.`); break; }
      const servers = await scrapeServerInvites(page, discoverUrl);
      for (const server of servers) {
        if (postsThisCycle >= MAX_POSTS_PER_CYCLE) break;
        const type = postsThisCycle % 2 === 0 ? "DEVHIRE" : "MAPZAP";
        const postText = type === "DEVHIRE" ? pick(DEVHIRE_POSTS) : pick(MAPZAP_POSTS);
        const result = await joinAndPost(page, server, postText, posted);
        if (result === "posted") {
          postsThisCycle++;
          log("INFO", `${postsThisCycle}/${MAX_POSTS_PER_CYCLE} posts. Waiting ${Math.round(MIN_DELAY_MS/60000)} to ${Math.round(MAX_DELAY_MS/60000)}min...`);
          await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
        }
        await sleep(rand(3000, 6000));
      }
      await sleep(rand(5000, 10000));
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
