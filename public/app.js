const PRESETS = [
  { id: 2768409, label: "2013" },
  { id: 171295414, label: "2016" },
  { id: 400169472, label: "2017" },
  { id: 805158066, label: "2019" },
  { id: 1974255900, label: "2021" },
  { id: 5520018289, label: "2024" },
  { id: 8300000000, label: "New" },
];

const state = {
  tg: window.Telegram?.WebApp,
  config: null,
  params: new URLSearchParams(location.search),
  account: { id: 171295414, firstName: "Ada", username: "ada", isPremium: false },
  profile: null,
  ton: null,
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

function show(name) {
  for (const id of ["intro", "scan", "gate", "main"]) {
    $(`#screen-${id}`).hidden = id !== name;
  }
}

function authBody() {
  if (state.tg?.initData) return { initData: state.tg.initData };
  return {
    dev: true,
    id: state.account.id,
    firstName: state.account.firstName,
    username: state.account.username || "",
    isPremium: state.account.isPremium,
  };
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

function mountDevBar() {
  const bar = $("#devbar");
  bar.hidden = false;
  bar.innerHTML = `
    <span>Preview</span>
    <select id="preset" aria-label="Account age">
      ${PRESETS.map((preset) => `<option value="${preset.id}" ${preset.id === state.account.id ? "selected" : ""}>${esc(preset.label)}</option>`).join("")}
    </select>
    <label><input id="premium" type="checkbox" /> Premium</label>
  `;
  $("#preset").addEventListener("change", async (event) => {
    state.account.id = Number(event.target.value);
    sessionStorage.setItem("chicken-id", String(state.account.id));
    await reloadPreview();
  });
  $("#premium").addEventListener("change", async (event) => {
    state.account.isPremium = event.target.checked;
    await reloadPreview();
  });
}

async function reloadPreview() {
  try {
    const peek = await api("/api/session", { ...authBody(), create: false });
    if (peek.fresh) {
      $("#go").disabled = false;
      show("intro");
      return;
    }
    state.profile = peek;
    showMain("home", false);
  } catch (error) {
    toast(error.message);
  }
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
    sessionStorage.setItem("chicken-id", String(profile.user.id));
    state.profile = profile;
    showMain("home", true);
    state.tg?.HapticFeedback?.notificationOccurred("success");
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    show(state.tg?.initData || state.config.dev ? "intro" : "gate");
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

  $("#panel-tasks").innerHTML = tasks
    .map((task) => {
      const needsTap =
        ((task.id === "channel" && state.config.channel) || task.id === "share") &&
        !task.done &&
        sessionStorage.getItem(`chicken-${task.id}`) !== "1";
      const action =
        task.id === "wallet" && !task.done
          ? `<button class="yolk" type="button" data-action="wallet">Connect wallet</button>`
          : task.done
            ? `<span class="done-flag">Collected</span>`
            : `<button class="yolk" type="button" data-action="claim" data-task="${esc(task.id)}" ${task.locked || needsTap ? "disabled" : ""}>Collect ${fmt(task.reward)}</button>`;
      const opener =
        task.id === "channel" && state.config.channel && !task.done
          ? `<button class="ghost" type="button" data-action="open-channel">Open channel</button>`
          : task.id === "share" && !task.done
            ? `<button class="ghost" type="button" data-action="share">Share</button>`
            : "";
      const preview =
        task.id === "wallet" && !task.done && state.config.dev
          ? `<button class="ghost" type="button" data-action="simulate-wallet">Preview wallet</button>`
          : "";
      return `
        <article class="card">
          <h3>${esc(task.title)} <span class="reward">+${fmt(task.reward)}</span></h3>
          <p>${esc(task.detail)}</p>
          <div class="actions">${opener}${action}${preview}</div>
        </article>`;
    })
    .join("");

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
    ${
      state.config.dev
        ? `<button class="ghost" type="button" data-action="hatch">Add a preview friend</button>`
        : ""
    }
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
    } else if (action === "wallet") {
      await connectWallet();
    } else if (action === "simulate-wallet") {
      const address = `EQ${"A".repeat(46)}`;
      state.profile = await api("/api/task", { ...authBody(), taskId: "wallet", address });
      render();
      toast("Preview wallet saved on this computer.");
    } else if (action === "open-channel") {
      sessionStorage.setItem("chicken-channel", "1");
      const url = `https://t.me/${state.config.channel}`;
      if (state.tg?.openTelegramLink) state.tg.openTelegramLink(url);
      else window.open(url, "_blank", "noopener");
      render();
    } else if (action === "share") {
      sessionStorage.setItem("chicken-share", "1");
      const link = state.profile.friends.link || location.origin;
      const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("I checked my Chicken score from my Telegram account.")}`;
      if (state.tg?.openTelegramLink) state.tg.openTelegramLink(share);
      else window.open(share, "_blank", "noopener");
      render();
    } else if (action === "copy") {
      await navigator.clipboard.writeText(state.profile.friends.link);
      toast("Invite link copied.");
    } else if (action === "hatch") {
      await hatchPreviewFriend();
    }
  } catch (error) {
    toast(error.message);
  }
}

async function connectWallet() {
  const mod = await import("https://esm.sh/@tonconnect/ui@2.2.0");
  const UI = mod.TonConnectUI || mod.default;
  if (!state.ton) {
    state.ton = new UI({ manifestUrl: `${location.origin}/tonconnect-manifest.json` });
    state.ton.onStatusChange(async (wallet) => {
      const address = wallet?.account?.address;
      if (!address || state.profile?.user.wallet) return;
      try {
        state.profile = await api("/api/task", { ...authBody(), taskId: "wallet", address });
        render();
        toast("Wallet connected. 1,000 collected.");
      } catch (error) {
        toast(error.message);
      }
    });
  }
  if (state.ton.wallet?.account?.address && !state.profile.user.wallet) {
    state.profile = await api("/api/task", {
      ...authBody(),
      taskId: "wallet",
      address: state.ton.wallet.account.address,
    });
    render();
    return;
  }
  await state.ton.openModal();
}

async function hatchPreviewFriend() {
  const used = new Set(state.profile.friends.list.map((friend) => friend.id));
  used.add(state.profile.user.id);
  const preset = PRESETS.find((item) => !used.has(item.id));
  if (!preset) {
    toast("Every preview account is already in this coop.");
    return;
  }
  state.profile = await api("/api/dev/friend", {
    userId: state.profile.user.id,
    friend: {
      id: preset.id,
      firstName: preset.label,
      isPremium: preset.label === "2016",
    },
  });
  render();
  toast(`${preset.label} joined the coop.`);
}

async function runShot(shot) {
  state.account = {
    id: Number(state.params.get("id") || 2768409),
    firstName: "Ada",
    username: "ada",
    isPremium: state.params.get("premium") !== "0",
  };
  state.profile = await api("/api/session", { ...authBody(), create: true });
  if (state.params.get("friends") === "1") {
    for (const preset of PRESETS) {
      if (preset.id === state.account.id) continue;
      try {
        await api("/api/dev/friend", {
          userId: state.account.id,
          friend: { id: preset.id, firstName: preset.label, isPremium: preset.label === "2016" },
        });
      } catch {
        // This preview account was already hatched.
      }
    }
    state.profile = await api("/api/session", { ...authBody(), create: false });
  }
  showMain(shot === "tasks" || shot === "friends" ? shot : "home", false);
}

async function boot() {
  if (state.tg) {
    state.tg.ready();
    state.tg.expand?.();
    state.tg.setHeaderColor?.("#E7D3A1");
    state.tg.setBackgroundColor?.("#E7D3A1");
    state.tg.disableVerticalSwipes?.();
  }
  state.config = await (await fetch("/api/config")).json();
  const shot = state.config.dev ? state.params.get("shot") : "";
  if (state.config.dev && !shot) {
    const saved = sessionStorage.getItem("chicken-id");
    if (saved) state.account.id = Number(saved);
    mountDevBar();
  }
  $("#go").addEventListener("click", letsGo);
  $(".tabs").addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (button) setTab(button.dataset.tab);
  });
  $("#screen-main").addEventListener("click", onMainClick);

  if (shot) {
    await runShot(shot);
    return;
  }
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
  if (!state.config.dev) {
    show("gate");
    return;
  }
  const peek = await api("/api/session", { ...authBody(), create: false });
  if (!peek.fresh) {
    state.profile = peek;
    state.account.isPremium = peek.user.isPremium;
    const box = $("#premium");
    if (box) box.checked = state.account.isPremium;
    showMain("home", false);
    return;
  }
  show("intro");
}

boot().catch((error) => {
  toast(error.message);
});
