# imageLink — educational tracking-link / tracking-pixel demo

A tiny, self-hostable lab for teaching **how much any link or image reveals about
whoever opens it**. You generate a link (or a 1×1 tracking pixel), share it, and a
dashboard shows the visits it captured: IP, approximate location, device, browser,
language, and timestamp.

This is the same mechanism behind email "read receipts", web bugs, and security
tools like [Thinkst Canarytokens](https://canarytokens.org). It's built for
**defensive / awareness training** — so people can *recognise* and *defend against*
link tracking.

---

## ⚠️ Ethics & legality — read this

- **Get consent.** Only send these links to people who have agreed to participate,
  or use them inside a lab you control.
- **Tracking people without consent can be illegal** (privacy, wiretap, and
  computer-misuse laws vary by country) and **violates the terms of service** of
  Telegram, WhatsApp, and similar platforms.
- This project intentionally **omits** anything weaponizable: no fake login /
  phishing pages, no malware, no browser exploits, no attempt to hide the
  disclosure shown to visitors. Don't add them.
- You are responsible for how you use it.

The collected fields are exactly what **every web server already sees on every
request** — that's the point of the lesson.

---

## What it collects

| Source        | Data |
|---------------|------|
| Request       | IP address, User-Agent, Referer, Accept-Language, timestamp |
| Derived       | Browser, OS, device class, link-preview bot detection (Telegram/WhatsApp/etc.) |
| IP geolocation| Country, region, city, ISP/org, proxy/hosting flags (via free `ip-api.com`) |
| Client (opt.) | Timezone, screen/viewport size, CPU cores, languages — collected by the landing page and clearly disclosed |

> Heads-up: when you paste a link into Telegram/WhatsApp, **their servers fetch it
> first** to build the preview card. Those show up as `🤖` bot hits *before* the
> human ever taps the link.

---

## Run locally

```bash
npm install
cp .env.example .env   # optionally set ADMIN_KEY
npm start              # http://localhost:3000
```

1. Open `/` → create a tracking link (give it a destination image URL).
2. Open the generated `/i/<id>` link in another browser/phone.
3. View captures at `/dashboard` (append `?key=YOUR_ADMIN_KEY` if you set one).

## Deploy to Railway

1. Push this repo to GitHub (e.g. `https://github.com/uday210/imageLink`).
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
   Nixpacks auto-detects Node and runs `npm start`.
3. **Variables** tab — set:
   - `ADMIN_KEY` = a long random string (locks the dashboard/API).
   - `DB_PATH` = `/data/tracker.db`
4. Add a **Volume** mounted at `/data` so captures survive redeploys.
5. (Optional) set `PUBLIC_URL` to your Railway domain for clean share links.
6. Open the generated domain — done.

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /` | Landing page + create form |
| `GET /dashboard` | View tokens & captured visits |
| `GET /i/:id` | Tracking **link** — logs, shows the real image, sets preview cards |
| `GET /p/:id.png` | Tracking **pixel** — logs, returns a 1×1 transparent PNG |
| `POST /api/tokens` | Create a token `{ label, targetUrl }` |
| `GET /api/tokens` · `GET /api/tokens/:id/hits` | List tokens / hits |
| `DELETE /api/tokens/:id` | Delete a token and its captures |
| `GET /healthz` | Health check |

Management routes honor `ADMIN_KEY` (via `?key=` or `x-admin-key` header) when set.

## Stack

Node + Express + SQLite (`better-sqlite3`). No build step. ~3 source files.

## License

MIT — for educational use. See the ethics notice above.
