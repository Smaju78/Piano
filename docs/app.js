/* Piano: hash-routed static app over works.json. No build step.
   Visual design "Programme": a printed concert programme / record sleeve. One site player (the jukebox) plays
   everything; the player bar at the bottom shows what is playing on every page. Preferences live in this
   browser and, when someone signs in with Google (sync.js), in their account too. */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const view = $("#view");

let WORKS = [], BY_ID = new Map(), META = {}, PIANISTS = [];

/* ---------------- icons ---------------- */
const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  heartF: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  yt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

/* ---------------- preferences (localStorage; synced to the account when signed in) ---------------- */
const PREF_KEY = "piano.prefs.v1";
const SESSION_KEY = "piano.session.v1"; // resume point: page, work, recording, position, programme
const THEME_KEY = "piano.theme";
let lastPage = "#/";
let holdSession = true; // the saved resume point is kept untouched until the visitor has answered the resume prompt
const EMPTY_FILTERS = { moods: [], periods: [], kinds: [], forms: [], composer: "", pianist: "", maxMin: 0, likedOnly: false, popular: false };
const ARR = { moods: 1, periods: 1, kinds: 1, forms: 1 };
const freshFilters = () => ({ ...EMPTY_FILTERS, moods: [], periods: [], kinds: [], forms: [] });
const prefs = loadPrefs();
function loadPrefs() {
  const empty = { likes: [], never: [], recent: [], recOnly: false, filters: freshFilters() };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    return p ? { ...empty, ...p, filters: { ...freshFilters(), ...(p.filters || {}) } } : empty;
  } catch { return empty; }
}
function savePrefs() {
  prefs.updatedAt = Date.now();
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  SYNC.changed("prefs");
}

/* ---------------- account sync hooks (optional Google sign-in, see sync.js) ----------------
   sync.js (an ES module) fills these in when firebase-config.js has a Firebase config; without it they
   stay no-ops and everything is kept in this browser only. */
const SYNC = window.pianoSync = {
  changed: () => {},       // called after every local change; sync.js uploads (debounced)
  signIn: null,            // set by sync.js: the account button appears only then
  user: null,
};
// Resolves when the sign-in state is known (so the resume prompt can use the account's latest resume point).
SYNC.ready = new Promise((res) => { SYNC.resolveReady = res; setTimeout(res, 4000); });
const readSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } };
SYNC.snapshot = () => ({
  prefs: { likes: prefs.likes, never: prefs.never, filters: prefs.filters, recOnly: !!prefs.recOnly, adsOptOut: !!prefs.adsOptOut, recent: prefs.recent.slice(-150) },
  prefsAt: prefs.updatedAt || 0, session: readSession(),
});
// Merge what the account holds into this browser. The first time a browser is linked to an account, likes and
// never-play lists from both are kept; after that the newer side wins. The newer resume point always wins.
SYNC.apply = (r, firstLink) => {
  if (!r) return;
  const rp = r.prefs || {};
  if (firstLink) {
    prefs.likes = [...new Set([...(rp.likes || []), ...prefs.likes])];
    prefs.never = [...new Set([...(rp.never || []), ...prefs.never])].filter((id) => !prefs.likes.includes(id));
  }
  if ((r.prefsAt || 0) > (prefs.updatedAt || 0)) {
    if (!firstLink) { prefs.likes = rp.likes || []; prefs.never = rp.never || []; }
    Object.assign(prefs.filters, freshFilters(), rp.filters || {});
    prefs.adsOptOut = !!rp.adsOptOut;
    prefs.recOnly = !!rp.recOnly;
    if (rp.recent) prefs.recent = rp.recent;
    prefs.updatedAt = r.prefsAt;
  }
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  const ls = readSession();
  if (r.session && (!ls || (r.session.at || 0) > (ls.at || 0))) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(r.session)); } catch { /* storage unavailable */ }
  }
  if (WORKS.length) { jb.refresh(); if (location.hash.startsWith("#/mine")) renderMine(); }
};
const isLiked = (id) => prefs.likes.includes(id);
const isNever = (id) => prefs.never.includes(id);
function toggle(list, id, on) {
  prefs[list] = prefs[list].filter((x) => x !== id);
  if (on) {
    prefs[list].push(id);
    const other = list === "likes" ? "never" : "likes"; // liked and never-play are exclusive
    prefs[other] = prefs[other].filter((x) => x !== id);
  }
  savePrefs();
}

/* ---------------- theme ---------------- */
const darkNow = () => document.documentElement.dataset.theme === "dark"
  || (!document.documentElement.dataset.theme && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
function setTheme(th) {
  document.documentElement.dataset.theme = th;
  const meta = $('meta[name="theme-color"]'); if (meta) meta.content = th === "light" ? "#f4f1ea" : "#121212";
  try { localStorage.setItem(THEME_KEY, th); } catch { /* ignore */ }
}
$$(".theme-toggle").forEach((b) => b.onclick = () => setTheme(darkNow() ? "light" : "dark"));
if (darkNow()) { const meta = $('meta[name="theme-color"]'); if (meta) meta.content = "#121212"; }

/* ---------------- toast ---------------- */
let toastT;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg; el.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 2200);
}

/* ---------------- helpers ---------------- */
const composerOf = (w) => META.composers[w.c];
const surname = (name) => name === "Clara Schumann" ? "Clara Schumann" : name === "Manuel de Falla" ? "de Falla"
  : name === "Richard Strauss" ? "R. Strauss" : name.split(" ").slice(-1)[0];
const hasRec = (w) => !!(w.v && w.v.length);
const fmtViews = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
const fmtTime = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return sec >= 3600 ? `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`
  : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
const unaccent = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/g, "o").replace(/ł/g, "l");
const norm = (t) => unaccent(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const pianistsOf = (w) => [...new Set((w.v || []).flatMap((v) => v.p || []))];
const subline = (w) => [surname(composerOf(w).n), w.cat, w.f && w.t !== w.f ? w.f : ""].filter(Boolean).join(" · ");
const thumb = (id, q = "mq") => `https://i.ytimg.com/vi/${esc(id)}/${q}default.jpg`;
const bestVideo = (w) => hasRec(w) ? [...w.v].sort((a, b) => b.views - a.views)[0] : null;
const initials = (name) => name.split(/[\s-]+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

// Privacy-enhanced player by default. YouTube offers no way for a site to check for Premium, so when someone is
// signed in with Google the standard player (which knows their YouTube sign-in, so Premium members get no ads)
// is used automatically; prefs.adsOptOut is set only if they switch it off in the account menu.
const noAds = () => !!SYNC.user && !prefs.adsOptOut;
const ytHost = () => noAds() ? "https://www.youtube.com" : "https://www.youtube-nocookie.com";
// "Open in YouTube": the same recording on youtube.com (or the YouTube app on a phone), where YouTube Premium
// always applies, e.g. in browsers that block YouTube's cookies inside other sites.
const ytLink = (id, at = 0) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${at > 5 ? `&t=${Math.floor(at)}s` : ""}`;
const ytBtn = (id) => `<a class="icon-btn yt" href="${ytLink(id)}" target="_blank" rel="noopener" data-open-yt aria-label="Open in YouTube" title="Open in YouTube (ad-free with Premium)">${I.yt}</a>`;
document.addEventListener("click", (e) => { if (e.target.closest("[data-open-yt]")) jb.pause(); });

const KINDS = {
  composer: { label: "Composer", get: (w) => [composerOf(w).n] },
  period: { label: "Period", get: (w) => [composerOf(w).p] },
  form: { label: "Form", get: (w) => [cap(w.fm)] },
  key: { label: "Key", get: (w) => w.key ? [w.key] : [] },
  mood: { label: "Mood", get: (w) => w.moods || [] },
  pianist: { label: "Pianist", get: pianistsOf },
  popular: { label: "Well-known" },
  az: { label: "A–Z" },
};
const NOTE_ORDER = ["C", "C-sharp", "D-flat", "D", "D-sharp", "E-flat", "E", "F", "F-sharp", "G-flat", "G", "G-sharp", "A-flat", "A", "A-sharp", "B-flat", "B"];
const keyRank = (k) => { const [n, m] = k.split(" "); return NOTE_ORDER.indexOf(n) * 2 + (m === "minor" ? 1 : 0); };

function groupsOf(kind) {
  const m = new Map();
  for (const w of WORKS) for (const v of KINDS[kind].get(w)) {
    const g = m.get(v) || { n: 0, rec: 0 };
    g.n++; g.rec += hasRec(w); m.set(v, g);
  }
  const arr = [...m.entries()];
  const order = {
    composer: (v) => META.composers.findIndex((c) => c.n === v),
    period: (v) => META.periods.indexOf(v),
    key: keyRank,
    mood: (v) => Object.keys(META.moods).indexOf(v),
  }[kind];
  if (order) arr.sort((a, b) => order(a[0]) - order(b[0]));
  else arr.sort((a, b) => b[1].rec - a[1].rec || b[1].n - a[1].n || a[0].localeCompare(b[0]));
  return arr;
}
function groupCounts(list, keyFn) {
  const m = new Map();
  for (const w of list) { const k = keyFn(w); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ---------------- palettes ----------------
   Every work gets a generated record sleeve coloured by its period; moods and the hour have their own pairs. */
const PCOL = { Baroque: ["#5b3a1e", "#9a6b3a"], Classical: ["#24405f", "#5b7ea8"], Romantic: ["#6b1f2e", "#a8475a"],
  "Late Romantic": ["#43265c", "#7d5a99"], Impressionist: ["#1d565c", "#4f9099"], "20th century": ["#2a2d31", "#5d6168"] };
const MCOL = { Calm: ["#2f5f6e", "#6fa0ad"], Dreamy: ["#3b3a6e", "#7b78b8"], Tender: ["#8a4a5e", "#c48aa0"], Melancholy: ["#3a4a6a", "#6f7fa3"],
  Passionate: ["#8a2635", "#c25a62"], Stormy: ["#2b2f3a", "#5a6075"], Dark: ["#1e1b2a", "#4a4560"], Heroic: ["#7a4a16", "#b98735"],
  Joyful: ["#b06a1a", "#e0a84a"], Playful: ["#3e7a4a", "#7ab37a"], Dancing: ["#8a5a1e", "#c7984c"], Virtuosic: ["#6a2a7a", "#a56bb5"],
  Contemplative: ["#2f4f3f", "#5f8a73"] };
const pcol = (w) => PCOL[composerOf(w).p] || PCOL["20th century"];
const mcol = (m) => MCOL[m] || ["#3a3a3a", "#6a6a6a"];
// The programme of the hour: a mood set that suits the time of day (nocturnes at night, the big works by day).
const HOURS = [
  { from: 5, to: 11, name: "Morning", title: "Clear heads and bright keys", moods: ["Calm", "Joyful", "Playful"], text: "Preludes, inventions and sunny things to begin the day.", col: ["#b8742a", "#6e4418"] },
  { from: 11, to: 17, name: "Afternoon", title: "Sonatas and concertos", moods: ["Heroic", "Passionate", "Virtuosic"], text: "The big works: sonatas, concertos and dazzling showpieces.", col: ["#6b1f2e", "#2e4a7a"] },
  { from: 17, to: 22, name: "Evening", title: "Ballades and tender things", moods: ["Tender", "Passionate", "Melancholy"], text: "Romantic lyricism for the evening: ballades, intermezzi, songs without words.", col: ["#4a2a5e", "#8a3a4a"] },
  { from: 22, to: 29, name: "Night", title: "Nocturnes and reveries", moods: ["Dreamy", "Calm", "Contemplative"], text: "Quiet, dreaming music for the late hours.", col: ["#1b2440", "#0e1222"] },
];
const hourNow = (d = new Date()) => { const h = d.getHours(), hh = h < 5 ? h + 24 : h; return HOURS.find((x) => hh >= x.from && hh < x.to) || HOURS[3]; };

/* ---------------- spelling-tolerant search ----------------
   Composer names are spelled many ways (Rachmaninoff / Rachmaninov, Tchaikovsky / Chaikovsky), so
   words are also compared as consonant "skeletons". Catalogue numbers in the query (op 9 no 2,
   op.9/2, bwv846, k 331, hob xvi:50) are normalised and matched exactly. */
function skel(t) {
  t = unaccent(t).toLowerCase().replace(/[^a-z]/g, "").replace(/^tch/, "ch").replace(/ph/g, "f").replace(/[vw]/g, "f")
    .replace(/[cq]/g, "k").replace(/z/g, "s").replace(/[aeiouyh]/g, "");
  return t.replace(/(.)\1+/g, "$1");
}
const CAT_RE = /\b(op(?:us)?|bwv|kv|k|d|s|l|hob|sz|m|b|woo|fp|hwv|trv)\.?\s*([0-9]+[a-c]?|[ivx]+\s*[:/.]\s*[0-9]+)(?:\s*(?:,?\s*(?:no|nr|n°)\.?\s*|\/|-|\s)\s*([0-9]+))?(?![a-z0-9])/i;
function normCat(s) {
  const m = CAT_RE.exec(unaccent(s || "").toLowerCase());
  if (!m) return "";
  const kind = m[1].replace(/^opus$/, "op").replace(/^kv$/, "k");
  return `${kind}${m[2].replace(/\s+/g, "").replace("/", ":").replace(".", ":")}${m[3] ? "-" + m[3] : ""}`;
}
function searchWorks(q) {
  let rest = unaccent(q).toLowerCase();
  const qcat = normCat(rest);
  if (qcat) rest = rest.replace(CAT_RE, " ");
  const words = norm(rest).split(" ").filter(Boolean);
  if (!words.length && !qcat) return [];
  const scored = [];
  for (const w of WORKS) {
    let score = 0;
    if (qcat) {
      if (w._cat === qcat) score += 10;
      else if (w._cat.startsWith(qcat + "-")) score += 4;  // "op 10" finds all of Op. 10
      else continue;
    }
    let ok = true, fuzzy = false;
    for (const x of words) {
      if (w._words.some((h) => h === x)) score += 3;
      else if (w._words.some((h) => h.startsWith(x))) score += 2;
      else if (x.length >= 4 && w._skels.some((h) => h.startsWith(skel(x)))) { score += 1; fuzzy = true; }
      else { ok = false; break; }
    }
    if (!ok) continue;
    score += w.pop ? 2 - w.pop / 300 : 0;
    score += hasRec(w) ? 0.5 : 0;
    scored.push([score, w, fuzzy]);
  }
  // spelling-tolerant matches only when the query matched nothing as typed
  const exact = scored.filter(([, , f]) => !f);
  return (exact.length ? exact : scored).sort((a, b) => b[0] - a[0]).map(([, w]) => w);
}
// Type-to-find for names (composers, pianists): every word of the query starts a word of the name, or sounds like one.
function searchNames(names, q) {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  const exact = [], fuzzy = [];
  for (const n of names) {
    const ws = norm(n).split(" ");
    if (words.every((x) => ws.some((h) => h.startsWith(x)))) exact.push(n);
    else if (words.every((x) => ws.some((h) => h.startsWith(x)) || (x.length >= 4 && ws.some((h) => skel(h).startsWith(skel(x)))))) fuzzy.push(n);
  }
  return exact.concat(fuzzy);
}

/* ---------------- building blocks ---------------- */
// The sleeve: composer in small capitals, the title, the catalogue number; coloured by period.
function sleeve(w, { lg = false, ribbon = "" } = {}) {
  const [p1, p2] = pcol(w), c = composerOf(w);
  return `<div class="sleeve${lg ? " lg" : ""}${hasRec(w) ? "" : " dim"}" style="--p1:${p1};--p2:${p2}" aria-hidden="true">${ribbon ? `<span class="rib">${esc(ribbon)}</span>` : ""}
    <span class="sc">${esc(c.n)}</span><span class="st">${esc(w.t)}</span><span class="sk">${esc([w.cat, w.key].filter(Boolean).join(" · "))}</span></div>`;
}
function workCard(w, { lg = false, ribbon = "" } = {}) {
  const n = (w.v || []).length;
  const sub = n ? `${plural(n, "recording")}${w.o ? " · with orchestra" : ""}` : w.v == null ? "recordings coming soon" : "no recording found";
  return `<div class="card${lg ? " lg" : ""}">
    <a href="#/work/${enc(w.id)}" aria-label="${esc(w.t)}, ${esc(composerOf(w).n)}">${sleeve(w, { lg, ribbon })}<b>${esc(w.t)}</b><span class="sub">${esc(subline(w))}</span><span class="sub${n ? " rec" : ""}">${esc(sub)}</span></a>
    ${n ? `<button class="play" type="button" data-play-work="${esc(w.id)}" aria-label="Play ${esc(w.t)}">${I.play}</button>` : ""}
  </div>`;
}
// A person: a composer (with dates) or a pianist. The disc shows initials over a band in the period colour.
function whoCard(kind, name, { sub = "", n = 0, col = null, img = "" } = {}) {
  return `<div class="card who">
    <a href="#/list/${kind}/${enc(name)}"><div class="pt"${col ? ` style="--p1:${col[0]}"` : ""}>${img ? `<img src="${img}" alt="" loading="lazy">` : `<span class="pd" aria-hidden="true"></span><span class="init" aria-hidden="true">${esc(initials(name))}</span>`}</div><b>${esc(name)}</b><span class="sub">${esc(sub)}</span></a>
    ${n ? `<button class="play" type="button" data-play="${kind}:${esc(name)}" aria-label="Play ${esc(name)} in the jukebox">${I.play}</button>` : ""}
  </div>`;
}
function recCard(w, v) {
  return `<div class="card rec"><button type="button" data-play-work="${esc(w.id)}" data-vid="${esc(v.id)}" aria-label="Play ${esc(w.t)}, ${esc((v.p || []).join(", ") || v.ch)}">
    <span class="fr"><img src="${thumb(v.id)}" alt="" loading="lazy"><span class="pv"><i>${I.play}</i></span></span>
    <b>${esc(w.t)}</b><span class="sub">${esc([surname(composerOf(w).n), (v.p || []).join(", ") || v.ch].join(" · "))} · ${fmtTime(v.sec)}</span></button></div>`;
}
function moodCard(m) {
  const [c1, c2] = mcol(m), n = jb.countFor({ moods: [m] });
  return `<button class="mood" type="button" style="--m1:${c1};--m2:${c2}" data-play="mood:${esc(m)}"${n ? "" : " disabled"} aria-label="Play ${esc(m)} works${n ? ` (${n})` : " (none yet)"}">
    <b>${esc(m)}</b><small>${esc(META.moods[m] || "")}<span class="n">${n ? `▶ ${plural(n, "work")}` : "coming soon"}</span></small></button>`;
}
const row = (title, items, { more = "", sub = "", hint = "", id = "" } = {}) => `<section class="sec"${id ? ` aria-labelledby="${id}"` : ""}>
  <div class="sec-h"><h2${id ? ` id="${id}"` : ""}>${title}${sub ? `<small>${sub}</small>` : ""}</h2>${more ? `<a class="more" href="${more}">All →</a>` : ""}${hint ? `<span class="hint">${hint}</span>` : ""}</div>
  <div class="row">${items.join("")}</div></section>`;

// A compact row for long lists: ▶ (plays the work in the site player, the page stays), title, details, recordings.
function workRow(w) {
  const n = (w.v || []).length, cur = jb.currentWork() === w.id;
  const meta = [w.key, w.y].filter(Boolean).join(" · ");
  return `<div class="rowi${n ? "" : " dim"}" data-row="${esc(w.id)}">
    <button class="rp${cur ? " on" : ""}" type="button" data-play-work="${esc(w.id)}"${n ? "" : " disabled"} aria-label="${cur ? "Pause" : "Play"} ${esc(w.t)}">${cur && jb.isPlaying() ? I.pause : I.play}</button>
    <a class="rt" href="#/work/${enc(w.id)}"><b>${esc(w.t)}</b><span class="sub">${esc(subline(w))}</span></a>
    <span class="meta">${n ? `<span class="rec">▶ ${plural(n, "recording")}</span>` : ""}<span>${esc(meta)}</span></span></div>`;
}
// Works with recordings first (keeping the given order inside each part), optional "only with recordings".
function workList(list, { limit = 120, step = 300, toggle = true, recFirst = true } = {}) {
  const wrap = document.createElement("div");
  let shown = limit;
  const draw = () => {
    const rec = list.filter(hasRec), rest = list.filter((w) => !hasRec(w));
    const all = prefs.recOnly ? rec : recFirst ? rec.concat(rest) : list;
    const vis = all.slice(0, shown);
    const firstRest = recFirst ? vis.findIndex((w) => !hasRec(w)) : -1;
    const rows = vis.map((w, i) => (i === firstRest && i > 0 ? `<div class="divider">Recordings coming soon</div>` : "") + workRow(w)).join("");
    wrap.innerHTML = (toggle ? `<div class="listbar"><label class="toggle"><input type="checkbox" class="rec-only"${prefs.recOnly ? " checked" : ""}> Only works with recordings <span class="hint">(${rec.length} of ${list.length})</span></label></div>` : "") +
      `<div class="rows">${rows || `<div class="empty"><div class="ic">♩</div><b>Nothing here yet</b><p>No works with recordings here yet. They are added every day.</p></div>`}</div>` +
      (all.length > shown ? `<p class="more-row"><button class="btn ghost sm" type="button">Show ${Math.min(step, all.length - shown)} more of ${all.length - shown}</button></p>` : "");
    if (toggle) $(".rec-only", wrap).onchange = (e) => { prefs.recOnly = e.target.checked; savePrefs(); draw(); };
    const b = $(".more-row button", wrap);
    if (b) b.onclick = () => { shown += step; draw(); };
    wirePlays(wrap);
  };
  draw();
  return wrap;
}
// Grid/row list with a "show more" button.
function listOf(items, item, { limit = 24, step = 48, cls = "grid" } = {}) {
  const wrap = document.createElement("div");
  let shown = limit;
  const draw = () => {
    const vis = items.slice(0, shown);
    wrap.innerHTML = `<div class="${cls}">${vis.map(item).join("") || `<div class="empty"><div class="ic">♩</div><b>Nothing here yet</b></div>`}</div>` +
      (items.length > shown ? `<p class="more-row"><button class="btn ghost sm" type="button">Show ${Math.min(step, items.length - shown)} more of ${items.length - shown}</button></p>` : "");
    const b = $(".more-row button", wrap);
    if (b) b.onclick = () => { shown += step; draw(); };
    wirePlays(wrap);
  };
  draw();
  return wrap;
}

// Play buttons: a work plays at once in the site player (the page stays; the player bar shows it);
// "Play X" tiles start a programme in the jukebox.
function wirePlays(root) {
  $$("[data-play-work]", root).forEach((b) => b.onclick = () => jb.playWork(b.dataset.playWork, b.dataset.vid || ""));
  $$("[data-play]", root).forEach((b) => b.onclick = () => { const i = b.dataset.play.indexOf(":"); playFiltered(b.dataset.play.slice(0, i), b.dataset.play.slice(i + 1)); });
}
// The row / recording that is playing is highlighted wherever it appears.
function markPlaying() {
  const wid = jb.currentWork(), vid = jb.currentVideo(), on = jb.isPlaying();
  $$(".rowi .rp").forEach((b) => {
    const cur = b.dataset.playWork === wid;
    b.classList.toggle("on", cur);
    b.innerHTML = cur && on ? I.pause : I.play;
    const t = b.closest(".rowi").querySelector("b");
    b.setAttribute("aria-label", `${cur && on ? "Pause" : "Play"} ${t ? t.textContent : ""}`);
  });
  $$(".perf").forEach((p) => {
    const cur = p.dataset.perf === vid;
    p.classList.toggle("on", cur);
    const i = $(".pv i", p); if (i) i.innerHTML = cur && on ? I.pause : I.play;
    const now = $(".now", p); if (now) now.hidden = !cur;
  });
  const wp = $("#w-play");
  if (wp) { const cur = wp.dataset.playWork === wid; wp.innerHTML = `${cur && on ? I.pause : I.play} ${cur && on ? "Pause" : cur ? "Resume" : "Play"}`; }
}

function playFiltered(kind, value) {
  const f = kind === "mood" ? { moods: [value] } : kind === "period" ? { periods: [value] } : kind === "form" ? { forms: [value.toLowerCase()] }
    : kind === "composer" ? { composer: value } : kind === "pianist" ? { pianist: value } : kind === "popular" ? { popular: true }
    : kind === "hour" ? { moods: hourNow().moods } : kind === "likes" ? { likedOnly: true } : {};
  jb.setFilters(f);
  location.hash = "#/jukebox";
  jb.start(true);
}

/* ---------------- views ---------------- */
const BROWSE = ["composer", "period", "form", "mood", "pianist", "key", "popular", "az"];
const BLABEL = { composer: "Composers", period: "Periods", form: "Forms", mood: "Moods", pianist: "Pianists", key: "Keys", popular: "Well-known", az: "All works A–Z" };

function renderHome() {
  const H = hourNow();
  const hourN = jb.countFor({ moods: H.moods });
  const hourWorks = WORKS.filter((w) => hasRec(w) && (w.moods || []).some((m) => H.moods.includes(m)) && !isNever(w.id))
    .sort((a, b) => (a.pop || 999) - (b.pop || 999)).slice(0, 12);
  const popular = WORKS.filter((w) => w.pop).sort((a, b) => a.pop - b.pop);
  const popRec = popular.filter(hasRec), totalRec = WORKS.filter(hasRec).length;
  const topWorks = (popRec.length >= 8 ? popRec : popular).slice(0, 16);
  const composers = groupsOf("composer").filter(([, g]) => g.rec).slice(0, 16);
  const pianists = groupsOf("pianist").slice(0, 16);
  const cur = jb.currentWork();
  const recent = [...prefs.recent].reverse().concat([...prefs.likes].reverse()).filter((id, i, a) => BY_ID.has(id) && hasRec(BY_ID.get(id)) && a.indexOf(id) === i).slice(0, 12);
  const moodLinks = H.moods.map((m) => `<a href="#/list/mood/${enc(m)}">${esc(m)}</a>`).join(", ");
  view.innerHTML = `
    <section class="hero" style="--h1:${H.col[0]};--h2:${H.col[1]}" aria-labelledby="h-hour">
      <div class="kick">${H.name} programme</div>
      <h1 id="h-hour">${esc(H.title)}</h1>
      <p>${esc(H.text)} ${hourN ? `A shuffled programme of ${plural(hourN, "work")} tagged ${moodLinks}.` : "Recordings for this hour are on their way."}</p>
      <div class="acts">
        <button class="btn" type="button" data-play="hour:"${hourN ? "" : " disabled"}>${I.play} Play the ${H.name.toLowerCase()} programme</button>
        <button class="btn ghost" type="button" data-play="popular:"${popRec.length ? "" : " disabled"}>${I.shuffle} Shuffle the great works <span class="n">(${popRec.length})</span></button>
      </div>
      ${hourWorks.length ? `<div class="row">${hourWorks.map((w) => workCard(w, { lg: true, ribbon: cur === w.id ? "Now playing" : "" })).join("")}</div>` : ""}
    </section>
    ${row("Moods", Object.keys(META.moods).map(moodCard), { more: "#/browse/mood", id: "h-moods" })}
    ${row("Well-known works", topWorks.map((w) => workCard(w)), { more: "#/browse/popular", sub: `${popular.length} chosen by hand`, id: "h-pop" })}
    ${row("Composers", composers.map(([n, g]) => { const c = META.composers.find((x) => x.n === n); return whoCard("composer", n, { sub: `${c.y || c.p} · ${plural(g.rec, "recording")}`, n: g.rec, col: PCOL[c.p] }); }), { more: "#/browse/composer", id: "h-comp" })}
    ${pianists.length ? row("Pianists", pianists.map(([n, g]) => whoCard("pianist", n, { sub: plural(g.n, "work"), n: g.n, col: ["#1b5e4b"] })), { more: "#/browse/pianist", id: "h-pian" }) : ""}
    ${recent.length ? row("Continue listening", recent.map((id) => { const w = BY_ID.get(id); return recCard(w, bestVideo(w)); }), { more: "#/mine", sub: "what you played and liked", id: "h-cont" }) : ""}
    <section class="sec" aria-labelledby="h-explore">
      <div class="sec-h"><h2 id="h-explore">Explore</h2></div>
      <div class="chips wrap">${BROWSE.map((k) => `<a class="chip" href="#/browse/${k}">${BLABEL[k]}</a>`).join("")}</div>
      <p class="stats">${totalRec} of ${WORKS.length} works have recordings so far · more are added every day, well-known works first.</p>
    </section>`;
  wirePlays(view);
}

/* search: the field in the header; results replace the page */
function renderSearch() {
  const input = $("#q");
  if (!input.value && sessionGet("q")) input.value = sessionGet("q");
  const q = input.value;
  sessionSet("q", q);
  if (!norm(q)) {
    view.innerHTML = `<div class="pagehead"><div class="kick">Search</div><h1>Find a work</h1>
      <p>A title or nickname (Moonlight, Revolutionary), a composer (Rachmaninov, Tchaikowsky: spelling is forgiven),
      a pianist, or a catalogue number (op 9 no 2, BWV 846, Hob XVI/50, K 331).</p></div>`;
    return;
  }
  const works = searchWorks(q);
  const comps = searchNames(META.composers.map((c) => c.n), q);
  const pians = searchNames(PIANISTS, q);
  const people = comps.map((n) => { const c = META.composers.find((x) => x.n === n); return `<a class="chip" href="#/list/composer/${enc(n)}">${esc(n)} <span class="n">${esc(c.y || c.p)}</span></a>`; })
    .concat(pians.map((n) => `<a class="chip" href="#/list/pianist/${enc(n)}">${esc(n)} <span class="n">pianist</span></a>`));
  view.innerHTML = `<div class="pagehead"><div class="kick">Search</div><h1>${works.length ? plural(works.length, "work") : "No works"} for “${esc(q)}”</h1></div>
    ${people.length ? `<div class="chips wrap" style="margin:10px 0 4px">${people.join("")}</div>` : ""}
    <div id="search-body"></div>`;
  if (works.length) $("#search-body").append(workList(works, { recFirst: false }));
  else if (!people.length) $("#search-body").innerHTML = `<div class="empty"><div class="ic">⌕</div><b>Nothing found</b><p>Try another spelling, the nickname, or the catalogue number.</p></div>`;
}

function renderBrowse(kind) {
  if (!BROWSE.includes(kind)) kind = "composer";
  view.innerHTML = `<nav class="chips" aria-label="Browse by" style="margin-top:12px">${BROWSE.map((k) => `<a class="chip" href="#/browse/${k}"${k === kind ? ' aria-current="page"' : ""}>${BLABEL[k]}</a>`).join("")}</nav>
    <div id="browse-body"></div>`;
  const body = $("#browse-body");
  if (kind === "popular" || kind === "az") {
    const list = kind === "popular" ? WORKS.filter((w) => w.pop).sort((a, b) => a.pop - b.pop) : [...WORKS].sort((a, b) => a._sort.localeCompare(b._sort));
    body.innerHTML = `<div class="pagehead"><h1>${kind === "popular" ? "Well-known works" : "All works A–Z"}</h1>
      <p>${kind === "popular" ? `The ${list.length} works most people know, chosen by hand. Their recordings are fetched first.` : `All ${WORKS.length} works, alphabetical by title.`}</p>
      ${kind === "popular" ? `<div class="acts"><button class="btn sm" type="button" data-play="popular:"${list.some(hasRec) ? "" : " disabled"}>${I.play} Shuffle them all</button></div>` : ""}</div>`;
    body.append(workList(list));
    wirePlays(body);
    return;
  }
  const groups = groupsOf(kind);
  if (kind === "composer" || kind === "pianist") {
    const names = groups.map(([n]) => n);
    const q0 = sessionGet(kind + "Q");
    body.innerHTML = `<div class="pagehead"><h1>${BLABEL[kind]}</h1><p>${kind === "composer" ? `${names.length} composers from the Baroque to the 20th century, by period.` : `${names.length} pianists recognised in the recordings so far, most-recorded first.`}</p></div>
      <label class="searchf" style="margin:12px 0 6px;max-width:460px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="find-q" type="search" value="${esc(q0)}" autocomplete="off" placeholder="${kind === "composer" ? "Type to find a composer (Chopin, Rachmaninov…)" : "Type to find a pianist (Argerich, Zimerman…)"}" aria-label="Find a ${kind}"></label>
      <p class="hint" id="find-n"></p><div id="find-list"></div>`;
    const input = $("#find-q"), list = $("#find-list");
    const card = (n) => {
      const g = groups.find(([x]) => x === n)[1];
      if (kind === "composer") { const c = META.composers.find((x) => x.n === n); return whoCard("composer", n, { sub: `${c.y || c.p} · ${g.n} works${g.rec ? ` · ▶ ${g.rec}` : ""}`, n: g.rec, col: PCOL[c.p] }); }
      return whoCard("pianist", n, { sub: plural(g.n, "work"), n: g.n, col: ["#1b5e4b"] });
    };
    const draw = () => {
      const q = input.value; sessionSet(kind + "Q", q);
      if (norm(q)) {
        const hits = searchNames(names, q);
        $("#find-n").textContent = plural(hits.length, kind);
        list.replaceChildren(listOf(hits, card, { cls: "grid who-grid", limit: 48 }));
      } else if (kind === "composer") {
        $("#find-n").textContent = "";
        list.innerHTML = META.periods.map((p) => {
          const inP = names.filter((n) => META.composers.find((c) => c.n === n).p === p);
          return inP.length ? `<div class="formh">${esc(p)}<small>${inP.length}</small></div><div class="grid who-grid">${inP.map(card).join("")}</div>` : "";
        }).join("");
        wirePlays(list);
      } else { $("#find-n").textContent = ""; list.replaceChildren(listOf(names, card, { cls: "grid who-grid", limit: 48 })); }
    };
    input.addEventListener("input", draw);
    draw();
    return;
  }
  const head = { period: ["Periods", "From Bach's Baroque to the 20th century."], form: ["Forms", "Sonatas, nocturnes, études, concertos… most works first."],
    mood: ["Moods", "The site's own tags; press a mood to hear a shuffled programme of it."], key: ["Keys", "Every key, from C major round the circle."] }[kind];
  body.innerHTML = `<div class="pagehead"><h1>${head[0]}</h1><p>${head[1]}</p></div>`;
  if (kind === "mood") body.insertAdjacentHTML("beforeend", `<div class="mood-grid" style="margin-top:14px">${groups.map(([m]) => moodCard(m)).join("")}</div>
    <p class="hint" style="margin-top:12px">Or browse the lists: ${groups.map(([m, g]) => `<a class="textlink" href="#/list/mood/${enc(m)}">${esc(m)}</a> (${g.n})`).join(" · ")}</p>`);
  else body.insertAdjacentHTML("beforeend", `<div class="tile-grid" style="margin-top:14px">${groups.map(([v, g]) => {
    const col = kind === "period" ? PCOL[v] : null;
    return `<a class="tile${col ? " col" : ""}" href="#/list/${kind}/${enc(v)}"${col ? ` style="--t1:${col[0]};--t2:${col[1]}"` : ""}>${esc(v)}<small>${plural(g.n, "work")}${g.rec ? ` · ▶ ${g.rec}` : ""}</small></a>`;
  }).join("")}</div>`);
  wirePlays(body);
}

function renderList(kind, value, sub = "") {
  if (!KINDS[kind] || !KINDS[kind].get) return renderBrowse("composer");
  const all = WORKS.filter((w) => KINDS[kind].get(w).includes(value));
  if (!all.length) { view.innerHTML = `<div class="empty"><div class="ic">♩</div><b>Nothing here</b><p><a class="textlink" href="#/browse/${kind}">${BLABEL[kind]}</a></p></div>`; return; }
  const list = sub ? all.filter((w) => cap(w.fm) === sub) : all;
  const filt = { mood: { moods: [value] }, period: { periods: [value] }, composer: { composer: value }, pianist: { pianist: value }, form: { forms: [value.toLowerCase()] } }[kind];
  const n = filt ? jb.countFor(filt) : 0;
  // A composer's works are split by form (Nocturne, Étude, Mazurka…): offer them as chips.
  const subs = kind === "composer" ? groupCounts(all, (w) => cap(w.fm)) : [];
  const base = `#/list/${kind}/${enc(value)}`;
  const c = kind === "composer" ? META.composers.find((x) => x.n === value) : null;
  const desc = kind === "composer" ? `${c.y ? c.y + " · " : ""}${c.p} · ${plural(all.length, "work")}${all.filter(hasRec).length ? ` · ${all.filter(hasRec).length} with recordings` : ""}`
    : kind === "mood" ? `${META.moods[value] || ""} · ${plural(all.length, "work")}` : kind === "pianist" ? `${plural(all.length, "work")} recorded`
    : kind === "form" ? `${plural(all.length, "work")}` : plural(all.length, "work");
  view.innerHTML = `<a class="back" href="#/browse/${kind}">${I.back} ${BLABEL[kind]}</a>
    <div class="pagehead"><div class="kick">${KINDS[kind].label}</div><h1>${esc(sub ? `${value}: ${sub}` : value)}</h1><p>${esc(desc)}</p>
      ${n ? `<div class="acts"><button class="btn sm" type="button" id="play-list">${I.play} Play ${esc(kind === "pianist" ? value : kind === "composer" ? surname(value) : value)} in the jukebox <span class="n">(${n})</span></button>
        ${c && c.n ? `<a class="btn ghost sm" href="https://en.wikipedia.org/wiki/${enc(c.n.replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikipedia</a>` : ""}</div>` : ""}</div>
    ${subs.length > 1 ? `<nav class="chips" aria-label="${esc(value)} by form" style="margin-top:10px">
      <a class="chip sm" href="${base}"${sub ? "" : ' aria-current="page"'}>All <span class="n">${all.length}</span></a>
      ${subs.map(([v, k]) => `<a class="chip sm" href="${base}/${enc(v)}"${v === sub ? ' aria-current="page"' : ""}>${esc(v)} <span class="n">${k}</span></a>`).join("")}</nav>` : ""}
    <div id="list-body"></div>`;
  $("#list-body").append(workList(list, { recFirst: kind !== "composer" }));
  if (n) $("#play-list").onclick = () => { jb.setFilters(filt); location.hash = "#/jukebox"; jb.start(true); };
}

// Works that share moods, set, form or composer with this one; playable works ranked a little higher.
function relatedWorks(w, n = 8) {
  const moods = new Set(w.moods || []);
  const scored = [];
  for (const o of WORKS) {
    if (o.id === w.id) continue;
    let sc = 2 * (o.moods || []).filter((m) => moods.has(m)).length;
    if (w.set && o.set === w.set) sc += 3;
    if (o.fm === w.fm) sc += 2;
    if (o.c === w.c) sc += 1.5;
    if (!!o.o === !!w.o) sc += 0.5;
    if (sc < 5) continue;
    sc += hasRec(o) ? 1.5 : 0;
    sc += o.pop ? 0.5 : 0;
    scored.push([sc, o]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, n).map(([, o]) => o);
}

// One recording on the work page: ▶ plays it in the one site player (the page stays), credited to its pianist(s).
function perfRow(w, v) {
  const who = (v.p || []).map((p) => `<a href="#/list/pianist/${enc(p)}">${esc(p)}</a>`).join(", ");
  return `<div class="perf" data-perf="${esc(v.id)}">
    <button class="pthumb" type="button" data-play-work="${esc(w.id)}" data-vid="${esc(v.id)}" aria-label="Play ${esc(v.t)}"><img src="${thumb(v.id)}" alt="" loading="lazy"><span class="pv"><i>${I.play}</i></span></button>
    <div class="pmeta"><b>${who || esc(v.ch)}<span class="now" hidden>Now playing</span></b><span>${esc(v.t)}</span><small>${esc(v.ch)} · ${fmtViews(v.views)} views · ${fmtTime(v.sec)}</small></div>
    <div class="pbtns">${ytBtn(v.id)}</div></div>`;
}

function renderWork(id) {
  const w = BY_ID.get(id);
  if (!w) { view.innerHTML = `<div class="empty"><div class="ic">♩</div><b>Work not found</b><p><a class="textlink" href="#/">Back to Listen</a></p></div>`; return; }
  const c = composerOf(w);
  const chip = (kind, v, label = v) => `<a class="chip sm" href="#/list/${kind}/${enc(v)}">${esc(label)}</a>`;
  const facts = [
    w.cat && `<div><dt>Catalogue</dt><dd>${esc(w.cat)}</dd></div>`,
    w.key && `<div><dt>Key</dt><dd><a href="#/list/key/${enc(w.key)}">${esc(w.key)}</a></dd></div>`,
    w.y && `<div><dt>Year</dt><dd>${esc(w.y)}</dd></div>`,
    `<div><dt>Period</dt><dd><a href="#/list/period/${enc(c.p)}">${esc(c.p)}</a></dd></div>`,
    `<div><dt>Form</dt><dd><a href="#/list/form/${enc(cap(w.fm))}">${esc(cap(w.fm))}</a>${w.o ? `<small>piano and orchestra</small>` : ""}</dd></div>`,
    w.set && `<div class="span"><dt>Set</dt><dd>${esc(w.set)}</dd></div>`,
    (w.moods || []).length && `<div class="span"><dt>Mood</dt><dd><div class="tags">${w.moods.map((m) => chip("mood", m)).join("")}</div></dd></div>`,
    (w.al || []).length && `<div class="span"><dt>Also known as</dt><dd>${esc(w.al.join(" · "))}</dd></div>`,
  ].filter(Boolean);
  const vids = w.v == null
    ? `<p class="novideo">Recordings for this work haven't been fetched yet. They are added every day${w.pop ? ", well-known works first" : ""}.</p>`
    : !w.v.length ? `<p class="novideo">No recording that clearly matches this work was found on YouTube.</p>`
    : `<div class="list">${w.v.map((v) => perfRow(w, v)).join("")}</div>`;
  const best = bestVideo(w), rel = relatedWorks(w), relN = jb.countFor({ moods: w.moods });
  view.innerHTML = `<a class="back" href="#/list/composer/${enc(c.n)}">${I.back} ${esc(c.n)}</a>
    <div class="dhead">${sleeve(w, { lg: true })}
      <div><div class="kick"><a href="#/list/composer/${enc(c.n)}">${esc(c.n)}</a> · <a href="#/list/period/${enc(c.p)}">${esc(c.p)}</a> · <a href="#/list/form/${enc(cap(w.fm))}">${esc(cap(w.fm))}</a>${w.o ? " · with orchestra" : ""}</div>
        <h1>${esc(w.t)}</h1>
        <div class="alt">${esc([w.f, w.cat].filter(Boolean).join(", "))}${w.set ? `<span class="al">From ${esc(w.set)}</span>` : ""}</div></div></div>
    <div class="dacts">
      <button class="btn" type="button" id="w-play" data-play-work="${esc(w.id)}"${best ? "" : " disabled"}>${I.play} Play</button>
      <button class="icon-btn" id="w-like" type="button" aria-pressed="${isLiked(w.id)}" aria-label="Like" title="Liked works come up 4× as often in the jukebox">${isLiked(w.id) ? I.heartF : I.heart}</button>
      <button class="icon-btn" id="w-never" type="button" aria-pressed="${isNever(w.id)}" aria-label="Never play in the jukebox" title="Never play this work in the jukebox">${I.ban}</button>
      ${best ? ytBtn(best.id) : ""}
      <span class="hint" id="w-state">${isNever(w.id) ? "Hidden from the jukebox" : isLiked(w.id) ? "Liked" : ""}</span>
    </div>
    <div class="work-grid">
      <div>
        <dl class="cat">${facts.join("")}</dl>
        ${w.mv ? `<div class="formh">Movements<small>${w.mv.length}</small></div><ol class="movements">${w.mv.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>` : ""}
        ${w.wp ? `<p class="src">Read more on <a href="${esc(w.wp)}" target="_blank" rel="noopener">Wikipedia</a>.</p>` : ""}
      </div>
      <section aria-label="Recordings"><div class="formh">Recordings<small>${(w.v || []).length || ""}</small></div>${vids}</section>
    </div>
    ${rel.length ? `<section class="sec" aria-labelledby="h-related">
      <div class="sec-h"><h2 id="h-related">More like this</h2>${relN ? `<button class="btn ghost xs" type="button" id="play-like">${I.play} Play works like this <span class="n">(${relN})</span></button>` : ""}
        <span class="hint">Works that share this one's mood, set, form or composer.</span></div>
      <div id="related"></div></section>` : ""}`;
  if (rel.length) $("#related").append(workList(rel, { limit: 8, toggle: false }));
  const likeBtn = $("#play-like");
  if (likeBtn) likeBtn.onclick = () => { jb.setFilters({ moods: w.moods }); location.hash = "#/jukebox"; jb.start(true); };
  wirePlays(view);
  markPlaying();
  const state = () => { $("#w-state").textContent = isNever(w.id) ? "Hidden from the jukebox" : isLiked(w.id) ? "Liked" : ""; };
  $("#w-like").onclick = () => {
    const on = !isLiked(w.id);
    toggle("likes", w.id, on); jb.prefsChanged();
    $("#w-like").setAttribute("aria-pressed", String(on)); $("#w-like").innerHTML = on ? I.heartF : I.heart;
    $("#w-never").setAttribute("aria-pressed", "false"); state();
    toast(on ? "Added to your likes" : "Removed from your likes");
  };
  $("#w-never").onclick = () => {
    const on = !isNever(w.id);
    toggle("never", w.id, on); jb.prefsChanged();
    $("#w-never").setAttribute("aria-pressed", String(on));
    if (on) { $("#w-like").setAttribute("aria-pressed", "false"); $("#w-like").innerHTML = I.heart; }
    state();
    toast(on ? "This work won't play in the jukebox" : "This work can play again");
  };
}

/* ---------------- Mine: liked and hidden works ---------------- */
function mineRow(id, kind) {
  const w = BY_ID.get(id);
  if (!w) return "";
  const n = (w.v || []).length, best = bestVideo(w);
  return `<div class="rowi${n ? "" : " dim"}">
    <button class="rp${jb.currentWork() === id ? " on" : ""}" type="button" data-play-work="${esc(id)}"${n ? "" : " disabled"} aria-label="Play ${esc(w.t)}">${I.play}</button>
    <a class="rt" href="#/work/${enc(id)}"><b>${esc(w.t)}</b><span class="sub">${esc(subline(w))}${n ? "" : " · no recording yet"}</span></a>
    <span class="meta" style="display:flex;gap:6px;align-items:center">
      <button class="btn ghost xs" type="button" data-un="${kind}" data-id="${esc(id)}">${kind === "likes" ? "Unlike" : "Allow again"}</button>
      ${best ? ytBtn(best.id) : ""}</span></div>`;
}
function renderMine() {
  const likes = prefs.likes.filter((id) => BY_ID.has(id)).slice().reverse(); // newest first
  const never = prefs.never.filter((id) => BY_ID.has(id)).slice().reverse();
  const u = SYNC.user, nLiked = jb.countFor({ likedOnly: true });
  const acct = SYNC.signIn && !u
    ? `<div class="acct"><span class="avatar" aria-hidden="true">?</span><div><b>Not signed in</b><small>Sign in to keep your likes on all your devices.</small></div><button class="btn sm" type="button" id="mine-in">Sign in with Google</button></div>`
    : u ? `<div class="acct">${u.photo ? `<img class="avatar" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar" aria-hidden="true">${esc((u.name || u.email || "?").trim()[0].toUpperCase())}</span>`}<div><b>${esc(u.name || u.email || "")}</b><small>Kept in your account, so they're on all your devices.</small></div></div>`
    : `<p class="hint" style="margin:8px 0 16px">Saved in this browser only.</p>`;
  view.innerHTML = `<div class="pagehead"><div class="kick">Mine</div><h1>Your works</h1></div>
    ${acct}
    <section class="sec" style="margin-top:10px" aria-labelledby="h-likes">
      <div class="sec-h"><h2 id="h-likes">Liked works<small>${likes.length}</small></h2>
        ${nLiked ? `<button class="btn sm" type="button" id="mine-play-all" style="margin-left:auto">${I.play} Play all my likes <span class="n">(${nLiked})</span></button>` : ""}
        <span class="hint">Liked works come up 4× as often in the jukebox.</span></div>
      ${likes.length ? `<div class="rows">${likes.map((id) => mineRow(id, "likes")).join("")}</div>` : `<div class="empty"><div class="ic">♥</div><b>Nothing liked yet</b><p>Press ♥ on a work you love, in the player or on its page; they collect here.</p></div>`}
    </section>
    ${never.length ? `<section class="sec" aria-labelledby="h-never"><div class="sec-h"><h2 id="h-never">Never play<small>${never.length}</small></h2><span class="hint">The jukebox skips these.</span></div>
      <div class="rows">${never.map((id) => mineRow(id, "never")).join("")}</div></section>` : ""}`;
  wirePlays(view);
  $$("[data-un]", view).forEach((b) => b.onclick = () => { toggle(b.dataset.un, b.dataset.id, false); jb.prefsChanged(); toast(b.dataset.un === "likes" ? "Removed from your likes" : "This work can play again"); renderMine(); });
  const all = $("#mine-play-all");
  if (all) all.onclick = () => playFiltered("likes", "");
  const si = $("#mine-in");
  if (si) si.onclick = () => SYNC.signIn();
}

function sessionGet(k) { try { return sessionStorage.getItem("piano." + k) || ""; } catch { return ""; } }
function sessionSet(k, v) { try { sessionStorage.setItem("piano." + k, v); } catch { /* ignore */ } }

/* ---------------- jukebox: the one player ---------------- */
const jb = (() => {
  const F = prefs.filters;
  const findQ = { composer: "", pianist: "" }; // text in the jukebox find boxes (not saved)
  let player = null, apiLoading = null, current = null, errors = 0, queue = [], qShown = 60, seeking = false;
  const history = []; // items {w, v}
  const KIND_LABEL = { solo: "Solo piano", orch: "Piano and orchestra" };
  const LENGTHS = [[0, "Any length"], [10, "Under 10 minutes"], [20, "Under 20 minutes"], [40, "Under 40 minutes"]];

  const fitVideos = (w, f) => w.v.filter((v) => !f.maxMin || v.sec <= f.maxMin * 60);
  function matches(w, f) {
    return hasRec(w) && !isNever(w.id)
      && (!f.popular || w.pop)
      && (!f.likedOnly || isLiked(w.id))
      && (!f.moods.length || (w.moods || []).some((m) => f.moods.includes(m)))
      && (!f.periods.length || f.periods.includes(composerOf(w).p))
      && (!f.kinds.length || f.kinds.includes(w.o ? "orch" : "solo"))
      && (!f.forms.length || f.forms.includes(w.fm))
      && (!f.composer || composerOf(w).n === f.composer)
      && (!f.pianist || w.v.some((v) => (v.p || []).includes(f.pianist)))
      && fitVideos(w, f).length > 0;
  }
  const pool = (f = F) => WORKS.filter((w) => matches(w, f));

  /* The programme: a weighted shuffle of every work that matches the filters. Liked ones tend to come early
     (4x weight), recently played ones go to the end, and the same composer twice in a row is avoided. */
  function buildQueue() {
    const recent = new Set(prefs.recent.slice(-150));
    const p = pool().filter((w) => !current || w.id !== current.w.id);
    const q = p.map((w) => [Math.pow(Math.random(), 1 / (isLiked(w.id) ? 4 : 1)) - (recent.has(w.id) ? 1 : 0), w])
      .sort((a, b) => b[0] - a[0]).map(([, w]) => w);
    const same = (a, b) => !!a && !!b && a.c === b.c;
    for (let i = 0; i < q.length; i++) {
      const prev = i ? q[i - 1] : current && current.w;
      if (!same(prev, q[i])) continue;
      const j = q.findIndex((w, k) => k > i && !same(prev, w));
      if (j > 0) [q[i], q[j]] = [q[j], q[i]];
    }
    queue = q;
    qShown = 60;
  }
  // Prefer the chosen pianist; otherwise favour popular recordings (weight ~ sqrt(views)).
  function pickVideo(w, prefer = F.pianist) {
    const fit = fitVideos(w, F);
    let vids = fit.length ? fit : w.v;
    if (prefer) { const p = vids.filter((v) => (v.p || []).includes(prefer)); if (p.length) vids = p; }
    const wt = vids.map((v) => Math.sqrt(v.views + 1));
    let r = Math.random() * wt.reduce((a, b) => a + b, 0);
    for (let i = 0; i < vids.length; i++) if ((r -= wt[i]) <= 0) return vids[i];
    return vids[0];
  }
  const label = (w) => `${w.t} · ${surname(composerOf(w).n)}`;
  const credit = (v) => (v.p || []).join(", ") || v.ch;
  function qRow(w, i, cur) {
    return `<button class="item${cur ? " on" : ""}${isLiked(w.id) ? " liked" : ""}" type="button" data-qid="${esc(w.id)}"${cur ? ' aria-current="true"' : ""}>
      <span class="n">${cur ? "▶" : i}</span>${sleeve(w)}
      <span class="qm"><b>${esc(w.t)}</b><span>${esc(subline(w))}${cur ? ` · ${esc(credit(current.v))}` : ""}</span></span>
      <span class="dur">${cur ? fmtTime(current.v.sec) : hasRec(w) ? fmtTime(Math.min(...w.v.map((v) => v.sec))) : ""}</span></button>`;
  }
  function renderQueue() {
    queue = queue.filter((w) => matches(w, F));
    $("#jb-next").textContent = queue.length && current ? `Up next: ${label(queue[0])}` : "";
    const el = $("#jb-queue");
    if (!current && !queue.length) { el.innerHTML = ""; return; }
    const more = queue.length - qShown;
    el.innerHTML = `<div class="q-head"><span class="hint">${current ? "Now playing, then the shuffled programme." : "The shuffled programme; press Play to begin."}</span>
        <button class="btn ghost xs" type="button" id="q-shuffle">${I.shuffle} Reshuffle</button></div>
      <div class="list">${current ? qRow(current.w, 0, true) : ""}${queue.slice(0, qShown).map((w, i) => qRow(w, i + 1, false)).join("")}</div>
      ${more > 0 ? `<p class="more-row"><button class="btn ghost sm" type="button" id="q-more">Show ${Math.min(100, more)} more of ${more}</button></p>` : ""}`;
    $$("[data-qid]", el).forEach((b) => b.onclick = () => playWork(b.dataset.qid));
    $("#q-shuffle").onclick = () => { buildQueue(); renderQueue(); };
    const m = $("#q-more"); if (m) m.onclick = () => { qShown += 100; renderQueue(); };
  }

  function loadApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiLoading) return apiLoading;
    apiLoading = new Promise((res) => {
      window.onYouTubeIframeAPIReady = res;
      const sc = document.createElement("script");
      sc.src = "https://www.youtube.com/iframe_api";
      document.head.append(sc);
    });
    return apiLoading;
  }

  // play = false only cues the recording at startAt (after a page refresh browsers block sound until a click).
  async function playItem(item, startAt = 0, play = true) {
    current = item;
    pendingStart = Math.floor(startAt);
    if (!startAt) { prefs.recent.push(item.w.id); prefs.recent = prefs.recent.slice(-300); savePrefs(); }
    showNow(); renderQueue(); saveSession(); setProgress(pendingStart, item.v.sec); markPlaying();
    await loadApi();
    $("#jb-empty").hidden = true;
    const start = Math.floor(startAt);
    if (!player) {
      player = new YT.Player("yt-player", {
        videoId: item.v.id, host: ytHost(),
        playerVars: { autoplay: play ? 1 : 0, rel: 0, playsinline: 1, start },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) next();
            if (e.data === YT.PlayerState.PLAYING) errors = 0;
            updateButtons(); saveSession(); tick(); markPlaying();
          },
          onError: () => { if (++errors < 5) next(); }, // unembeddable or removed video: move on
        },
      });
    } else if (play) player.loadVideoById({ videoId: item.v.id, startSeconds: start });
    else player.cueVideoById({ videoId: item.v.id, startSeconds: start });
    updateButtons();
  }

  /* Resume point: what was playing, where, the programme and the page. */
  let pendingStart = 0; // until a cued recording has really started, its position is where it was cued
  const position = () => {
    try {
      const st = player && player.getPlayerState ? player.getPlayerState() : -1;
      if (st === -1 || st === 5) return pendingStart; // unstarted / cued
      return player.getCurrentTime();
    } catch { return pendingStart; }
  };
  const duration = () => { try { const d = player && player.getDuration ? player.getDuration() : 0; return d || (current ? current.v.sec : 0); } catch { return current ? current.v.sec : 0; } };
  function saveSession() {
    if (!WORKS.length || holdSession) return;
    const s = { at: Date.now(), route: lastPage, wid: current ? current.w.id : "", vid: current ? current.v.id : "", t: current ? Math.floor(position()) : 0,
      queue: queue.slice(0, 200).map((w) => w.id), history: history.slice(-30).map((x) => x.w.id) };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
    SYNC.changed("session");
  }
  // Continue a saved session: programme and history come back, the recording starts where it stopped.
  function resume(s, play = true) {
    const get = (ids) => (ids || []).map((id) => BY_ID.get(id)).filter((w) => w && hasRec(w));
    queue = get(s.queue).filter((w) => matches(w, F));
    history.splice(0, history.length, ...get(s.history).map((w) => ({ w, v: pickVideo(w) })));
    const w = s.wid && BY_ID.get(s.wid);
    if (w && hasRec(w)) {
      const v = w.v.find((x) => x.id === s.vid) || pickVideo(w);
      playItem({ w, v }, play ? Math.max(0, (s.t || 0) - 3) : s.t || 0, play);
    } else renderQueue();
  }

  function next() {
    queue = queue.filter((w) => matches(w, F));
    if (!queue.length) buildQueue();
    const w = queue.shift();
    if (!w) { showEmpty(); return; }
    if (current) history.push(current);
    playItem({ w, v: pickVideo(w) });
  }
  function prev() {
    const item = history.pop();
    if (!item) return;
    if (current) queue.unshift(current.w); // the one we leave comes up next again
    current = null;
    playItem(item);
  }
  // Play a chosen work (optionally a chosen recording) from anywhere; the programme then continues after it.
  // Pressing it again pauses or resumes. The page stays; the player bar shows what is playing.
  function playWork(id, vid = "") {
    const w = BY_ID.get(id);
    if (!w || !hasRec(w)) return;
    if (current && current.w.id === id && (!vid || current.v.id === vid)) { togglePlay(); return; }
    const i = queue.findIndex((x) => x.id === id);
    if (i >= 0) queue = queue.slice(i + 1).concat(queue.slice(0, i));
    if (current) history.push(current);
    const v = (vid && w.v.find((x) => x.id === vid)) || pickVideo(w);
    playItem({ w, v });
  }
  // Switch between the privacy-enhanced player and the standard one (YouTube Premium) without losing the place.
  function resetPlayer() {
    if (!player) return;
    const t0 = player.getCurrentTime ? player.getCurrentTime() : 0;
    try { player.destroy(); } catch { /* already gone */ }
    player = null;
    if (!$("#yt-player")) { const d = document.createElement("div"); d.id = "yt-player"; $(".jb-player").prepend(d); }
    if (current) playItem(current, t0);
  }
  // start(): resume what is playing; start(true): jump to the first item of the (new) programme.
  function start(fresh = false) {
    if (!fresh && current && player) { player.playVideo(); return; }
    next();
  }

  function showEmpty() {
    const n = pool().length;
    $("#jb-empty").hidden = !!current && n > 0;
    $("#jb-empty-msg").textContent = n ? `Press Play for a shuffled programme of ${plural(n, "work")} that match your filters.`
      : "No works with recordings match these filters yet. Remove a filter or clear them all.";
    $("#jb-empty-clear").hidden = n > 0;
    $("#jb-empty-play").hidden = !n;
    $("#jb-empty-play").innerHTML = `${I.play} Play`;
    updateButtons();
  }

  function showNow() {
    const el = $("#jb-now"), side = $("#jb-side"), notes = $("#jb-notes");
    document.title = "Piano · Solo works and concertos";
    if (!current) { el.innerHTML = `<p class="hint" style="margin-top:14px">Nothing playing yet.</p>`; side.innerHTML = ""; notes.innerHTML = ""; return; }
    const { w, v } = current, c = composerOf(w);
    document.title = `♪ ${w.t} · ${surname(c.n)} · Piano`;
    el.innerHTML = `<div class="title">
        <h1><a href="#/work/${enc(w.id)}">${esc(w.t)}</a></h1>
        <div class="by"><a href="#/list/composer/${enc(c.n)}">${esc(c.n)}</a>${w.f || w.cat ? ` · ${esc([w.f, w.cat].filter(Boolean).join(", "))}` : ""}</div>
        <div class="by">${(v.p || []).length ? v.p.map((p) => `<a href="#/list/pianist/${enc(p)}">${esc(p)}</a>`).join(", ") : esc(v.ch)}${w.o ? " · piano and orchestra" : ""}</div>
        <p class="vt">${esc(v.t)} — ${esc(v.ch)} · ${fmtViews(v.views)} views · ${fmtTime(v.sec)}</p>
        ${(w.moods || []).length ? `<div class="tags">${w.moods.map((m) => `<a class="chip sm" href="#/list/mood/${enc(m)}">${esc(m)}</a>`).join("")}</div>` : ""}
      </div>`;
    notes.innerHTML = w.mv ? `<div class="mvs"><span class="kick">Movements</span><ol class="movements">${w.mv.map((m) => `<li>${esc(m)}</li>`).join("")}</ol></div>` : "";
    side.innerHTML = `<a href="#/work/${enc(w.id)}" aria-label="${esc(w.t)}">${sleeve(w)}</a>`;
  }

  const playing = () => !!(player && player.getPlayerState && player.getPlayerState() === 1);
  function updateButtons() {
    const on = !!current, n = pool().length, isPlaying = playing();
    $("#jb-skip").disabled = !on || !n; $("#jb-like").disabled = !on; $("#jb-never").disabled = !on;
    $("#jb-prev").disabled = !history.length;
    $("#jb-play").disabled = !on && !n;
    $("#jb-seek").disabled = !on;
    const liked = on && isLiked(current.w.id);
    $("#jb-like").setAttribute("aria-pressed", String(liked));
    $("#jb-like").innerHTML = liked ? I.heartF : I.heart;
    $("#jb-play").dataset.playing = String(isPlaying);
    $("#jb-play").setAttribute("aria-label", !on ? "Play" : isPlaying ? "Pause" : "Resume");
    updateMini();
  }
  function updateMini() {
    const show = !!current && location.hash.indexOf("#/jukebox") !== 0;
    $("#mini").hidden = !show;
    document.body.classList.toggle("has-mini", show);
    if (!current) return;
    const { w, v } = current, isPlaying = playing();
    $("#mini-main").textContent = w.t;
    $("#mini-sub").textContent = `${composerOf(w).n} · ${credit(v)}`;
    $("#mini-thumb").src = thumb(v.id);
    $("#mini-title").setAttribute("aria-label", `Open the jukebox: ${label(w)}`);
    const mp = $("#mini-play");
    mp.dataset.playing = String(isPlaying);
    $(".playi", mp).hidden = isPlaying; $(".pause", mp).hidden = !isPlaying;
    mp.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    $("#mini-like").setAttribute("aria-pressed", String(isLiked(w.id)));
    $("#mini-like").innerHTML = isLiked(w.id) ? I.heartF : I.heart;
    $("#mini-prev").disabled = !history.length;
  }
  /* progress: the seek bar on Now Playing and the thin line / timer of the player bar */
  function setProgress(c, d) {
    const pct = d ? Math.min(100, Math.max(0, c / d * 100)) : 0;
    if (!seeking) $("#jb-seek").value = String(Math.round(pct * 10));
    $("#jb-cur").textContent = fmtTime(c); $("#jb-dur").textContent = d ? fmtTime(d) : "–:––";
    $("#mini-bar").style.width = `${pct}%`; $("#mini-prog").style.width = `${pct}%`;
    $("#mini-cur").textContent = fmtTime(c); $("#mini-dur").textContent = d ? fmtTime(d) : "–:––";
  }
  function tick() { if (!current) return; setProgress(position(), duration()); }

  /* filters */
  function countWith(key, value) {
    const f = { ...F, [key]: ARR[key] ? [value] : value };
    return pool(f).length;
  }
  function pills(key, values, labelFn = (v) => v) {
    return `<div class="opts">${values.map((v) => `<label><input type="checkbox" name="${key}" value="${esc(v)}"${F[key].includes(v) ? " checked" : ""}><span class="chip sm">${esc(labelFn(v))} <span class="n" data-count></span></span></label>`).join("")}</div>`;
  }
  function renderFilters() {
    const forms = groupCounts(WORKS.filter(hasRec), (w) => w.fm).map(([f]) => f);
    $("#jb-filters").innerHTML = `
      <div class="grp"><h4>Mood</h4>${pills("moods", Object.keys(META.moods))}</div>
      <div class="grp"><h4>Period</h4>${pills("periods", META.periods)}</div>
      <div class="grp"><h4>Kind</h4>${pills("kinds", ["solo", "orch"], (v) => KIND_LABEL[v])}</div>
      <div class="grp"><h4>Form</h4>${pills("forms", forms, cap)}</div>
      <div class="grp"><h4>Composer, pianist, length</h4>
        <label class="flab" for="jb-composer-q">Composer</label>
        <input class="mini-search" type="search" id="jb-composer-q" autocomplete="off" placeholder="Type to find a composer (Chopin, Rachmaninov…)" value="${esc(findQ.composer)}">
        <select class="sel" id="jb-composer" aria-label="Composer"></select>
        <label class="flab" for="jb-pianist-q">Pianist</label>
        <input class="mini-search" type="search" id="jb-pianist-q" autocomplete="off" placeholder="Type to find a pianist (Argerich, Gould…)" value="${esc(findQ.pianist)}">
        <select class="sel" id="jb-pianist" aria-label="Pianist"></select>
        <label class="flab" for="jb-len">Length</label><select class="sel" id="jb-len" aria-label="Length"></select>
        <label class="toggle"><input type="checkbox" id="jb-popular"${F.popular ? " checked" : ""}> Only well-known works</label><br>
        <label class="toggle"><input type="checkbox" id="jb-liked"${F.likedOnly ? " checked" : ""}> Only liked works</label>
      </div>`;
    // Typing in a find box narrows its dropdown; a single match is chosen at once.
    for (const key of ["composer", "pianist"]) {
      $(`#jb-${key}-q`).oninput = (e) => {
        findQ[key] = e.target.value;
        const ids = updateSelects();
        if (norm(findQ[key]) && ids[key].length === 1 && F[key] !== ids[key][0]) { F[key] = ids[key][0]; filtersChanged(); }
      };
    }
    $("#jb-filters").onchange = (e) => {
      const el = e.target;
      if (el.classList.contains("mini-search")) return;
      if (ARR[el.name]) F[el.name] = $$(`input[name="${el.name}"]:checked`, $("#jb-filters")).map((x) => x.value);
      else if (el.id === "jb-composer") F.composer = el.value;
      else if (el.id === "jb-pianist") F.pianist = el.value;
      else if (el.id === "jb-len") F.maxMin = Number(el.value);
      else if (el.id === "jb-liked") F.likedOnly = el.checked;
      else if (el.id === "jb-popular") F.popular = el.checked;
      filtersChanged();
    };
    updateCounts();
  }
  // Each option shows how many works you'd get by choosing it (other filters unchanged); zero = greyed out.
  function updateCounts() {
    $$("#jb-filters input[name]").forEach((inp) => {
      const n = countWith(inp.name, inp.value);
      inp.checked = F[inp.name].includes(inp.value);
      inp.disabled = !n && !inp.checked;
      inp.nextElementSibling.querySelector("[data-count]").textContent = n;
    });
    updateSelects();
    $("#jb-len").innerHTML = LENGTHS.map(([v, l]) => `<option value="${v}"${v === F.maxMin ? " selected" : ""}>${l}${v ? ` (${countWith("maxMin", v)})` : ""}</option>`).join("");
    $("#jb-liked").checked = F.likedOnly;
    $("#jb-popular").checked = F.popular;
    renderFilterBar();
  }
  // Composer / pianist dropdowns: only options that would play something, narrowed by the find boxes.
  function updateSelects() {
    const out = {};
    const opts = (sel, key, names, anyLabel) => {
      const rows = names.map((v) => [v, countWith(key, v)]).filter(([v, n]) => n || v === F[key]);
      out[key] = rows.map(([v]) => v);
      sel.innerHTML = `<option value="">${anyLabel}</option>` +
        rows.map(([v, n]) => `<option value="${esc(v)}"${v === F[key] ? " selected" : ""}>${esc(v)} (${n})</option>`).join("");
    };
    const narrow = (names, key) => norm(findQ[key]) ? [...new Set(searchNames(names, findQ[key]).concat(names.filter((x) => x === F[key])))] : names;
    opts($("#jb-composer"), "composer", narrow(META.composers.map((c) => c.n), "composer"), "Any composer");
    opts($("#jb-pianist"), "pianist", narrow(PIANISTS, "pianist"), "Any pianist");
    return out;
  }
  function renderFilterBar() {
    const n = pool().length;
    $("#jb-count").textContent = `${plural(n, "work")} to play`;
    $("#sheet-count").textContent = `${plural(n, "work")} to play`;
    const chips = [
      ...(F.popular ? [["popular", "", "Well-known works"]] : []),
      ...F.moods.map((v) => ["moods", v, v]), ...F.periods.map((v) => ["periods", v, v]),
      ...F.kinds.map((v) => ["kinds", v, KIND_LABEL[v]]), ...F.forms.map((v) => ["forms", v, cap(v)]),
      ...(F.composer ? [["composer", F.composer, F.composer]] : []), ...(F.pianist ? [["pianist", F.pianist, F.pianist]] : []),
      ...(F.maxMin ? [["maxMin", "", `Under ${F.maxMin} min`]] : []),
      ...(F.likedOnly ? [["likedOnly", "", "Liked only"]] : []),
    ];
    $("#jb-active").innerHTML = chips.length
      ? chips.map(([k, v, l]) => `<button class="chip on" type="button" data-k="${k}" data-v="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)}</button>`).join("") +
        `<button class="chip" type="button" id="jb-clear">Clear all</button>`
      : `<span class="hint">All works with recordings</span>`;
    $$("#jb-active [data-k]").forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (ARR[k]) F[k] = F[k].filter((x) => x !== b.dataset.v);
      else if (k === "likedOnly" || k === "popular") F[k] = false;
      else if (k === "maxMin") F.maxMin = 0;
      else F[k] = "";
      filtersChanged();
    });
    const c = $("#jb-clear"); if (c) c.onclick = clearFilters;
  }
  function filtersChanged() {
    savePrefs(); updateCounts(); buildQueue(); renderQueue();
    if (!current) showEmpty(); else updateButtons();
  }
  function clearFilters() { setFilters({}); }
  // Replace all filters with the given ones (unspecified ones are cleared).
  function setFilters(f) {
    Object.assign(F, freshFilters(), f);
    filtersChanged();
  }
  const countFor = (f) => pool({ ...freshFilters(), ...f }).length;

  // Likes or never-play changed anywhere: counts, buttons and the programme follow.
  function prefsChanged() {
    if (WORKS.length) { updateCounts(); updateButtons(); renderQueue(); }
  }

  function togglePlay() { if (!current || !player) return next(); playing() ? player.pauseVideo() : player.playVideo(); }
  function likeCurrent() {
    if (!current) return;
    const on = !isLiked(current.w.id);
    toggle("likes", current.w.id, on); prefsChanged();
    toast(on ? "Added to your likes" : "Removed from your likes");
    const wl = $("#w-like"); if (wl && $("#w-play") && $("#w-play").dataset.playWork === current.w.id) { wl.setAttribute("aria-pressed", String(on)); wl.innerHTML = on ? I.heartF : I.heart; }
  }
  /* the filter sheet */
  let sheetOpener = null;
  function toggleFilters(open) {
    const sh = $("#sheet");
    sh.classList.toggle("on", open); $("#sheet-bg").classList.toggle("on", open);
    sh.setAttribute("aria-hidden", String(!open));
    $("#jb-edit").setAttribute("aria-expanded", String(open));
    if (open) { sheetOpener = document.activeElement; setTimeout(() => { const f = $("#sheet input, #sheet button"); if (f) f.focus(); }, 60); }
    else if (sheetOpener && sheetOpener.focus) { sheetOpener.focus(); sheetOpener = null; }
  }

  function init() {
    renderFilters(); showEmpty(); buildQueue(); renderQueue();
    $("#jb-play").onclick = togglePlay;
    $("#jb-empty-play").onclick = () => start();
    $("#jb-skip").onclick = next;
    $("#jb-prev").onclick = prev;
    $("#jb-like").onclick = likeCurrent;
    for (const id of ["jb-yt", "mini-yt"]) $(`#${id}`).addEventListener("click", (e) => {
      if (!current) { e.preventDefault(); return; }
      e.currentTarget.href = ytLink(current.v.id, position());
    });
    $("#jb-never").onclick = () => { if (!current) return; toggle("never", current.w.id, true); prefsChanged(); toast("This work won't play in the jukebox again"); next(); };
    $("#jb-empty-clear").onclick = clearFilters;
    $("#jb-edit").onclick = () => toggleFilters(!$("#sheet").classList.contains("on"));
    $("#sheet-close").onclick = () => toggleFilters(false);
    $("#sheet-done").onclick = () => toggleFilters(false);
    $("#sheet-bg").onclick = () => toggleFilters(false);
    $("#sheet-clear").onclick = clearFilters;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#sheet").classList.contains("on")) toggleFilters(false); });
    $("#mini-play").onclick = togglePlay;
    $("#mini-skip").onclick = next;
    $("#mini-prev").onclick = prev;
    $("#mini-like").onclick = likeCurrent;
    const seek = $("#jb-seek");
    seek.oninput = () => { seeking = true; $("#jb-cur").textContent = fmtTime(duration() * seek.value / 1000); };
    seek.onchange = () => { seeking = false; if (player && player.seekTo) player.seekTo(duration() * seek.value / 1000, true); tick(); };
    setInterval(() => { if (current) saveSession(); }, 15000);
    setInterval(tick, 1000);
    window.addEventListener("pagehide", saveSession);
    document.addEventListener("visibilitychange", () => { if (document.hidden) saveSession(); });
  }

  // YouTube Premium: the standard player (sees the YouTube sign-in) instead of the privacy-enhanced one.
  function setPremium(on) {
    prefs.adsOptOut = !on;
    savePrefs();
    resetPlayer();
  }
  // Signing in or out can change which player is used: rebuild it (keeping the place) only if it changed.
  let lastHost = null;
  function hostChanged() {
    const h = ytHost();
    if (lastHost && h !== lastHost && player) resetPlayer();
    lastHost = h;
  }
  // Prefs changed from outside (account sync): redraw filters, lists and the programme.
  function refresh() { renderFilters(); buildQueue(); renderQueue(); updateButtons(); }

  return { init, refresh, setPremium, hostChanged, playWork, start, setFilters, countFor, prefsChanged, updateMini, saveSession, resume, preload: loadApi, label,
    currentWork: () => current && current.w.id, currentVideo: () => current && current.v.id, isPlaying: playing,
    pause: () => { try { player && player.pauseVideo(); } catch { /* not ready */ } } };
})();

/* ---------------- account (Google sign-in via sync.js) ---------------- */
function renderAccount() {
  const el = $("#account");
  if (!el) return;
  if (!SYNC.signIn) { el.hidden = true; return; }
  el.hidden = false;
  const u = SYNC.user;
  if (!u) {
    el.innerHTML = `<button class="pill signin" type="button" id="acct-in" aria-label="Sign in with Google">${I.user}<span class="lbl-short">Sign in</span><span class="lbl-long">Sign in with Google</span></button>`;
    $("#acct-in").onclick = () => SYNC.signIn();
    return;
  }
  const initial = (u.name || u.email || "?").trim()[0].toUpperCase();
  el.innerHTML = `<details class="acct-menu"><summary class="acct-btn" aria-label="Your account">
      ${u.photo ? `<img class="avatar" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc(initial)}</span>`}</summary>
    <div class="acct-pop">
      <p><strong>${esc(u.name || "")}</strong><br><small class="hint">${esc(u.email || "")}</small></p>
      <p class="hint">Your likes, settings and where you left off are kept in your account, so they follow you to your other devices.</p>
      <label class="toggle"><input type="checkbox" id="acct-premium"${noAds() ? " checked" : ""}> Watch without ads (if you have YouTube Premium)</label>
      <p class="hint">On automatically while you're signed in: the standard YouTube player recognises your YouTube sign-in, so with YouTube Premium there are no ads (without Premium nothing changes). YouTube can set its cookies when you play. If ads still appear, your browser is blocking YouTube's cookies inside other sites.</p>
      ${SYNC.lastSync ? `<p class="hint">Saved to your account at ${new Date(SYNC.lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>` : ""}
      <button class="btn ghost sm" type="button" id="acct-out">Sign out</button>
      <button class="btn danger sm" type="button" id="acct-del">Delete my saved data</button>
    </div></details>`;
  $("#acct-premium").onchange = (e) => jb.setPremium(e.target.checked);
  $("#acct-out").onclick = () => SYNC.signOut();
  $("#acct-del").onclick = () => { if (confirm("Delete everything saved in your account (likes, settings, resume point) and sign out? This browser keeps its own copy.")) SYNC.deleteData(); };
  const d = $("details", el); // the menu closes on an outside click
  document.addEventListener("click", (e) => { if (d.open && !d.contains(e.target)) d.open = false; });
}
SYNC.userChanged = () => {
  renderAccount();
  if (location.hash.startsWith("#/mine")) renderMine();
  jb.hostChanged(); // signed in: standard player (no ads with Premium); signed out: privacy-enhanced player
};
SYNC.onError = (e) => {
  console.warn("Piano sync:", e);
  if (e && /popup-closed|cancelled-popup/.test(e.code || "")) return;
  toast(`Couldn't reach your account (${(e && (e.code || e.message)) || ""}). Everything is still saved in this browser.`);
};

/* ---------------- resume where you left off ---------------- */
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s || Date.now() - s.at > 30 * 864e5) return null; // older than 30 days: start fresh
    const page = s.route && s.route !== "#/" && s.route !== "#" ? s.route : "";
    return (s.wid && BY_ID.has(s.wid)) || page ? s : null;
  } catch { return null; }
}
function pageName(hash) {
  const [kind, a, b] = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (kind === "work" && BY_ID.get(a)) return jb.label(BY_ID.get(a));
  if (kind === "list" && b) return b;
  if (kind === "jukebox") return "the jukebox";
  if (kind === "mine") return "your works";
  if (kind === "browse" || kind === "search") return "Browse";
  return "";
}
function askResume(s) {
  const dlg = $("#resume"), w = s.wid && BY_ID.get(s.wid);
  if (!dlg || typeof dlg.showModal !== "function" || dlg.open) { holdSession = false; return; }
  if (w) jb.preload(); // so playback can start straight from the click on "Continue"
  $("#resume-text").innerHTML = w
    ? `Continue where you left off? You were listening to <strong>${esc(jb.label(w))}</strong>, at ${fmtTime(s.t || 0)}.`
    : `Continue where you left off? You were on <strong>${esc(pageName(s.route) || s.route)}</strong>.`;
  $("#resume-yes").onclick = () => {
    dlg.close();
    holdSession = false;
    if (s.route && s.route !== location.hash) location.hash = s.route;
    jb.resume(s);
  };
  $("#resume-no").onclick = () => {
    dlg.close();
    holdSession = false;
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    jb.saveSession();
    if (location.hash !== "#/") location.hash = "#/";
  };
  dlg.addEventListener("cancel", () => $("#resume-no").onclick(), { once: true }); // Esc = No
  dlg.showModal();
}

/* ---------------- router ---------------- */
function route() {
  $$(".acct-menu[open]").forEach((d) => { d.open = false; }); // a menu left open must not cover the next page
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const page = parts[0] || "home";
  const isJb = page === "jukebox";
  const screen = { home: "home", work: "work", browse: "browse", list: "browse", search: "search", jukebox: "jukebox", mine: "mine" }[page] || "home";
  document.body.dataset.screen = screen;
  $("#jb-screen").classList.toggle("offstage", !isJb);
  $("#jb-screen").setAttribute("aria-hidden", String(!isJb));
  view.hidden = isJb;
  $$("[data-nav]").forEach((a) => a.removeAttribute("aria-current"));
  const nav = { home: "home", work: "browse", browse: "browse", list: "browse", search: "browse", jukebox: "jukebox", mine: "mine" }[page];
  $$(`[data-nav="${nav}"]`).forEach((a) => a.setAttribute("aria-current", "page"));
  jb.updateMini();
  lastPage = location.hash || "#/";
  jb.saveSession();
  if (page !== "search" && $("#q").value) { $("#q").value = ""; sessionSet("q", ""); }
  window.scrollTo(0, 0);
  if (isJb) return;
  if (page === "work") renderWork(parts[1]);
  else if (page === "mine") renderMine();
  else if (page === "search") renderSearch();
  else if (page === "browse") renderBrowse(parts[1]);
  else if (page === "list" && parts[1] === "composer") renderList("composer", parts[2], parts[3] || "");
  else if (page === "list") renderList(parts[1], parts.slice(2).join("/"));
  else renderHome();
  view.style.animation = "none"; void view.offsetWidth; view.style.animation = "";
  if (page !== "home" && page !== "search") view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
// The header search: typing opens the results page and keeps the field focused.
$("#searchf").addEventListener("submit", (e) => e.preventDefault());
$("#q").addEventListener("input", () => {
  if (!WORKS.length) return;
  if (location.hash !== "#/search") { sessionSet("q", $("#q").value); location.hash = "#/search"; }
  else renderSearch();
});
addEventListener("load", () => setTimeout(() => window.scrollTo(0, 0), 0));

/* ---------------- data ---------------- */
function load() {
  fetch("works.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => {
    META = d.meta; WORKS = d.works;
    for (const w of WORKS) {
      BY_ID.set(w.id, w);
      const c = composerOf(w);
      const text = [w.t, w.f, c.n, w.cat, w.key, w.set, (w.al || []).join(" "), w.fm].join(" ");
      w._words = [...new Set(norm(text).split(" ").filter(Boolean))];
      w._skels = [...new Set(w._words.map(skel).filter((s) => s.length >= 3))];
      w._cat = normCat(w.cat);
      w._sort = norm(w.t);
    }
    PIANISTS = groupsOf("pianist").map(([n]) => n);
    jb.init();
    const startHash = location.hash;
    window.addEventListener("hashchange", route);
    route();
    renderAccount();
    // Coming back to the home page: offer to continue where the last visit stopped (on any device, when signed in).
    // A shared link opens directly.
    SYNC.ready.then(() => {
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      const reload = !!nav && nav.type === "reload";
      const home = !startHash || startHash === "#/" || startHash === "#";
      const session = loadSession();
      if (reload && session && session.wid) {
        // Page refresh: quietly restore the programme and cue the recording where it was (same page via the URL).
        holdSession = false;
        jb.resume(session, false);
      } else if (!reload && home && session && (location.hash || "#/") === (startHash || "#/")) askResume(session);
      else holdSession = false;
    });
  }).catch((e) => {
    view.innerHTML = `<div class="empty"><div class="ic">♩</div><b>Couldn't load the repertoire (${esc(e.message)})</b><p>Serve this folder over HTTP, e.g. <code>python3 -m http.server</code> inside <code>docs/</code>, or try again.</p><p><button class="btn sm" type="button" id="retry">Try again</button></p></div>`;
    $("#retry").onclick = load;
    console.error(e);
  });
}
load();
