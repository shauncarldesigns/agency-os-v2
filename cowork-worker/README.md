# cowork-worker

Local CLI helper that bridges the Agency OS queue and the operator's Cowork workflow.

This is the **manual-trigger version** the spec asked for first. It's a single Node.js script — no dependencies, no build step. Run it on whatever desktop Cowork lives on.

## What it does

- Polls `/api/briefs/queue/status` every 30 seconds
- Prints active and recently-completed jobs in a colored table
- Notifies you when new jobs appear since the last poll
- Lets you mark jobs `started`, `done`, or `failed` from a REPL prompt
- One-key shortcut to `open` landingsite.ai in your browser

What it does **not** do (yet):
- Drive landingsite.ai's UI directly — you copy the brief from the dashboard's Build tab and paste it in yourself
- Auto-detect when a page is finished — you click `done <jobId>` in the REPL when Cowork wraps up

The spec calls this out as the deliberate launch posture: prove the workflow manually, then automate.

## Run

```bash
cd cowork-worker

# Either set env vars in your shell, or copy .env.example → .env.local and fill in:
cp .env.example .env.local
$EDITOR .env.local

npm start
```

Required env:

| Var | Default | Purpose |
|---|---|---|
| `AGENCY_OS_API_URL` | `http://localhost:8788` | Backend URL (your Worker on production) |
| `AGENCY_OS_API_KEY` | _(required)_ | Same value as `DASHBOARD_API_KEY` on the backend |
| `COWORK_POLL_INTERVAL_SECONDS` | `30` | How often to refresh queue/status |
| `LANDINGSITE_URL` | `https://landingsite.ai` | Where the `o`/`open` shortcut points |

## REPL commands

```
l, list                  refresh + list active jobs
s, start <id>            mark job started   (POST /webhook/cowork/started)
o, open                  open landingsite.ai in browser
d, done <id> [url]       mark job complete  (POST /webhook/cowork/manual-complete)
f, fail <id> <reason>    mark job failed
h, help                  show help
q, quit                  exit
```

Example session:

```
cowork> l
═══ Queue ─ 2 queued · 0 processing ═══
  #  17 QUEUED Lakeshore Plumbing & Heating T3 (initial-build)
  #  18 QUEUED Lakeshore Plumbing & Heating T3 (add-page)

cowork> s 17
✓ Job 17 marked started

cowork> o
Opening https://landingsite.ai…

# (paste the brief into Cowork from the dashboard's Build tab,
#  watch it run, then come back here when done)

cowork> d 17 https://lakeshore-plumbing.agncy.dev
✓ Job 17 marked complete (https://lakeshore-plumbing.agncy.dev)
```

## When you're ready to automate

To replace this manual flow with a real polling worker:

1. Add an actual Cowork-driving function in place of the REPL — e.g. via `mcp__computer-use` or whatever scripting layer Cowork exposes.
2. Wire it to call `notifyStarted` → drive the UI → call `notifyDone` (or `notifyFailed`).
3. Drop the REPL and run as a long-lived `node src/index.mjs` process under launchd / systemd / pm2.

The webhook endpoints (`/api/webhook/cowork/{started,completed,manual-complete}`) are unchanged — only the trigger source changes.
