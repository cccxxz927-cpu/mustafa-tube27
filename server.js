import express from "express";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.YOUTUBE_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CHANNELS_FILE = path.join(__dirname, "data", "channels.json");
const CACHE_MS = Math.max(60, Number(process.env.CACHE_SECONDS || 900)) * 1000;

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const cache = new Map();
let channelsCache = { expires: 0, value: null };

async function readChannels() {
  return JSON.parse(await fs.readFile(CHANNELS_FILE, "utf8"));
}
async function saveChannels(channels) {
  await fs.writeFile(CHANNELS_FILE, JSON.stringify(channels, null, 2), "utf8");
  channelsCache = { expires: 0, value: null };
  cache.clear();
}
async function yt(endpoint, params) {
  if (!API_KEY) {
    const err = new Error("مفتاح YouTube API غير مضبوط على السيرفر.");
    err.status = 503;
    throw err;
  }
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data?.error?.message || "تعذر الاتصال بيوتيوب.");
    err.status = response.status;
    throw err;
  }
  return data;
}
function cleanHandle(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:youtube\.com\/)?@([A-Za-z0-9._-]+)/i);
  return match ? `@${match[1]}` : (text.startsWith("@") ? text : `@${text}`);
}
async function resolveChannel(handle) {
  const clean = cleanHandle(handle);
  const data = await yt("channels", {
    part: "snippet,contentDetails,statistics",
    forHandle: clean.replace(/^@/, "")
  });
  if (!data.items?.length) throw Object.assign(new Error(`لم نعثر على القناة ${clean}. تأكد من الرابط أو اسم المستخدم.`), { status: 404 });
  return data.items[0];
}
async function getChannels() {
  if (channelsCache.value && channelsCache.expires > Date.now()) return channelsCache.value;
  const configured = (await readChannels()).filter(c => c.enabled !== false);
  const results = await Promise.all(configured.map(async entry => {
    try {
      const ch = await resolveChannel(entry.handle);
      const item = ch.snippet || {};
      return {
        id: ch.id, handle: entry.handle, name: item.title || entry.displayName || "قناة مدرس",
        customUrl: item.customUrl || entry.handle,
        avatar: item.thumbnails?.high?.url || item.thumbnails?.medium?.url || item.thumbnails?.default?.url || "",
        banner: item.thumbnails?.high?.url || "",
        description: item.description || "",
        subject: entry.subject || "عام",
        subscribers: ch.statistics?.hiddenSubscriberCount ? null : Number(ch.statistics?.subscriberCount || 0),
        uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads
      };
    } catch (error) {
      return { id: `pending-${Buffer.from(entry.handle).toString("hex")}`, handle: entry.handle,
        name: entry.displayName || entry.handle, avatar: "", description: "",
        subject: entry.subject || "عام", unavailable: error.message };
    }
  }));
  channelsCache = { value: results, expires: Date.now() + CACHE_MS };
  return results;
}
app.get("/api/health", (_req, res) => res.json({ ok: true, apiKeyConfigured: Boolean(API_KEY) }));

app.get("/api/channels", async (_req, res, next) => {
  try { res.json({ channels: await getChannels() }); } catch (e) { next(e); }
});

app.get("/api/channels/:channelId/videos", async (req, res, next) => {
  try {
    const channels = await getChannels();
    const channel = channels.find(c => c.id === req.params.channelId);
    if (!channel || !channel.uploadsPlaylistId) {
      return res.status(404).json({ error: "القناة غير متاحة حالياً. تحقق من رابطها ومفتاح API." });
    }
    const key = `videos:${channel.id}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return res.json(cached.value);

    const playlist = await yt("playlistItems", {
      part: "snippet,contentDetails", playlistId: channel.uploadsPlaylistId,
      maxResults: 30
    });
    const ids = (playlist.items || []).map(x => x.contentDetails?.videoId).filter(Boolean);
    let details = [];
    if (ids.length) {
      const info = await yt("videos", { part: "contentDetails,statistics", id: ids.join(",") });
      details = info.items || [];
    }
    const detailMap = new Map(details.map(v => [v.id, v]));
    const videos = (playlist.items || []).map(item => {
      const s = item.snippet || {};
      const id = item.contentDetails?.videoId;
      const d = detailMap.get(id);
      const thumbs = s.thumbnails || {};
      return {
        id, title: s.title || "محاضرة",
        description: s.description || "",
        publishedAt: item.contentDetails?.videoPublishedAt || s.publishedAt || null,
        thumbnail: thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        duration: d?.contentDetails?.duration || "",
        views: Number(d?.statistics?.viewCount || 0),
        url: `https://www.youtube.com/watch?v=${id}`
      };
    }).filter(v => v.id);
    const payload = { channel, videos, nextPageToken: playlist.nextPageToken || null };
    cache.set(key, { value: payload, expires: Date.now() + CACHE_MS });
    res.json(payload);
  } catch (e) { next(e); }
});

// إضافة قناة من لوحة الإدارة لاحقاً. لا تفتح هذا المسار للعامة دون ضبط ADMIN_TOKEN.
app.post("/api/admin/channels", async (req, res, next) => {
  try {
    if (!ADMIN_TOKEN || req.get("x-admin-token") !== ADMIN_TOKEN) {
      return res.status(401).json({ error: "غير مصرح." });
    }
    const handle = cleanHandle(req.body?.handle);
    const displayName = String(req.body?.displayName || "").trim().slice(0, 80);
    const subject = String(req.body?.subject || "عام").trim().slice(0, 40);
    if (!/^@[A-Za-z0-9._-]{2,}$/.test(handle)) return res.status(400).json({ error: "رابط أو معرّف القناة غير صحيح." });
    const channels = await readChannels();
    if (channels.some(c => cleanHandle(c.handle).toLowerCase() === handle.toLowerCase())) {
      return res.status(409).json({ error: "القناة مضافة مسبقاً." });
    }
    channels.push({ handle, displayName: displayName || handle, subject, enabled: true });
    await saveChannels(channels);
    res.status(201).json({ ok: true, message: "تمت إضافة القناة. ستظهر بعد جلب بيانات يوتيوب." });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "حدث خطأ غير متوقع." });
});

app.listen(PORT, () => console.log(`Mustafa Tube running at http://localhost:${PORT}`));
