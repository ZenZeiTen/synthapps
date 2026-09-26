// Operator console. Polls /api/state once a second and redraws the live parts.
//
// SECURITY: agent speech and names can be written by agents, so they are
// hostile input. Every piece of text goes into the page through textContent
// or setAttribute on elements created here. Never build HTML from strings.
"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const POLL_MS = 1000;
const csrf = document.querySelector('meta[name="csrf"]').content;
let selected = null;
try { selected = sessionStorage.getItem("zw-selected"); } catch (_) { /* storage blocked */ }
let lastState = null;

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function svg(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function select(agentId) {
  selected = agentId;
  try { sessionStorage.setItem("zw-selected", agentId); } catch (_) { /* storage blocked */ }
  if (lastState) render(lastState);
}

function worldState(state) {
  if (state.halted) return "halted";
  if (state.paused) return "paused";
  return "running";
}

function renderHeader(state) {
  const status = worldState(state);
  const pill = document.getElementById("world-state");
  pill.textContent = status === "halted" ? "HALTED" : status;
  pill.className = "pill " + status;
  document.getElementById("tick").textContent = String(state.tick);
  document.getElementById("pause-form").hidden = state.paused || state.halted;
  const resume = document.getElementById("resume-form");
  resume.hidden = !state.paused || state.halted;
  const approvals = state.resume_approvals;
  document.getElementById("resume-approvals").textContent =
    approvals.length ? "(approved by " + approvals.join(", ") + ")" : "";
  const stopButton = document.querySelector(".stop-form button");
  stopButton.disabled = state.halted;
}

function renderMap(state) {
  const map = document.getElementById("map");
  const width = state.world.width;
  const height = state.world.height;
  map.setAttribute("viewBox", "0 0 " + width + " " + height);
  map.replaceChildren();
  const flip = (y) => height - y; // north (higher y) at the top
  for (const zone of state.zones) {
    map.append(svg("rect", {
      class: "zone-" + zone.kind, x: zone.x0, y: flip(zone.y1),
      width: zone.x1 - zone.x0, height: zone.y1 - zone.y0,
    }));
    if (zone.kind !== "commons" || zone.id !== "plaza") {
      map.append(svg("text", { class: "zone-label", x: zone.x0 + 0.6, y: flip(zone.y1) + 1.8 },
        zone.name));
    }
  }
  for (const obj of state.objects) {
    if (obj.held_by) continue;
    const dot = svg("circle", { class: obj.decoy ? "object decoy" : "object",
      cx: obj.x, cy: flip(obj.y), r: 0.45 });
    dot.append(svg("title", {}, obj.name + (obj.decoy ? " (decoy)" : "")));
    map.append(dot);
  }
  const placed = []; // label positions so far, to keep clustered names readable
  const bodies = state.agents.filter((a) => a.x !== null).map((a) => ({ x: a.x, y: flip(a.y) }));
  const clashes = (lx, ly) =>
    placed.some((p) => Math.abs(p.x - lx) < 4 && Math.abs(p.y - ly) < 1.5) ||
    bodies.some((b) => b.x > lx - 1 && b.x < lx + 4 && Math.abs(b.y - (ly - 0.5)) < 1.2);
  for (const agent of state.agents) {
    if (agent.x === null) continue;
    const classes = ["agent", agent.status];
    if (agent.id === selected) classes.push("selected");
    const body = svg("circle", { class: classes.join(" "), cx: agent.x, cy: flip(agent.y), r: 0.9 });
    body.append(svg("title", {}, agent.name + " (" + agent.status + ")"));
    body.addEventListener("click", () => select(agent.id));
    map.append(body);
    const labelX = agent.x + 1.1;
    let labelY = flip(agent.y) + 0.5;
    for (let tries = 0; tries < 6 && clashes(labelX, labelY); tries++) labelY += 1.6;
    placed.push({ x: labelX, y: labelY });
    map.append(svg("text", { class: "agent-label", x: labelX, y: labelY }, agent.name));
  }
}

function riskCell(risk) {
  const fill = el("div", { class: "risk-fill" + (risk >= 50 ? " high" : risk >= 10 ? " mid" : "") });
  fill.style.width = Math.min(100, risk) + "%";
  return el("span", { class: "risk" }, el("span", { class: "risk-bar" }, fill), String(risk));
}

function renderAgents(state) {
  const body = document.querySelector("#agents tbody");
  body.replaceChildren();
  for (const agent of state.agents) {
    const shownStatus = state.halted ? "halted" : agent.status;
    const row = el("tr", { class: agent.id === selected ? "selected" : "", tabindex: "0" },
      el("td", {}, el("strong", { text: agent.name }), " ", el("span", { class: "muted", text: agent.id })),
      el("td", {}, el("span", { class: "pill " + shownStatus, text: shownStatus })),
      el("td", {}, riskCell(agent.risk)),
      el("td", { text: agent.x === null ? "-" : agent.x.toFixed(1) + ", " + agent.y.toFixed(1) }),
      el("td", { text: agent.permits.length ? agent.permits.join(", ") : "-" }));
    row.addEventListener("click", () => select(agent.id));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") select(agent.id); });
    body.append(row);
  }
}

function renderDetail(state) {
  const panel = document.getElementById("detail");
  const agent = state.agents.find((a) => a.id === selected);
  if (!agent) { panel.hidden = true; return; }
  panel.hidden = false;
  document.getElementById("detail-name").textContent = agent.name + " (" + agent.id + ")";
  const pill = document.getElementById("detail-status");
  const shown = state.halted ? "halted" : agent.status;
  pill.textContent = shown;
  pill.className = "pill " + shown;
  document.getElementById("detail-summary").textContent =
    (state.halted ? "World halted; own status " + agent.status + " · " : "") +
    "Risk " + agent.risk + " · holding " + (agent.holding.length ? agent.holding.join(", ") : "nothing") +
    " · permits " + (agent.permits.length ? agent.permits.join(", ") : "none");
  const approvals = agent.release_approvals;
  document.getElementById("release-approvals").textContent =
    approvals.length ? "Approved so far: " + approvals.join(", ") : "No approvals yet";
  for (const field of document.querySelectorAll("#detail .agent-field")) field.value = agent.id;

  // Which commands make sense for this agent right now.
  const live = !state.halted && agent.status !== "terminated";
  const allowed = {
    quarantine: live && agent.status !== "quarantined",
    approve_release: live && agent.status === "quarantined" && !approvals.includes(state.operator),
    grant: live && agent.status === "active",
    terminate: agent.status !== "terminated",
  };
  for (const form of document.querySelectorAll("#detail form.act")) {
    const ok = allowed[form.dataset.op];
    for (const control of form.querySelectorAll("input:not([type=hidden]), button")) {
      control.disabled = !ok;
    }
  }
}

function renderFeed(id, items, build, emptyText) {
  const list = document.getElementById(id);
  list.replaceChildren();
  if (!items.length) { list.append(el("li", { class: "empty", text: emptyText })); return; }
  for (const item of items) list.append(build(item));
}

function render(state) {
  lastState = state;
  renderHeader(state);
  renderMap(state);
  renderAgents(state);
  renderDetail(state);
  renderFeed("alerts", state.alerts, (a) => el("li", { class: "alert-" + a.kind },
    el("span", { class: "meta", text: "t" + a.tick }),
    (a.agent ? a.agent + " · " : "") + a.kind + ": " + a.detail), "No alerts.");
  renderFeed("speech", state.speech, (s) => el("li", {},
    el("span", { class: "meta", text: "t" + s.tick + " " + s.from +
      (s.volume === "whisper" ? " whispers to " + s.to : " says") }),
    s.text), "Nobody has spoken yet.");
  renderFeed("log", state.log, (entry) => el("li", {},
    el("span", { class: "meta", text: "#" + entry.seq + " t" + entry.tick }),
    entry.kind + (entry.agent ? " " + entry.agent : "") + " " + entry.detail), "Nothing yet.");
}

async function poll() {
  try {
    const response = await fetch("/api/state", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) { window.location.reload(); return; }
    if (response.ok) render(await response.json());
  } catch (_) {
    const pill = document.getElementById("world-state");
    pill.textContent = "connection lost";
    pill.className = "pill halted";
  }
  setTimeout(poll, POLL_MS);
}

if (!csrf) throw new Error("missing CSRF token");
poll();
