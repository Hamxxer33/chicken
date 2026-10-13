import { ageLabel, estimateJoined } from "./age.js";
import crypto from "node:crypto";
import { RULES, milestoneBonus, referralShare, scoreParts } from "./points.js";

// Spin and win: every slice pays points, so every spin is a win of some size.
// `weight` is how often each slice comes up relative to the others.
export const SPINS_PER_DAY = 3;
export const SLICES = [
  { reward: 100, weight: 30 },
  { reward: 250, weight: 25 },
  { reward: 150, weight: 20 },
  { reward: 500, weight: 13 },
  { reward: 200, weight: 8 },
  { reward: 1_000, weight: 4 },
];

function pickSlice(random) {
  const total = SLICES.reduce((sum, slice) => sum + slice.weight, 0);
  let roll = random() * total;
  for (let index = 0; index < SLICES.length; index += 1) {
    roll -= SLICES[index].weight;
    if (roll < 0) return index;
  }
  return 0;
}

const secureRandom = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

// A real GRAM prize. Each spin has its own `odds` roll, before the points
// slices, until `budget` GRAM has been won in total. Winners are paid by hand
// from the owner's wallet; see /api/admin/gram.
export const GRAM = Object.freeze({ amount: 1, odds: 20_000, budget: 5_000 });
const gramRoll = () => crypto.randomInt(0, GRAM.odds);

function gramLeft(db) {
  const won = Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS sum FROM gram_wins").get().sum);
  return Math.max(0, GRAM.budget - won);
}

export function validTonAddress(value) {
  const s = String(value || "").trim();
  return /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(s) || /^-?\d+:[0-9a-fA-F]{64}$/.test(s);
}

// Each task pays once. A task with `chat` pays only after Telegram confirms the
// player is a member, so the bot has to be an admin of that group or channel.
// A task with `link` can't be checked (X has no free follower lookup), so it
// pays once the player has had the link open for OPEN_SECONDS.
// A `daily` task pays again every UTC day; each day is its own row.
// Add `requires: "<other id>"` to unlock a task only after another one.
const TASKS = [
  {
    id: "group",
    title: "Join the Chicken group",
    detail: "Join @chickenyxz, then come back and collect.",
    reward: 3_000,
    chat: "chickenyxz",
  },
  {
    id: "channel",
    title: "Join the Chicken channel",
    detail: "Join @chickenxzy, then come back and collect.",
    reward: 3_000,
    chat: "chickenxzy",
  },
  {
    id: "daily",
    title: "Daily check-in",
    detail: "Come back every day for another 500.",
    reward: 500,
    daily: true,
  },
];

// Tasks for an X post that has been replaced. Their points are removed on
// start-up so everyone can do the new post's tasks. Give a new post new ids.
export const RETIRED_TASKS = ["x-repost", "x-like", "x-comment"];

// The row a task is stored under: daily tasks get one per UTC day.
function taskKey(task, now) {
  return task.daily ? `${task.id}:${day(now)}` : task.id;
}

export const OPEN_SECONDS = 10;

export function findTask(taskId) {
  return TASKS.find((item) => item.id === taskId) || null;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    is_premium: Number(row.is_premium),
    joined_at: Number(row.joined_at),
    scored_at: Number(row.scored_at),
    age_score: Number(row.age_score),
    premium_score: Number(row.premium_score),
    og_score: Number(row.og_score),
  };
}

export function getUser(db, id) {
  return rowToUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

function day(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function monthLabel(ms) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function present(db, id, { botUsername = "", now = Date.now() } = {}) {
  const user = getUser(db, id);
  if (!user) return { fresh: true };
  const friends = db
    .prepare(
      `SELECT r.share, u.id, u.username, u.first_name, u.is_premium
       FROM referrals r JOIN users u ON u.id = r.friend_id
       WHERE r.referrer_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(id)
    .map((friend) => ({
      id: Number(friend.id),
      name: friend.first_name || friend.username || "Friend",
      premium: Boolean(friend.is_premium),
      share: Number(friend.share),
    }));
  const done = new Map(
    db
      .prepare("SELECT task_id, reward FROM tasks WHERE user_id = ?")
      .all(id)
      .map((task) => [task.task_id, Number(task.reward)]),
  );
  const referralSum = friends.reduce((sum, friend) => sum + friend.share, 0);
  const milestone = milestoneBonus(friends.length);
  const taskSum = [...done.values()].reduce((sum, reward) => sum + reward, 0);
  const spinSum = Number(
    db.prepare("SELECT COALESCE(SUM(reward), 0) AS sum FROM spins WHERE user_id = ?").get(id).sum,
  );
  const spinsToday = Number(
    db.prepare("SELECT COUNT(*) AS n FROM spins WHERE user_id = ? AND day = ?").get(id, day(now)).n,
  );
  const gramWins = db
    .prepare("SELECT amount, paid_at FROM gram_wins WHERE user_id = ?")
    .all(id)
    .map((row) => ({ amount: Number(row.amount), paid: row.paid_at !== null }));
  const tasks = TASKS.map((task) => {
    const days = task.daily
      ? [...done.keys()].filter((key) => key.startsWith(`${task.id}:`)).length
      : 0;
    return {
      id: task.id,
      title: task.title,
      detail: days ? `${task.detail} ${days === 1 ? "1 day" : `${days} days`} so far.` : task.detail,
      reward: task.reward,
      url: task.chat ? `https://t.me/${task.chat}` : task.link || "",
      external: Boolean(task.link),
      daily: Boolean(task.daily),
      done: done.has(taskKey(task, now)),
      locked: Boolean(task.requires && !done.has(task.requires)),
    };
  });
  return {
    fresh: false,
    user: {
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      isPremium: Boolean(user.is_premium),
      og: user.og_score > 0,
      joined: day(user.joined_at),
      joinedLabel: monthLabel(user.joined_at),
      ageLabel: ageLabel(new Date(user.joined_at), new Date(user.scored_at)),
      scoredOn: day(user.scored_at),
    },
    scores: {
      age: user.age_score,
      premium: user.premium_score,
      og: user.og_score,
      referrals: referralSum,
      milestone,
      tasks: taskSum,
      spins: spinSum,
      total:
        user.age_score +
        user.premium_score +
        user.og_score +
        referralSum +
        milestone +
        taskSum +
        spinSum,
    },
    friends: {
      count: friends.length,
      nextIn: 5 - (friends.length % 5),
      milestone,
      link: botUsername ? `https://t.me/${botUsername}?startapp=${user.id}` : "",
      list: friends,
    },
    tasks,
    spin: {
      left: Math.max(0, SPINS_PER_DAY - spinsToday),
      perDay: SPINS_PER_DAY,
      slices: SLICES.map((slice) => slice.reward),
      gram: {
        amount: GRAM.amount,
        odds: GRAM.odds,
        left: gramLeft(db),
        won: gramWins.reduce((sum, win) => sum + win.amount, 0),
        unpaid: gramWins.filter((win) => !win.paid).reduce((sum, win) => sum + win.amount, 0),
        wallet: user.wallet || "",
      },
    },
  };
}

function touchProfile(db, row, profile) {
  const premiumScore =
    profile.isPremium && !row.is_premium
      ? Math.round(row.age_score * RULES.premiumRate)
      : row.premium_score;
  db.prepare(
    `UPDATE users
     SET username = ?, first_name = ?, is_premium = ?, premium_score = ?
     WHERE id = ?`,
  ).run(
    profile.username || row.username,
    profile.firstName || row.first_name,
    profile.isPremium || row.is_premium ? 1 : 0,
    premiumScore,
    row.id,
  );
}

function creditReferral(db, friend, referrerId, now) {
  if (!referrerId || referrerId === friend.id) return;
  const referrer = getUser(db, referrerId);
  if (!referrer) return;
  const already = db.prepare("SELECT 1 FROM referrals WHERE friend_id = ?").get(friend.id);
  if (already) return;
  const share = referralShare(friend.age_score + friend.premium_score + friend.og_score);
  db.prepare(
    "INSERT INTO referrals (friend_id, referrer_id, share, created_at) VALUES (?, ?, ?, ?)",
  ).run(friend.id, referrerId, share, now);
}

export function openCoop(db, profile, { now = new Date(), referrerId = null, create = false, botUsername } = {}) {
  const existing = getUser(db, profile.id);
  if (existing) {
    touchProfile(db, existing, profile);
    return present(db, profile.id, { botUsername });
  }
  if (!create) return { fresh: true };

  const scoredAt = now.getTime();
  const joined = estimateJoined(profile.id, now);
  const parts = scoreParts(joined, profile.isPremium, now);
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO users (
        id, username, first_name, is_premium, joined_at, scored_at,
        age_score, premium_score, og_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      profile.id,
      profile.username || "",
      profile.firstName || "",
      profile.isPremium ? 1 : 0,
      joined.getTime(),
      scoredAt,
      parts.age,
      parts.premium,
      parts.og,
    );
    creditReferral(
      db,
      { id: profile.id, age_score: parts.age, premium_score: parts.premium, og_score: parts.og },
      referrerId,
      scoredAt,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (!String(error.message).includes("UNIQUE") && !String(error.code).includes("CONSTRAINT")) {
      throw error;
    }
  }
  return present(db, profile.id, { botUsername });
}

export function savePendingReferral(db, userId, referrerId) {
  if (!userId || !referrerId || userId === referrerId) return;
  if (getUser(db, userId)) return;
  db.prepare(
    `INSERT INTO pending_referrals (user_id, referrer_id) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET referrer_id = excluded.referrer_id`,
  ).run(userId, referrerId);
}

export function takePendingReferral(db, userId) {
  const row = db.prepare("SELECT referrer_id FROM pending_referrals WHERE user_id = ?").get(userId);
  if (!row) return null;
  db.prepare("DELETE FROM pending_referrals WHERE user_id = ?").run(userId);
  return Number(row.referrer_id);
}

export function openTask(db, userId, taskId, now = Date.now()) {
  const task = findTask(taskId);
  if (!task?.link || !getUser(db, userId)) return;
  db.prepare(
    "INSERT OR IGNORE INTO task_opens (user_id, task_id, opened_at) VALUES (?, ?, ?)",
  ).run(userId, taskId, now);
}

export function claimTask(db, userId, taskId, { botUsername = "", now = Date.now() } = {}) {
  const user = getUser(db, userId);
  if (!user) {
    const error = new Error("Open the coop first.");
    error.status = 404;
    throw error;
  }
  const task = findTask(taskId);
  if (!task) {
    const error = new Error("Unknown task.");
    error.status = 400;
    throw error;
  }
  if (task.requires) {
    const prior = db
      .prepare("SELECT 1 FROM tasks WHERE user_id = ? AND task_id = ?")
      .get(userId, task.requires);
    if (!prior) {
      const error = new Error("Finish the earlier task first.");
      error.status = 400;
      throw error;
    }
  }
  const key = taskKey(task, now);
  const already = db
    .prepare("SELECT 1 FROM tasks WHERE user_id = ? AND task_id = ?")
    .get(userId, key);
  if (!already && task.link) {
    const opened = db
      .prepare("SELECT opened_at FROM task_opens WHERE user_id = ? AND task_id = ?")
      .get(userId, taskId);
    if (!opened) {
      const error = new Error("Tap Open first.");
      error.status = 400;
      throw error;
    }
    if (now - Number(opened.opened_at) < OPEN_SECONDS * 1000) {
      const error = new Error("Give it a few seconds on X, then collect.");
      error.status = 400;
      throw error;
    }
  }
  if (!already) {
    db.prepare(
      "INSERT INTO tasks (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)",
    ).run(userId, key, task.reward, now);
  }
  return present(db, userId, { botUsername, now });
}

export function spin(
  db,
  userId,
  { botUsername = "", now = Date.now(), random = secureRandom, gram = gramRoll } = {},
) {
  if (!getUser(db, userId)) {
    const error = new Error("Open the coop first.");
    error.status = 404;
    throw error;
  }
  const today = day(now);
  const used = Number(
    db.prepare("SELECT COUNT(*) AS n FROM spins WHERE user_id = ? AND day = ?").get(userId, today).n,
  );
  if (used >= SPINS_PER_DAY) {
    const error = new Error("No spins left today. Come back tomorrow.");
    error.status = 400;
    throw error;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const wonGram = gramLeft(db) >= GRAM.amount && gram() === 0;
    const index = wonGram ? SLICES.length : pickSlice(random);
    const reward = wonGram ? 0 : SLICES[index].reward;
    db.prepare(
      "INSERT INTO spins (user_id, day, n, reward, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, today, used + 1, reward, now);
    if (wonGram) {
      db.prepare("INSERT INTO gram_wins (user_id, amount, won_at) VALUES (?, ?, ?)").run(
        userId,
        GRAM.amount,
        now,
      );
    }
    db.exec("COMMIT");
    return {
      slice: index,
      reward,
      gram: wonGram ? GRAM.amount : 0,
      profile: present(db, userId, { botUsername, now }),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function saveWallet(db, userId, address, options = {}) {
  const trimmed = String(address || "").trim();
  if (!validTonAddress(trimmed)) {
    const error = new Error("That is not a GRAM (TON) wallet address.");
    error.status = 400;
    throw error;
  }
  if (!getUser(db, userId)) {
    const error = new Error("Open the coop first.");
    error.status = 404;
    throw error;
  }
  db.prepare("UPDATE users SET wallet = ? WHERE id = ?").run(trimmed, userId);
  return present(db, userId, options);
}

export function listGramWins(db) {
  return db
    .prepare(
      `SELECT g.id, g.user_id, u.username, u.first_name, u.wallet, g.amount, g.won_at, g.paid_at, g.tx
       FROM gram_wins g JOIN users u ON u.id = g.user_id
       ORDER BY g.paid_at IS NOT NULL, g.won_at`,
    )
    .all()
    .map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      username: row.username,
      name: row.first_name,
      wallet: row.wallet || "",
      amount: Number(row.amount),
      wonAt: new Date(Number(row.won_at)).toISOString(),
      paidAt: row.paid_at === null ? null : new Date(Number(row.paid_at)).toISOString(),
      tx: row.tx || "",
    }));
}

export function markGramPaid(db, id, tx, now = Date.now()) {
  const result = db
    .prepare("UPDATE gram_wins SET paid_at = ?, tx = ? WHERE id = ? AND paid_at IS NULL")
    .run(now, String(tx || ""), Number(id));
  if (!Number(result.changes)) {
    const error = new Error("No unpaid win with that id.");
    error.status = 404;
    throw error;
  }
  return listGramWins(db);
}
