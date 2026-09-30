const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

export async function describeBot(token) {
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || "getMe failed");
  return data.result;
}

export function startBot({ token, webAppUrl, onStart }) {
  let offset = 0;
  let stopped = false;

  async function sendOpen(chatId) {
    const text =
      "Chicken is open.\n\nYour score comes from how long you have been on Telegram, plus Premium, friends, and a few tasks.\n\nTap Let’s go.";
    const https = typeof webAppUrl === "string" && webAppUrl.startsWith("https://");
    const marked = await telegram(token, "sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: https
        ? { inline_keyboard: [[{ text: "Let’s go", web_app: { url: webAppUrl } }]] }
        : undefined,
    });
    if (!marked.ok) {
      await telegram(token, "sendMessage", {
        chat_id: chatId,
        text: `${text}\n\n${webAppUrl}`,
      });
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?timeout=50&offset=${offset}`,
          { signal: AbortSignal.timeout(60_000) },
        );
        const data = await response.json();
        if (!data.ok) {
          await sleep(3_000);
          continue;
        }
        for (const update of data.result) {
          offset = update.update_id + 1;
          const message = update.message;
          if (!message?.text?.startsWith("/start")) continue;
          const payload = message.text.trim().split(/\s+/)[1] || "";
          if (onStart) onStart({ from: message.from, payload });
          await sendOpen(message.chat.id);
        }
      } catch {
        if (!stopped) await sleep(3_000);
      }
    }
  }

  loop();
  return () => {
    stopped = true;
  };
}

export async function configureBot(token, webAppUrl) {
  await telegram(token, "setMyCommands", {
    commands: [{ command: "start", description: "Open the coop" }],
  });
  if (webAppUrl.startsWith("https://")) {
    await telegram(token, "setChatMenuButton", {
      menu_button: { type: "web_app", text: "Chicken", web_app: { url: webAppUrl } },
    });
  }
}

// Needs the bot to be an admin of a channel, or a member of a group.
export async function isChatMember(token, chat, userId) {
  const data = await telegram(token, "getChatMember", { chat_id: `@${chat}`, user_id: userId });
  if (!data.ok) {
    const error = new Error(`getChatMember @${chat}: ${data.description || "failed"}`);
    error.unverifiable = true;
    throw error;
  }
  const { status, is_member: isMember } = data.result;
  return ["creator", "administrator", "member"].includes(status) || (status === "restricted" && isMember);
}
