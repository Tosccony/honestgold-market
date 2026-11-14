import {
  ageText, afterCut, coins, daysOfSupply, filterRows, freshness, goldTradedPerDay, insights,
  priceChange, sellPrice, sortRows, verdict,
} from "./market.js";

const PAGE_SIZE = 80;
const SHARDS = 32;
const WATCH_KEY = "honestgold.watchlist";
const SVG = "http://www.w3.org/2000/svg";
const DEMANDS = ["All", "Strong", "Fair", "Weak"];
const SERIES = [
  { key: 0, label: "Cheapest", color: "var(--series-lowest)" },
  { key: 1, label: "Typical", color: "var(--series-typical)" },
];
const RANGES = [["24h", 1], ["3d", 3], ["7d", 7]];
const COLUMNS = [
  { key: "name", label: "Item", dir: 1, cls: "item" },
  { key: "lowest", label: "Cheapest", dir: 1, cls: "col-lowest" },
  { key: "soldPrice", label: "Sold around", dir: -1, cls: "col-sold-price" },
  { key: "perDay", label: "Sold / day", dir: -1, cls: "col-sold" },
  { key: "listed", label: "Listed", dir: -1, cls: "col-listed" },
  { key: "change", label: "Trend", dir: -1, cls: "col-change" },
  { label: "Recent price", cls: "col-trail" },
  { key: "demandRank", label: "Demand", dir: -1, cls: "col-demand" },
  { key: "confidenceRank", label: "Confidence", dir: -1, cls: "col-confidence" },
];
const ICONS = {
  star: "m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z",
  close: "M6 6l12 12M18 6 6 18",
  copy: "M9 9h10v11H9zM5 15V4h10",
  sell: "M4 12.5 9.5 18 20 6.5",
  slow: "M12 7v5l3.5 2M21 12a9 9 0 1 1-18 0 9 0 0 1 18 0z",
  vendor: "M4 9h16l-1.5 10h-13zM8 9l4-5 4 5",
  unproven: "M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
};

const $ = (id) => document.getElementById(id);
const state = { query: "", category: "All", demand: "All", sort: "value", dir: -1, watchOnly: false, shown: PAGE_SIZE };
let market = null;
let rows = [];
let visible = [];
let watched = loadWatched();
let returnFocus = null;
const shardCache = new Map();

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return node;
}

function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function icon(name) {
  return svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, svg("path", { d: ICONS[name] }));
}

function money(copper) {
  const parts = coins(copper);
  if (!parts.length) return el("span", { class: "dim", text: "–" });
  const words = { g: "gold", s: "silver", c: "copper" };
  const label = parts.map(([amount, unit]) => `${amount} ${words[unit]}`).join(" ");
  return el("span", { class: "money", role: "img", "aria-label": label },
    parts.map(([amount, unit]) => el("span", {}, amount.toLocaleString(), el("i", { class: unit }))));
}

const number = (value) => Math.round(value).toLocaleString();

function changeText(change) {
  if (change === null || Math.abs(change) < 0.5) return change === null ? "–" : "Flat";
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(Math.abs(change) < 10 ? 1 : 0)}%`;
}

function loadWatched() {
  try {
    return new Set(JSON.parse(localStorage.getItem(WATCH_KEY)) ?? []);
  } catch {
    return new Set();
  }
}

function toggleWatch(id) {
  if (watched.has(id)) watched.delete(id);
  else watched.add(id);
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify([...watched]));
  } catch {
    toast("Your browser won't save the watchlist");
  }
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 1800);
}

function renderStatus() {
  const age = Date.now() / 1000 - market.updatedAt;
  const status = $("status");
  status.dataset.state = freshness(age);
  const note = { fresh: "Updated", behind: "Collector behind, updated", stale: "Collector offline, updated" };
  $("status-text").textContent = `${note[freshness(age)]} ${ageText(age)}`;
}

function renderStats() {
  const stats = [
    ["Items tracked", number(rows.length)],
    ["Units on sale", number(rows.reduce((sum, row) => sum + row.listed, 0))],
    ["Est. gold traded a day", `${number(goldTradedPerDay(rows) / 10000)}g`],
    ["Hours watched", number(market.observedHours)],
  ];
  $("stats").replaceChildren(...stats.map(([label, value]) =>
    el("div", {}, el("dt", { text: label }), el("dd", { text: value }))));
}

function insightCard(title, note, items, value, empty) {
  const list = items.length
    ? el("ol", {}, items.map((row, index) => el("li", {},
      el("a", { href: `#item=${row.id}` },
        el("span", { class: "rank", text: index + 1 }),
        el("span", { class: "name", text: row.name }),
        el("span", { class: "value" }, value(row))))))
    : el("p", { class: "none", text: empty });
  return el("article", { class: "card" }, el("h2", { text: title }), el("p", { text: note }), list);
}

function renderInsights() {
  const { top, falling, bargains } = insights(rows);
  const perDay = (row) => `${number((row.perDay * row.soldPrice) / 10000)}g/day`;
  $("insights").replaceChildren(
    insightCard("Where the gold is", "Most gold changing hands each day", top, perDay, "Not enough sales yet."),
    insightCard("Prices falling", "Biggest recent drops on items that sell", falling, (row) => changeText(priceChange(row.spark)), "No clear drops right now."),
    insightCard("Listed below sold price", "Cheapest listing is 20% or more under recent sales", bargains, (row) => money(row.lowest), "Nothing is well under its sold price."),
  );
}

function renderFilters() {
  const categories = ["All", ...[...new Set(rows.map((row) => row.category))].sort()];
  const pressed = (value, current) => String(value === current);
  $("categories").replaceChildren(...categories.map((category) =>
    el("button", { type: "button", text: category, "aria-pressed": pressed(category, state.category),
      onclick: () => update({ category }) })));
  $("demand-filter").replaceChildren(...DEMANDS.map((demand) =>
    el("button", { type: "button", text: demand === "All" ? "Any demand" : demand, "aria-pressed": pressed(demand, state.demand),
      onclick: () => update({ demand }) })));
  const toggle = $("watch-toggle");
  toggle.setAttribute("aria-pressed", String(state.watchOnly));
}

function renderHead() {
  $("table-head").replaceChildren(...COLUMNS.map((column) => {
    if (!column.key) return el("th", { class: `static ${column.cls}`, scope: "col", text: column.label });
    const sorted = state.sort === column.key;
    const header = el("th", { class: column.cls, scope: "col" },
      el("button", { type: "button", text: column.label, onclick: () => {
        update(sorted ? { dir: -state.dir } : { sort: column.key, dir: column.dir });
      } }));
    if (sorted) header.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
    return header;
  }));
}

function sparkline(points) {
  const known = points.map((value, index) => [index, value]).filter(([, value]) => value !== null);
  if (known.length < 2) return el("span", { class: "dim", text: "–" });
  const values = known.map(([, value]) => value);
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const x = (index) => (index / (points.length - 1)) * 72 + 2;
  const y = (value) => 21 - ((value - low) / span) * 18;
  const path = known.map(([index, value], at) => `${at ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join("");
  const [lastIndex, lastValue] = known.at(-1);
  return svg("svg", { class: "spark", viewBox: "0 0 76 24", "aria-hidden": "true" },
    svg("path", { d: path }), svg("circle", { cx: x(lastIndex), cy: y(lastValue), r: 2 }));
}

function starButton(row) {
  const on = watched.has(row.id);
  return el("button", {
    class: "star", type: "button", "aria-pressed": String(on),
    "aria-label": `${on ? "Remove" : "Add"} ${row.name} ${on ? "from" : "to"} watchlist`,
    onclick: (event) => {
      event.stopPropagation();
      toggleWatch(row.id);
      if (state.watchOnly) update({});
      else event.currentTarget.replaceWith(starButton(row));
    },
  }, icon("star"));
}

function tableRow(row) {
  const change = priceChange(row.spark);
  return el("tr", { onclick: () => { location.hash = `item=${row.id}`; } },
    el("td", { class: "item" }, el("div", { class: "item-cell" }, starButton(row),
      el("div", { class: "item-text" },
        el("a", { href: `#item=${row.id}`, text: row.name, onclick: (event) => event.stopPropagation() }),
        el("small", { text: row.category })))),
    el("td", { class: "col-lowest" }, row.listed ? money(row.lowest) : el("span", { class: "dim", text: "None listed" })),
    el("td", { class: "col-sold-price" }, money(row.soldPrice)),
    el("td", { class: "col-sold", text: row.perDay ? `~${number(row.perDay)}` : "0" }),
    el("td", { class: "col-listed", text: number(row.listed) }),
    el("td", { class: "col-change" }, el("span", { class: "trend", text: changeText(change) })),
    el("td", { class: "col-trail" }, sparkline(row.spark)),
    el("td", { class: "col-demand" }, el("span", { class: `tag ${row.demand}`, text: row.demand })),
    el("td", { class: "col-confidence dim", text: row.confidence }));
}

function renderRows(reset) {
  const body = $("rows");
  if (reset) body.replaceChildren();
  const from = body.children.length;
  const to = Math.min(state.shown, visible.length);
  body.append(...visible.slice(from, to).map(tableRow));
}

function renderEmpty() {
  const empty = $("empty");
  empty.hidden = visible.length > 0;
  if (visible.length) return;
  const watching = state.watchOnly && !watched.size;
  empty.replaceChildren(
    el("strong", { text: watching ? "Your watchlist is empty" : "No items match" }),
    watching ? "Tap the star on any item to keep an eye on it." : "Nobody may be selling it right now, or try a shorter search.");
}

function update(changes) {
  Object.assign(state, changes, { shown: PAGE_SIZE });
  document.body.classList.toggle("searching", state.query.trim().length > 0);
  const matches = filterRows(rows, { ...state, watched });
  visible = sortRows(matches, state.sort, state.dir);
  const label = state.query || state.category !== "All" || state.demand !== "All" || state.watchOnly
    ? `${number(visible.length)} ${visible.length === 1 ? "item" : "items"}` : "Market";
  $("result-count").textContent = label;
  renderFilters();
  renderHead();
  renderRows(true);
  renderEmpty();
}

async function loadShard(id) {
  const shard = id % SHARDS;
  if (!shardCache.has(shard)) {
    shardCache.set(shard, fetch(`history/${shard}.json?v=${market.updatedAt}`).then((response) => {
      if (!response.ok) throw new Error(`History returned ${response.status}`);
      return response.json();
    }));
  }
  const data = await shardCache.get(shard);
  const series = data.items[id] ?? [];
  return data.times.map((time, index) => ({ time, point: series[index] ?? null }));
}

const when = (seconds, options) => new Date(seconds * 1000).toLocaleString(undefined, options);
const shortTime = (seconds) => when(seconds, { weekday: "short", hour: "numeric" });
const fullTime = (seconds) => when(seconds, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function linePath(points, key, x, y) {
  let path = "";
  let drawing = false;
  points.forEach((entry, index) => {
    const value = entry.point?.[key];
    if (value === null || value === undefined) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
    drawing = true;
  });
  return path;
}

function tooltip(entry) {
  const [lowest, typical, listed] = entry.point ?? [null, null, null];
  const series = (label, color, value) => el("div", {},
    el("span", {}, el("i", { class: "key", style: `background:${color}` }), label), money(value));
  return [
    el("time", { text: fullTime(entry.time) }),
    series(SERIES[0].label, SERIES[0].color, lowest),
    series(SERIES[1].label, SERIES[1].color, typical),
    el("div", {}, el("span", { text: "Listed" }), el("b", { text: listed === null ? "–" : number(listed) })),
  ];
}

/** Hairline, tooltip and keyboard stepping shared by both charts. */
function attachHover(box, points, x, plot, onMove) {
  const tip = el("div", { class: "tip", hidden: "" });
  box.append(tip);
  const show = (index) => {
    onMove(index);
    tip.replaceChildren(...tooltip(points[index]));
    tip.hidden = false;
    const left = x(index);
    const flip = left > box.clientWidth / 2;
    tip.style.left = `${flip ? left - tip.offsetWidth - 12 : left + 12}px`;
    box.dataset.index = index;
  };
  const hide = () => {
    tip.hidden = true;
    onMove(null);
  };
  box.addEventListener("pointermove", (event) => {
    const at = event.clientX - box.getBoundingClientRect().left;
    const ratio = (at - plot.left) / Math.max(plot.width, 1);
    show(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  });
  box.addEventListener("pointerleave", hide);
  box.addEventListener("blur", hide);
  box.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const current = Number(box.dataset.index ?? points.length);
    show(Math.min(points.length - 1, Math.max(0, current + step)));
  });
}

function priceChart(box, points) {
  const width = box.clientWidth || 540;
  const height = 230;
  const plot = { left: 62, right: 66, top: 12, bottom: 26 };
  plot.width = width - plot.left - plot.right;
  const values = points.flatMap(({ point }) => (point ? [point[0], point[1]] : [])).filter((value) => value !== null);
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low) * 0.12 || high * 0.05 || 1;
  low = Math.max(0, low - pad);
  high += pad;
  const x = (index) => plot.left + (points.length > 1 ? (index / (points.length - 1)) * plot.width : plot.width / 2);
  const y = (value) => plot.top + (1 - (value - low) / (high - low)) * (height - plot.top - plot.bottom);
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Price history. Use the arrow keys to step through it." });

  for (let tick = 0; tick <= 3; tick += 1) {
    const value = low + ((high - low) * tick) / 3;
    const label = svg("text", { x: plot.left - 8, y: y(value) + 4, "text-anchor": "end" });
    label.textContent = coins(value).slice(0, 2).map(([amount, unit]) => `${amount}${unit}`).join(" ");
    chart.append(svg("line", { class: "grid", x1: plot.left, x2: plot.left + plot.width, y1: y(value), y2: y(value) }), label);
  }
  const ticks = Math.min(4, points.length);
  for (let tick = 0; tick < ticks; tick += 1) {
    const index = ticks > 1 ? Math.round((tick * (points.length - 1)) / (ticks - 1)) : 0;
    const anchor = tick === 0 ? "start" : tick === ticks - 1 ? "end" : "middle";
    const label = svg("text", { x: x(index), y: height - 6, "text-anchor": anchor });
    label.textContent = shortTime(points[index].time);
    chart.append(label);
  }

  const labels = [];
  for (const series of SERIES) {
    chart.append(svg("path", { class: "line", d: linePath(points, series.key, x, y), stroke: series.color }));
    const last = [...points.keys()].reverse().find((index) => (points[index].point?.[series.key] ?? null) !== null);
    if (last !== undefined) {
      const lastY = y(points[last].point[series.key]);
      chart.append(svg("circle", { cx: x(last), cy: lastY, r: 4, fill: series.color, stroke: "var(--surface)", "stroke-width": 2 }));
      labels.push({ text: series.label, x: x(last) + 9, y: lastY + 4 });
    }
  }
  if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 14) {
    const middle = (labels[0].y + labels[1].y) / 2;
    const first = labels[0].y >= labels[1].y ? 0 : 1;
    labels[first].y = middle + 7;
    labels[1 - first].y = middle - 7;
  }
  for (const entry of labels) {
    const label = svg("text", { class: "end-label", x: entry.x, y: entry.y });
    label.textContent = entry.text;
    chart.append(label);
  }

  const cross = svg("line", { class: "cross", y1: plot.top, y2: height - plot.bottom, visibility: "hidden" });
  chart.append(cross);
  box.replaceChildren(chart);
  box.tabIndex = 0;
  attachHover(box, points, x, plot, (index) => {
    cross.setAttribute("visibility", index === null ? "hidden" : "visible");
    if (index !== null) {
      cross.setAttribute("x1", x(index));
      cross.setAttribute("x2", x(index));
    }
  });
}

function supplyChart(box, points) {
  const width = box.clientWidth || 540;
  const height = 92;
  const plot = { left: 62, right: 66, top: 8, bottom: 6 };
  plot.width = width - plot.left - plot.right;
  const high = Math.max(...points.map(({ point }) => point?.[2] ?? 0), 1);
  const slot = plot.width / points.length;
  const barWidth = Math.max(1.5, Math.min(slot - 2, 26));
  const x = (index) => plot.left + slot * (index + 0.5);
  const base = height - plot.bottom;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Units listed, up to ${number(high)}.` });
  const top = svg("text", { x: plot.left - 8, y: plot.top + 8, "text-anchor": "end" });
  top.textContent = number(high);
  chart.append(top, svg("line", { class: "grid", x1: plot.left, x2: plot.left + plot.width, y1: base, y2: base }));
  const bars = points.map(({ point }, index) => {
    const size = ((point?.[2] ?? 0) / high) * (base - plot.top);
    const bar = svg("rect", { class: "bar", x: x(index) - barWidth / 2, y: base - size, width: barWidth, height: size, rx: Math.min(3, barWidth / 2) });
    chart.append(bar);
    return bar;
  });
  box.replaceChildren(chart);
  plot.width -= slot;
  plot.left += slot / 2;
  attachHover(box, points, x, plot, (index) => {
    bars.forEach((bar, at) => bar.classList.toggle("active", at === index));
  });
}

function historyTable(points) {
  const recent = points.filter(({ point }) => point).slice(-24).reverse();
  return el("details", { class: "data" }, el("summary", { text: "Show the numbers" }),
    el("table", {},
      el("thead", {}, el("tr", {}, ["Time", "Cheapest", "Typical", "Listed"].map((text) => el("th", { text })))),
      el("tbody", {}, recent.map(({ time, point }) => el("tr", {},
        el("td", { text: fullTime(time) }), el("td", {}, money(point[0])), el("td", {}, money(point[1])), el("td", { text: number(point[2]) }))))));
}

function renderCharts(area, all, days) {
  const cutoff = (all.at(-1)?.time ?? 0) - days * 86400;
  const points = all.filter(({ time }) => time >= cutoff);
  const known = points.filter(({ point }) => point).length;
  if (known < 2) {
    area.replaceChildren(el("p", { class: "chart-empty", text: "Not enough history for this item yet. The chart fills in as the collector keeps watching." }));
    return;
  }
  const prices = el("div", { class: "chart" });
  const supply = el("div", { class: "chart" });
  area.replaceChildren(prices,
    el("div", { class: "legend" }, SERIES.map((series) =>
      el("span", {}, el("i", { style: `background:${series.color}` }), series.label))),
    el("section", { class: "supply" }, el("h3", { text: "Units listed" }), supply),
    historyTable(points));
  priceChart(prices, points);
  supplyChart(supply, points);
}

async function renderHistory(area, row) {
  area.replaceChildren(el("div", { class: "chart-empty", text: "Loading history" }));
  let all;
  try {
    all = await loadShard(row.id);
  } catch {
    area.replaceChildren(el("p", { class: "chart-empty", text: "History couldn't be loaded. Try again in a moment." }));
    return;
  }
  const hours = (all.at(-1)?.time - all[0]?.time) / 3600;
  const ranges = RANGES.filter(([, days], index) => index === 0 || hours > (RANGES[index - 1][1] * 24));
  let days = ranges.at(-1)[1];
  const buttons = el("div", { class: "segment", role: "group", "aria-label": "Chart range" });
  const paint = () => {
    buttons.replaceChildren(...ranges.map(([label, value]) => el("button", {
      type: "button", text: label, "aria-pressed": String(value === days),
      onclick: () => { days = value; paint(); },
    })));
    renderCharts(body, all, days);
  };
  const body = el("div");
  area.replaceChildren(el("div", { class: "chart-head" }, el("h3", { text: "Price history" }), buttons), body);
  paint();
  const panel = $("panel");
  const observer = new ResizeObserver(() => { if (body.isConnected) renderCharts(body, all, days); else observer.disconnect(); });
  observer.observe(panel);
}

function fact(label, value) {
  return el("div", {}, el("dt", { text: label }), el("dd", {}, value));
}

function openPanel(row) {
  const panel = $("panel");
  const advice = verdict(row);
  const supply = daysOfSupply(row);
  const watchButton = el("button", { class: "icon-button", type: "button", "aria-pressed": String(watched.has(row.id)), "aria-label": "Add to watchlist",
    onclick: (event) => {
      toggleWatch(row.id);
      event.currentTarget.setAttribute("aria-pressed", String(watched.has(row.id)));
      update({ shown: state.shown });
    } }, icon("star"));
  const copyButton = el("button", { class: "icon-button", type: "button", "aria-label": "Copy item name",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(row.name);
        toast("Name copied, paste it into the auction house");
      } catch {
        toast("Couldn't copy the name");
      }
    } }, icon("copy"));
  const closeButton = el("button", { class: "icon-button", type: "button", "aria-label": "Close", onclick: closePanel }, icon("close"));
  const history = el("div");
  const net = sellPrice(row) === null ? null : afterCut(sellPrice(row));
  panel.replaceChildren(
    el("div", { class: "panel-head" },
      el("div", {}, el("p", { class: "panel-kicker", text: `${row.category} · Item ${row.id}` }), el("h2", { id: "panel-title", text: row.name })),
      el("div", { class: "panel-actions" }, watchButton, copyButton, closeButton)),
    el("div", { class: `verdict ${advice.kind}` }, icon(advice.kind), el("strong", { text: advice.title }), el("p", { text: advice.text })),
    el("dl", { class: "prices" },
      fact("Cheapest now", row.listed ? money(row.lowest) : "None listed"),
      fact("Typical listing", money(row.typical)),
      fact("Sold around", money(row.soldPrice))),
    el("dl", { class: "facts" },
      fact("Sold a day", row.perDay ? `~${number(row.perDay)}` : "None seen"),
      fact("Listed", number(row.listed)),
      fact("Days of supply", supply === null ? "–" : supply < 1 ? "Under 1" : number(supply)),
      fact("Confidence", row.confidence),
      fact("You'd keep", money(net)),
      fact("Vendor pays", row.vendor ? money(row.vendor) : "Nothing")),
    history,
    el("p", { class: "note", text: "You'd keep is the sell price after the 5% auction cut, before any deposit. Sales are estimates." }));
  panel.hidden = false;
  panel.scrollTop = 0;
  $("scrim").hidden = false;
  document.body.classList.add("locked");
  panel.focus({ preventScroll: true });
  renderHistory(history, row);
}

function closePanel() {
  if (location.hash.startsWith("#item=")) history.pushState("", "", location.pathname + location.search);
  hidePanel();
}

function hidePanel() {
  $("panel").hidden = true;
  $("scrim").hidden = true;
  document.body.classList.remove("locked");
  returnFocus?.focus?.({ preventScroll: true });
  returnFocus = null;
}

function route() {
  const match = location.hash.match(/^#item=(\d+)$/);
  const row = match && rows.find((candidate) => candidate.id === Number(match[1]));
  if (row) {
    returnFocus = returnFocus ?? document.activeElement;
    openPanel(row);
  } else if (!$("panel").hidden) {
    hidePanel();
  }
}

function trapFocus(event) {
  const items = [...$("panel").querySelectorAll("button, a[href], summary, [tabindex='0']")].filter((node) => node.offsetParent);
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindEvents() {
  let timer;
  $("search").addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => update({ query: event.target.value }), 90);
  });
  $("watch-toggle").addEventListener("click", () => update({ watchOnly: !state.watchOnly }));
  $("scrim").addEventListener("click", closePanel);
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", (event) => {
    const open = !$("panel").hidden;
    if (event.key === "Escape" && open) closePanel();
    else if (event.key === "Tab" && open) trapFocus(event);
    else if (event.key === "/" && !open && document.activeElement !== $("search")) {
      event.preventDefault();
      $("search").focus();
    }
  });
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.shown < visible.length) {
      state.shown += PAGE_SIZE;
      renderRows(false);
    }
  }, { rootMargin: "600px" }).observe($("sentinel"));
}

function showLoading() {
  $("rows").replaceChildren(...Array.from({ length: 8 }, () =>
    el("tr", { class: "loading" }, COLUMNS.map((column) => el("td", { class: column.cls === "item" ? "item" : column.cls }, el("div"))))));
}

const DEMAND_RANK = { Strong: 3, Fair: 2, Weak: 1 };
const CONFIDENCE_RANK = { High: 3, Medium: 2, Low: 1 };

async function start() {
  bindEvents();
  showLoading();
  try {
    const response = await fetch(`market.json?t=${Math.floor(Date.now() / 300000)}`);
    if (!response.ok) throw new Error(`Market returned ${response.status}`);
    market = await response.json();
  } catch {
    $("status-text").textContent = "Market unavailable";
    $("status").dataset.state = "stale";
    $("rows").replaceChildren();
    const empty = $("empty");
    empty.hidden = false;
    empty.replaceChildren(el("strong", { text: "The market couldn't be loaded" }), "Check your connection and refresh the page.");
    return;
  }
  rows = market.items.map((row) => ({
    ...row,
    value: row.perDay * (row.soldPrice ?? 0),
    demandRank: DEMAND_RANK[row.demand] ?? 0,
    confidenceRank: CONFIDENCE_RANK[row.confidence] ?? 0,
  }));
  renderStatus();
  setInterval(renderStatus, 60000);
  renderStats();
  renderInsights();
  update({});
  route();
}

start();
