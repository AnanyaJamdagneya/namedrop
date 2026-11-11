/* NAMEDROP: game logic. Plain JS, no build step. */
(() => {
  "use strict";

  /* ---------------- Card bank ---------------- */
  const CATS = Object.entries(window.BANK).map(([id, c]) => ({
    id, label: c.label, emoji: c.emoji,
    cards: c.items.split("\n").map(s => s.trim()).filter(Boolean).map((line, i) => {
      const [name, clue = "", pts = "2"] = line.split("|").map(s => s.trim());
      return { id: `${id}:${i}`, name, clue, pts: Math.min(4, Math.max(1, +pts || 2)), cat: id };
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
    teams: ["The Headliners", "Night Owls"],
    deckSize: 40, turnTime: 60,
    cats: CATS.map(c => c.id),
    diff: "mix",
    rounds: [true, true, true, false],
    skipPenalty: false,
    custom: "",
    sound: true,
  };
  let S = Object.assign({}, defaults, store.get("settings", {}));
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
  function render(html, cls = "") {
    document.body.dataset.screen = "";
    $app.innerHTML = `<section class="screen ${cls}">${html}</section>`;
    window.scrollTo(0, 0);
    return $app.firstElementChild;
  }
  const ticketHTML = (c, extra = "") => {
    const cat = CAT[c.cat];
    return `<div class="ticket ${extra}">
      <div class="t-top"><span class="t-cat">${cat ? cat.emoji + " " + esc(cat.label) : "✍️ House Card"}</span>
        <span class="t-pts" data-p="${c.pts}">${c.pts}<small>PT${c.pts > 1 ? "S" : ""}</small></span></div>
      <div class="t-name ${c.name.length > 18 ? "long" : ""}">${esc(c.name)}</div>
      <div class="t-clue">${c.clue ? esc(c.clue) : "&nbsp;"}</div>
      <div class="t-foot"><span>Namedrop</span><span>№ ${String(G ? G.deck.indexOf(c) + 1 : 0).padStart(3, "0")}</span></div>
    </div>`;
  };

  /* ---------------- Deck building ---------------- */
  function pool() {
    let p = CATS.filter(c => S.cats.includes(c.id)).flatMap(c => c.cards);
    if (S.diff === "easy") p = p.filter(c => c.pts <= 2);
    if (S.diff === "hard") p = p.filter(c => c.pts >= 2);
    return p;
  }
  function customCards() {
    return S.custom.split("\n").map(s => s.trim()).filter(Boolean).map((line, i) => {
      const [name, clue = "", pts = "2"] = line.split("|").map(s => s.trim());
      return { id: "custom:" + i, name, clue, pts: Math.min(4, Math.max(1, +pts || 2)), cat: "custom" };
    });
  }
  function buildDeck() {
    const custom = customCards();
    const used = new Set(store.get("recent", []));          // avoid repeats across games
    let p = shuffle(pool().slice());
    const fresh = p.filter(c => !used.has(c.id));
    if (fresh.length >= S.deckSize - custom.length) p = fresh.concat(p.filter(c => used.has(c.id)));
    const need = Math.max(0, S.deckSize - custom.length);
    const deck = shuffle(custom.concat(p.slice(0, need)));
    const recent = store.get("recent", []).concat(deck.map(c => c.id)).slice(-Math.floor(TOTAL * .7));
    store.set("recent", recent);
    return deck;
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
          ${G && !G.over ? `<button class="btn btn-primary btn-block" id="resume">Resume game <small>ROUND ${G.r + 1}</small></button>
            <button class="btn btn-ghost btn-block" id="new">New game</button>`
          : `<button class="btn btn-primary btn-block" id="new">New game</button>`}
        </div>
        <div class="stat-row">
          <div class="stat"><b>${TOTAL.toLocaleString()}</b><span>cards</span></div>
          <div class="stat"><b>${CATS.length}</b><span>categories</span></div>
          <div class="stat"><b>4</b><span>rounds</span></div>
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
          <div class="label"><span>Deck size</span><em>${S.deckSize} cards</em></div>
          ${seg("deckSize", [20, 30, 40, 50, 60])}
        </div>
        <div class="field">
          <div class="label"><span>Turn timer</span><em>${S.turnTime}s</em></div>
          ${seg("turnTime", [30, 45, 60, 75, 90], v => v + "s")}
        </div>
        <div class="field">
          <div class="label"><span>Difficulty</span></div>
          ${seg("diff", ["easy", "mix", "hard"], v => ({ easy: "Chill", mix: "Mixed", hard: "Hard" })[v])}
        </div>
      </div>

      <div class="panel">
        <div class="label"><span>Card packs</span><em id="poolCount"></em></div>
        <div class="cats" id="cats"></div>
      </div>

      <div class="panel">
        <div class="label"><span>Rounds</span></div>
        <div class="rounds-pick" id="rounds"></div>
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
        <button type="button" data-shuffle="${i}" title="Random name" aria-label="Random name">🎲</button>
        ${S.teams.length > 2 ? `<button type="button" data-rm="${i}" title="Remove team" aria-label="Remove team">✕</button>` : ""}
      </div>`).join("");
    $teams.oninput = e => { if (e.target.dataset.i != null) { S.teams[+e.target.dataset.i] = e.target.value; saveS(); } };
    $teams.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.rm != null) { S.teams.splice(+b.dataset.rm, 1); saveS(); setup(); }
      if (b.dataset.shuffle != null) {
        const opts = TEAM_NAMES.filter(n => !S.teams.includes(n));
        S.teams[+b.dataset.shuffle] = opts[Math.random() * opts.length | 0]; saveS(); setup();
      }
    };
    const add = el.querySelector("#addTeam");
    if (add) add.onclick = () => { S.teams.push(TEAM_NAMES.find(n => !S.teams.includes(n))); saveS(); setup(); };

    // segmented controls
    el.querySelectorAll(".seg").forEach(sg => sg.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      const k = sg.dataset.key; S[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; saveS(); setup();
    });

    // categories
    const $cats = el.querySelector("#cats");
    const paintCats = () => {
      $cats.innerHTML = CATS.map(c => `<button type="button" class="cat" data-c="${c.id}" aria-pressed="${S.cats.includes(c.id)}">
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

    el.querySelector("#penalty").onclick = e => { S.skipPenalty = !S.skipPenalty; e.currentTarget.setAttribute("aria-pressed", S.skipPenalty); saveS(); };
    el.querySelector("#custom").oninput = e => { S.custom = e.target.value; saveS(); };
    el.querySelector("#back").onclick = title;
    el.querySelector("#go").onclick = () => {
      S.teams = S.teams.map((t, i) => t.trim() || `Team ${i + 1}`);
      const need = S.deckSize - customCards().length;
      if (pool().length < need) { toast(`Pick more packs. Only ${pool().length} cards available.`); return; }
      saveS(); startGame();
    };
  }

  function startGame() {
    G = {
      teams: S.teams.map(name => ({ name, score: 0, rounds: [] })),
      deck: buildDeck(),
      rounds: S.rounds.map((on, i) => on ? i : -1).filter(i => i >= 0),
      turnTime: S.turnTime, skipPenalty: S.skipPenalty,
      r: 0, pile: [], turn: 0, carry: 0, carryTeam: -1,
      log: [],          // {r, team, id, ms}
      over: false, started: Date.now(),
    };
    G.pile = shuffle(G.deck.map(c => c.id));
    saveG();
    deckPeek();
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
        <button class="linkbtn" id="skipPeek" style="display:block;margin:0 auto">Skip, keep it a surprise</button>
      </div>`, "wide");
    const $p = el.querySelector("#peek");
    const paint = () => $p.innerHTML = G.deck.map((c, i) => `<button type="button" class="mini" data-i="${i}">
      <span class="c"><span>${CAT[c.cat] ? CAT[c.cat].emoji : "✍️"}</span><span>${c.pts}pt</span></span>
      <span class="n">${esc(c.name)}</span><span class="sw">↻ SWAP</span></button>`).join("");
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
    el.querySelector("#skipPeek").onclick = ready;
  }

  function resume() { if (G.over) return final(); G.pile.length ? ready() : roundEnd(); }

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

  /* ---------------- The turn ---------------- */
  function startTurn(ti, seconds, usedBonus) {
    if (usedBonus) { G.carry = 0; G.carryTeam = -1; }
    T = { ti, total: seconds, left: seconds * 1000, got: [], skipped: 0, seen: new Set(), paused: false, last: performance.now(), cur: null, cardStart: 0, lastTick: 99 };
    sfx.start(); buzz(40);
    const rd = activeRounds()[G.r];
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
      <div class="subrow"><span class="pill" id="pileCount"></span><button class="linkbtn" id="pause">Pause</button></div>`);
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
    T.got.push({ id: c.id, ms: performance.now() - T.cardStart, on: true });
    G.pile.shift();
    document.getElementById("tgot").textContent = turnPts();
    sfx.got(); buzz(25);
    flyOut("out-got", () => { busy = false; if (T) nextCard(); });
  }
  function skip() {
    if (!T || T.paused || busy || !T.cur) return;
    if (G.pile.length === 1) return toast("Last card, no skipping!");
    busy = true;
    T.skipped++;
    G.pile.push(G.pile.shift());
    document.getElementById("tgot").textContent = turnPts();
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
    if (T.left <= 0) return endTurn("time");
    T.raf = requestAnimationFrame(loop);
  }

  function endTurn(why) {
    if (!T) return;
    cancelAnimationFrame(T.raf);
    const turn = T; T = null;
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
    };
    $r.onclick = e => { const b = e.target.closest(".ritem"); if (!b) return; const g = turn.got[+b.dataset.i]; g.on = !g.on; paint(); };
    paint();
    el.querySelector("#ok").onclick = () => {
      let pts = 0;
      turn.got.forEach(g => {
        if (g.on) { pts += cardById(g.id).pts; G.log.push({ r: G.r, team: turn.ti, id: g.id, ms: g.ms }); }
        else G.pile.push(g.id);                 // didn't count → back in the pile
      });
      if (G.skipPenalty) pts -= turn.skipped;
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
          <div class="award"><div class="kicker">⏱ Game time</div><b>${Math.max(1, Math.round((Date.now() - G.started) / 60000))} min</b><span>${G.deck.length} cards · ${G.rounds.length} rounds</span></div>
        </div>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary btn-block" id="again">Rematch · new deck</button>
        <button class="btn btn-ghost btn-block" id="home">Change setup</button>
      </div>`);
    el.querySelector("#again").onclick = () => { S.teams = G.teams.map(t => t.name); startGame(); };
    el.querySelector("#home").onclick = () => { G = null; saveG(); setup(); };
    sfx.win(); confetti();
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
