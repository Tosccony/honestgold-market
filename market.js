// Market maths and wording, kept apart from the page so it can be tested.

export const AUCTION_CUT = 0.05;
const COPPER_HIDDEN_FROM = 1000000;
const FRESH_SECONDS = 7200;
const STALE_SECONDS = 86400;
const SLOW_DAYS_OF_SUPPLY = 14;
const BARGAIN_RATIO = 0.8;
const INSIGHT_ROWS = 5;

/** Split copper into [amount, denomination] pairs, largest first. */
export function coins(copper) {
  if (copper === null || copper === undefined) return [];
  const total = Math.round(copper);
  const parts = [
    [Math.floor(total / 10000), "g"],
    [Math.floor((total % 10000) / 100), "s"],
  ];
  if (total < COPPER_HIDDEN_FROM) parts.push([total % 100, "c"]);
  const shown = parts.filter(([amount]) => amount > 0);
  return shown.length ? shown : [[0, "c"]];
}

export function filterRows(rows, { query = "", category = "All", demand = "All", watched, watchOnly } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (category !== "All" && row.category !== category) return false;
    if (demand !== "All" && row.demand !== demand) return false;
    if (watchOnly && !watched?.has(row.id)) return false;
    const text = `${row.name} ${row.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Sort a copy of the rows. Missing values go last in either direction. */
export function sortRows(rows, key, direction) {
  const value = (row) => (key === "supply" ? daysOfSupply(row) : key === "change" ? priceChange(row.spark) : row[key]);
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;
    if (leftMissing || rightMissing) return leftMissing - rightMissing;
    if (typeof left === "string") return left.localeCompare(right) * direction;
    return (left - right) * direction || a.name.localeCompare(b.name);
  });
}

export function daysOfSupply(row) {
  return row.perDay > 0 ? row.listed / row.perDay : null;
}

export function afterCut(copper) {
  return copper * (1 - AUCTION_CUT);
}

export function sellPrice(row) {
  return row.soldPrice ?? row.typical ?? null;
}

/** Percent change from the first to the last known point, or null. */
export function priceChange(points) {
  const known = (points ?? []).filter((point) => point !== null && point !== undefined);
  if (known.length < 2 || known[0] === 0) return null;
  return ((known.at(-1) - known[0]) / known[0]) * 100;
}

export function ageText(seconds) {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 172800) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  return `${Math.floor(seconds / 86400)} days ago`;
}

export function freshness(seconds) {
  if (seconds <= FRESH_SECONDS) return "fresh";
  return seconds <= STALE_SECONDS ? "behind" : "stale";
}

function caution(row) {
  return row.confidence === "Low" ? " Still early, so treat the sales figures as a rough guide." : "";
}

function supplyText(days) {
  if (days < 0.75) return "under a day";
  const rounded = Math.round(days);
  return `about ${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** A plain answer to "should I bother selling this?". */
export function verdict(row) {
  const price = sellPrice(row);
  if (row.vendor > 0 && (price === null || afterCut(price) <= row.vendor)) {
    return { kind: "vendor", title: "Vendor it", text: "A vendor pays at least as much as the market does after the 5% auction cut." };
  }
  if (row.perDay <= 0) {
    return { kind: "unproven", title: "No buyers seen", text: "Nothing has sold yet while we have been watching, so a listing may just sit there." };
  }
  const days = daysOfSupply(row);
  if (days >= SLOW_DAYS_OF_SUPPLY) {
    return { kind: "slow", title: "Slow market", text: `Over ${Math.floor(days)} days of supply is already listed, so expect to wait or undercut.${caution(row)}` };
  }
  return { kind: "sell", title: "Real buyers", text: `This is selling, with ${supplyText(days)} of supply listed.${caution(row)}` };
}

const goldPerDay = (row) => row.perDay * (row.soldPrice ?? 0);

export function insights(rows) {
  // Each piece of gear differs, so only stackable goods have a comparable price.
  const goods = rows.filter((row) => row.feed !== "items");
  const knownPoints = (row) => (row.spark ?? []).filter((point) => point !== null).length;
  const top = [...rows].sort((a, b) => goldPerDay(b) - goldPerDay(a));
  const falling = goods
    .filter((row) => row.perDay > 0 && knownPoints(row) >= 3 && priceChange(row.spark) < 0)
    .sort((a, b) => priceChange(a.spark) - priceChange(b.spark));
  const discount = (row) => row.lowest / row.soldPrice;
  const bargains = goods
    .filter((row) => row.demand !== "Weak" && row.soldPrice && row.lowest && discount(row) <= BARGAIN_RATIO)
    .sort((a, b) => discount(a) - discount(b));
  return {
    top: top.slice(0, INSIGHT_ROWS),
    falling: falling.slice(0, INSIGHT_ROWS),
    bargains: bargains.slice(0, INSIGHT_ROWS),
  };
}

export function goldTradedPerDay(rows) {
  return rows.reduce((total, row) => total + goldPerDay(row), 0);
}
