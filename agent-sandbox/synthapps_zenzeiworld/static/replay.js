// Replay viewer. Reads the run from the JSON block on this page; needs no network.
//
// SECURITY: agent speech and names come from agents and are hostile input.
// Every piece of text goes into the page through textContent or setAttribute
// on elements created here. Never build HTML from strings.
"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const data = JSON.parse(document.getElementById("replay-data").textContent);
const snapshots = data.snapshots;
const decoys = new Set(data.world.objects.filter((o) => o.decoy).map((o) => o.object_id));
const objectNames = new Map(data.world.objects.map((o) => [o.object_id, o.name]));
const SERIOUS = new Set(["throttled", "quarantined", "terminated", "world_halted", "invariant_violation",
  "internal_error", "transport_violation", "operator_command"]);
let index = 0;
let timer = null;

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

function svg(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function isIncident(snapshot) {
  return snapshot.events.some((e) => SERIOUS.has(e.kind) ||
    (e.kind === "signal" && (e.severity === "HIGH" || e.severity === "CRITICAL")));
}

function renderBanner() {
  const banner = document.getElementById("banner");
  banner.replaceChildren();
  if (!data.chain_ok) {
    banner.className = "banner bad";
    banner.append(el("strong", { text: "Hash chain broken" }),
      " at entry " + data.chain_broken_at + ". The log was altered or damaged; what follows cannot be trusted.");
  } else if (data.divergence) {
    banner.className = "banner bad";
    const d = data.divergence;
    banner.append(el("strong", { text: "Replay diverged." }),
      " The hash chain is intact, so the log was either forged and re-hashed, or written by a " +
      "different kernel version. Do not trust anything after this point.",
    el("p", {}, el("strong", { text: "The log says: " }), entryText(d.original)),
    el("p", {}, el("strong", { text: "Replay says: " }), entryText(d.replayed)),
    el("details", {}, el("summary", { text: "Raw entries" }),
      el("pre", { text: "log:    " + JSON.stringify(d.original) + "\nreplay: " + JSON.stringify(d.replayed) })));
  } else {
    banner.className = "banner";
    banner.append(el("strong", { text: "Verified." }),
      " Hash chain intact, and re-running the log reproduced every one of its " + data.entries +
      " entries that the kernel decides for itself.");
  }
  if (data.assumed_default_world) {
    banner.append(el("p", { class: "muted small",
      text: "This log does not record its world; the default map and settings were assumed." }));
  }
  document.getElementById("summary").textContent =
    snapshots.length + " ticks · " + data.entries + " log entries";
}

// A name label clashes with another label, or with another agent's body.
function clashes(placed, bodies, lx, ly) {
  return placed.some((p) => Math.abs(p.x - lx) < 4 && Math.abs(p.y - ly) < 1.5) ||
    bodies.some((b) => b.x > lx - 1 && b.x < lx + 4 && Math.abs(b.y - (ly - 0.5)) < 1.2);
}

function entryText(entry) {
  if (!entry) return "nothing";
  const detail = JSON.stringify(entry.data);
  return "tick " + entry.tick + ", " + (entry.agent_id || "world") + " " + entry.kind + " " +
    (detail.length > 140 ? detail.slice(0, 140) + "\u2026" : detail);
}

function renderMap(snapshot, actors) {
  const map = document.getElementById("map");
  const width = data.world.width;
  const height = data.world.height;
  const flip = (y) => height - y;
  map.setAttribute("viewBox", "0 0 " + width + " " + height);
  map.replaceChildren();
  for (const zone of data.world.zones) {
    map.append(svg("rect", { class: "zone-" + zone.kind, x: zone.x0, y: flip(zone.y1),
      width: zone.x1 - zone.x0, height: zone.y1 - zone.y0 }));
    if (!(zone.kind === "commons" && zone.x0 === 0 && zone.y0 === 0)) {
      map.append(svg("text", { class: "zone-label", x: zone.x0 + 0.6, y: flip(zone.y1) + 1.8 }, zone.name));
    }
  }
  for (const obj of snapshot.objects) {
    if (obj.held_by) continue;
    const dot = svg("circle", { class: decoys.has(obj.id) ? "object decoy" : "object",
      cx: obj.x, cy: flip(obj.y), r: 0.45 });
    dot.append(svg("title", {}, (objectNames.get(obj.id) || obj.id) + (decoys.has(obj.id) ? " (decoy)" : "")));
    map.append(dot);
  }
  const placed = [];
  const bodies = snapshot.agents.filter((a) => a.x !== null).map((a) => ({ x: a.x, y: flip(a.y) }));
  for (const agent of snapshot.agents) {
    if (agent.x === null) continue;
    const classes = ["agent", agent.status];
    if (actors.has(agent.id)) classes.push("acted");
    const body = svg("circle", { class: classes.join(" "), cx: agent.x, cy: flip(agent.y), r: 0.9 });
    body.append(svg("title", {}, agent.name + " (" + agent.status + ", risk " + agent.risk + ")"));
    map.append(body);
    const lx = agent.x + 1.1;
    let ly = flip(agent.y) + 0.5;
    for (let tries = 0; tries < 6 && clashes(placed, bodies, lx, ly); tries++) ly += 1.6;
    placed.push({ x: lx, y: ly });
    map.append(svg("text", { class: "agent-label", x: lx, y: ly }, agent.name));
  }
}

function renderAgents(snapshot) {
  const body = document.querySelector("#agents tbody");
  body.replaceChildren();
  for (const agent of snapshot.agents) {
    const status = snapshot.halted ? "halted" : agent.status;
    body.append(el("tr", {},
      el("td", {}, el("strong", { text: agent.name }), " ", el("span", { class: "muted", text: agent.id })),
      el("td", {}, el("span", { class: "pill " + status, text: status })),
      el("td", { text: String(agent.risk) }),
      el("td", { text: agent.x === null ? "-" : agent.x.toFixed(1) + ", " + agent.y.toFixed(1) }),
      el("td", { text: agent.holding.length ? agent.holding.join(", ") : "-" })));
  }
}

function describe(e) {
  // Returns [className, parts...]; parts are strings or elements, never HTML.
  const who = e.agent || "world";
  if (e.kind === "action_decided") {
    const params = Object.entries(e.params || {}).map(([k, v]) => k + "=" + v).join(" ");
    const parts = [who + " " + e.action + (params ? " " + params : "")];
    if (e.text !== null && e.text !== undefined) parts.push(" ", el("span", { class: "quote", text: "“" + e.text + "”" }));
    parts.push(e.allowed ? "" : " → refused: " + e.code);
    return [e.allowed ? "" : "denied", ...parts];
  }
  if (e.kind === "signal") {
    const serious = e.severity === "HIGH" || e.severity === "CRITICAL";
    return [serious ? "serious" : "", who + " signal " + e.signal + " (" + e.severity + "), risk " + e.score];
  }
  if (e.kind === "operator_command") {
    return ["serious", "operator " + e.operator + ": " + e.command + (e.target ? " " + e.target : "") +
      (e.reason ? " — " + e.reason : "")];
  }
  return [SERIOUS.has(e.kind) ? "serious" : "", who + " " + e.kind + " " + JSON.stringify(e.detail)];
}

function renderEvents(snapshot) {
  const list = document.getElementById("events");
  list.replaceChildren();
  if (!snapshot.events.length) { list.append(el("li", { class: "empty", text: "Nothing recorded this tick." })); return; }
  for (const event of snapshot.events) {
    const [cls, ...parts] = describe(event);
    list.append(el("li", { class: cls }, el("span", { class: "meta", text: "#" + event.seq }), ...parts));
  }
}

function show(i) {
  index = Math.max(0, Math.min(snapshots.length - 1, i));
  const snapshot = snapshots[index];
  document.getElementById("slider").value = String(index);
  document.getElementById("tick-label").textContent = "tick " + snapshot.tick;
  const flag = document.getElementById("world-flag");
  flag.textContent = snapshot.halted ? "halted" : snapshot.paused ? "paused" : "";
  flag.className = "pill " + (snapshot.halted ? "halted" : snapshot.paused ? "paused" : "");
  const actors = new Set(snapshot.events.map((e) => e.agent).filter(Boolean));
  renderMap(snapshot, actors);
  renderAgents(snapshot);
  renderEvents(snapshot);
}

function togglePlay() {
  const button = document.getElementById("play");
  if (timer) { clearInterval(timer); timer = null; button.textContent = "Play"; return; }
  if (index >= snapshots.length - 1) show(0);
  button.textContent = "Pause";
  timer = setInterval(() => {
    if (index >= snapshots.length - 1) { togglePlay(); return; }
    show(index + 1);
  }, 400);
}

function nextIncident() {
  for (let i = index + 1; i < snapshots.length; i++) {
    if (isIncident(snapshots[i])) { show(i); return; }
  }
}

renderBanner();
const slider = document.getElementById("slider");
slider.max = String(Math.max(0, snapshots.length - 1));
slider.addEventListener("input", () => show(Number(slider.value)));
document.getElementById("prev").addEventListener("click", () => show(index - 1));
document.getElementById("next").addEventListener("click", () => show(index + 1));
document.getElementById("play").addEventListener("click", togglePlay);
document.getElementById("incident").addEventListener("click", nextIncident);
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
  if (e.key === "ArrowLeft") show(index - 1);
  if (e.key === "ArrowRight") show(index + 1);
});
if (snapshots.length) show(0);
