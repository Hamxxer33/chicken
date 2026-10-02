import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateInitData } from "./auth.js";
import { configureBot, describeBot, isChatMember, startBot } from "./bot.js";
import { openDatabase } from "./db.js";
import { chickenPng } from "./icon.js";
import { RULES } from "./points.js";
import {
  claimTask,
  findTask,
  openCoop,
  openTask,
  savePendingReferral,
  takePendingReferral,
} from "./store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Railway sets RAILWAY_PUBLIC_DOMAIN once the service has a domain.
function publicUrl() {
  const explicit = process.env.PUBLIC_URL || "";
  if (explicit) return explicit.replace(/\/$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN || "";
  return railway ? `https://${railway}` : "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error("too large"), { status: 413, publicMessage: "Too large." }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("bad json"), { status: 400, publicMessage: "Bad request." }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, body, status = 200, type = "application/json; charset=utf-8") {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": type,
    "content-length": payload.length,
    "cache-control": type.startsWith("application/json") ? "no-store" : "public, max-age=300",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  throw error;
}

function parseReferrer(value, selfId) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = typeof value === "number" ? value : /^\d{1,16}$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric === selfId) return null;
  return numeric;
}

export async function startServer(options = {}) {
  if (!options.skipEnv) loadEnv(path.join(root, ".env"));
  const token = options.token ?? process.env.BOT_TOKEN ?? "";
  let botUsername = options.botUsername ?? process.env.BOT_USERNAME ?? "";
  const dataDir = process.env.DATA_DIR || path.join(root, "data");
  const db = openDatabase(options.dbPath ?? path.join(dataDir, "chicken.sqlite"));
  fs.writeFileSync(path.join(publicDir, "icon.png"), chickenPng());

  const viewOptions = () => ({ botUsername });
  const checkMember = options.checkMember ?? ((chat, userId) => isChatMember(token, chat, userId));

  async function confirmJoined(task, userId) {
    if (!task?.chat) return;
    let joined;
    try {
      joined = await checkMember(task.chat, userId);
    } catch (error) {
      console.error(error.message);
      fail(503, "Chicken can’t check that chat right now. Try again in a bit.");
    }
    if (!joined) fail(400, `Join @${task.chat} first, then collect.`);
  }

  async function identity(body) {
    if (body?.initData) {
      if (!token) fail(400, "This Chicken has no bot token yet.");
      const parsed = validateInitData(body.initData, token);
      if (!parsed) fail(401, "Telegram did not confirm this account. Open Chicken from the bot again.");
      return {
        profile: {
          id: parsed.user.id,
          username: parsed.user.username || "",
          firstName: parsed.user.first_name || "",
          isPremium: Boolean(parsed.user.is_premium),
        },
        startParam: parsed.startParam,
      };
    }
    fail(401, "Open Chicken from Telegram.");
  }

  async function session(body) {
    const { profile, startParam } = await identity(body);
    const create = Boolean(body.create);
    let referrerId = parseReferrer(startParam, profile.id);
    if (create && !referrerId) referrerId = parseReferrer(takePendingReferral(db, profile.id), profile.id);
    return openCoop(db, profile, {
      create,
      referrerId,
      ...viewOptions(),
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/health") {
        return send(res, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/config") {
        return send(res, {
          botUsername,
          hasBot: Boolean(token),
          rules: {
            premiumRate: RULES.premiumRate,
            ogRate: RULES.ogRate,
            referralRate: RULES.referralRate,
            milestoneEvery: RULES.milestoneEvery,
            milestoneBonus: RULES.milestoneBonus,
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/api/session") {
        return send(res, await session(await readBody(req)));
      }
      if (req.method === "POST" && url.pathname === "/api/task/open") {
        const body = await readBody(req);
        const { profile } = await identity(body);
        openTask(db, profile.id, body.taskId, options.now?.() ?? Date.now());
        return send(res, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/task") {
        const body = await readBody(req);
        const { profile } = await identity(body);
        await confirmJoined(findTask(body.taskId), profile.id);
        return send(
          res,
          claimTask(db, profile.id, body.taskId, {
            ...viewOptions(),
            now: options.now?.() ?? Date.now(),
          }),
        );
      }
      if (req.method === "GET") return sendFile(url.pathname, res);
      send(res, { error: "Not found." }, 404);
    } catch (error) {
      const status = error.status || 500;
      const message = error.status
        ? error.publicMessage || error.message
        : "Something went wrong.";
      send(res, { error: message }, status);
    }
  });

  await new Promise((resolve) => {
    server.listen(
      options.port ?? Number(process.env.PORT || 8787),
      options.host ?? process.env.HOST ?? "127.0.0.1",
      resolve,
    );
  });

  let stopBot = () => {};
  if (token && options.bot !== false) {
    try {
      const me = await describeBot(token);
      botUsername = botUsername || me.username || "";
      const webAppUrl = publicUrl();
      await configureBot(token, webAppUrl);
      stopBot = startBot({
        token,
        webAppUrl,
        onStart({ from, payload }) {
          const referrerId = parseReferrer(payload, from.id);
          if (referrerId) savePendingReferral(db, from.id, referrerId);
        },
      });
    } catch (error) {
      console.error(`Telegram bot did not start: ${error.message}`);
    }
  }

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    close() {
      stopBot();
      db.close();
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function sendFile(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(publicDir, requested));
  const relative = path.relative(publicDir, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return send(res, { error: "Not found." }, 404);
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, { error: "Not found." }, 404);
  }
  send(res, fs.readFileSync(file), 200, TYPES[path.extname(file)] || "application/octet-stream");
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const running = await startServer();
  console.log(`Chicken is listening on port ${new URL(running.url).port}`);
}
