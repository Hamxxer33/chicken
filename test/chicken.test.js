import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ageLabel, estimateJoined, estimateJoinedMs } from "../src/age.js";
import { validateInitData } from "../src/auth.js";
import { openDatabase } from "../src/db.js";
import { chickenPng } from "../src/icon.js";
import { ageScore, milestoneBonus, referralShare, scoreParts } from "../src/points.js";
import { startServer } from "../src/server.js";
import { openCoop, savePendingReferral, takePendingReferral } from "../src/store.js";

const NOW = new Date("2026-09-29T12:00:00Z");

function sign(fields, token) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, value);
  const pairs = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort();
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

test("account age grows as the telegram id shrinks", () => {
  assert.equal(estimateJoinedMs(2768409), 1383264000000);
  const early = estimateJoined(2768409, NOW);
  const later = estimateJoined(5520018289, NOW);
  assert.ok(early < later);
  assert.ok(ageScore(early, NOW) > ageScore(later, NOW) * 5);
  assert.equal(estimateJoined(9_000_000_000_000, NOW).getTime(), NOW.getTime());
});

test("premium, OG, friends, and the 5-friend pile follow the public rules", () => {
  const joined = new Date("2016-03-01T00:00:00Z");
  const plain = scoreParts(joined, false, NOW);
  const premium = scoreParts(joined, true, NOW);
  assert.equal(premium.premium, Math.round(plain.age * 0.2));
  assert.ok(premium.og > 0);
  assert.equal(scoreParts(new Date("2019-01-01T00:00:00Z"), false, NOW).og, 0);
  assert.equal(referralShare(premium.base), Math.round(premium.base * 0.1));
  assert.equal(milestoneBonus(4), 0);
  assert.equal(milestoneBonus(5), 20_000);
  assert.equal(milestoneBonus(10), 40_000);
  assert.match(ageLabel(joined, NOW), /years on Telegram/);
});

test("a signed telegram session is accepted and a tampered one is not", () => {
  const token = "123:ABC";
  const initData = sign(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "coop",
      user: JSON.stringify({ id: 171295414, first_name: "Ada", username: "ada", is_premium: true }),
      start_param: "2768409",
    },
    token,
  );
  const parsed = validateInitData(initData, token);
  assert.equal(parsed.user.id, 171295414);
  assert.equal(parsed.user.is_premium, true);
  assert.equal(parsed.startParam, "2768409");
  assert.equal(validateInitData(initData.replace("Ada", "Bob"), token), null);
  const stale = sign(
    {
      auth_date: String(Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60),
      user: JSON.stringify({ id: 7, first_name: "Old" }),
    },
    token,
  );
  assert.equal(validateInitData(stale, token), null);
});

test("opening the coop freezes a score and pays the referrer", () => {
  const db = openDatabase(":memory:");
  const referrer = openCoop(
    db,
    { id: 2768409, firstName: "Ada", username: "ada", isPremium: true },
    { now: NOW, create: true },
  );
  assert.equal(referrer.fresh, false);
  assert.ok(referrer.user.og);
  assert.ok(referrer.scores.premium > 0);
  const again = openCoop(
    db,
    { id: 2768409, firstName: "Ada", username: "ada", isPremium: true },
    { now: new Date("2030-01-01T00:00:00Z"), create: true },
  );
  assert.equal(again.scores.age, referrer.scores.age);

  savePendingReferral(db, 5520018289, 2768409);
  const friend = openCoop(
    db,
    { id: 5520018289, firstName: "Pip", username: "pip", isPremium: false },
    { now: NOW, create: true, referrerId: takePendingReferral(db, 5520018289) },
  );
  const paid = openCoop(
    db,
    { id: 2768409, firstName: "Ada", username: "ada", isPremium: true },
    { now: NOW },
  );
  assert.equal(paid.scores.referrals, referralShare(friend.scores.age + friend.scores.premium + friend.scores.og));
  assert.equal(paid.friends.count, 1);
  db.close();
});

test("the mini app serves the coop and the telegram rules", async () => {
  const token = "999:CHICKEN";
  const running = await startServer({
    port: 0,
    dev: true,
    token,
    skipEnv: true,
    bot: false,
    dbPath: ":memory:",
  });
  try {
    const page = await fetch(`${running.url}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Let’s go/);
    assert.match(html, /Chicken/);

    const png = await fetch(`${running.url}/icon.png`);
    const bytes = Buffer.from(await png.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(chickenPng().subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

    const initData = sign(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 400169472, first_name: "Nia", is_premium: false }),
      },
      token,
    );
    const created = await post(running.url, "/api/session", { initData, create: true });
    assert.equal(created.user.firstName, "Nia");
    assert.ok(created.user.og);
    assert.equal(created.scores.total, created.scores.age + created.scores.og);

    const bad = await post(running.url, "/api/task", { initData, taskId: "wallet", address: "nope" });
    assert.equal(bad.status, 400);

    const wallet = await post(running.url, "/api/task", {
      initData,
      taskId: "wallet",
      address: `0:${"ab".repeat(32)}`,
    });
    assert.equal(wallet.scores.tasks, 1000);
    const repeat = await post(running.url, "/api/task", {
      initData,
      taskId: "wallet",
      address: `0:${"cd".repeat(32)}`,
    });
    assert.equal(repeat.scores.tasks, 1000);

    const early = await post(running.url, "/api/task", { initData, taskId: "community" });
    assert.equal(early.status, 400);
    const channel = await post(running.url, "/api/task", { initData, taskId: "channel" });
    assert.equal(channel.scores.tasks, 1500);

    const ids = [171295414, 805158066, 1974255900, 5520018289, 8300000000];
    let latest = created;
    for (const id of ids) {
      latest = await post(running.url, "/api/dev/friend", {
        userId: 400169472,
        friend: { id, firstName: String(id), isPremium: id === 171295414 },
      });
    }
    assert.equal(latest.friends.count, 5);
    assert.equal(latest.scores.milestone, 20_000);
    assert.ok(latest.scores.referrals > 0);

    const self = await post(running.url, "/api/dev/friend", {
      userId: 400169472,
      friend: { id: 400169472, firstName: "Self" },
    });
    assert.equal(self.status, 400);
  } finally {
    await running.close();
  }
});

test("preview accounts are refused when dev mode is off", async () => {
  const running = await startServer({
    port: 0,
    dev: false,
    token: "999:CHICKEN",
    skipEnv: true,
    bot: false,
    dbPath: ":memory:",
  });
  try {
    const refused = await post(running.url, "/api/session", { dev: true, id: 2768409, create: true });
    assert.equal(refused.status, 403);
    const initData = sign(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 805158066, first_name: "Bo" }),
      },
      "999:CHICKEN",
    );
    await post(running.url, "/api/session", { initData, create: true });
    const channel = await post(running.url, "/api/task", { initData, taskId: "channel" });
    assert.equal(channel.status, 400);
    assert.equal(fs.existsSync(new URL("../public/index.html", import.meta.url)), true);
  } finally {
    await running.close();
  }
});

async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return response.ok ? data : { status: response.status, ...data };
}
