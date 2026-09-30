import { ageLabel, estimateJoined } from "./age.js";
import { RULES, milestoneBonus, referralShare, scoreParts } from "./points.js";

// Each task pays once. A task with `chat` pays only after Telegram confirms the
// player is a member, so the bot has to be an admin of that group or channel.
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
];

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

export function present(db, id, { botUsername = "" } = {}) {
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
  const tasks = TASKS.map((task) => ({
    id: task.id,
    title: task.title,
    detail: task.detail,
    reward: task.reward,
    url: task.chat ? `https://t.me/${task.chat}` : "",
    done: done.has(task.id),
    locked: Boolean(task.requires && !done.has(task.requires)),
  }));
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
      total:
        user.age_score +
        user.premium_score +
        user.og_score +
        referralSum +
        milestone +
        taskSum,
    },
    friends: {
      count: friends.length,
      nextIn: 5 - (friends.length % 5),
      milestone,
      link: botUsername ? `https://t.me/${botUsername}?startapp=${user.id}` : "",
      list: friends,
    },
    tasks,
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

export function claimTask(db, userId, taskId, { botUsername = "" } = {}) {
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
  const already = db
    .prepare("SELECT 1 FROM tasks WHERE user_id = ? AND task_id = ?")
    .get(userId, taskId);
  if (!already) {
    db.prepare(
      "INSERT INTO tasks (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)",
    ).run(userId, taskId, task.reward, Date.now());
  }
  return present(db, userId, { botUsername });
}
