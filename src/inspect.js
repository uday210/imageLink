'use strict';

// Lightweight request inspection — no external deps.
// Everything here is data a normal web server already sees on every request.
// That's the whole lesson: opening a link or image is never "anonymous".

// Known link-preview crawlers. Telegram/WhatsApp/etc. fetch your URL to build
// the little preview card BEFORE a human ever taps it, so these show up first.
const BOT_PATTERNS = [
  ['TelegramBot', 'Telegram link preview'],
  ['WhatsApp', 'WhatsApp link preview'],
  ['facebookexternalhit', 'Facebook/Messenger preview'],
  ['Discordbot', 'Discord preview'],
  ['Slackbot', 'Slack preview'],
  ['Twitterbot', 'Twitter/X preview'],
  ['LinkedInBot', 'LinkedIn preview'],
  ['SkypeUriPreview', 'Skype preview'],
  ['Googlebot', 'Googlebot'],
  ['bingbot', 'Bingbot'],
  ['Applebot', 'Applebot'],
  ['redditbot', 'Reddit preview'],
];

function detectBot(ua = '') {
  for (const [needle, label] of BOT_PATTERNS) {
    if (ua.toLowerCase().includes(needle.toLowerCase())) return label;
  }
  return null;
}

function parseUA(ua = '') {
  const u = ua;

  // OS
  let os = 'Unknown';
  if (/Windows NT 10/.test(u)) os = 'Windows 10/11';
  else if (/Windows NT/.test(u)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(u)) os = 'iOS';
  else if (/Android/.test(u)) os = (u.match(/Android [\d.]+/) || ['Android'])[0];
  else if (/Mac OS X/.test(u)) os = 'macOS';
  else if (/CrOS/.test(u)) os = 'ChromeOS';
  else if (/Linux/.test(u)) os = 'Linux';

  // Browser (order matters — Edge/Chrome both contain "Chrome", etc.)
  let browser = 'Unknown';
  if (/Edg\//.test(u)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(u)) browser = 'Opera';
  else if (/SamsungBrowser/.test(u)) browser = 'Samsung Internet';
  else if (/Firefox\//.test(u)) browser = 'Firefox';
  else if (/Chrome\//.test(u)) browser = 'Chrome';
  else if (/CriOS\//.test(u)) browser = 'Chrome (iOS)';
  else if (/Safari\//.test(u)) browser = 'Safari';

  // Device class
  let device = 'Desktop';
  if (/iPad|Tablet/.test(u)) device = 'Tablet';
  else if (/Mobi|iPhone|Android.*Mobile/.test(u)) device = 'Mobile';

  return { os, browser, device };
}

// Best-effort real client IP behind Railway's proxy. With app.set('trust proxy')
// Express already populates req.ip, but X-Forwarded-For is the source of truth.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

// Coarse IP geolocation via ip-api.com (free, no key, ~45 req/min).
// Returns null for private/loopback IPs (e.g. local testing).
async function geolocate(ip) {
  if (!ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(ip)) {
    return null;
  }
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,zip,lat,lon,isp,org,as,mobile,proxy,hosting`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data.status !== 'success') return null;
    return data;
  } catch {
    return null;
  }
}

module.exports = { detectBot, parseUA, clientIp, geolocate };
