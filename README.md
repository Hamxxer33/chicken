# Chicken

A Telegram mini app that scores an account the way the 2024 DOGS coop did.

You tap **Let’s go**. Chicken reads an estimate of how long that Telegram account has existed, then adds Premium and friends. The number is frozen at that scan. It is a point balance in this app, not a listed coin.

DOGS never published the exact age curve. The public rules are the same here, with Chicken’s weights written in `src/points.js`:

| Piece | What you get |
| --- | --- |
| Account age | 400 for a brand-new account, up to 110,000 at 13 years. Months in between are prorated. |
| Premium | +20% of the age score |
| OG | +10% of the age score if the account dates from 2017 or earlier |
| A friend | 10% of that friend’s age + Premium + OG score. Older friends are worth more. |
| Every 5 friends | 20,000 |
| Tasks | None yet. Add them to `TASKS` in `src/store.js` once the bot is live. |

Telegram does not tell bots the real signup date. Age is estimated from the account id.

Only players signed in through Telegram can score. There is no browser preview and no fake accounts. Opened outside Telegram, the page says to open it from the bot.

```bash
npm test
```

## Go live on Railway

1. In Telegram, talk to [@BotFather](https://t.me/BotFather). Send `/newbot` and copy the token.
2. On [Railway](https://railway.com), create a project from this GitHub repo. It builds from the `Dockerfile`.
3. In the service, add a **Volume** mounted at `/data`. That is where `chicken.sqlite` lives. Without it, every deploy wipes all points.
4. Under **Variables**, set `BOT_TOKEN`.
5. Under **Settings → Networking**, click **Generate Domain**. Chicken uses that https address automatically. If you use your own domain, set `PUBLIC_URL` to it.
6. Redeploy. On start the bot sets its menu button and `/start` message to the mini app.
7. In BotFather: **Bot Settings → Configure Mini App → Enable**, and enter the same https address. Invite links (`https://t.me/YourBot?startapp=123`) only open the app once this is set.

Keep it at one replica. The bot uses long polling, and two copies would fight over Telegram updates.

## Settings

| Name | Where it comes from | Why |
| --- | --- | --- |
| `BOT_TOKEN` | @BotFather → `/newbot` | Required. Proves each player is a real Telegram account. |
| `BOT_USERNAME` | Filled automatically from the token | Builds invite links: `https://t.me/<name>?startapp=<id>` |
| `PUBLIC_URL` | Your https address | Optional on Railway, which provides `RAILWAY_PUBLIC_DOMAIN`. Telegram refuses `http://`. |
| `DATA_DIR` | `/data` in the Dockerfile | Where `chicken.sqlite` is stored. |
| `HOST` / `PORT` | `0.0.0.0` in the Dockerfile; Railway sets `PORT` | Where the server listens. |

Node.js 22.13 or newer. No `npm install` step: the app uses only Node’s built-in libraries.

## What is still later

- Tasks, once the bot is live.
- Backups of `/data/chicken.sqlite`.
- A TON jetton, if the points should become a coin. That is a separate launch, the way DOGS listed after the coop closed.
