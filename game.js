/* NAMEDROP: game logic. Plain JS, no build step. */
(() => {
  "use strict";

  /* ---------------- Card bank ---------------- */
  const CATS = Object.entries(window.BANK).map(([id, c]) => ({
    id, label: c.label, emoji: c.emoji, lang: c.lang || "en", extraOnly: !!c.extraOnly,
    cards: c.items.split("\n").map(s => s.trim()).filter(Boolean).map((line, i) => {
      const [name, clue = "", pts = "2", roman = ""] = line.split("|").map(s => s.trim());
      return { id: `${id}:${i}`, name, clue, roman, lang: c.lang || "en", pts: Math.min(4, Math.max(1, +pts || 2)), cat: id };
    })
  }));
  const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
  const TOTAL = CATS.reduce((n, c) => n + c.cards.length, 0);

  const ROUNDS = [
    { key: "say", name: "Say Anything", short: "Say anything", rule: "Use any words you want, just not the name itself.", big: "Say<br><em>anything</em>" },
    { key: "one", name: "One Word", short: "One word", rule: "Exactly one word per card. Make it count.", big: "One<br><em>word</em>" },
    { key: "act", name: "Act It Out", short: "Charades", rule: "No words at all. Sound effects are fair game.", big: "Act it<br><em>out</em>" },
    { key: "snd", name: "Sound Only", short: "Sounds only", rule: "Guessers close their eyes. Noises only, no words.", big: "Sound<br><em>only</em>" },
  ];
  const TEAM_COLORS = ["var(--team0)", "var(--team1)", "var(--team2)", "var(--team3)"];
  const TEAM_NAMES = ["The Headliners", "Night Owls", "Main Stage", "Glow Sticks", "Encore", "Backstage Pass", "Ferris Wheelers", "Lantern Gang", "Tilt-a-Whirls", "Cotton Candy"];

  /* ---------------- Storage (best effort) ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("namedrop:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("namedrop:" + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem("namedrop:" + k); } catch {} },
  };

  /* ---------------- State ---------------- */
  const defaults = {
    teams: ["Team 1", "Team 2"],
    deckSize: 40, turnTime: 60,
    cats: CATS.filter(c => c.lang === "en" && !c.extraOnly).map(c => c.id),   // language packs start off
    diff: "mix",
    rounds: [true, true, true, false],
    skipPenalty: false,
    draft: false, players: 6,
    charadesCam: true,
    custom: "",
    sound: true,
  };
  let S = Object.assign({}, defaults, store.get("settings", {}));
  // older versions used fun default team names; switch those to plain "Team N"
  S.teams = S.teams.map((t, i) => TEAM_NAMES.includes(t) ? `Team ${i + 1}` : t);
  let G = store.get("game", null);   // persisted game
  let T = null;                       // live turn (not persisted)

  const $app = document.getElementById("app");
  const $chip = document.getElementById("roundChip");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const saveS = () => store.set("settings", S);
  const saveG = () => G ? store.set("game", G) : store.del("game");
  const sky = v => document.body.dataset.sky = v;

  /* ---------------- Sound ---------------- */
  let ac;
  function beep(freq = 660, dur = .09, type = "sine", vol = .14, when = 0) {
    if (!S.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
    } catch {}
  }
  const sfx = {
    got: () => { beep(784, .08, "triangle"); beep(1175, .12, "triangle", .12, .07); },
    skip: () => beep(260, .12, "sawtooth", .06),
    tick: () => beep(1400, .04, "square", .05),
    buzz: () => { beep(180, .5, "sawtooth", .12); beep(140, .5, "square", .06); },
    start: () => [523, 659, 784].forEach((f, i) => beep(f, .12, "triangle", .12, i * .09)),
    win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => beep(f, .16, "triangle", .13, i * .12)),
  };
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  const soundBtn = document.getElementById("soundBtn");
  const paintSound = () => soundBtn.textContent = S.sound ? "🔊" : "🔇";
  soundBtn.onclick = () => { S.sound = !S.sound; saveS(); paintSound(); if (S.sound) sfx.got(); };
  paintSound();
  document.getElementById("rulesBtn").onclick = () => document.getElementById("rules").showModal();
  document.getElementById("homeBtn").onclick = () => { if (T) return; title(); };

  function toast(msg) {
    const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
    document.body.appendChild(el); setTimeout(() => el.remove(), 2500);
  }

  /* ---------------- Scene dressing ---------------- */
  (function dressScene() {
    const st = document.getElementById("stars");
    let h = "";
    for (let i = 0; i < 90; i++) {
      const s = Math.random() < .12 ? 3 : 2;
      h += `<i style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${s}px;height:${s}px;--d:${2 + Math.random() * 4}s;animation-delay:${-Math.random() * 5}s"></i>`;
    }
    st.innerHTML = h;
    const ln = document.getElementById("lanterns");
    h = "";
    for (let i = 0; i < 14; i++) {
      h += `<div class="lantern" style="left:${4 + Math.random() * 92}%;--s:${8 + Math.random() * 14}px;--t:${18 + Math.random() * 20}s;--delay:${-Math.random() * 30}s;--drift:${(Math.random() * 80 - 40) | 0}px"></div>`;
    }
    ln.innerHTML = h;
    // bulbs along the light string
    const svg = document.querySelector(".lights");
    const path = svg.querySelector(".string");
    const len = path.getTotalLength();
    const cols = ["#FFD27A", "#FF8A5C", "#7FC3FF", "#9BF0C2", "#FF9AD0"];
    for (let i = 1; i < 30; i++) {
      const p = path.getPointAtLength(len * i / 30);
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", p.x); c.setAttribute("cy", p.y + 3); c.setAttribute("r", 3.2);
      c.setAttribute("fill", cols[i % cols.length]);
      c.style.filter = `drop-shadow(0 0 5px ${cols[i % cols.length]})`;
      c.style.animation = `twinkle ${1.5 + Math.random() * 2}s ease-in-out ${-Math.random() * 3}s infinite alternate`;
      svg.appendChild(c);
    }
  })();

  /* ---------------- Helpers ---------------- */
  const activeRounds = () => G.rounds.map(i => ROUNDS[i]);
  const team = i => G.teams[i];
  const teamColor = i => TEAM_COLORS[i % TEAM_COLORS.length];
  const cardById = id => G.deck.find(c => c.id === id);
  const setChip = txt => { $chip.hidden = !txt; $chip.textContent = txt || ""; };
  const $score = document.getElementById("scorebar");
  function showScore(activeTeam = -1, live = 0) {
    if (!G) return hideScore();
    $score.innerHTML = G.teams.map((t, i) => `<div class="sb-team ${i === activeTeam ? "on" : ""}" style="--team-c:${teamColor(i)}">
      <i></i><span class="sb-name">${esc(t.name)}</span><b>${t.score}</b>${i === activeTeam && live ? `<em>${live > 0 ? "+" : ""}${live}</em>` : ""}</div>`).join("");
    $score.hidden = false; document.body.classList.add("has-score");
  }
  function hideScore() { $score.hidden = true; document.body.classList.remove("has-score"); }
  function render(html, cls = "") {
    document.body.dataset.screen = "";
    hideScore();
    $app.innerHTML = `<section class="screen ${cls}">${html}</section>`;
    window.scrollTo(0, 0);
    return $app.firstElementChild;
  }
  const ticketHTML = (c, extra = "") => {
    const cat = CAT[c.cat];
    const hi = c.lang === "hi";
    return `<div class="ticket ${extra} ${hi ? "lang-hi" : ""}" ${hi ? 'lang="hi"' : ""}>
      <div class="t-top"><span class="t-cat">${cat ? cat.emoji + " " + esc(cat.label) : "✍️ House Card"}</span>
        <span class="t-pts" data-p="${c.pts}">${c.pts}<small>PT${c.pts > 1 ? "S" : ""}</small></span></div>
      <div class="t-name ${c.name.length > 18 ? "long" : ""}">${esc(c.name)}</div>
      ${c.roman ? `<div class="t-roman ${c.name.length > 18 || c.roman.length > 18 ? "long" : ""}" lang="en">${esc(c.roman)}</div>` : ""}
      <div class="t-clue ${c.clue.length > 90 ? "long-clue" : ""}">${c.clue ? esc(c.clue) : "&nbsp;"}</div>
      <div class="t-foot"><span>Namedrop</span><span>№ ${String(G ? G.deck.indexOf(c) + 1 : 0).padStart(3, "0")}</span></div>
    </div>`;
  };

  // Hindi cards carry a second big line (the English spelling), so pin the tear line
  // and side notches halfway into the gap above the clue instead of at a fixed 62%.
  function placePerf(tk) {
    if (!tk || !tk.classList.contains("lang-hi")) return;
    const roman = tk.querySelector(".t-roman"), clue = tk.querySelector(".t-clue");
    if (!roman || !clue) return;
    const y = (roman.offsetTop + roman.offsetHeight + clue.offsetTop) / 2;
    tk.style.setProperty("--perf", Math.round(y) + "px");
  }
  addEventListener("resize", () => placePerf(document.querySelector("#stage .ticket")));
  document.fonts && document.fonts.ready.then(() => placePerf(document.querySelector("#stage .ticket")));

  /* ---------------- Deck building ---------------- */
  const chosenCards = () => CATS.filter(c => S.cats.includes(c.id) && !c.extraOnly).flatMap(c => c.cards);
  const deepCards = () => CATS.filter(c => c.extraOnly).flatMap(c => c.cards);
  // Share of each deck that comes from Deep Cuts, by difficulty
  const DEEP_SHARE = { easy: .05, mix: .15, hard: .3, extra: .7 };
  const DIFF_LABEL = { easy: "Chill", mix: "Mixed", hard: "Hard", extra: "Extra Hard" };
  function mainPool() {
    let p = chosenCards();
    if (S.diff === "easy") p = p.filter(c => c.pts <= 2);
    if (S.diff === "hard") p = p.filter(c => c.pts >= 2);
    if (S.diff === "extra") p = p.filter(c => c.pts >= 3);
    return p;
  }
  const pool = () => mainPool().concat(deepCards());

  // How many times each card has been dealt on this device, so we can deal the least-played first
  const seenMap = () => store.get("seen", null) || Object.fromEntries(store.get("recent", []).map(id => [id, 1]));
  const unseenCount = () => { const s = seenMap(); return CATS.reduce((n, c) => n + c.cards.filter(x => !s[x.id]).length, 0); };
  function customCards() {
    return S.custom.split("\n").map(s => s.trim()).filter(Boolean).map((line, i) => {
      const [name, clue = "", pts = "2"] = line.split("|").map(s => s.trim());
      return { id: "custom:" + i, name, clue, pts: Math.min(4, Math.max(1, +pts || 2)), cat: "custom" };
    });
  }
  // Pick `need` cards, least-played first, with the Deep Cuts share for this difficulty
  function pickFresh(need) {
    const seen = seenMap();
    // random order among cards played the same number of times
    const freshFirst = list => shuffle(list.slice()).sort((a, b) => (seen[a.id] || 0) - (seen[b.id] || 0));
    const main = freshFirst(mainPool()), deep = freshFirst(deepCards());
    let nDeep = Math.min(deep.length, Math.round(need * DEEP_SHARE[S.diff]));
    let picked = deep.slice(0, nDeep).concat(main.slice(0, need - nDeep));
    if (picked.length < need) picked = picked.concat(deep.slice(nDeep, nDeep + need - picked.length));
    return shuffle(picked);
  }
  function markSeen(cards) {
    const seen = seenMap();
    cards.forEach(c => { seen[c.id] = (seen[c.id] || 0) + 1; });
    store.set("seen", seen); store.del("recent");
  }
  function buildDeck() {
    const custom = customCards();
    const deck = shuffle(custom.concat(pickFresh(Math.max(0, S.deckSize - custom.length))));
    markSeen(deck);
    return deck;
  }
  // Drafting: each player is dealt `deal` cards in secret and keeps `keep`
  const draftPlan = () => {
    const keep = Math.min(8, Math.max(3, Math.round(S.deckSize / S.players)));
    return { keep, deal: keep + 3, size: keep * S.players };
  }

  /* =========================================================
     SCREENS
     ========================================================= */

  function title() {
    T = null; sky(0); setChip("");
    render(`
      <div class="hero">
        <div class="kicker">A party game for loud rooms</div>
        <h1 class="logo">Name<span>drop</span></h1>
        <p class="tag">Say it. Shrink it. Act it out.</p>
        <div class="stack">
          ${G && !G.over ? `<button class="btn btn-primary btn-block" id="resume">Resume game <small>${G.draft ? "DRAFT" : "ROUND " + (G.r + 1)}</small></button>
            <button class="btn btn-ghost btn-block" id="new">New game</button>`
          : `<button class="btn btn-primary btn-block" id="new">New game</button>`}
        </div>
        <div class="stat-row">
          <div class="stat"><b>${TOTAL.toLocaleString()}</b><span>cards</span></div>
          <div class="stat"><b>${CATS.length}</b><span>categories</span></div>
          <div class="stat"><b>${unseenCount().toLocaleString()}</b><span>not played yet</span></div>
        </div>
        <button class="linkbtn" id="how">How to play</button>
      </div>`);
    const r = document.getElementById("resume");
    if (r) r.onclick = resume;
    document.getElementById("new").onclick = setup;
    document.body.dataset.screen = "title";
    document.getElementById("how").onclick = () => document.getElementById("rules").showModal();
  }

  function setup() {
    sky(0); setChip("Setup");
    const seg = (key, opts, fmt = v => v) => `<div class="seg" data-key="${key}">${opts.map(v =>
      `<button type="button" data-v="${v}" aria-pressed="${S[key] == v}">${fmt(v)}</button>`).join("")}</div>`;

    const el = render(`
      <div class="panel">
        <div class="kicker">Set up</div>
        <h2 class="display">Who's <em>playing?</em></h2>
        <div class="field">
          <div class="label"><span>Teams</span><em>${S.teams.length} of 4</em></div>
          <div class="teams" id="teams"></div>
          ${S.teams.length < 4 ? `<button class="linkbtn" id="addTeam" style="margin-top:6px">+ Add a team</button>` : ""}
        </div>
      </div>

      <div class="panel">
        <div class="field" style="margin-top:0">
          <div class="label"><span>Deck size</span><em>${S.draft ? `about ${draftPlan().size}` : S.deckSize} cards</em></div>
          ${seg("deckSize", [20, 30, 40, 50, 60])}
        </div>
        <div class="field">
          <button type="button" class="toggle" id="draft" aria-pressed="${S.draft}">
            <span><b>Draft the deck</b><br><span class="fine">Everyone secretly picks their own cards, so nobody sees the whole deck.</span></span><span class="sw"></span></button>
          ${S.draft ? `<div class="draft-opts">
            <div class="label"><span>Players</span><em>${S.players}</em></div>
            <div class="stepper"><button type="button" data-d="-1" aria-label="Fewer players">−</button><b>${S.players}</b><button type="button" data-d="1" aria-label="More players">+</button></div>
            <p class="fine">Each player gets <b>${draftPlan().deal}</b> cards and keeps <b>${draftPlan().keep}</b>. Deck: <b>${draftPlan().size + customCards().length}</b> cards${customCards().length ? ` (${customCards().length} custom)` : ""}.</p>
          </div>` : ""}
        </div>
        <div class="field">
          <div class="label"><span>Turn timer</span><em>${S.turnTime}s</em></div>
          ${seg("turnTime", [30, 45, 60, 75, 90], v => v + "s")}
        </div>
        <div class="field">
          <div class="label"><span>Difficulty</span></div>
          ${seg("diff", ["easy", "mix", "hard", "extra"], v => ({ easy: "Chill", mix: "Mixed", hard: "Hard", extra: "Extra Hard" })[v])}
          <p class="fine extra-note ${S.diff === "extra" ? "hot" : ""}">🌶️ About <b>${Math.round((S.draft ? draftPlan().size : S.deckSize) * DEEP_SHARE[S.diff])} of ${S.draft ? draftPlan().size : S.deckSize}</b> cards will be <b>Deep Cuts</b>: obscure people, weird history and strange ideas. Their clues explain what they are, so it's fine to read them out loud.</p>
        </div>
      </div>

      <div class="panel">
        <div class="label"><span>Card packs</span><em id="poolCount"></em></div>
        <div class="cats" id="cats"></div>
      </div>

      <div class="panel">
        <div class="label"><span>Rounds</span></div>
        <div class="rounds-pick" id="rounds"></div>
        <button type="button" class="toggle" id="cam" aria-pressed="${S.charadesCam}" style="margin-top:10px">
          <span><b>📸 Charades cam</b><br><span class="fine">During Act It Out, the front camera snaps a couple of surprise photos of whoever's acting. You'll see them after the turn. Photos stay on this phone.</span></span><span class="sw"></span></button>
      </div>

      <div class="panel">
        <details class="more">
          <summary>House rules & custom cards</summary>
          <button type="button" class="toggle" id="penalty" aria-pressed="${S.skipPenalty}">
            <span>Skipping costs 1 point</span><span class="sw"></span></button>
          <div class="field">
            <div class="label"><span>Add your own cards</span><em>${customCards().length || ""}</em></div>
            <textarea class="custom" id="custom" placeholder="One per line. Optional clue and points:&#10;Mr. Henderson | our chem teacher, says 'folks' | 2&#10;Grandma's meatloaf">${esc(S.custom)}</textarea>
            <p class="fine">Custom cards are always shuffled into the deck.</p>
          </div>
        </details>
      </div>

      <div style="margin-top:16px" class="stack">
        <button class="btn btn-primary btn-block" id="go">Deal the deck</button>
        <button class="linkbtn" id="back" style="display:block;margin:0 auto">Back</button>
      </div>`);

    // teams
    const $teams = el.querySelector("#teams");
    $teams.innerHTML = S.teams.map((t, i) => `
      <div class="team-input"><span class="dot" style="background:${teamColor(i)};color:${teamColor(i)}"></span>
        <input value="${esc(t)}" maxlength="22" data-i="${i}" aria-label="Team ${i + 1} name">
        ${S.teams.length > 2 ? `<button type="button" data-rm="${i}" title="Remove team" aria-label="Remove team">✕</button>` : ""}
      </div>`).join("");
    $teams.oninput = e => { if (e.target.dataset.i != null) { S.teams[+e.target.dataset.i] = e.target.value; saveS(); } };
    $teams.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.rm != null) { S.teams.splice(+b.dataset.rm, 1); saveS(); setup(); }
    };
    const add = el.querySelector("#addTeam");
    if (add) add.onclick = () => { S.teams.push(`Team ${S.teams.length + 1}`); saveS(); setup(); };

    // segmented controls
    el.querySelectorAll(".seg").forEach(sg => sg.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      const k = sg.dataset.key; S[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; saveS(); setup();
    });

    // categories
    const $cats = el.querySelector("#cats");
    const paintCats = () => {
      $cats.innerHTML = CATS.filter(c => !c.extraOnly).map(c => `<button type="button" class="cat" data-c="${c.id}" aria-pressed="${S.cats.includes(c.id)}">
        <span class="em">${c.emoji}</span><span><b>${esc(c.label)}</b><small>${c.cards.length} cards</small></span></button>`).join("");
      el.querySelector("#poolCount").textContent = pool().length.toLocaleString() + " in play";
    };
    $cats.onclick = e => {
      const b = e.target.closest(".cat"); if (!b) return;
      const id = b.dataset.c;
      S.cats = S.cats.includes(id) ? S.cats.filter(x => x !== id) : S.cats.concat(id);
      saveS(); paintCats();
    };
    paintCats();

    // rounds
    const $r = el.querySelector("#rounds");
    const paintRounds = () => $r.innerHTML = ROUNDS.map((r, i) => `<button type="button" class="rpick" data-r="${i}" aria-pressed="${S.rounds[i]}">
      <span class="n">${i + 1}</span><span><b>${r.name}</b><br><span class="fine">${r.rule}</span></span><span class="chk">${S.rounds[i] ? "✓" : ""}</span></button>`).join("");
    $r.onclick = e => {
      const b = e.target.closest(".rpick"); if (!b) return;
      const i = +b.dataset.r; S.rounds[i] = !S.rounds[i];
      if (!S.rounds.some(Boolean)) S.rounds[i] = true;
      saveS(); paintRounds();
    };
    paintRounds();

    el.querySelector("#draft").onclick = () => { S.draft = !S.draft; saveS(); setup(); };
    const $step = el.querySelector(".stepper");
    if ($step) $step.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      S.players = Math.min(16, Math.max(3, S.players + +b.dataset.d)); saveS(); setup();
    };
    el.querySelector("#cam").onclick = e => { S.charadesCam = !S.charadesCam; e.currentTarget.setAttribute("aria-pressed", S.charadesCam); saveS(); };
    el.querySelector("#penalty").onclick = e => { S.skipPenalty = !S.skipPenalty; e.currentTarget.setAttribute("aria-pressed", S.skipPenalty); saveS(); };
    el.querySelector("#custom").oninput = e => { S.custom = e.target.value; saveS(); };
    el.querySelector("#back").onclick = title;
    el.querySelector("#go").onclick = () => {
      S.teams = S.teams.map((t, i) => t.trim() || `Team ${i + 1}`);
      const need = S.draft ? S.players * draftPlan().deal : S.deckSize - customCards().length;
      if (pool().length < need) { toast(`Pick more packs. Only ${pool().length} cards available.`); return; }
      saveS(); startGame();
    };
  }

  function startGame() {
    let draft = null;
    if (S.draft) {
      const { keep, deal } = draftPlan();
      const cards = pickFresh(S.players * deal);
      draft = { keep, p: 0, hands: Array.from({ length: S.players }, (_, i) => cards.slice(i * deal, (i + 1) * deal)), kept: customCards() };
    }
    G = {
      teams: S.teams.map(name => ({ name, score: 0, rounds: [] })),
      deck: draft ? [] : buildDeck(), draft,
      rounds: S.rounds.map((on, i) => on ? i : -1).filter(i => i >= 0),
      turnTime: S.turnTime, skipPenalty: S.skipPenalty, cam: S.charadesCam,
      r: 0, pile: [], turn: 0, carry: 0, carryTeam: -1,
      log: [],          // {r, team, id, ms}  every card that counted
      skips: [],        // {r, team, id, ms}  every skip, with time spent before skipping
      fouls: [],        // {r, team, id}      cards tapped off in review
      turns: [],        // {r, team, secs, pts, got, skipped, cleared}
      over: false, started: Date.now(),
    };
    G.pile = shuffle(G.deck.map(c => c.id));
    store.del("photos");
    saveG();
    draft ? draftPass() : peekChoice();
  }

  /* ---------------- Draft ---------------- */
  function draftPass() {
    const d = G.draft, n = d.hands.length;
    sky(0); setChip(`Draft · ${d.p + 1}/${n}`);
    const el = render(`
      <div class="panel" style="text-align:center">
        <div class="kicker">The draft · player ${d.p + 1} of ${n}</div>
        <h2 class="display">Pass to <em>player ${d.p + 1}.</em></h2>
        <p class="lede">${d.p === 0 ? "Everyone takes a secret turn picking cards. Only look at your own hand, then pass the phone on." : "Don't peek at anyone else's hand. Hand the phone over, then tap below."}</p>
        <div class="draft-dots">${d.hands.map((_, i) => `<i class="${i < d.p ? "done" : i === d.p ? "on" : ""}"></i>`).join("")}</div>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary btn-block" id="go">I'm player ${d.p + 1}, show my cards</button>
        <button class="linkbtn" id="quit" style="display:block;margin:0 auto">Cancel game</button>
      </div>`);
    el.querySelector("#go").onclick = draftPick;
    el.querySelector("#quit").onclick = () => { if (confirm("Cancel this game?")) { G = null; saveG(); title(); } };
  }

  function draftPick() {
    const d = G.draft, hand = d.hands[d.p], n = d.hands.length;
    const picked = new Set();
    setChip(`Draft · ${d.p + 1}/${n}`);
    const el = render(`
      <div class="panel">
        <div class="kicker">Player ${d.p + 1} · your hand</div>
        <h2 class="display">Keep <em>${d.keep}.</em></h2>
        <p class="lede">Pick the ${d.keep} you want in the deck. The rest get thrown out, and nobody else will see them.</p>
        <div class="draft" id="hand"></div>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary btn-block" id="keep" disabled>Pick ${d.keep} more</button>
      </div>`, "wide");
    const $h = el.querySelector("#hand"), $k = el.querySelector("#keep");
    const paint = () => {
      $h.innerHTML = hand.map((c, i) => `<button type="button" class="dcard ${c.lang === "hi" ? "lang-hi" : ""}" data-i="${i}" aria-pressed="${picked.has(i)}">
        <span class="c"><span>${CAT[c.cat] ? CAT[c.cat].emoji + " " + esc(CAT[c.cat].label) : ""}</span><span>${c.pts}pt</span></span>
        <span class="n">${esc(c.name)}${c.roman ? `<small>${esc(c.roman)}</small>` : ""}</span>
        ${c.clue ? `<span class="cl">${esc(c.clue)}</span>` : ""}<span class="tick">✓</span></button>`).join("");
      const left = d.keep - picked.size;
      $k.disabled = left > 0;
      $k.textContent = left > 0 ? `Pick ${left} more` : `Keep these ${d.keep}`;
    };
    $h.onclick = e => {
      const b = e.target.closest(".dcard"); if (!b) return;
      const i = +b.dataset.i;
      if (picked.has(i)) picked.delete(i);
      else if (picked.size < d.keep) picked.add(i);
      else return toast(`You can only keep ${d.keep}. Tap one to drop it first.`);
      sfx.skip(); paint();
    };
    paint();
    $k.onclick = () => {
      d.kept = d.kept.concat(hand.filter((_, i) => picked.has(i)));
      d.hands[d.p] = []; d.p++;
      if (d.p < n) { saveG(); return draftPass(); }
      G.deck = shuffle(d.kept); G.pile = shuffle(G.deck.map(c => c.id)); G.draft = null;
      markSeen(G.deck); saveG(); draftDone();
    };
  }

  function draftDone() {
    sky(0); setChip(`${G.deck.length} cards drafted`);
    const el = render(`
      <div class="panel" style="text-align:center">
        <div class="kicker">Draft complete</div>
        <h2 class="display">${G.deck.length} cards <em>in the deck.</em></h2>
        <p class="lede">Everyone knows a few of them. Nobody knows them all. Same deck every round, so listen closely.</p>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary btn-block" id="go">Start round 1</button>
      </div>`);
    el.querySelector("#go").onclick = ready;
  }

  function peekChoice() {
    sky(0); setChip(`${G.deck.length} cards dealt`);
    const el = render(`
      <div class="panel" style="text-align:center">
        <div class="kicker">${G.deck.length} cards dealt</div>
        <h2 class="display">Peek at <em>the deck?</em></h2>
        <p class="lede">Looking first makes the game easier, and you can swap out cards you don't like. Skipping keeps every card a surprise.</p>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary btn-block" id="see">See the deck</button>
        <button class="btn btn-ghost btn-block" id="skipPeek">Skip, start round 1</button>
      </div>`);
    el.querySelector("#see").onclick = deckPeek;
    el.querySelector("#skipPeek").onclick = ready;
  }

  function deckPeek() {
    sky(0); setChip(`${G.deck.length} cards dealt`);
    const el = render(`
      <div class="panel">
        <div class="kicker">The deck</div>
        <h2 class="display">Learn <em>these.</em></h2>
        <p class="lede">These ${G.deck.length} names come back every round. Everyone take a look, then hide the screen. Tap any card to swap it for a new one.</p>
        <div class="peek" id="peek"></div>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary btn-block" id="go">Start round 1</button>
      </div>`, "wide");
    const $p = el.querySelector("#peek");
    const paint = () => $p.innerHTML = G.deck.map((c, i) => `<button type="button" class="mini ${c.lang === "hi" ? "lang-hi" : ""}" data-i="${i}">
      <span class="c"><span>${CAT[c.cat] ? CAT[c.cat].emoji : "✍️"}</span><span>${c.pts}pt</span></span>
      <span class="n">${esc(c.name)}${c.roman ? `<small>${esc(c.roman)}</small>` : ""}</span><span class="sw">↻ SWAP</span></button>`).join("");
    $p.onclick = e => {
      const b = e.target.closest(".mini"); if (!b) return;
      const i = +b.dataset.i, old = G.deck[i];
      const inDeck = new Set(G.deck.map(c => c.id));
      const opts = pool().filter(c => !inDeck.has(c.id));
      if (!opts.length) return toast("No more cards in these packs.");
      const nc = opts[Math.random() * opts.length | 0];
      G.deck[i] = nc; G.pile = G.pile.map(id => id === old.id ? nc.id : id);
      saveG(); paint(); sfx.skip();
    };
    paint();
    el.querySelector("#go").onclick = ready;
  }

  function resume() { if (G.over) return final(); if (G.draft) return draftPass(); G.pile.length ? ready() : roundEnd(); }

  /* ---------------- Ready / pass-the-phone ---------------- */
  function ready() {
    T = null;
    const rd = activeRounds()[G.r];
    sky(G.rounds[G.r] % 4);
    setChip(`Round ${G.r + 1}/${G.rounds.length} · ${rd.short}`);
    const ti = G.turn % G.teams.length, t = team(ti);
    const left = G.pile.length, total = G.deck.length;
    const bonus = G.carryTeam === ti && G.carry > 0 ? G.carry : 0;
    const time = bonus || G.turnTime;
    const el = render(`
      <div class="panel" style="--team-c:${teamColor(ti)}">
        <span class="round-badge"><b>${G.r + 1}</b> Round ${G.r + 1} of ${G.rounds.length}</span>
        <div class="big-rule">${rd.big}</div>
        <p class="lede">${rd.rule}</p>
        <div class="passto">
          <div class="avatar">${esc(t.name.trim()[0] || "?").toUpperCase()}</div>
          <div><div class="kicker">Pass the phone to</div><h3>${esc(t.name)}</h3></div>
        </div>
        ${bonus ? `<div class="bonus">⚡ Leftover time from last round: ${bonus}s on the clock</div>` : ""}
        <div class="meter"><div class="bar"><i style="width:${(1 - left / total) * 100}%"></i></div>
          <div class="lbl"><span>${total - left} cleared</span><span>${left} left in pile</span></div></div>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary btn-block" id="go">Start · ${time}s <small>SPACE</small></button>
        <div class="row"><button class="btn btn-ghost" id="scores" style="font-size:1rem">Scores</button>
          <button class="btn btn-ghost" id="quit" style="font-size:1rem">Quit</button></div>
      </div>`);
    showScore(ti);
    el.querySelector("#go").onclick = () => startTurn(ti, time, !!bonus);
    el.querySelector("#scores").onclick = () => scoreSheet();
    el.querySelector("#quit").onclick = () => { if (confirm("End this game? Progress will be lost.")) { G = null; saveG(); title(); } };
  }

  function scoreSheet() {
    const d = document.createElement("dialog"); d.className = "sheet";
    d.innerHTML = `<div class="sheet-head"><div class="kicker">Scoreboard</div><button class="iconbtn" aria-label="Close">✕</button></div>
      <h2 class="display">Standings</h2>${boardHTML()}`;
    document.body.appendChild(d); d.showModal();
    d.querySelector("button").onclick = () => d.close();
    d.onclose = () => d.remove();
  }
  function boardHTML(roundGain) {
    const max = Math.max(1, ...G.teams.map(t => t.score));
    const order = G.teams.map((t, i) => ({ t, i })).sort((a, b) => b.t.score - a.t.score);
    return `<div class="board">${order.map(({ t, i }, k) => `
      <div class="brow ${k === 0 && t.score > 0 ? "lead" : ""}" style="--team-c:${teamColor(i)}">
        <div class="fill" style="width:${t.score / max * 100}%"></div>
        <div class="rank">${k + 1}</div>
        <div class="nm"><i></i><span>${esc(t.name)}</span></div>
        <div class="sc">${roundGain ? `<small>+${roundGain[i] || 0}</small>` : ""}${t.score}</div>
      </div>`).join("")}</div>`;
  }

  /* ---------------- Charades cam ---------------- */
  const photos = () => store.get("photos", []);
  async function camStart() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.srcObject = stream;
      await v.play();
      return { stream, v };
    } catch { return null; }
  }
  function camSnap(cam) {
    const v = cam.v;
    if (!v.videoWidth) return null;
    const w = 360, h = Math.round(w * v.videoHeight / v.videoWidth);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.translate(w, 0); x.scale(-1, 1); x.drawImage(v, 0, 0, w, h);   // mirror, like a selfie
    return c.toDataURL("image/jpeg", .72);
  }
  const camStop = cam => { try { cam && cam.stream.getTracks().forEach(t => t.stop()); } catch {} };
  const photoHTML = (list, title) => list.length ? `
    <div class="kicker" style="margin-top:18px">${title}</div>
    <div class="photos">${list.map((p, i) => { const c = cardById(p.id); return `
      <figure class="polaroid" style="--tilt:${(i % 2 ? 1 : -1) * (1 + (i * 7 % 3))}deg">
        <img src="${p.src}" alt="Photo of ${esc(team(p.team).name)} acting out ${c ? esc(c.name) : "a card"}">
        <figcaption><b>${c ? esc(c.name) : "?"}</b><span>${dot(p.team)}${esc(team(p.team).name)}</span></figcaption>
        <a class="psave" href="${p.src}" download="namedrop-${(c ? c.name : "charades").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jpg" aria-label="Save photo">⤓</a>
      </figure>`; }).join("")}</div>` : "";

  /* ---------------- The turn ---------------- */
  function startTurn(ti, seconds, usedBonus) {
    if (usedBonus) { G.carry = 0; G.carryTeam = -1; }
    T = { ti, total: seconds, left: seconds * 1000, got: [], skipped: 0, skipLog: [], seen: new Set(), paused: false, last: performance.now(), cur: null, cardStart: 0, lastTick: 99 };
    sfx.start(); buzz(40);
    const rd = activeRounds()[G.r];
    T.photos = [];
    if (rd.key === "act" && G.cam) {
      // two surprise snaps at random moments in the turn
      const span = seconds * 1000;
      T.snapAt = [span * (.2 + Math.random() * .25), span * (.55 + Math.random() * .3)];
      const me = T;
      camStart().then(cam => {
        if (T !== me) return camStop(cam);
        me.cam = cam;
        const ind = document.getElementById("camInd");
        if (ind) ind.hidden = !cam;
      });
    }
    const el = render(`
      <div class="hud" style="--team-c:${teamColor(ti)}">
        <div class="timer" id="timer"><svg viewBox="0 0 82 82"><circle class="track" cx="41" cy="41" r="35"/><circle class="bar" id="tbar" cx="41" cy="41" r="35" stroke-dasharray="${2 * Math.PI * 35}" stroke-dashoffset="0"/></svg><div class="num" id="tnum">${seconds}</div></div>
        <div class="who"><div class="kicker">${rd.short}</div><h3>${esc(team(ti).name)}</h3></div>
        <div class="tally"><b id="tgot">0</b><span>pts this turn</span></div>
      </div>
      <div class="card-stage" id="stage"></div>
      <div class="actions">
        <button class="btn btn-skip" id="skip">Skip<small>← / S</small></button>
        <button class="btn btn-got" id="got">Got it<small>SPACE / →</small></button>
      </div>
      <div class="subrow"><span class="pill" id="pileCount"></span><span class="camind" id="camInd" hidden>📸 cam on</span><button class="linkbtn" id="pause">Pause</button></div>`);
    showScore(ti, 0);
    el.querySelector("#got").onclick = gotIt;
    el.querySelector("#skip").onclick = skip;
    el.querySelector("#pause").onclick = pause;
    nextCard(true);
    T.raf = requestAnimationFrame(loop);
  }

  function nextCard(first) {
    if (!G.pile.length) return endTurn("cleared");
    T.cur = G.pile[0];
    T.cardStart = performance.now();
    const c = cardById(T.cur);
    const stage = document.getElementById("stage");
    stage.innerHTML = `<div class="stack-shadow s2"></div><div class="stack-shadow"></div>` + ticketHTML(c, first ? "in" : "in");
    placePerf(stage.querySelector(".ticket"));
    document.getElementById("pileCount").textContent = `${G.pile.length} card${G.pile.length === 1 ? "" : "s"} left in pile`;
  }

  function flyOut(cls, then) {
    const tk = document.querySelector("#stage .ticket");
    if (!tk) return then();
    tk.classList.remove("in"); tk.classList.add(cls);
    setTimeout(then, 170);
  }
  let busy = false;
  function gotIt() {
    if (!T || T.paused || busy || !T.cur) return;
    busy = true;
    const c = cardById(T.cur);
    T.got.push({ id: c.id, ms: performance.now() - T.cardStart, left: T.left, on: true });
    G.pile.shift();
    document.getElementById("tgot").textContent = turnPts(); showScore(T.ti, turnPts());
    sfx.got(); buzz(25);
    flyOut("out-got", () => { busy = false; if (T) nextCard(); });
  }
  function skip() {
    if (!T || T.paused || busy || !T.cur) return;
    if (G.pile.length === 1) return toast("Last card, no skipping!");
    busy = true;
    T.skipped++;
    T.skipLog.push({ id: T.cur, ms: performance.now() - T.cardStart });
    G.pile.push(G.pile.shift());
    document.getElementById("tgot").textContent = turnPts(); showScore(T.ti, turnPts());
    sfx.skip(); buzz(12);
    flyOut("out-skip", () => { busy = false; if (T) nextCard(); });
  }
  const turnPts = () => T.got.filter(g => g.on).reduce((n, g) => n + cardById(g.id).pts, 0) - (G.skipPenalty ? T.skipped : 0);

  function pause() {
    if (!T) return;
    T.paused = true;
    const v = document.createElement("div"); v.className = "pause-veil";
    v.innerHTML = `<div class="panel" style="text-align:center;max-width:340px"><div class="kicker">Paused</div>
      <h2 class="display">Time <em>out</em></h2><p class="lede">${Math.ceil(T.left / 1000)}s left on the clock. Card hidden.</p>
      <button class="btn btn-primary btn-block" id="res">Resume</button>
      <button class="linkbtn" id="endnow" style="margin-top:8px">End turn now</button></div>`;
    document.body.appendChild(v);
    v.querySelector("#res").onclick = () => { v.remove(); T.paused = false; T.last = performance.now(); };
    v.querySelector("#endnow").onclick = () => { v.remove(); T.paused = false; endTurn("time"); };
  }

  function loop(now) {
    if (!T) return;
    const dt = now - T.last; T.last = now;
    if (!T.paused) T.left -= dt;
    const sec = Math.max(0, Math.ceil(T.left / 1000));
    const num = document.getElementById("tnum"), bar = document.getElementById("tbar"), tm = document.getElementById("timer");
    if (num) {
      num.textContent = sec;
      const C = 2 * Math.PI * 35;
      bar.style.strokeDashoffset = C * (1 - Math.max(0, T.left) / (T.total * 1000));
      tm.classList.toggle("low", sec <= 10);
    }
    if (!T.paused && sec <= 5 && sec < T.lastTick && sec > 0) { T.lastTick = sec; sfx.tick(); }
    if (T.cam && !T.paused && T.snapAt && T.snapAt.length && T.total * 1000 - T.left >= T.snapAt[0]) {
      T.snapAt.shift();
      const src = camSnap(T.cam);
      if (src) {
        T.photos.push({ src, id: T.cur, team: T.ti, r: G.r });
        beep(2200, .03, "square", .04);
        const ind = document.getElementById("camInd");
        if (ind) { ind.classList.remove("flash"); void ind.offsetWidth; ind.classList.add("flash"); }
      }
    }
    if (T.left <= 0) return endTurn("time");
    T.raf = requestAnimationFrame(loop);
  }

  function endTurn(why) {
    if (!T) return;
    cancelAnimationFrame(T.raf);
    const turn = T; T = null;
    camStop(turn.cam);
    if (turn.photos.length) {
      const all = photos().concat(turn.photos);
      store.set("photos", all.slice(-16));   // keep the newest 16 so we stay under storage limits
    }
    if (why === "cleared") {
      const leftover = Math.floor(turn.left / 1000);
      if (leftover >= 5) { G.carry = leftover; G.carryTeam = turn.ti; } else { G.carry = 0; G.carryTeam = -1; }
    } else { sfx.buzz(); buzz([80, 60, 160]); }
    if (why === "cleared") sfx.win();
    review(turn, why);
  }

  function review(turn, why) {
    const rd = activeRounds()[G.r];
    const el = render(`
      <div class="panel" style="--team-c:${teamColor(turn.ti)}">
        <div class="kicker" style="color:var(--team-c)">${esc(team(turn.ti).name)}</div>
        <h2 class="display">${why === "cleared" ? "Deck <em>cleared!</em>" : "Time's <em>up!</em>"}</h2>
        <p class="lede">Tap anything that didn't count (said the name, wrong round rules…).</p>
        <div class="review" id="rev"></div>
        <div class="meter"><div class="lbl"><span id="sum"></span><span>${turn.skipped} skipped${G.skipPenalty && turn.skipped ? ` (−${turn.skipped})` : ""}</span></div></div>
        ${photoHTML(turn.photos, "📸 Caught in the act")}
      </div>
      <button class="btn btn-primary btn-block" id="ok" style="margin-top:16px">Lock it in</button>`);
    const $r = el.querySelector("#rev");
    const paint = () => {
      $r.innerHTML = turn.got.length ? turn.got.map((g, i) => { const c = cardById(g.id); return `
        <button type="button" class="ritem ${g.on ? "" : "off"}" data-i="${i}"><span class="nm">${esc(c.name)}</span>
        <span class="p">${(g.ms / 1000).toFixed(1)}s · ${c.pts}pt</span><span class="x">${g.on ? "✓" : "✕"}</span></button>`; }).join("")
        : `<div class="empty">Nothing this time. It happens to the best of us.</div>`;
      const pts = turn.got.filter(g => g.on).reduce((n, g) => n + cardById(g.id).pts, 0) - (G.skipPenalty ? turn.skipped : 0);
      el.querySelector("#sum").textContent = `${pts >= 0 ? "+" : ""}${pts} points`;
      showScore(turn.ti, pts);
    };
    $r.onclick = e => { const b = e.target.closest(".ritem"); if (!b) return; const g = turn.got[+b.dataset.i]; g.on = !g.on; paint(); };
    paint();
    el.querySelector("#ok").onclick = () => {
      let pts = 0;
      turn.got.forEach(g => {
        if (g.on) { pts += cardById(g.id).pts; G.log.push({ r: G.r, team: turn.ti, id: g.id, ms: g.ms, left: g.left }); }
        else { G.pile.push(g.id); (G.fouls = G.fouls || []).push({ r: G.r, team: turn.ti, id: g.id }); }   // didn't count → back in the pile
      });
      if (G.skipPenalty) pts -= turn.skipped;
      G.skips = (G.skips || []).concat(turn.skipLog.map(k => ({ r: G.r, team: turn.ti, id: k.id, ms: k.ms })));
      (G.turns = G.turns || []).push({ r: G.r, team: turn.ti, secs: Math.round(turn.total - Math.max(0, turn.left) / 1000), pts,
        got: turn.got.filter(g => g.on).length, skipped: turn.skipped, cleared: why === "cleared" });
      const t = team(turn.ti);
      t.score += pts; t.rounds[G.r] = (t.rounds[G.r] || 0) + pts;
      if (G.pile.length) shuffle(G.pile);
      // if a disqualified card refilled the pile, the clearing team didn't really clear → drop carry
      if (G.pile.length && G.carryTeam === turn.ti) { G.carry = 0; G.carryTeam = -1; }
      // team that cleared the deck goes first next round
      G.turn = G.pile.length ? G.turn + 1 : (G.carryTeam === turn.ti ? G.turn : G.turn + 1);
      saveG();
      G.pile.length ? ready() : roundEnd();
    };
  }

  /* ---------------- Between rounds ---------------- */
  function roundEnd() {
    T = null;
    const last = G.r >= G.rounds.length - 1;
    const gains = G.teams.map(t => t.rounds[G.r] || 0);
    sky(G.rounds[G.r] % 4);
    setChip(`Round ${G.r + 1} complete`);
    const nx = !last && activeRounds()[G.r + 1];
    const el = render(`
      <div class="panel">
        <span class="round-badge"><b>${G.r + 1}</b> Round complete</span>
        <h2 class="display" style="margin-top:12px">${last ? "That's the <em>show.</em>" : "Shuffle <em>up.</em>"}</h2>
        <p class="lede">${last ? "All rounds done. Drumroll please…" : `Same ${G.deck.length} cards, new rule: <b>${nx.name}</b>. ${nx.rule}`}</p>
        ${boardHTML(gains)}
      </div>
      <button class="btn btn-primary btn-block" id="go" style="margin-top:16px">${last ? "Reveal the winner" : `On to round ${G.r + 2}`}</button>`);
    showScore();
    el.querySelector("#go").onclick = () => {
      if (last) { G.over = true; saveG(); return final(); }
      G.r++; G.pile = shuffle(G.deck.map(c => c.id)); saveG(); ready();
    };
  }

  /* ---------------- Final ---------------- */
  function final() {
    sky("win"); setChip("Final");
    const order = G.teams.map((t, i) => ({ t, i })).sort((a, b) => b.t.score - a.t.score);
    const top = order[0], tie = order.length > 1 && order[1].t.score === top.t.score;
    const fastest = G.log.slice().sort((a, b) => a.ms - b.ms)[0];
    const byCard = {};
    G.log.forEach(l => (byCard[l.id] = byCard[l.id] || []).push(l.ms));
    const slowest = Object.entries(byCard).map(([id, a]) => ({ id, avg: a.reduce((x, y) => x + y, 0) / a.length })).sort((a, b) => b.avg - a.avg)[0];
    const skipCount = {};
    (G.skips || []).forEach(k => skipCount[k.id] = (skipCount[k.id] || 0) + 1);
    const mostSkipped = Object.entries(skipCount).sort((a, b) => b[1] - a[1])[0];
    const bestRound = G.teams.flatMap((t, i) => t.rounds.map((p, r) => ({ i, r, p: p || 0 }))).sort((a, b) => b.p - a.p)[0];
    const el = render(`
      <div class="trophy">🏆</div>
      <div class="panel" style="text-align:center;--team-c:${teamColor(top.i)}">
        <div class="kicker">${tie ? "It's a tie" : "Winner"}</div>
        <h2 class="display" style="font-size:clamp(2.8rem,12vw,4.4rem)">${tie ? "Everybody <em>wins</em>" : `<em>${esc(top.t.name)}</em>`}</h2>
        <p class="lede serif" style="font-size:1.2rem">${tie ? "Which is to say, nobody does. Rematch?" : `${top.t.score} points. Take a bow.`}</p>
        ${boardHTML()}
        <div class="awards">
          ${fastest ? `<div class="award"><div class="kicker">⚡ Fastest guess</div><b>${esc(cardById(fastest.id).name)}</b><span>${(fastest.ms / 1000).toFixed(1)}s · ${esc(team(fastest.team).name)}</span></div>` : ""}
          ${slowest ? `<div class="award"><div class="kicker">🐢 Hardest card</div><b>${esc(cardById(slowest.id).name)}</b><span>avg ${(slowest.avg / 1000).toFixed(1)}s to guess</span></div>` : ""}
          ${bestRound && bestRound.p ? `<div class="award"><div class="kicker">🔥 Best round</div><b>${esc(team(bestRound.i).name)}</b><span>+${bestRound.p} in ${activeRounds()[bestRound.r].name}</span></div>` : ""}
          ${mostSkipped ? `<div class="award"><div class="kicker">🙈 Most skipped</div><b>${esc(cardById(mostSkipped[0]).name)}</b><span>skipped ${mostSkipped[1]}×</span></div>` : ""}
          <div class="award"><div class="kicker">⏱ Game time</div><b>${Math.max(1, Math.round((Date.now() - G.started) / 60000))} min</b><span>${G.deck.length} cards · ${G.rounds.length} rounds</span></div>
        </div>
        <div style="text-align:left">${photoHTML(photos(), "📸 Charades cam")}</div>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-ghost btn-block" id="stats">📊 Card points & full breakdown</button>
        <button class="btn btn-primary btn-block" id="again">Rematch · new deck</button>
        <button class="btn btn-ghost btn-block" id="home">Change setup</button>
      </div>`);
    el.querySelector("#stats").onclick = () => breakdown();
    el.querySelector("#again").onclick = () => { S.teams = G.teams.map(t => t.name); startGame(); };
    el.querySelector("#home").onclick = () => { G = null; saveG(); setup(); };
    sfx.win(); confetti();
  }

  /* ---------------- Post-game breakdown ---------------- */
  const sec = ms => (ms / 1000).toFixed(1) + "s";
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const catLabel = id => CAT[id] ? `${CAT[id].emoji} ${CAT[id].label}` : "✍️ House Cards";
  const dot = i => `<i class="tdot" style="background:${teamColor(i)}"></i>`;

  function analyze() {
    const log = G.log, skips = G.skips || [], fouls = G.fouls || [], turns = G.turns || [];
    const R = activeRounds();
    const words = G.deck.map((c, i) => {
      const hits = log.filter(l => l.id === c.id);
      return {
        c, i, hits, byRound: R.map((_, r) => hits.find(h => h.r === r) || null),
        earned: hits.length * c.pts, avg: mean(hits.map(h => h.ms)),
        skips: skips.filter(k => k.id === c.id), fouls: fouls.filter(f => f.id === c.id).length,
      };
    });
    const teams = G.teams.map((t, i) => {
      const hits = log.filter(l => l.team === i), tk = skips.filter(k => k.team === i), tt = turns.filter(x => x.team === i);
      const catPts = {};
      hits.forEach(h => { const c = cardById(h.id); if (c) catPts[c.cat] = (catPts[c.cat] || 0) + c.pts; });
      const bestCat = Object.entries(catPts).sort((a, b) => b[1] - a[1])[0];
      const clueSecs = tt.reduce((n, x) => n + x.secs, 0);
      return {
        t, i, hits, avg: mean(hits.map(h => h.ms)), skips: tk.length, skipMs: tk.reduce((n, k) => n + k.ms, 0),
        fouls: fouls.filter(f => f.team === i).length, turns: tt, clueSecs,
        ppm: clueSecs ? t.score / (clueSecs / 60) : 0,
        bestTurn: tt.slice().sort((a, b) => b.pts - a.pts)[0],
        fastest: hits.slice().sort((a, b) => a.ms - b.ms)[0], bestCat,
      };
    });
    const rounds = R.map((rd, r) => {
      const hits = log.filter(l => l.r === r), sorted = hits.slice().sort((a, b) => a.ms - b.ms);
      return {
        rd, r, hits, avg: mean(hits.map(h => h.ms)), skips: skips.filter(k => k.r === r).length,
        turns: turns.filter(x => x.r === r), fastest: sorted[0], slowest: sorted[sorted.length - 1],
        pts: G.teams.map(t => t.rounds[r] || 0),
      };
    });
    return { words, teams, rounds, log, skips, fouls, turns, R };
  }

  function insights(A) {
    const out = [], { words, rounds, teams, skips, R } = A;
    const add = (icon, title, text) => out.push({ icon, title, text });
    const played = words.filter(w => w.hits.length);
    // round-over-round slowdown
    const rr = rounds.filter(x => x.hits.length);
    if (rr.length > 1) {
      const a = rr[0], b = rr.slice(1).sort((x, y) => y.avg - x.avg)[0];
      const f = b.avg / a.avg;
      add("📉", `${b.rd.name} was the hardest round`, f > 1.05
        ? `Cards took ${sec(b.avg)} on average, ${f.toFixed(1)}× longer than ${a.rd.name} (${sec(a.avg)}).`
        : `Even so, it was about as fast as ${a.rd.name}. You all clearly memorized the deck.`);
    }
    // point values vs reality
    const byPts = [1, 2, 3, 4].map(p => ({ p, ms: mean(played.filter(w => w.c.pts === p).flatMap(w => w.hits.map(h => h.ms))), n: played.filter(w => w.c.pts === p).length })).filter(x => x.n);
    if (byPts.length > 1) {
      const lo = byPts[0], hi = byPts[byPts.length - 1];
      add("⚖️", hi.ms > lo.ms ? "The point values held up" : "The point values lied",
        `${hi.p}-point cards averaged ${sec(hi.ms)} vs ${sec(lo.ms)} for ${lo.p}-pointers.`);
    }
    // underrated / overrated cards: time compared with that round's average
    const rel = played.map(w => ({ w, r: mean(w.hits.map(h => h.ms / (rounds[h.r].avg || 1))) }));
    const under = rel.filter(x => x.w.c.pts <= 2).sort((a, b) => b.r - a.r)[0];
    if (under && under.r > 1.3) add("💎", `Underrated: ${under.w.c.name}`, `Only ${under.w.c.pts} pt, but it took ${under.r.toFixed(1)}× longer than an average card.`);
    const over = rel.filter(x => x.w.c.pts >= 3).sort((a, b) => a.r - b.r)[0];
    if (over && over.r < .8) add("🎈", `Overrated: ${over.w.c.name}`, `Worth ${over.w.c.pts} pts, yet guessed ${(1 / over.r).toFixed(1)}× faster than average.`);
    // memory effect
    if (R.length > 1) {
      const glow = played.filter(w => w.byRound[0] && w.byRound.slice(1).some(Boolean))
        .map(w => { const later = w.byRound.slice(1).filter(Boolean).sort((a, b) => a.ms - b.ms)[0]; return { w, d: w.byRound[0].ms - later.ms, later }; })
        .sort((a, b) => b.d - a.d)[0];
      if (glow && glow.d > 1500) add("🧠", `Glow-up: ${glow.w.c.name}`, `${sec(glow.w.byRound[0].ms)} in ${R[0].name}, then just ${sec(glow.later.ms)} in ${R[glow.later.r].name}.`);
    }
    // most skipped
    const ms = words.slice().sort((a, b) => b.skips.length - a.skips.length)[0];
    if (ms && ms.skips.length >= 2) add("🙈", `Most dodged: ${ms.c.name}`, `Skipped ${ms.skips.length} times, ${sec(ms.skips.reduce((n, k) => n + k.ms, 0))} of clue time burned before giving up.`);
    // categories
    const cats = {};
    played.forEach(w => w.hits.forEach(h => (cats[w.c.cat] = cats[w.c.cat] || []).push(h.ms / (rounds[h.r].avg || 1))));
    const ce = Object.entries(cats).filter(([, a]) => a.length >= 2).map(([id, a]) => ({ id, r: mean(a) })).sort((a, b) => a.r - b.r);
    if (ce.length > 1) add("🗂️", "Strongest and weakest category", `${catLabel(ce[0].id)} went fastest. ${catLabel(ce[ce.length - 1].id)} slowed everyone down.`);
    // efficiency
    const eff = teams.filter(t => t.clueSecs).sort((a, b) => b.ppm - a.ppm);
    if (eff.length > 1) add("⏱️", `${eff[0].t.name} scored fastest`, `${eff[0].ppm.toFixed(1)} points per minute of clue time, vs ${eff[eff.length - 1].ppm.toFixed(1)} for ${eff[eff.length - 1].t.name}.`);
    // skip cost
    const sk = teams.slice().sort((a, b) => b.skipMs - a.skipMs)[0];
    if (sk && sk.skipMs > 5000) add("💸", `${sk.t.name} lost the most time to skips`, `${sk.skips} skips cost ${sec(sk.skipMs)} of their clock.`);
    // margin
    const o = G.teams.map(t => t.score).sort((a, b) => b - a);
    if (o.length > 1) add("🏁", o[0] - o[1] <= 3 ? "A photo finish" : "Final margin", `${o[0] - o[1]} point${o[0] - o[1] === 1 ? "" : "s"} between first and second.`);
    // buzzer-beater: guessed with the least time left on the clock
    const bb = A.log.filter(l => l.left != null).sort((a, b) => a.left - b.left)[0];
    if (bb && bb.left < 3000) add("🚨", `Buzzer-beater: ${cardById(bb.id).name}`, `${G.teams[bb.team].name} got it with ${sec(Math.max(0, bb.left))} left in ${R[bb.r].name}.`);
    // biggest single turn
    const bt = A.turns.slice().sort((a, b) => b.got - a.got)[0];
    if (bt && bt.got >= 3) add("🌪️", `Hot streak: ${G.teams[bt.team].name}`, `${bt.got} cards in one ${bt.secs}s turn during ${R[bt.r].name}${bt.cleared ? ", clearing the deck" : ""}.`);
    // never guessed in under X
    const nem = played.slice().sort((a, b) => b.avg - a.avg)[0];
    if (nem) add("🐢", `Nemesis card: ${nem.c.name}`, `Averaged ${sec(nem.avg)} per guess across ${nem.hits.length} round${nem.hits.length > 1 ? "s" : ""}.`);
    // deep cuts vs everything else
    const dc = played.filter(w => CAT[w.c.cat] && CAT[w.c.cat].extraOnly), reg = played.filter(w => !(CAT[w.c.cat] && CAT[w.c.cat].extraOnly));
    if (dc.length >= 2 && reg.length >= 2) {
      const a = mean(dc.map(w => w.avg)), b = mean(reg.map(w => w.avg));
      add("🌶️", "Deep Cuts vs the rest", `Deep Cuts took ${sec(a)} on average, regular cards ${sec(b)}${a > b * 1.15 ? `. ${(a / b).toFixed(1)}× harder, as advertised.` : a < b ? ". Your group knows its obscure trivia." : ". Basically even."}`);
    }
    // team that hoarded the big cards
    const big = teams.map(t => ({ t, n: t.hits.filter(h => cardById(h.id).pts >= 3).length })).sort((a, b) => b.n - a.n);
    if (big.length > 1 && big[0].n > big[1].n) add("💰", `${big[0].t.t.name} grabbed the big cards`, `${big[0].n} guesses on 3–4 point cards, vs ${big[1].n} for ${big[1].t.t.name}.`);
    if (!skips.length && played.length) add("🎯", "Zero skips all game", "Nobody passed on a single card. Impressive, or suspicious.");
    return out;
  }

  let bdTab = "words", bdSort = "earned";
  function breakdown() {
    sky("win"); setChip("Breakdown");
    const A = analyze();
    const el = render(`
      <div class="panel">
        <div class="kicker">Post-game</div>
        <h2 class="display">The <em>breakdown.</em></h2>
        <p class="lede">${G.deck.length} cards, ${A.R.length} rounds, ${A.log.length} guesses, ${A.skips.length} skips.</p>
        <div class="seg bd-tabs" id="tabs">${[["words", "Cards"], ["teams", "Teams"], ["rounds", "Rounds"], ["insights", "Insights"]].concat(photos().length ? [["photos", "📸"]] : [])
          .map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${bdTab === k}">${l}</button>`).join("")}</div>
        <div id="bd"></div>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-ghost btn-block" id="back">Back to results</button>
      </div>`, "wide");
    const $bd = el.querySelector("#bd");
    const tabs = { words: wordsHTML, teams: teamsHTML, rounds: roundsHTML, insights: insightsHTML };
    if (photos().length) tabs.photos = () => photoHTML(photos(), "Charades cam");
    if (!tabs[bdTab]) bdTab = "words";
    const paint = () => {
      el.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.t === bdTab));
      $bd.innerHTML = tabs[bdTab](A);
    };
    el.querySelector("#tabs").onclick = e => { const b = e.target.closest("button"); if (b) { bdTab = b.dataset.t; paint(); } };
    $bd.onclick = e => { const b = e.target.closest("[data-sort]"); if (b) { bdSort = b.dataset.sort; paint(); } };
    el.querySelector("#back").onclick = final;
    paint();
  }

  function wordsHTML(A) {
    const sorts = { earned: (a, b) => b.earned - a.earned || a.avg - b.avg, slow: (a, b) => b.avg - a.avg, fast: (a, b) => (a.avg || 1e9) - (b.avg || 1e9), skips: (a, b) => b.skips.length - a.skips.length || b.avg - a.avg };
    const list = A.words.slice().sort(sorts[bdSort]);
    const total = A.words.reduce((n, w) => n + w.earned, 0);
    return `
      <div class="bd-sort">${[["earned", "Points"], ["slow", "Slowest"], ["fast", "Fastest"], ["skips", "Skips"]]
        .map(([k, l]) => `<button type="button" data-sort="${k}" aria-pressed="${bdSort === k}">${l}</button>`).join("")}</div>
      <p class="fine" style="margin:8px 0 0">Each card scores its value every round it's guessed. ${total} points came from cards in total.</p>
      <div class="wlist">${list.map(w => `
        <div class="witem ${w.c.lang === "hi" ? "lang-hi" : ""}">
          <div class="wtop"><span class="wname">${esc(w.c.name)}</span><span class="wpts"><b>+${w.earned}</b><small>${w.c.pts} pt × ${w.hits.length}</small></span></div>
          <div class="wmeta">${catLabel(w.c.cat)} · ${w.hits.length ? `avg ${sec(w.avg)}` : "never guessed"}${w.skips.length ? ` · ${w.skips.length} skip${w.skips.length > 1 ? "s" : ""}` : ""}${w.fouls ? ` · ${w.fouls} foul${w.fouls > 1 ? "s" : ""}` : ""}</div>
          <div class="wrounds">${w.byRound.map((h, r) => `<span class="rchip ${h ? "" : "miss"}">R${r + 1} ${h ? `${dot(h.team)}${sec(h.ms)}` : "—"}</span>`).join("")}</div>
        </div>`).join("")}</div>`;
  }

  function teamsHTML(A) {
    const maxR = Math.max(1, ...A.teams.flatMap(t => t.t.rounds.map(p => p || 0)));
    return A.teams.slice().sort((a, b) => b.t.score - a.t.score).map(T2 => `
      <div class="tblock" style="--team-c:${teamColor(T2.i)}">
        <div class="tb-head">${dot(T2.i)}<b>${esc(T2.t.name)}</b><span>${T2.t.score} pts</span></div>
        <div class="hbars">${A.R.map((rd, r) => { const p = T2.t.rounds[r] || 0; return `
          <div class="hbar"><span>R${r + 1} ${esc(rd.short)}</span><i><u style="width:${Math.max(0, p) / maxR * 100}%;background:var(--team-c)"></u></i><b>${p >= 0 ? "+" : ""}${p}</b></div>`; }).join("")}</div>
        <div class="sgrid">
          <div><b>${T2.hits.length}</b><span>cards guessed</span></div>
          <div><b>${T2.hits.length ? sec(T2.avg) : "—"}</b><span>avg per card</span></div>
          <div><b>${T2.clueSecs ? T2.ppm.toFixed(1) : "—"}</b><span>pts per minute</span></div>
          <div><b>${T2.turns.length || "—"}</b><span>turns played</span></div>
          <div><b>${T2.skips}</b><span>skips${T2.skipMs ? ` · ${sec(T2.skipMs)} lost` : ""}</span></div>
          <div><b>${T2.fouls}</b><span>didn't count</span></div>
        </div>
        <div class="tb-notes">
          ${T2.bestTurn ? `<div>🔥 Best turn: <b>+${T2.bestTurn.pts}</b> in ${esc(A.R[T2.bestTurn.r].name)} (${T2.bestTurn.got} cards in ${T2.bestTurn.secs}s)</div>` : ""}
          ${T2.fastest ? `<div>⚡ Fastest guess: <b>${esc(cardById(T2.fastest.id).name)}</b> in ${sec(T2.fastest.ms)}</div>` : ""}
          ${T2.bestCat ? `<div>🗂️ Best category: <b>${catLabel(T2.bestCat[0])}</b> (${T2.bestCat[1]} pts)</div>` : ""}
        </div>
      </div>`).join("");
  }

  function roundsHTML(A) {
    const maxAvg = Math.max(1, ...A.rounds.map(x => x.avg));
    return `
      <div class="tblock"><div class="tb-head"><b>Average time per card</b></div>
        <div class="hbars">${A.rounds.map(x => `<div class="hbar"><span>R${x.r + 1} ${esc(x.rd.short)}</span><i><u style="width:${x.avg / maxAvg * 100}%"></u></i><b>${x.hits.length ? sec(x.avg) : "—"}</b></div>`).join("")}</div>
      </div>
      ${A.rounds.map(x => `
      <div class="tblock">
        <div class="tb-head"><span class="rnum">${x.r + 1}</span><b>${esc(x.rd.name)}</b><span>${x.turns.length ? `${x.turns.length} turn${x.turns.length > 1 ? "s" : ""}` : ""}</span></div>
        <div class="sgrid">
          <div><b>${x.hits.length}</b><span>cards guessed</span></div>
          <div><b>${x.hits.length ? sec(x.avg) : "—"}</b><span>avg per card</span></div>
          <div><b>${x.skips}</b><span>skips</span></div>
        </div>
        <div class="tb-notes">
          <div>${G.teams.map((t, i) => `${dot(i)}${esc(t.name)} <b>${x.pts[i] >= 0 ? "+" : ""}${x.pts[i]}</b>`).join(" &nbsp; ")}</div>
          ${x.fastest ? `<div>⚡ Fastest: <b>${esc(cardById(x.fastest.id).name)}</b> ${sec(x.fastest.ms)}</div>` : ""}
          ${x.slowest && x.slowest !== x.fastest ? `<div>🐢 Slowest: <b>${esc(cardById(x.slowest.id).name)}</b> ${sec(x.slowest.ms)}</div>` : ""}
        </div>
      </div>`).join("")}`;
  }

  function insightsHTML(A) {
    const list = insights(A);
    return list.length ? `<div class="ilist">${list.map(x => `<div class="insight"><span class="ic">${x.icon}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div></div>`).join("")}</div>`
      : `<div class="empty">Not enough guesses to say anything clever yet.</div>`;
  }

  function confetti() {
    const cv = document.createElement("canvas"); cv.id = "confetti"; document.body.appendChild(cv);
    const ctx = cv.getContext("2d"), dpr = devicePixelRatio || 1;
    const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
    const cols = ["#FFB547", "#FF5F45", "#5BD49A", "#6CA9FF", "#FF7AB6", "#F5ECDC"];
    const P = Array.from({ length: 160 }, () => ({
      x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 18 * dpr, vy: (-Math.random() * 16 - 6) * dpr,
      s: (5 + Math.random() * 7) * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[Math.random() * cols.length | 0],
    }));
    let f = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      P.forEach(p => { p.vy += .45 * dpr; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
      if (++f < 260) requestAnimationFrame(tick); else cv.remove();
    })();
  }

  /* ---------------- Keyboard ---------------- */
  document.addEventListener("keydown", e => {
    if (e.target.matches("input, textarea")) return;
    if (document.querySelector("dialog[open]")) return;
    if (T) {
      if (e.key === "p" || e.key === "P" || e.key === "Escape") { e.preventDefault(); if (!T.paused) pause(); return; }
      if (T.paused) return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); gotIt(); }
      else if (e.key === "ArrowLeft" || e.key === "s" || e.key === "S") { e.preventDefault(); skip(); }
    } else if (e.key === " ") {
      const go = document.getElementById("go");
      if (go) { e.preventDefault(); go.click(); }
    }
  });
  // Pause automatically if the tab is hidden mid-turn
  document.addEventListener("visibilitychange", () => { if (document.hidden && T && !T.paused) pause(); });

  title();
})();
