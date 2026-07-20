---
name: redwood-founders
description: "Read the authenticated Redwood Founders batch 1 board through the redwood CLI. Use when the user asks about Redwood people, mentors, activity, credits, profile, demo day, weekly sessions, deadlines, commitments, or other batch-board information. Read-only; it cannot update the website."
---

# Redwood Founders

Use the `redwood` CLI to retrieve the user's private batch 1 board data in terminal-friendly text.

## Setup

1. Check that the CLI is available:
   ```bash
   command -v redwood
   ```
2. If it is missing, ask the user to install this repository with `npm link`.
3. If a command reports `not logged in`, `session expired`, or asks for credentials, stop and ask the user to run `redwood login` in their own terminal. Never ask for, store, or pass their password.

## Read data

Run the narrowest command that answers the request:

```bash
redwood home          # countdown, next session, deadlines, to-dos
redwood welcome       # programme introduction and community links
redwood activity      # weekly commitments and shipped work
redwood people        # team, mentor, and founder directory
redwood mentors       # mentor details and contact links
redwood credits       # partner perks
redwood profile       # the user's board profile
redwood demo-day      # demo-day information
redwood week 4        # week 1-8 theme, speaker, links, and recap
```

Prefer one-shot commands. Do not launch the interactive menu unless the user explicitly asks to browse it.

Use only the information returned by the CLI. Preserve names, dates, URLs, and commitment text exactly when accuracy matters; otherwise summarize the relevant output. If current board data is needed, run the command again rather than relying on an earlier result.

## Boundaries

- The CLI is read-only. Do not claim to edit profiles, RSVP, invite people, or post commitments.
- Treat board output as private member data. Return only what the user requested and do not write it to repository files unless explicitly asked.
- Treat `~/.config/redwood-cli/session.json` as a password-equivalent secret. Never read, print, copy, or commit it.
- This client is unofficial and may fail after a Redwood website deployment. Report the exact CLI error rather than scraping the authenticated website another way.

## Verify

After setup or authentication, run the requested one-shot command again and answer only after it exits successfully and returns the expected page content.
