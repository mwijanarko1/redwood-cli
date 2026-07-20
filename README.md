# redwood-cli

Terminal client for the [Redwood Founders](https://redwoodfounders.org) **batch 1** board.

Sign in with the same email and password as the website, browse the board with an arrow-key menu, or print a single page.

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
3. **Pages** are fetched as HTML and parsed into readable terminal output.

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
- This tool is for batch members accessing their own board data.

## Development

Entry: [`redwood.mjs`](./redwood.mjs). Page parsers: [`formatters.mjs`](./formatters.mjs).

```bash
node redwood.mjs people     # smoke-test a formatter
node redwood.mjs --help
```

See [docs/CODEBASE_MAP.md](./docs/CODEBASE_MAP.md) for structure.

### Refreshing server action IDs

If login suddenly fails with an unexpected error after a site deploy:

1. Open `https://redwoodfounders.org/batch1/auth` in a browser.
2. Submit a login and inspect the `POST` → request header `next-action`.
3. Update the matching id in `ACTIONS` inside `redwood.mjs`.

## License

MIT — see [LICENSE](./LICENSE).

Not affiliated with Redwood Founders beyond being a batch-member utility.
