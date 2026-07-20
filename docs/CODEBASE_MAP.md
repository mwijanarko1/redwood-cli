---
last_mapped: 2026-07-20T12:30:00Z
---

# Codebase Map

## System Overview

`redwood-cli` is a **zero-dependency Node.js CLI** that talks to the Redwood Founders batch 1 board at `https://redwoodfounders.org`.

```
user ──► redwood.mjs ──► HTTPS ──► redwoodfounders.org
                │                    │
                │                    ├─ POST /batch1/auth  (server action login)
                │                    └─ GET  /batch1/*     (SSR HTML)
                │
                └─► ~/.config/redwood-cli/session.json
```

There is **no public JSON API**. Auth is a Next.js server action; board pages are server-rendered HTML that the CLI parses into terminal-friendly text.

## Directory Guide

| Path | Role |
|------|------|
| [`redwood.mjs`](../redwood.mjs) | Entire application: auth, HTTP, formatters, interactive menu, CLI entry |
| [`package.json`](../package.json) | Package metadata + `bin.redwood` |
| [`README.md`](../README.md) | Public install/usage docs |
| [`LICENSE`](../LICENSE) | MIT |
| [`docs/CODEBASE_MAP.md`](./CODEBASE_MAP.md) | This map |
| `~/.config/redwood-cli/session.json` | Runtime session (not in repo) |

## Module layout inside `redwood.mjs`

| Section | Responsibility |
|---------|----------------|
| `ACTIONS` / `MENU` / `PAGE_ALIASES` | Constants: server-action ids, menu items, one-shot command routes |
| Session helpers | Load/save/clear cookie jar |
| Prompts | Email + masked password |
| HTTP | `serverAction()` (login), `getPage()` (SSR HTML) |
| Text helpers | Entity decode, wrap, generic HTML strip |
| **Page formatters** | Path-specific parsers → readable text |
| TUI | Arrow-key `pick()`, `showPage()`, `menuLoop()` |
| Main | `parseArgs` dispatch: interactive / one-shot / login / logout |

### Formatters (by path)

| Path | Formatter |
|------|-----------|
| `/batch1` | `formatHome` |
| `/batch1/welcome` | `formatWelcome` |
| `/batch1/activity` | `formatActivity` |
| `/batch1/people` | `formatPeople` |
| `/batch1/mentors` | `formatMentors` |
| `/batch1/credits` | `formatCredits` |
| `/batch1/profile` | `formatProfile` |
| `/batch1/demo-day` | `formatDemoDay` |
| `/batch1/weeks/:n` | `formatWeek` |
| anything else | `cleanText` fallback |

`formatPage(path, html)` is the single dispatch used by both the menu and one-shot commands.

## Key Workflows

### Login

1. Prompt email/password (or accept CLI args).
2. `POST` multipart form to `/batch1/auth` with header `next-action: <loginAction id>`.
3. Body fields: `1_email`, `1_password`, `0=["$K1"]` (Next.js server-action wire format).
4. Persist `Set-Cookie` into `session.json`.

### Browse (interactive)

1. Ensure session (login if missing/expired).
2. Render menu → user selects page.
3. `GET` HTML with cookie → `formatPage` → print.
4. Enter returns to menu.

### One-shot

```bash
redwood people      # login if needed → print → exit
redwood week 4
```

## Known Risks

| Risk | Notes |
|------|-------|
| **Server action ID drift** | Login ids are content hashes; break on redeploy. Refresh from browser DevTools (`next-action` header). |
| **HTML structure drift** | Formatters use class-name / markup anchors. Site redesigns need parser updates. |
| **No write actions** | Read-only. Cannot edit profile, RSVP, invite, or post commitments from the CLI. |
| **Session = full account access** | Treat `session.json` like a password. |
| **Unofficial** | Not a supported Redwood product surface. |

## Task-specific guidance

| Task | Start here |
|------|------------|
| Fix login | `ACTIONS.login`, `serverAction()` |
| Fix a page layout | matching `formatX()` + live HTML sample from `getPage` |
| Change menu items | `MENU` array |
| Add a command | `PAGE_ALIASES` + main dispatch |
| Docs for users | `README.md` |
