const state = {
  tg: window.Telegram?.WebApp,
  config: null,
  profile: null,
  wheelTurn: 0,
  spinning: false,
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
  for (const id of ["home", "tasks", "spin", "friends"]) {
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
      ${row("Spins", scores.spins)}
      ${state.profile.spin.gram.won ? `<div class="row"><span>GRAM won</span><b>${fmt(state.profile.spin.gram.won)}</b></div>` : ""}
    </div>
    <p class="note">Chicken points live in this coop. They are not a listed coin.</p>
  `;

  $("#panel-tasks").innerHTML = tasks.length
    ? tasks
        .map((task) => {
          const action = task.done
            ? `<span class="done-flag">${task.daily ? "Back tomorrow" : "Collected"}</span>`
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
  renderSpin();

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

const WHEEL_COLORS = ["#f0b429", "#fff6e4", "#f6d68a", "#e23d32", "#fff6e4", "#2f6b45"];
const WHEEL_TEXT = ["#2a1b10", "#2a1b10", "#2a1b10", "#fff6e4", "#2a1b10", "#fff6e4"];

function wheelSlices(spin) {
  const labels = spin.slices.map((reward) => fmt(reward));
  if (spin.gram.left >= spin.gram.amount) labels.push(`${spin.gram.amount} GRAM`);
  return labels;
}

function wheelSvg(slices) {
  const size = slices.length;
  const step = (Math.PI * 2) / size;
  const point = (angle, radius) => [100 + radius * Math.sin(angle), 100 - radius * Math.cos(angle)];
  const parts = slices.map((label, index) => {
    const gram = label.endsWith("GRAM");
    const [x1, y1] = point(index * step, 98);
    const [x2, y2] = point((index + 1) * step, 98);
    const mid = (index + 0.5) * step;
    const [tx, ty] = point(mid, 66);
    const degrees = (mid * 180) / Math.PI;
    return `
      <path d="M100 100 L${x1} ${y1} A98 98 0 0 1 ${x2} ${y2} Z" fill="${gram ? "#2a1b10" : WHEEL_COLORS[index % WHEEL_COLORS.length]}" stroke="#2a1b10" stroke-width="2" />
      <text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${degrees} ${tx} ${ty})" style="fill:${gram ? "#f0b429" : WHEEL_TEXT[index % WHEEL_TEXT.length]}${gram ? ";font-size:13px" : ""}">${esc(label)}</text>`;
  });
  return `<svg class="wheel" id="wheel" viewBox="0 0 200 200" style="transform: rotate(${state.wheelTurn}deg)">
    <circle cx="100" cy="100" r="99" fill="#2a1b10" />${parts.join("")}</svg>`;
}

function renderSpin() {
  const { spin } = state.profile;
  const { gram } = spin;
  const left = spin.left;
  const gramOn = gram.left >= gram.amount;
  const prize = gram.won
    ? `<article class="card gram-card">
        <h3>You won ${fmt(gram.won)} GRAM</h3>
        ${
          gram.unpaid
            ? gram.wallet
              ? `<p>${fmt(gram.unpaid)} GRAM will be sent to <b>${esc(gram.wallet.slice(0, 6))}…${esc(gram.wallet.slice(-4))}</b>.</p>`
              : `<p>Add your GRAM (TON) wallet address so we can send it.</p>`
            : `<p>Paid. Check your wallet.</p>`
        }
        ${
          gram.unpaid
            ? `<form class="wallet-form" data-form="wallet">
                <input name="address" autocomplete="off" spellcheck="false" placeholder="UQ… or EQ… wallet address" value="${esc(gram.wallet)}" aria-label="GRAM wallet address" />
                <button class="yolk" type="submit">${gram.wallet ? "Update wallet" : "Save wallet"}</button>
              </form>`
            : ""
        }
      </article>`
    : "";
  $("#panel-spin").innerHTML = `
    <div class="spin">
      <h2>Spin and win</h2>
      <p class="note">${spin.perDay} free spins a day. Every spin pays Chicken points${
        gramOn
          ? `, or ${gram.amount} GRAM with a 1 in ${fmt(gram.odds)} chance. ${fmt(gram.left)} GRAM left in the prize pool.`
          : ". The GRAM prize pool has been won."
      }</p>
      <div class="wheel-wrap">
        <span class="pointer" aria-hidden="true"></span>
        ${wheelSvg(wheelSlices(spin))}
        <span class="hub" aria-hidden="true"><svg><use href="#chicken" /></svg></span>
      </div>
      <button class="yolk" type="button" data-action="spin" ${left && !state.spinning ? "" : "disabled"}>
        ${left ? "Spin" : "Come back tomorrow"}
      </button>
      <p class="spin-left">${left === 1 ? "1 spin left today" : `${left} spins left today`}</p>
      ${prize}
    </div>`;
}

async function onWalletSubmit(event) {
  const form = event.target.closest("[data-form=wallet]");
  if (!form) return;
  event.preventDefault();
  try {
    state.profile = await api("/api/wallet", { ...authBody(), address: form.address.value });
    render();
    setTab("spin");
    toast("Wallet saved.");
  } catch (error) {
    toast(error.message);
  }
}

async function doSpin() {
  if (state.spinning) return;
  state.spinning = true;
  renderSpin();
  try {
    const result = await api("/api/spin", authBody());
    const size = wheelSlices(state.profile.spin).length;
    const center = (result.slice + 0.5) * (360 / size);
    const current = ((state.wheelTurn % 360) + 360) % 360;
    const target = (360 - center + 360) % 360;
    state.wheelTurn += 360 * 5 + ((target - current + 360) % 360);
    $("#wheel").style.transform = `rotate(${state.wheelTurn}deg)`;
    state.tg?.HapticFeedback?.impactOccurred?.("medium");
    await sleep(3700);
    state.profile = result.profile;
    state.spinning = false;
    render();
    state.tg?.HapticFeedback?.notificationOccurred("success");
    if (result.gram) toast(`You won ${fmt(result.gram)} GRAM!`);
    else toast(`+${fmt(result.reward)} Chicken`);
  } catch (error) {
    state.spinning = false;
    renderSpin();
    toast(error.message);
  }
}

function row(label, value) {
  return `<div class="row"><span>${label}</span><b>${fmt(value)}</b></div>`;
}

async function onMainClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === "spin") {
      await doSpin();
    } else if (action === "claim") {
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
  $("#screen-main").addEventListener("submit", onWalletSubmit);

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
