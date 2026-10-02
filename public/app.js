const state = {
  tg: window.Telegram?.WebApp,
  config: null,
  profile: null,
};

const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function fmt(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
}

// Mirrors Telegram's safe areas into CSS, for clients whose script does not.
function syncInsets() {
  const tg = state.tg;
  if (!tg) return;
  const root = document.documentElement.style;
  const set = (name, value) => {
    if (Number.isFinite(value)) root.setProperty(name, `${value}px`);
  };
  set("--tg-safe-area-inset-top", tg.safeAreaInset?.top);
  set("--tg-safe-area-inset-bottom", tg.safeAreaInset?.bottom);
  set("--tg-content-safe-area-inset-top", tg.contentSafeAreaInset?.top);
}

function show(name) {
  for (const id of ["intro", "scan", "gate", "main"]) {
    $(`#screen-${id}`).hidden = id !== name;
  }
}

function authBody() {
  return { initData: state.tg?.initData || "" };
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function playScan(work) {
  show("scan");
  const steps = [...document.querySelectorAll("#screen-scan li")];
  steps.forEach((step) => step.classList.remove("on"));
  const pending = work();
  for (const step of steps) {
    await sleep(480);
    step.classList.add("on");
  }
  const result = await pending;
  await sleep(220);
  return result;
}

async function letsGo() {
  const button = $("#go");
  button.disabled = true;
  try {
    const profile = await playScan(() => api("/api/session", { ...authBody(), create: true }));
    state.profile = profile;
    showMain("home", true);
    state.tg?.HapticFeedback?.notificationOccurred("success");
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    show(state.tg?.initData ? "intro" : "gate");
  }
}

function showMain(tab, animate) {
  show("main");
  render();
  setTab(tab);
  if (animate) countUp($("#balance"), state.profile.scores.total);
}

function setTab(name) {
  for (const id of ["home", "tasks", "friends"]) {
    $(`#panel-${id}`).hidden = id !== name;
    const button = $(`.tab[data-tab="${id}"]`);
    if (id === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function countUp(node, total) {
  if (!node) return;
  const started = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - started) / 700);
    node.textContent = fmt(Math.round(total * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function render() {
  const { user, scores, friends, tasks } = state.profile;
  $("#panel-home").innerHTML = `
    <div class="hero">
      <svg class="mascot" aria-hidden="true"><use href="#chicken" /></svg>
      <p class="who">
        <strong>${esc(user.firstName || user.username || "You")}</strong>
        ${user.og ? '<span class="badge">OG</span>' : ""}
        ${user.isPremium ? '<span class="badge">Premium</span>' : ""}
        <br />${esc(user.ageLabel)} · joined ${esc(user.joinedLabel)}
      </p>
    </div>
    <p class="balance" id="balance">${fmt(scores.total)}</p>
    <p class="unit">CHICKEN</p>
    <p class="note">Counted on ${esc(user.scoredOn)}. This pile stays put.</p>
    <div class="rows">
      ${row("Account age", scores.age)}
      ${row("Premium", scores.premium)}
      ${user.og ? row("OG", scores.og) : ""}
      ${row("Friends", scores.referrals)}
      ${row("Every 5 friends", scores.milestone)}
      ${row("Tasks", scores.tasks)}
    </div>
    <p class="note">Chicken points live in this coop. They are not a listed coin.</p>
  `;

  $("#panel-tasks").innerHTML = tasks.length
    ? tasks
        .map((task) => {
          const action = task.done
            ? `<span class="done-flag">Collected</span>`
            : `<button class="yolk" type="button" data-action="claim" data-task="${esc(task.id)}" ${task.locked ? "disabled" : ""}>Collect ${fmt(task.reward)}</button>`;
          const opener =
            task.url && !task.done
              ? `<button class="ghost" type="button" data-action="open" data-task="${esc(task.id)}" data-external="${task.external ? "1" : ""}" data-url="${esc(task.url)}">Open</button>`
              : "";
          return `
            <article class="card">
              <h3>${esc(task.title)} <span class="reward">+${fmt(task.reward)}</span></h3>
              <p>${esc(task.detail)}</p>
              <div class="actions">${opener}${action}</div>
            </article>`;
        })
        .join("")
    : `<p class="note">Tasks are coming soon.</p>`;

  const eggs = Array.from({ length: 5 }, (_, index) => {
    const full = index < friends.count % 5;
    return `<span class="egg${full ? " full" : ""}"></span>`;
  }).join("");
  const friendRows = friends.list.length
    ? friends.list
        .map(
          (friend) => `
            <div class="friend">
              <span>${esc(friend.name)}${friend.premium ? " · Premium" : ""}</span>
              <b>+${fmt(friend.share)}</b>
            </div>`,
        )
        .join("")
    : `<p class="note">The coop is quiet. Invite someone who already uses Telegram.</p>`;
  $("#panel-friends").innerHTML = `
    <article class="card">
      <h3>Every 5 friends: ${fmt(state.config.rules.milestoneBonus)}</h3>
      <p>${friends.count === 1 ? "1 friend" : `${friends.count} friends`}. ${friends.nextIn} to the next pile.${friends.milestone ? ` Already collected ${fmt(friends.milestone)}.` : ""}</p>
      <div class="eggs" aria-hidden="true">${eggs}</div>
      ${
        friends.link
          ? `<div class="actions"><button class="yolk" type="button" data-action="copy">Copy invite link</button></div>`
          : `<p class="note">The invite link shows up once the bot username is set.</p>`
      }
    </article>
    <div class="rows">${friendRows}</div>
  `;
}

function row(label, value) {
  return `<div class="row"><span>${label}</span><b>${fmt(value)}</b></div>`;
}

async function onMainClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === "claim") {
      state.profile = await api("/api/task", { ...authBody(), taskId: button.dataset.task });
      render();
      toast("Collected.");
    } else if (action === "open") {
      const url = button.dataset.url;
      if (button.dataset.external) {
        api("/api/task/open", { ...authBody(), taskId: button.dataset.task }).catch(() => {});
        if (state.tg?.openLink) state.tg.openLink(url);
        else window.open(url, "_blank", "noopener");
      } else if (state.tg?.openTelegramLink) state.tg.openTelegramLink(url);
      else window.open(url, "_blank", "noopener");
    } else if (action === "copy") {
      await navigator.clipboard.writeText(state.profile.friends.link);
      toast("Invite link copied.");
    }
  } catch (error) {
    toast(error.message);
  }
}

async function boot() {
  if (state.tg) {
    state.tg.ready();
    state.tg.expand?.();
    state.tg.setHeaderColor?.("#E7D3A1");
    state.tg.setBackgroundColor?.("#E7D3A1");
    state.tg.disableVerticalSwipes?.();
    syncInsets();
    for (const event of ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged"]) {
      state.tg.onEvent?.(event, syncInsets);
    }
  }
  state.config = await (await fetch("/api/config")).json();
  $("#go").addEventListener("click", letsGo);
  $(".tabs").addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (button) setTab(button.dataset.tab);
  });
  $("#screen-main").addEventListener("click", onMainClick);

  if (state.tg?.initData) {
    const peek = await api("/api/session", { initData: state.tg.initData, create: false });
    if (!peek.fresh) {
      state.profile = peek;
      showMain("home", false);
      return;
    }
    show("intro");
    return;
  }
  show("gate");
}

boot().catch((error) => {
  toast(error.message);
});
