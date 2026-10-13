// One-off messages to every player. Set BROADCAST=<name> on the server to
// send that message; each player gets each broadcast at most once, so a
// restart or redeploy does not send it again.

export const BROADCASTS = {
  "gram-event-1": {
    photo: "/event-gram.png",
    button: "Spin now",
    caption: [
      "🐔 NEW EVENT: 5,000 GRAM up for grabs!",
      "",
      "Join Chicken on Telegram and try your luck. 3 free spins every day, and each spin has a 1 in 20,000 chance to win 1 GRAM until the 5,000 GRAM pool runs out. Every other spin pays Chicken points.",
      "",
      "👉 @chickenxyz_bot",
    ].join("\n"),
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runBroadcast({ db, name, send, publicUrl, delayMs = 50, log = console.log }) {
  const message = BROADCASTS[name];
  if (!message) {
    log(`Broadcast ${name}: no such broadcast.`);
    return { sent: 0, failed: 0 };
  }
  const pending = db
    .prepare(
      `SELECT id FROM users
       WHERE id NOT IN (SELECT user_id FROM broadcast_sends WHERE name = ?)
       ORDER BY id`,
    )
    .all(name)
    .map((row) => Number(row.id));
  const record = db.prepare(
    "INSERT OR REPLACE INTO broadcast_sends (name, user_id, ok, error, sent_at) VALUES (?, ?, ?, ?, ?)",
  );
  const body = (chatId) => ({
    chat_id: chatId,
    photo: `${publicUrl}${message.photo}`,
    caption: message.caption,
    reply_markup: publicUrl.startsWith("https://")
      ? { inline_keyboard: [[{ text: message.button, web_app: { url: publicUrl } }]] }
      : undefined,
  });
  let sent = 0;
  let failed = 0;
  log(`Broadcast ${name}: sending to ${pending.length} players.`);
  for (const chatId of pending) {
    let result = await send("sendPhoto", body(chatId));
    if (!result.ok && result.parameters?.retry_after) {
      await sleep(result.parameters.retry_after * 1000);
      result = await send("sendPhoto", body(chatId));
    }
    record.run(name, chatId, result.ok ? 1 : 0, result.ok ? null : result.description || "failed", Date.now());
    if (result.ok) sent += 1;
    else failed += 1;
    if (delayMs) await sleep(delayMs);
  }
  log(`Broadcast ${name}: ${sent} sent, ${failed} could not be reached.`);
  return { sent, failed };
}
