const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");
const CACHE_TTL_MS = 5 * 60 * 1000;

const RSS_SOURCES = [
  {
    name: "India Brand Campaigns",
    type: "Campaign",
    url: "https://news.google.com/rss/search?q=%22brand+campaign%22+OR+%22ad+campaign%22+India&hl=en-IN&gl=IN&ceid=IN:en"
  },
  {
    name: "Booming Indian Startups",
    type: "Startup",
    url: "https://news.google.com/rss/search?q=%22Indian+startup%22+OR+%22D2C+brand%22+funding+OR+launch&hl=en-IN&gl=IN&ceid=IN:en"
  },
  {
    name: "Inc42 Startups",
    type: "Startup",
    url: "https://inc42.com/feed/"
  },
  {
    name: "YourStory",
    type: "Startup",
    url: "https://yourstory.com/feed"
  },
  {
    name: "Global Rebrands & Identity",
    type: "Rebrand",
    url: "https://news.google.com/rss/search?q=%22rebrand%22+OR+%22brand+identity%22+OR+%22new+logo%22&hl=en-US&gl=US&ceid=US:en"
  }
];

function loadJsonFile(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (err) {
    console.warn("Read warning:", err.message);
  }
  return fallback;
}

function saveJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("Write warning:", err.message);
  }
}

function fetchUrl(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = targetUrl.startsWith("https:") ? https : http;
    const req = client.get(
      targetUrl,
      {
        headers: {
          "User-Agent": "MarketingAdda/1.0 (Brand Strategy Studio)",
          "Accept": "application/rss+xml, application/xml, application/json, text/xml, */*"
        },
        timeout: 10000
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          res.resume();
          return resolve(fetchUrl(nextUrl, redirectsLeft - 1));
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      }
    );

    req.on("timeout", () => req.destroy(new Error("Request timeout")));
    req.on("error", reject);
  });
}

function decodeEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tag) {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(regex);
  return match ? decodeEntities(match[1]) : "";
}

function parseFeedXml(xml, fallbackSource, defaultType) {
  const items = [];
  const itemMatches =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ||
    xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ||
    [];

  for (const block of itemMatches.slice(0, 7)) {
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) {
      const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (hrefMatch) link = hrefMatch[1];
    }
    const pubDateRaw =
      extractTag(block, "pubDate") ||
      extractTag(block, "published") ||
      extractTag(block, "updated");
    const description =
      extractTag(block, "description") ||
      extractTag(block, "summary") ||
      extractTag(block, "content");
    const sourceTag = extractTag(block, "source") || fallbackSource;

    if (!title || !link) continue;

    const parsedDate =
      pubDateRaw && !isNaN(Date.parse(pubDateRaw))
        ? new Date(pubDateRaw).toISOString()
        : new Date().toISOString();

    items.push({
      id: "sig_" + Buffer.from(link).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(-14),
      title,
      source: sourceTag,
      pubDate: parsedDate,
      link,
      snippet:
        description.length > 190
          ? description.slice(0, 187) + "..."
          : description || "Click original source to inspect the full campaign or startup launch.",
      signalType: defaultType
    });
  }
  return items;
}

function classifyWithWheeler(item) {
  const text = `${item.title} ${item.snippet}`.toLowerCase();

  let signalType = item.signalType || "Startup";
  if (/rebrand|logo|wordmark|redesign|identity|packaging|typography|mascot/.test(text)) {
    signalType = "Rebrand";
  } else if (/campaign|ad |ads |commercial|film|festive|ipl|influencer|marketing|viral/.test(text)) {
    signalType = "Campaign";
  } else if (/startup|funding|raises|d2c|launch|unicorn|ipo|series [a-z]|founder/.test(text)) {
    signalType = "Startup";
  }

  let wheelerPhase = "Phase 2: Clarifying Strategy";
  let phaseReason = "Tests positioning, category differentiation, and narrowing strategic focus.";

  if (/rebrand|logo|color|font|typography|packaging|design|visual|mascot|sonic/.test(text)) {
    wheelerPhase = "Phase 3: Designing Identity";
    phaseReason = "Demonstrates visual/sensory identity redesign and look-and-feel execution.";
  } else if (/campaign|ad |commercial|billboard|social|video|unboxing|website|app|retail|store/.test(text)) {
    wheelerPhase = "Phase 4: Creating Touchpoints";
    phaseReason = "Shows brand strategy translated into live customer touchpoints & campaigns.";
  } else if (/survey|report|study|consumer|research|trend|behavior|audit|data/.test(text)) {
    wheelerPhase = "Phase 1: Conducting Research";
    phaseReason = "Surfaces consumer research and category insights prior to strategic decisions.";
  } else if (/merger|acquire|acquisition|ipo|guideline|rollout|expansion|governance/.test(text)) {
    wheelerPhase = "Phase 5: Managing Assets";
    phaseReason = "Illustrates brand governance, portfolio changes, and large-scale rollouts.";
  }

  let dynamic6th = "6th Ed. Brand Dynamics";
  if (/\bai\b|artificial intelligence|genai|llm|automation/.test(text)) dynamic6th = "6th Ed. AI & Automation";
  else if (/sustainab|green|eco|climate|plastic|ev|electric/.test(text)) dynamic6th = "6th Ed. Sustainability";
  else if (/rebrand|redesign|logo/.test(text)) dynamic6th = "6th Ed. Before & After Rebrand";
  else if (/creator|influencer|meme|viral|gen z/.test(text)) dynamic6th = "6th Ed. Social & Cultural Agility";
  else if (/funding|d2c|bharat|quick commerce|upi/.test(text)) dynamic6th = "Startup Positioning & Scale";

  return { ...item, signalType, wheelerPhase, phaseReason, dynamic6th };
}

async function fetchHackerNews() {
  const raw = await fetchUrl(
    "https://hn.algolia.com/api/v1/search_by_date?query=startup%20OR%20branding%20OR%20marketing%20OR%20rebrand&tags=story&hitsPerPage=6"
  );
  const json = JSON.parse(raw);
  return (json.hits || [])
    .filter((h) => h.title)
    .map((h) => ({
      id: `hn_${h.objectID}`,
      title: h.title,
      source: "Hacker News Live",
      pubDate: h.created_at || new Date().toISOString(),
      link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: `Live startup & tech buzz (${h.points || 0} points · ${h.num_comments || 0} comments).`,
      signalType: "Startup"
    }));
}

async function fetchReddit(subreddit, label, type) {
  const raw = await fetchUrl(`https://www.reddit.com/r/${subreddit}/hot.json?limit=5`);
  const json = JSON.parse(raw);
  const posts = (json.data && json.data.children) || [];
  return posts
    .map((c) => c.data)
    .filter((p) => p && !p.stickied && p.title)
    .map((p) => ({
      id: `rd_${p.id}`,
      title: p.title,
      source: label,
      pubDate: new Date((p.created_utc || Date.now() / 1000) * 1000).toISOString(),
      link: `https://www.reddit.com${p.permalink}`,
      snippet:
        (p.selftext || "").replace(/\s+/g, " ").trim().slice(0, 180) ||
        `Trending discussion in ${label} (${p.ups || 0} upvotes).`,
      signalType: type
    }));
}

function startServer(dataDir, requestedPort = 3000, host = "127.0.0.1") {
  fs.mkdirSync(dataDir, { recursive: true });
  const CACHE_FILE = path.join(dataDir, "trends-cache.json");
  const VAULT_FILE = path.join(dataDir, "pinned-vault.json");

  let memoryCache = loadJsonFile(CACHE_FILE, {
    updatedAt: null,
    sourcesActive: 0,
    signals: []
  });

  async function refreshAllLiveFeeds(force = false) {
    const isFresh =
      memoryCache.updatedAt &&
      Date.now() - new Date(memoryCache.updatedAt).getTime() < CACHE_TTL_MS &&
      memoryCache.signals.length > 0;

    if (!force && isFresh) return memoryCache;

    const tasks = [
      ...RSS_SOURCES.map(async (src) => {
        const xml = await fetchUrl(src.url);
        return parseFeedXml(xml, src.name, src.type);
      }),
      fetchHackerNews(),
      fetchReddit("marketing", "r/marketing", "Campaign"),
      fetchReddit("IndianStartups", "r/IndianStartups", "Startup")
    ];

    const settled = await Promise.allSettled(tasks);
    let sourcesActive = 0;
    const collected = [];

    for (const res of settled) {
      if (res.status === "fulfilled" && Array.isArray(res.value) && res.value.length > 0) {
        sourcesActive++;
        collected.push(...res.value);
      }
    }

    const seen = new Set();
    const unique = [];
    for (const item of collected) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 45);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(classifyWithWheeler(item));
      }
    }

    unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    if (unique.length > 0) {
      memoryCache = {
        updatedAt: new Date().toISOString(),
        sourcesActive,
        signals: unique.slice(0, 40)
      };
      saveJsonFile(CACHE_FILE, memoryCache);
    }

    return memoryCache;
  }

  const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  function sendJson(res, status, payload) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end(JSON.stringify(payload));
  }

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      return res.end();
    }

    if (req.method === "GET" && reqUrl.pathname === "/api/live-trends") {
      try {
        const force = reqUrl.searchParams.get("force") === "1";
        const data = await refreshAllLiveFeeds(force);
        return sendJson(res, 200, { ok: true, mode: "live-server", ...data });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message, ...memoryCache });
      }
    }

    if (req.method === "GET" && reqUrl.pathname === "/api/vault") {
      return sendJson(res, 200, { ok: true, items: loadJsonFile(VAULT_FILE, []) });
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/vault") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const item = JSON.parse(body);
          const vault = loadJsonFile(VAULT_FILE, []);
          const filtered = vault.filter((v) => v.id !== item.id);
          filtered.unshift(item);
          saveJsonFile(VAULT_FILE, filtered);
          return sendJson(res, 200, { ok: true, items: filtered });
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
        }
      });
      return;
    }

    let filePath = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
    const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
    const fullPath = path.join(PUBLIC_DIR, safePath);

    if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found");
    }

    const ext = path.extname(fullPath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(fullPath).pipe(res);
  });

  const timer = setInterval(() => {
    refreshAllLiveFeeds(true).catch(() => {});
  }, CACHE_TTL_MS);

  return new Promise((resolve) => {
    server.listen(requestedPort, host, () => {
      const assignedPort = server.address().port;
      refreshAllLiveFeeds(true).catch(() => {});
      resolve({
        server,
        port: assignedPort,
        stop: () => {
          clearInterval(timer);
          server.close();
        }
      });
    });
  });
}

if (require.main === module) {
  const localDataDir = path.join(__dirname, "data");
  startServer(localDataDir, process.env.PORT || 3000, "0.0.0.0").then(({ port }) => {
    console.log(`Marketing Adda running on port ${port}`);
  });
}

module.exports = { startServer };