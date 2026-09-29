# Chicken

A Telegram mini app that scores an account the way the 2024 DOGS coop did.

You tap **Let’s go**. Chicken reads an estimate of how long that Telegram account has existed, then adds Premium, friends, and a few tasks. The number is frozen at that scan. It is a point balance in this app, not a listed coin.

DOGS never published the exact age curve. The public rules are the same here, with Chicken’s weights written in `src/points.js`:

| Piece | What you get |
| --- | --- |
| Account age | 400 for a brand-new account, up to 110,000 at 13 years. Months in between are prorated. |
| Premium | +20% of the age score |
| OG | +10% of the age score if the account dates from 2017 or earlier |
| A friend | 10% of that friend’s age + Premium + OG score. Older friends are worth more. |
| Every 5 friends | 20,000 |
| TON wallet | 1,000, once |
| Channel | 500, once `CHANNEL_USERNAME` is set |
| Coop book | 50, after the channel |
| Share | 200 |

Telegram does not tell bots the real signup date. Age is estimated from the account id.

## Preview on this computer

```bash
npm start
```

Open http://127.0.0.1:8787

The age menu at the top is only for this preview. It is off once `BOT_TOKEN` is set, unless you set `DEV_MODE=1`.

```bash
npm test
```

## Open it inside Telegram

1. In Telegram, talk to [@BotFather](https://t.me/BotFather). Create a bot. Copy the token.
2. Put the token in `.env` (copy `.env.example`).
3. Put an **https** address in `PUBLIC_URL`. Telegram will not open an `http://` mini app. A tunnel or a small host works. This server uses long polling, so the process has to stay running.
4. `npm start`. The bot sets its menu button to Chicken when `PUBLIC_URL` is https.
5. Invite links look like `https://t.me/YourBot?startapp=123`. The friend’s score is what pays you, plus 20,000 every fifth friend.

Leave `DEV_MODE` unset in that setup. The browser preview can invent accounts, so it stays off when a real bot token is present.

Wallet connect uses TON Connect. It needs the https address in the manifest. The app never asks for a seed phrase.

## Where we left off

The mini app works on this computer. Home, Tasks, and Friends are in place. Scores freeze on the first scan. Tests cover age, Premium, OG, the 5-friend bonus, wallet, and a signed Telegram login.

Nothing is on a public https address yet, so Telegram cannot open it. There is no coin contract and no exchange listing. Points live in `data/chicken.sqlite` on the machine that runs `npm start`.

## What you need before it works in Telegram

Copy `.env.example` to `.env`. Fill these in:

| Name | Where it comes from | Why |
| --- | --- | --- |
| `BOT_TOKEN` | @BotFather → `/newbot` | Proves each player is a real Telegram account. Without it, only the browser preview runs. |
| `BOT_USERNAME` | The bot’s @ name, without @. Filled automatically from the token if you leave it blank. | Builds invite links: `https://t.me/<name>?startapp=<id>` |
| `PUBLIC_URL` | An https address that reaches this server | Telegram refuses `http://` mini apps, including localhost. |
| `CHANNEL_USERNAME` | A Telegram channel you own, without @ | Unlocks the 500 channel task. Optional until you want that task. |
| `PORT` | Default `8787` | Local port. |
| `DEV_MODE` | Leave empty | Empty + a bot token turns the fake-account preview off. Set `1` only while testing. |

Also required, and not in `.env`:

- This process has to stay running. The bot uses long polling, not a serverless function. A small VPS, or your PC plus a tunnel, both work.
- The https host must proxy to `PORT`. BotFather menu button should be the same `PUBLIC_URL`.
- A player who connects a wallet needs a normal TON wallet (Tonkeeper or Telegram Wallet). Chicken never asks for a seed phrase.
- Node.js 22 or newer. No `npm install` step: the app uses only Node’s built-in libraries.

## What is still later

- A public https deploy, then the real bot.
- A TON jetton, if the points should become a coin. That is a separate launch, the way DOGS listed after the coop closed.
- A real channel username, if you want the channel task to pay.
