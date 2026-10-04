/* Piano site: hash-routed static app over works.json. No build step. */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const view = $("#view");

let WORKS = [], BY_ID = new Map(), META = {};

/* ---------------- preferences (localStorage, this browser only) ---------------- */
const PREF_KEY = "piano.prefs.v1";
const EMPTY_FILTERS = () => ({ moods: [], periods: [], kinds: [], composer: "", pianist: "", maxMin: 0, likedOnly: false });
const prefs = loadPrefs();
function loadPrefs() {
  const empty = { likes: [], never: [], recent: [], recOnly: false, filters: EMPTY_FILTERS() };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    return p ? { ...empty, ...p, filters: { ...EMPTY_FILTERS(), ...(p.filters || {}) } } : empty;
  } catch { return empty; }
}
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } }
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

/* ---------------- helpers ---------------- */
const composerOf = (w) => META.composers[w.c];
const surname = (name) => name === "Clara Schumann" ? "Clara Schumann" : name === "Manuel de Falla" ? "de Falla"
  : name === "Richard Strauss" ? "R. Strauss" : name.split(" ").slice(-1)[0];
const hasRec = (w) => !!(w.v && w.v.length);
const fmtViews = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
const fmtTime = (sec) => sec >= 3600 ? `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`
  : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const unaccent = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/g, "o").replace(/ł/g, "l");
const norm = (t) => unaccent(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const pianistsOf = (w) => [...new Set((w.v || []).flatMap((v) => v.p || []))];
const subline = (w) => [surname(composerOf(w).n), w.cat, w.f && w.t !== w.f ? w.f : ""].filter(Boolean).join(" · ");

const KINDS = {
  popular: { label: "Well-known" },
  composer: { label: "Composer", get: (w) => [composerOf(w).n] },
  period: { label: "Period", get: (w) => [composerOf(w).p] },
  form: { label: "Form", get: (w) => [cap(w.fm)] },
  key: { label: "Key", get: (w) => w.key ? [w.key] : [] },
  mood: { label: "Mood", get: (w) => w.moods || [] },
  pianist: { label: "Pianist", get: pianistsOf },
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
  else arr.sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  return arr;
}

/* ---------------- work lists ---------------- */
function workRow(w) {
  const meta = [w.key, w.y].filter(Boolean).join(" · ");
  return `<li class="${hasRec(w) ? "" : "no-rec"}"><a href="#/work/${enc(w.id)}">
    <span class="w-t">${esc(w.t)}</span>
    <span class="meta">${hasRec(w) ? `<span class="rec">▶ ${w.v.length} recording${w.v.length > 1 ? "s" : ""}</span>` : ""}<span>${esc(meta)}</span></span>
    <span class="w-sub">${esc(subline(w))}</span>
  </a></li>`;
}

// Works with recordings first (keeping the given order inside each part), optional "only with recordings".
function workList(list, { limit = 120, toggle = true, recFirst = true } = {}) {
  const wrap = document.createElement("div");
  let shown = limit;
  const draw = () => {
    const rec = list.filter(hasRec), rest = list.filter((w) => !hasRec(w));
    const all = prefs.recOnly ? rec : recFirst ? rec.concat(rest) : list;
    const vis = all.slice(0, shown);
    const firstRest = recFirst ? vis.findIndex((w) => !hasRec(w)) : -1;
    const rows = vis.map((w, i) => (i === firstRest && i > 0 ? `<li class="divider">Recordings coming soon</li>` : "") + workRow(w)).join("");
    wrap.innerHTML = (toggle ? `<p><label class="toggle"><input type="checkbox" class="rec-only"${prefs.recOnly ? " checked" : ""}> Only works with recordings (${rec.length} of ${list.length})</label></p>` : "") + `
      <ul class="works">${rows || `<li class="divider">No works with recordings here yet. They are added every day.</li>`}</ul>` +
      (all.length > shown ? `<p class="more"><button class="btn small" type="button">${all.length - shown > 300 ? `Show 300 more of ${all.length - shown}` : `Show ${all.length - shown} more`}</button></p>` : "");
    if (toggle) $(".rec-only", wrap).onchange = (e) => { prefs.recOnly = e.target.checked; savePrefs(); draw(); };
    const b = $(".more button", wrap);
    if (b) b.onclick = () => { shown += 300; draw(); };
  };
  draw();
  return wrap;
}

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

/* ---------------- views ---------------- */

function renderHome() {
  const q = sessionGet("q");
  view.innerHTML = `
    <div class="search-row">
      <input id="q" class="search" type="search" placeholder="Search: a title, nickname, composer or catalogue number (Moonlight, op 9 no 2, BWV 846)" value="${esc(q)}" autocomplete="off" aria-label="Search works">
    </div>
    <div id="home-body"></div>`;
  const input = $("#q"), body = $("#home-body");
  const run = () => {
    sessionSet("q", input.value);
    if (norm(input.value)) {
      const res = searchWorks(input.value);
      body.innerHTML = `<div class="section-head"><h2>${plural(res.length, "work")} found</h2></div>`;
      body.append(workList(res, { recFirst: false }));
    } else renderListen(body);
  };
  input.addEventListener("input", run);
  run();
}

function renderListen(body) {
  const moodRec = (m) => WORKS.filter((w) => hasRec(w) && (w.moods || []).includes(m)).length;
  const popular = WORKS.filter((w) => w.pop).sort((a, b) => a.pop - b.pop);
  const popRec = popular.filter(hasRec);
  const totalRec = WORKS.filter(hasRec).length;
  body.innerHTML = `
    <section class="section" aria-labelledby="h-listen">
      <div class="section-head"><h2 id="h-listen">Listen now</h2>
        <span class="hint">${totalRec} of ${WORKS.length} works have recordings so far · more are added every day</span></div>
      <div class="hero">
        <div><strong>The great piano works</strong>
          <p>${popRec.length ? `A shuffle of ${plural(popRec.length, "well-known work")}, from Bach to Rachmaninoff.` : "Recordings are on their way."}</p></div>
        <button class="btn" type="button" data-play="popular:"${popRec.length ? "" : " disabled"}>▶ Start listening</button>
      </div>
      <div class="tiles">${Object.entries(META.moods).map(([m, d]) => {
        const n = moodRec(m);
        return `<button class="tile" type="button" data-play="mood:${esc(m)}"${n ? "" : " disabled"}>
          <strong>${esc(m)}</strong><span>${esc(d)}</span><span class="n">${n ? `▶ ${plural(n, "work")}` : "coming soon"}</span></button>`;
      }).join("")}</div>
    </section>
    <section class="section" aria-labelledby="h-pop">
      <div class="section-head"><h2 id="h-pop">Well-known works</h2><a href="#/browse/popular">All ${popular.length}</a></div>
      <div id="pop-list"></div>
    </section>
    <section class="section" aria-labelledby="h-explore">
      <div class="section-head"><h2 id="h-explore">Explore all ${WORKS.length} works</h2></div>
      <p class="tabs">${Object.entries(KINDS).filter(([k]) => k !== "popular").map(([k, v]) => `<a class="tab" href="#/browse/${k}">By ${v.label.toLowerCase()}</a>`).join("")}</p>
    </section>`;
  $("#pop-list", body).append(workList(popRec.length >= 12 ? popRec : popular, { limit: 12, toggle: false }));
  $$("[data-play]", body).forEach((b) => b.onclick = () => {
    const [kind, value] = b.dataset.play.split(":");
    playFiltered(kind, value);
  });
}

function renderBrowse(kind) {
  if (!KINDS[kind]) kind = "composer";
  const tabs = Object.entries(KINDS).map(([k, v]) =>
    `<a class="tab" href="#/browse/${k}"${k === kind ? ' aria-current="page"' : ""}>${v.label}</a>`).join("");
  view.innerHTML = `<nav class="tabs" aria-label="Browse by">${tabs}</nav>`;
  if (kind === "popular" || kind === "az") {
    const list = kind === "popular" ? WORKS.filter((w) => w.pop).sort((a, b) => a.pop - b.pop)
      : [...WORKS].sort((a, b) => a._sort.localeCompare(b._sort));
    view.insertAdjacentHTML("beforeend", `<p class="hint">${kind === "popular"
      ? "Works most people know, chosen by hand. Their recordings are fetched first."
      : `All ${WORKS.length} works, alphabetical by title.`}</p>`);
    view.append(workList(list));
    return;
  }
  const label = (v) => {
    if (kind === "composer") { const c = META.composers.find((x) => x.n === v); return `${esc(v)} <small>${esc(c.y)}</small>`; }
    if (kind === "mood") return `${esc(v)} <small>${esc(META.moods[v] || "")}</small>`;
    return esc(v);
  };
  const groups = groupsOf(kind);
  const card = ([v, g]) => `<a class="group" href="#/list/${kind}/${enc(v)}"><span>${label(v)}</span><span class="n" title="${g.rec} with recordings">${g.n}${g.rec ? ` · ▶${g.rec}` : ""}</span></a>`;
  if (kind === "composer") {  // composers under their period headings
    view.insertAdjacentHTML("beforeend", `<div class="groups">${META.periods.map((p) => {
      const inP = groups.filter(([v]) => META.composers.find((c) => c.n === v).p === p);
      return inP.length ? `<h2 class="group-head">${esc(p)}</h2>${inP.map(card).join("")}` : "";
    }).join("")}</div>`);
  } else view.insertAdjacentHTML("beforeend", `<div class="groups">${groups.map(card).join("")}</div>`);
}

function renderList(kind, value, sub = "") {
  if (!KINDS[kind] || !KINDS[kind].get) return renderBrowse("composer");
  const all = WORKS.filter((w) => KINDS[kind].get(w).includes(value));
  const list = sub ? all.filter((w) => cap(w.fm) === sub) : all;
  const playable = ["mood", "period", "composer", "pianist"].includes(kind) && all.some(hasRec);
  // A composer's works are split by form (Nocturne, Étude, Mazurka…): offer them as chips.
  const subs = kind === "composer" ? groupCounts(all, (w) => cap(w.fm)) : [];
  const base = `#/list/${kind}/${enc(value)}`;
  const subChips = subs.length > 1 ? `<nav class="tabs subtabs" aria-label="${esc(value)} by form">
      <a class="tab" href="${base}"${sub ? "" : ' aria-current="page"'}>All <small>${all.length}</small></a>
      ${subs.map(([v, n]) => `<a class="tab" href="${base}/${enc(v)}"${v === sub ? ' aria-current="page"' : ""}>${esc(v)} <small>${n}</small></a>`).join("")}
    </nav>` : "";
  const c = kind === "composer" ? META.composers.find((x) => x.n === value) : null;
  view.innerHTML = `<p class="crumb"><a href="#/browse/${kind}">${KINDS[kind].label}</a>${sub ? ` › <a href="${base}">${esc(value)}</a>` : ""}</p>
    <div class="list-head"><h1>${esc(sub ? `${value}: ${sub}` : value)}</h1>
    <span class="n">${c ? `${esc(c.y)} · ${esc(c.p)} · ` : ""}${plural(list.length, "work")}</span>
    ${kind === "mood" ? `<span class="hint">${esc(META.moods[value] || "")}</span>` : ""}
    ${playable ? `<button class="btn small primary" type="button" id="play-list">▶ Play ${esc(value)} in jukebox</button>` : ""}</div>
    ${subChips}`;
  view.append(workList(list, { recFirst: kind !== "composer" }));
  if (playable) $("#play-list").onclick = () => playFiltered(kind, value);
}

function groupCounts(list, keyFn) {
  const m = new Map();
  for (const w of list) { const k = keyFn(w); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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

function renderWork(id) {
  const w = BY_ID.get(id);
  if (!w) { view.innerHTML = `<p>Work not found. <a href="#/">Back to Listen</a></p>`; return; }
  const c = composerOf(w);
  const chip = (kind, v) => `<a class="chip" href="#/list/${kind}/${enc(v)}">${esc(v)}</a>`;
  const facts = [
    ["Composer", `<a href="#/list/composer/${enc(c.n)}">${esc(c.n)}</a> <span class="hint">${esc(c.y)}</span>`],
    ["Catalogue", w.cat && esc(w.cat)],
    ["Key", w.key && chip("key", w.key)],
    ["Year", w.y && esc(w.y)],
    ["Period", chip("period", c.p)],
    ["Form", chip("form", cap(w.fm)) + (w.o ? ` <span class="hint">piano and orchestra</span>` : "")],
    ["Set", w.set && esc(w.set)],
    ["Mood", w.moods && w.moods.length && `<span class="chips">${w.moods.map((m) => chip("mood", m)).join("")}</span>`],
    ["Also known as", w.al && esc(w.al.join(" · "))],
  ].filter(([, v]) => v);
  const vids = w.v == null
    ? `<p class="novideo">Recordings for this work haven't been fetched yet. They are added every day${w.pop ? ", well-known works first" : ""}.</p>`
    : !w.v.length ? `<p class="novideo">No recording that clearly matches this work was found on YouTube.</p>`
    : w.v.map((v) => `<figure class="video">
        <div class="frame"><img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy">
          <button class="play" type="button" data-vid="${esc(v.id)}" aria-label="Play ${esc(v.t)}"><span>▶</span></button></div>
        <figcaption>${(v.p || []).length ? `<span class="pianist">${esc(v.p.join(", "))}</span> · ` : ""}${esc(v.t)}<small>${esc(v.ch)} · ${fmtViews(v.views)} views · ${fmtTime(v.sec)}</small></figcaption>
      </figure>`).join("");
  view.innerHTML = `<article class="work">
    <div>
      <p class="crumb"><a href="#/list/composer/${enc(c.n)}">${esc(c.n)}</a>${w.set ? ` › ${esc(w.set)}` : ""}</p>
      <h1>${esc(w.t)}</h1>
      <p class="sub">${esc([w.f, w.cat].filter(Boolean).join(", "))}</p>
      <div class="work-actions">
        <button class="btn small" id="w-like" type="button" aria-pressed="${isLiked(w.id)}">♥ ${isLiked(w.id) ? "Liked" : "Like"}</button>
        <button class="btn small" id="w-never" type="button" aria-pressed="${isNever(w.id)}">${isNever(w.id) ? "Hidden from jukebox" : "Never play in jukebox"}</button>
      </div>
      <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${w.mv ? `<h2 class="small">Movements</h2><ol class="movements">${w.mv.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>` : ""}
      ${w.wp ? `<p class="src">Read more: <a href="${esc(w.wp)}" target="_blank" rel="noopener">Wikipedia</a></p>` : ""}
    </div>
    <section class="videos" aria-label="Recordings"><h2>Recordings</h2>${vids}</section>
  </article>
  <section class="section related" aria-labelledby="h-related">
    <div class="section-head"><h2 id="h-related">More like this</h2>
      ${(w.moods || []).length ? `<button class="btn small primary" type="button" id="play-like">▶ Play works like this</button>` : ""}</div>
    <p class="hint">Works that share this one's mood, set, form or composer.</p>
    <div id="related"></div>
  </section>`;
  const rel = relatedWorks(w);
  if (rel.length) $("#related").append(workList(rel, { limit: 8, toggle: false }));
  else $(".related").hidden = true;
  const likeBtn = $("#play-like");
  if (likeBtn) {
    const n = jb.countFor({ moods: w.moods });
    likeBtn.disabled = !n;
    likeBtn.title = n ? `${plural(n, "work")} with recordings share its mood` : "No works with recordings share its mood yet";
    likeBtn.onclick = () => { jb.setFilters({ moods: w.moods }); location.hash = "#/jukebox"; jb.start(); };
  }
  $$("[data-vid]", view).forEach((b) => b.onclick = () => {
    jb.pause();
    const f = document.createElement("iframe");
    f.src = `https://www.youtube-nocookie.com/embed/${b.dataset.vid}?autoplay=1&rel=0`;
    f.allow = "autoplay; encrypted-media; picture-in-picture"; f.allowFullscreen = true; f.title = "YouTube video";
    b.parentElement.replaceChildren(f);
  });
  $("#w-like").onclick = () => { toggle("likes", w.id, !isLiked(w.id)); renderWork(id); jb.prefsChanged(); };
  $("#w-never").onclick = () => { toggle("never", w.id, !isNever(w.id)); renderWork(id); jb.prefsChanged(); };
}

function sessionGet(k) { try { return sessionStorage.getItem("piano." + k) || ""; } catch { return ""; } }
function sessionSet(k, v) { try { sessionStorage.setItem("piano." + k, v); } catch { /* ignore */ } }

/* ---------------- jukebox ---------------- */
const jb = (() => {
  const F = prefs.filters;
  let player = null, apiLoading = null, current = null, upNext = null, errors = 0, popularOnly = false;
  const history = [];
  const ARR = { moods: "moods", periods: "periods", kinds: "kinds" };
  const KIND_LABEL = { solo: "Solo piano", orch: "Piano and orchestra" };
  const LENGTHS = [[0, "Any length"], [10, "Under 10 minutes"], [20, "Under 20 minutes"], [40, "Under 40 minutes"]];

  const fitVideos = (w, f) => w.v.filter((v) => !f.maxMin || v.sec <= f.maxMin * 60);
  function matches(w, f) {
    return hasRec(w) && !isNever(w.id)
      && (!popularOnly || w.pop)
      && (!f.likedOnly || isLiked(w.id))
      && (!f.moods.length || (w.moods || []).some((m) => f.moods.includes(m)))
      && (!f.periods.length || f.periods.includes(composerOf(w).p))
      && (!f.kinds.length || f.kinds.includes(w.o ? "orch" : "solo"))
      && (!f.composer || composerOf(w).n === f.composer)
      && (!f.pianist || w.v.some((v) => (v.p || []).includes(f.pianist)))
      && fitVideos(w, f).length > 0;
  }
  const pool = (f = F) => WORKS.filter((w) => matches(w, f));

  // Liked works are 4x as likely; recently played works sit out until the pool cycles.
  function pickWork(exclude = []) {
    const p = pool();
    if (!p.length) return null;
    const avoid = new Set(prefs.recent.slice(-Math.min(40, Math.floor(p.length / 2))).concat(exclude));
    const cands = p.filter((w) => !avoid.has(w.id));
    const list = cands.length ? cands : p.filter((w) => !exclude.includes(w.id)).length ? p.filter((w) => !exclude.includes(w.id)) : p;
    const wt = list.map((w) => (isLiked(w.id) ? 4 : 1));
    let r = Math.random() * wt.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) if ((r -= wt[i]) <= 0) return list[i];
    return list[list.length - 1];
  }
  // Prefer the chosen pianist; otherwise favour popular recordings (weight ~ sqrt(views)).
  function pickVideo(w) {
    let vids = fitVideos(w, F);
    if (F.pianist) vids = vids.filter((v) => (v.p || []).includes(F.pianist));
    if (!vids.length) vids = fitVideos(w, F).length ? fitVideos(w, F) : w.v;
    const wt = vids.map((v) => Math.sqrt(v.views + 1));
    let r = Math.random() * wt.reduce((a, b) => a + b, 0);
    for (let i = 0; i < vids.length; i++) if ((r -= wt[i]) <= 0) return vids[i];
    return vids[0];
  }
  const label = (w) => `${esc(w.t)} <span class="hint">· ${esc(surname(composerOf(w).n))}</span>`;
  function planNext() {
    const w = pickWork(current ? [current.work.id] : []);
    upNext = w ? { work: w, video: pickVideo(w) } : null;
    $("#jb-next").innerHTML = upNext && current ? `Up next: <a href="#/work/${enc(upNext.work.id)}">${label(upNext.work)}</a>` : "";
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

  async function playItem(item) {
    current = item;
    prefs.recent.push(item.work.id); prefs.recent = prefs.recent.slice(-200); savePrefs();
    showNow(); planNext();
    await loadApi();
    $("#jb-empty").hidden = true;
    if (!player) {
      player = new YT.Player("yt-player", {
        videoId: item.video.id, host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) next();
            if (e.data === YT.PlayerState.PLAYING) errors = 0;
            updateButtons();
          },
          onError: () => { if (++errors < 5) next(); }, // unembeddable or removed video: move on
        },
      });
    } else player.loadVideoById(item.video.id);
    updateButtons();
  }

  function next() {
    if (upNext && !matches(upNext.work, F)) upNext = null;
    const item = upNext || (() => { const w = pickWork(); return w && { work: w, video: pickVideo(w) }; })();
    if (!item) { showEmpty(); return; }
    if (current) history.push(current);
    playItem(item);
  }
  function prev() {
    const item = history.pop();
    if (!item) return;
    const back = current;
    current = null;
    playItem(item); // runs planNext synchronously before its first await
    if (back) {     // after going back, "next" returns to the work we just left
      upNext = back;
      $("#jb-next").innerHTML = `Up next: <a href="#/work/${enc(back.work.id)}">${label(back.work)}</a>`;
    }
  }
  function start() {
    if (current && player) { player.playVideo(); return; }
    next();
  }

  function showEmpty() {
    const n = pool().length;
    $("#jb-empty").hidden = !!current && n > 0;
    $("#jb-empty-msg").textContent = n ? "Press Play for a shuffle of works that match your filters."
      : "No works with recordings match these filters yet. Remove a filter or clear them all.";
    $("#jb-empty-clear").hidden = n > 0;
    updateButtons();
  }

  function showNow() {
    const el = $("#jb-now");
    if (!current) { el.innerHTML = `<p class="hint">Nothing playing yet.</p>`; return; }
    const w = current.work, c = composerOf(w), v = current.video;
    el.innerHTML = `<h2><a href="#/work/${enc(w.id)}">${esc(w.t)}</a></h2>
      <p><a href="#/list/composer/${enc(c.n)}">${esc(c.n)}</a> · ${esc([w.f, w.cat].filter(Boolean).join(", "))}</p>
      <p class="chips">${(w.moods || []).map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</p>
      <p class="hint">${(v.p || []).length ? `<strong>${esc(v.p.join(", "))}</strong> · ` : ""}${esc(v.t)} — ${esc(v.ch)}</p>`;
    $("#jb-movements").innerHTML = w.mv ? `<ol class="movements">${w.mv.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>` : "";
  }

  const playing = () => !!(player && player.getPlayerState && player.getPlayerState() === 1);
  function updateButtons() {
    const on = !!current, n = pool().length;
    $("#jb-skip").disabled = !on || !n; $("#jb-like").disabled = !on; $("#jb-never").disabled = !on;
    $("#jb-prev").disabled = !history.length;
    $("#jb-play").disabled = !on && !n;
    const liked = on && isLiked(current.work.id);
    $("#jb-like").setAttribute("aria-pressed", String(liked));
    $("#jb-like").textContent = liked ? "♥ Liked" : "♥ Like";
    $("#jb-play").textContent = !on ? "▶ Play" : playing() ? "❚❚ Pause" : "▶ Resume";
    updateMini();
  }
  function updateMini() {
    const show = !!current && location.hash.indexOf("#/jukebox") !== 0;
    $("#mini").hidden = !show;
    document.body.classList.toggle("has-mini", show);
    if (!current) return;
    $("#mini-title").textContent = `${current.work.t} · ${surname(composerOf(current.work).n)}`;
    $("#mini-play").textContent = playing() ? "❚❚" : "▶";
    $("#mini-play").setAttribute("aria-label", playing() ? "Pause" : "Play");
    $("#mini-like").setAttribute("aria-pressed", String(isLiked(current.work.id)));
  }

  /* filters */
  function countWith(key, value) {
    const f = { ...F, [key]: ARR[key] ? [value] : value };
    return pool(f).length;
  }
  function pills(key, values, labelFn = (v) => v) {
    return `<div class="pillset">${values.map((v) => `<label><input type="checkbox" name="${key}" value="${esc(v)}"${F[key].includes(v) ? " checked" : ""}><span>${esc(labelFn(v))} <small data-count></small></span></label>`).join("")}</div>`;
  }
  function renderFilters() {
    $("#jb-filters").innerHTML = `
      <fieldset><legend>Mood</legend>${pills("moods", Object.keys(META.moods))}</fieldset>
      <fieldset><legend>Period</legend>${pills("periods", META.periods)}</fieldset>
      <fieldset><legend>Kind</legend>${pills("kinds", ["solo", "orch"], (v) => KIND_LABEL[v])}</fieldset>
      <fieldset><legend>Composer, pianist, length</legend>
        <label class="hint" for="jb-composer">Composer</label><select id="jb-composer"></select>
        <label class="hint" for="jb-pianist">Pianist</label><select id="jb-pianist"></select>
        <label class="hint" for="jb-len">Length</label><select id="jb-len"></select>
        <label class="toggle"><input type="checkbox" id="jb-liked"${F.likedOnly ? " checked" : ""}> Only liked works</label>
      </fieldset>`;
    $("#jb-filters").onchange = (e) => {
      const t = e.target;
      if (ARR[t.name]) F[t.name] = $$(`input[name="${t.name}"]:checked`, $("#jb-filters")).map((x) => x.value);
      else if (t.id === "jb-composer") F.composer = t.value;
      else if (t.id === "jb-pianist") F.pianist = t.value;
      else if (t.id === "jb-len") F.maxMin = Number(t.value);
      else if (t.id === "jb-liked") F.likedOnly = t.checked;
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
    const opts = (sel, key, values, anyLabel, labelFn = (v) => v) => {
      const items = values.map((v) => [v, countWith(key, v)]).filter(([v, n]) => n || v === F[key]);
      sel.innerHTML = `<option value="">${anyLabel}</option>` +
        items.map(([v, n]) => `<option value="${esc(v)}"${v === F[key] ? " selected" : ""}>${esc(labelFn(v))} (${n})</option>`).join("");
    };
    const withRec = WORKS.filter(hasRec);
    opts($("#jb-composer"), "composer", META.composers.map((c) => c.n), "Any composer");
    opts($("#jb-pianist"), "pianist", [...new Set(withRec.flatMap(pianistsOf))].sort(), "Any pianist");
    $("#jb-len").innerHTML = LENGTHS.map(([v, l]) => `<option value="${v}"${v === F.maxMin ? " selected" : ""}>${l}${v ? ` (${countWith("maxMin", v)})` : ""}</option>`).join("");
    $("#jb-liked").checked = F.likedOnly;
    renderFilterBar();
  }
  function renderFilterBar() {
    const n = pool().length;
    $("#jb-count").textContent = `${plural(n, "work")} to play`;
    const chips = [
      ...(popularOnly ? [["popularOnly", "", "Well-known works"]] : []),
      ...F.moods.map((v) => ["moods", v, v]), ...F.periods.map((v) => ["periods", v, v]),
      ...F.kinds.map((v) => ["kinds", v, KIND_LABEL[v]]),
      ...(F.composer ? [["composer", F.composer, F.composer]] : []), ...(F.pianist ? [["pianist", F.pianist, F.pianist]] : []),
      ...(F.maxMin ? [["maxMin", "", `Under ${F.maxMin} min`]] : []),
      ...(F.likedOnly ? [["likedOnly", "", "Liked only"]] : []),
    ];
    $("#jb-active").innerHTML = chips.length
      ? chips.map(([k, v, l]) => `<button class="chip" type="button" data-k="${k}" data-v="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)}</button>`).join("") +
        `<button class="btn small" type="button" id="jb-clear">Clear all</button>`
      : `<span class="hint">All works with recordings</span>`;
    $$("#jb-active [data-k]").forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (ARR[k]) F[k] = F[k].filter((x) => x !== b.dataset.v);
      else if (k === "likedOnly") F.likedOnly = false;
      else if (k === "popularOnly") popularOnly = false;
      else if (k === "maxMin") F.maxMin = 0;
      else F[k] = "";
      filtersChanged();
    });
    const c = $("#jb-clear"); if (c) c.onclick = clearFilters;
  }
  function filtersChanged() {
    savePrefs(); updateCounts(); planNext();
    if (!current) showEmpty(); else updateButtons();
  }
  function clearFilters() { popularOnly = false; Object.assign(F, EMPTY_FILTERS()); filtersChanged(); }
  function setFilter(kind, value) {
    popularOnly = kind === "popular";
    const key = { mood: "moods", period: "periods" }[kind];
    const f = key ? { [key]: [value] } : kind === "composer" ? { composer: value } : kind === "pianist" ? { pianist: value } : {};
    Object.assign(F, EMPTY_FILTERS(), f);
    filtersChanged();
  }
  // Replace all filters with the given ones (unspecified ones are cleared).
  function setFilters(f) {
    popularOnly = false;
    Object.assign(F, EMPTY_FILTERS(), f);
    filtersChanged();
  }
  const countFor = (f) => pool({ ...EMPTY_FILTERS(), ...f }).length;

  function prefsChanged() {
    const row = (id, list) => {
      const w = BY_ID.get(id); if (!w) return "";
      return `<li><a href="#/work/${enc(id)}">${label(w)}</a><button class="btn small" type="button" data-un="${list}" data-id="${esc(id)}">Remove</button></li>`;
    };
    $("#jb-prefs").innerHTML = `<summary>Your liked works (${prefs.likes.length}) and hidden works (${prefs.never.length})</summary>
      <h3 class="hint">Liked: these come up 4× as often</h3><ul>${prefs.likes.map((id) => row(id, "likes")).join("") || "<li class='hint'>None yet. Press ♥ Like while a work plays.</li>"}</ul>
      <h3 class="hint">Never play</h3><ul>${prefs.never.map((id) => row(id, "never")).join("") || "<li class='hint'>None</li>"}</ul>
      <p class="hint">Saved in this browser only.</p>`;
    $$("#jb-prefs [data-un]").forEach((b) => b.onclick = () => { toggle(b.dataset.un, b.dataset.id, false); prefsChanged(); });
    if (WORKS.length) { updateCounts(); updateButtons(); }
  }

  function togglePlay() { if (!current || !player) return next(); playing() ? player.pauseVideo() : player.playVideo(); }
  function likeCurrent() { if (!current) return; toggle("likes", current.work.id, !isLiked(current.work.id)); prefsChanged(); }

  function init() {
    renderFilters(); prefsChanged(); showEmpty();
    $("#jb-play").onclick = togglePlay;
    $("#jb-skip").onclick = next;
    $("#jb-prev").onclick = prev;
    $("#jb-like").onclick = likeCurrent;
    $("#jb-never").onclick = () => { toggle("never", current.work.id, true); prefsChanged(); next(); };
    $("#jb-empty-clear").onclick = clearFilters;
    $("#jb-edit").onclick = () => {
      const open = $("#jb-filters").hidden;
      $("#jb-filters").hidden = !open;
      $("#jb-edit").setAttribute("aria-expanded", String(open));
      $("#jb-edit").textContent = open ? "Done" : "Edit filters";
    };
    $("#mini-play").onclick = togglePlay;
    $("#mini-skip").onclick = next;
    $("#mini-like").onclick = likeCurrent;
  }

  return { init, start, setFilter, setFilters, countFor, prefsChanged, updateMini, pause: () => { try { player && player.pauseVideo(); } catch { /* not ready */ } } };
})();

function playFiltered(kind, value) {
  jb.setFilter(kind, value);
  location.hash = "#/jukebox";
  jb.start();
}

/* ---------------- router ---------------- */
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const page = parts[0] || "home";
  const isJb = page === "jukebox";
  $("#jukebox").classList.toggle("offstage", !isJb);
  $("#jukebox").setAttribute("aria-hidden", String(!isJb));
  view.hidden = isJb;
  $$("[data-nav]").forEach((a) => a.removeAttribute("aria-current"));
  const nav = { home: "home", work: "home", browse: "browse", list: "browse", jukebox: "jukebox" }[page];
  const navEl = $(`[data-nav="${nav}"]`); if (navEl) navEl.setAttribute("aria-current", "page");
  jb.updateMini();
  if (isJb) { window.scrollTo(0, 0); return; }
  if (page === "work") renderWork(parts[1]);
  else if (page === "browse") renderBrowse(parts[1]);
  else if (page === "list" && parts[1] === "composer") renderList("composer", parts[2], parts[3] || "");
  else if (page === "list") renderList(parts[1], parts.slice(2).join("/"));
  else renderHome();
  if (page !== "home") { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
}

fetch("works.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => {
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
  jb.init();
  window.addEventListener("hashchange", route);
  route();
}).catch((e) => {
  view.innerHTML = `<p>Couldn't load works.json (${esc(e.message)}). Serve this folder over HTTP, e.g. <code>python3 -m http.server</code> inside <code>docs/</code>.</p>`;
});
