# redwood-cli

Terminal client for the [Redwood Founders](https://redwoodfounders.org) **batch 1** board.

Sign in with the same email and password as the website, browse the board with an arrow-key menu, print a single page, or update your commitment / profile / team via confirmed write commands.

```
$ redwood
  email: you@example.com
  password: ••••••••

  welcome, Zain Mobarik

  › home
    welcome
    activity
    people
    …
```

## Install

Requires **Node.js 18.17+** (built-in `fetch` + `headers.getSetCookie`). No npm dependencies.

```bash
# clone
git clone https://github.com/mwijanarko1/redwood-cli.git
cd redwood-cli

# put `redwood` on your PATH (pick one)
npm link
# or
ln -s "$(pwd)/redwood.mjs" ~/.local/bin/redwood
```

Or run directly:

```bash
node redwood.mjs
```

## Usage

```bash
redwood                 # interactive menu (logs in if needed)
redwood login           # prompt for email/password, then menu
redwood logout          # clear saved session

redwood home            # one-shot print
redwood people
redwood activity
redwood mentors
redwood credits
redwood profile
redwood welcome
redwood demo-day
redwood week 4
```

### Writes

Every mutation prints a summary and asks for confirmation (default **No**). Agents/scripts must pass `--yes` explicitly. In a non-TTY without `--yes`, the CLI refuses to write.

```bash
# commitment + ship
redwood commitment 3 "ship landing page" --yes
redwood ship 3 https://example.com "demo link" --yes

# profile (partial update keeps unspecified fields)
redwood profile set --blurb "building X" --skills "engineering,design" --yes
redwood profile set --avatar ./me.jpg --yes
redwood profile edit          # guided prompts; enter keeps, - clears optional fields

# team
redwood team create "Acme" --one-liner "widgets" --looking-for "engineering,design" --yes
redwood team update --status closed --yes
redwood team invite "Ada Lovelace" --yes
redwood team respond "Acme" accept --yes
redwood team leave --yes
redwood team remove "Ada Lovelace" --yes
redwood team transfer "Ada Lovelace" --yes
redwood team disband --yes

# admin (requires board admin; mentor must be an RF-team person)
redwood admin hide "Acme" --yes
redwood admin mentor "Acme" "Ada Lovelace" --yes
redwood admin accept "Acme" "Ada Lovelace" --yes
redwood view-as "Ada Lovelace" --yes
redwood view-as clear --yes
```

Exact person/team names are case-insensitive but must match fully; UUID arguments pass through. Missing or ambiguous names are rejected. Avatar paths must be `jpg|jpeg|png|webp|gif`. In interactive profile/team prompts, `-` clears optional text fields (blurb, linkedin, calendar, one-liner, link, looking-for); empty keeps the current value.

Interactive menu includes a **write…** submenu for guided commitment, ship, profile, and team actions.

### Menu keys

| Key | Action |
|-----|--------|
| `↑` / `↓` / `k` / `j` | move |
| `enter` | open page |
| `q` / `esc` | quit |

On a page view, `enter` returns to the menu.

## What you get

| Page | Contents |
|------|----------|
| **home** | demo-day countdown, next session, deadlines, to-dos |
| **welcome** | mixer intro + WhatsApp / Luma links |
| **activity** | weekly shipped links + commitments |
| **people** | your team, mentor, full founder directory |
| **mentors** | your mentor + contact links |
| **credits** | partner perks |
| **profile** | your board profile |
| **week N** | theme, speaker, links, recap |

## How it works

The batch board is a Next.js app. There is no public REST API for board data.

1. **Login** posts the same server action the website uses (`next-action` + multipart form fields).
2. The session cookie (`sb-…-auth-token`) is stored locally.
3. **Pages** are fetched as HTML; display text is parsed for the terminal, and write commands also read RSC props for IDs/current state.
4. **Writes** POST JSON args with `content-type: text/plain;charset=UTF-8` and the matching `next-action` id (same wire format as the website).

This is an unofficial client. It may break when the site redeploys (server action IDs are build-specific hashes).

## Session storage

```
~/.config/redwood-cli/session.json
```

Stores the session cookie string (and a timestamp). Written `0600` under a `0700` config dir. Delete with `redwood logout`, or remove the file.

**Do not commit this file.** It is equivalent to being logged in.

## Security notes

- Use your own Redwood account. Do not share session files.
- Password input is masked in a TTY; prefer `redwood login` over putting passwords in shell history.
- Write commands never run without confirmation (`--yes` or interactive Yes).
- This tool is for batch members accessing their own board data.

## Development

Entry: [`redwood.mjs`](./redwood.mjs). Page parsers: [`formatters.mjs`](./formatters.mjs). Write helpers: [`writes.mjs`](./writes.mjs).

```bash
node redwood.mjs people     # smoke-test a formatter
node redwood.mjs --help
npm test
```

See [docs/CODEBASE_MAP.md](./docs/CODEBASE_MAP.md) for structure.

### Refreshing server action IDs

If login or a write suddenly fails after a site deploy:

1. Open the relevant board page in a browser (auth / profile / week / people).
2. Trigger the action and inspect the `POST` → request header `next-action`.
3. Update the matching id in `ACTIONS` / `WRITE_ACTIONS` inside `redwood.mjs` / `writes.mjs`.

## License

MIT — see [LICENSE](./LICENSE).

Not affiliated with Redwood Founders beyond being a batch-member utility.
