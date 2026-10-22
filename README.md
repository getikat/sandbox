# Ikat sandbox

The free, self-hosted version of [Ikat](https://getikat.com): a personal-finance web app that runs on your own computer, with your own
Plaid keys. Link your banks, cards and brokerages and see net worth, accounts, transactions, spending, budgets and recurring charges
in one place.

Nothing here is hosted. There is no Ikat server in the loop: the app talks to Plaid with the keys you give it, keeps its data in a
SQLite file on your machine, and sends nothing else anywhere. Ikat never moves money.

## What is in it

| Free here                               | In the iPhone app                   |
| --------------------------------------- | ----------------------------------- |
| Net worth and accounts                  | Investing, equity and taxes         |
| Transactions, categories and rules      | Planning and the monthly review     |
| Spending, budgets and recurring charges | Cards and rewards, loans and debt   |
| Import from CSV or OFX                  | Alerts on your phone                |
| Demo household to try it without a bank | Sealed sync through your own iCloud |

The paid sections show a page that points to [getikat.com/app](https://getikat.com/app/) instead of an empty screen.

## Run it

You need Node 24 (`.nvmrc`; `nvm use`).

```bash
npm install
PORT=4546 npm run dev
```

Open <http://localhost:5180>. The API runs on port 4546 and the web app proxies `/api` to it. To try it with made-up data, choose
the demo household on the first screen.

For one process on one port, build and start it:

```bash
npm run build
npm start
```

That serves the app at <http://localhost:4545>.

## Connect your banks

Linking uses your own [Plaid](https://plaid.com) account. In Settings, paste your client ID and secret and choose sandbox or
production, or set them when you start the server:

```bash
PLAID_CLIENT_ID=… PLAID_SECRET=… PLAID_ENV=production npm start
```

Keep keys out of the repository: `.env` files are ignored.

## Where your data lives

The server binds to `127.0.0.1` and keeps everything in `data/` (override with `IKAT_DATA_DIR`): `ikat.db` for your accounts,
`demo.db` for the demo, and a daily `backups/` folder. To reach it from your phone, put it behind
[Tailscale](https://tailscale.com) (`tailscale serve`) rather than opening the port.

## Develop

| Command               | What it does                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| `npm test`            | Vitest across core and server                                                      |
| `npm run typecheck`   | `tsc` for core, server and web                                                     |
| `npm run format`      | Prettier                                                                           |
| `npm run db:generate` | New migration after editing `server/src/db/schema.ts`; migrations apply on startup |

The code is three npm workspaces: `core` (shared types and math), `server` (Fastify and SQLite) and `web` (React and Vite). Money is
integer cents everywhere it is stored or summed, and a transaction's sign is plus for money in, minus for money out.

Changes arrive by pull request; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal and other noncommercial use.
