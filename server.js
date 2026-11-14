const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");
const CACHE_TTL_MS = 2 * 60 * 1000; // Refresh every 2 minutes

// 100% Pure Marketing, Advertising, Social Media & Rebrand Feeds
const RSS_SOURCES = [
  {
    name: "India Ad & Brand Trade",
    type: "Campaign",
    url: "https://news.google.com/rss/search?q=(site%3Aexchange4media.com%20OR%20site%3Aafaqs.com%20OR%20site%3Asocialsamosa.com%20OR%20site%3Acampaignindia.in%20OR%20site%3Abrandequity.economictimes.indiatimes.com)%20when%3A3d&hl=en-IN&gl=IN&ceid=IN:en"
  },
  {
    name: "India Campaigns & Influencers",
    type: "Campaign",
    url: "https://news.google.com/rss/search?q=(%22brand%20campaign%22%20OR%20%22ad%20campaign%22%20OR%20%22marketing%20campaign%22%20OR%20%22influencer%20marketing%22%20OR%20%22brand%20ambassador%22)%20India%20when%3A4d&hl=en-IN&gl=IN&ceid=IN:en"
  },
  {
    name: "Global Rebrands & Packaging",
    type: "Rebrand",
    url: "https://news.google.com/rss/search?q=(rebrand%20OR%20%22brand%20identity%22%20OR%20%22new%20logo%22%20OR%20%22packaging%20design%22%20OR%20%22viral%20campaign%22)%20when%3A4d&hl=en-US&gl=US&ceid=US:en"
  },
  {
    name: "AI, Gen Z & Creator Trends",
    type: "Startup",
    url: "https://news.google.com/rss/search?q=(%22AI%20marketing%22%20OR%20%22marketing%20trends%22%20OR%20%22Gen%20Z%22%20OR%20%22creator%20economy%22)%20brand%20when%3A5d&hl=en-US&gl=US&ceid=US:en"
  },
  {
    name: "Adweek",
    type: "Campaign",
    url: "https://www.adweek.com/feed/"
  },
  {
    name: "Social Media Examiner",
    type: "Campaign",
    url: "https://www.socialmediaexaminer.com/feed/"
  },
  {
    name: "Social Beat India",
    type: "Campaign",
    url: "https://www.socialbeat.in/feed/"
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
          "User-Agent": "MarketingAdda/2.1 (Brand & Marketing Trends Studio)",
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

function isBusinessOrFinanceNoise(title = "") {
  return /\b(q[1-4]\s*results|net\s*profit|profit\s*tanks|profit\s*jumps|ebitda|share\s*price|sensex|nifty|dividend|quarterly\s*earnings|pat\s*rises|pat\s*falls|ipo|layoffs|raises\s*\$|funding\s*round|stock\s*surge|stock\s*falls)\b/i.test(title);
}

function parseFeedXml(xml, fallbackSource, defaultType) {
  const items = [];
  const itemMatches =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ||
    xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ||
    [];

  for (const block of itemMatches.slice(0, 10)) {
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

    if (!title || !link || isBusinessOrFinanceNoise(title)) continue;

    const parsedDate =
      pubDateRaw && !isNaN(Date.parse(pubDateRaw))
        ? new Date(pubDateRaw).toISOString()
        : new Date().toISOString();

    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    const normalizedDesc = description.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    let cleanSnippet = description;
    if (!cleanSnippet || (normalizedTitle && normalizedDesc.startsWith(normalizedTitle))) {
      cleanSnippet = `Live marketing & brand trend from ${sourceTag}. Open the article to examine its consumer insight, messaging, and creative execution.`;
    } else if (cleanSnippet.length > 190) {
      cleanSnippet = cleanSnippet.slice(0, 187) + "...";
    }

    items.push({
      id: "sig_" + Buffer.from(link).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(-14),
      title,
      source: sourceTag,
      pubDate: parsedDate,
      link,
      snippet: cleanSnippet,
      signalType: defaultType
    });
  }
  return items;
}

function classifyWithWheeler(item) {
  const text = `${item.title} ${item.snippet} ${item.source}`.toLowerCase();

  let signalType = item.signalType || "Campaign";
  if (/rebrand|logo|wordmark|redesign|identity|packaging|typography|mascot|visual/.test(text)) {
    signalType = "Rebrand";
  } else if (/gen z|creator|ai marketing|trend|d2c|consumer/.test(text)) {
    signalType = "Startup";
  } else {
    signalType = "Campaign";
  }

  let wheelerPhase = "Phase 4: Creating Touchpoints";
  let phaseReason = "Shows brand strategy translated into live advertising, content, and customer touchpoints.";

  if (/rebrand|logo|color|font|typography|packaging|design|visual|mascot|sonic/.test(text)) {
    wheelerPhase = "Phase 3: Designing Identity";
    phaseReason = "Demonstrates visual/sensory identity redesign and look-and-feel execution.";
  } else if (/positioning|strategy|naming|audience|gen z|d2c|brand brief/.test(text)) {
    wheelerPhase = "Phase 2: Clarifying Strategy";
    phaseReason = "Highlights strategic positioning, target audience focus, and differentiation.";
  } else if (/survey|report|study|consumer|research|trend|behavior|audit|data|insight/.test(text)) {
    wheelerPhase = "Phase 1: Conducting Research";
    phaseReason = "Surfaces consumer research and cultural insights driving modern marketing.";
  } else if (/guideline|rollout|governance|champion|brand book/.test(text)) {
    wheelerPhase = "Phase 5: Managing Assets";
    phaseReason = "Illustrates brand governance, launches, and asset consistency at scale.";
  }

  let dynamic6th = "6th Ed. Brand Dynamics";
  if (/\bai\b|artificial intelligence|genai|llm|automation/.test(text)) dynamic6th = "6th Ed. AI & Automation";
  else if (/sustainab|green|eco|climate|plastic|ev/.test(text)) dynamic6th = "6th Ed. Sustainability";
  else if (/rebrand|redesign|logo|packaging/.test(text)) dynamic6th = "6th Ed. Before & After Rebrand";
  else if (/creator|influencer|meme|viral|gen z|ambassador|social/.test(text)) dynamic6th = "6th Ed. Social & Cultural Agility";
  else if (/campaign|ad |film|festive|creative/.test(text)) dynamic6th = "Creative Campaign Craft";

  return { ...item, signalType, wheelerPhase, phaseReason, dynamic6th };
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

    const settled = await Promise.allSettled(
      RSS_SOURCES.map(async (src) => {
        const xml = await fetchUrl(src.url);
        return parseFeedXml(xml, src.name, src.type);
      })
    );

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
        signals: unique.slice(0, 45)
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
