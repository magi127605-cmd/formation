// 布陣ボード本体。盤は SVG 1枚（1050×680、1m=10）。書き込みはこの端末（localStorage）に盤ごとに残す。
(function () {
  const { W, H, PRESETS, slots, isValid } = window.Formations;
  const NS = "http://www.w3.org/2000/svg";
  const LS_PREFIX = "fb:board:";
  const LS_LOCAL = "fb:local";   // この端末で作った盤（白紙・貼り付け）の一覧
  const LS_LAST = "fb:last";
  const VERSION = "1.2.0";

  const $ = s => document.querySelector(s);
  const svg = $("#board");

  let index = [];        // matches/index.json
  let board = null;      // 今開いている盤
  let tool = "move";
  let penColor = "#111111";
  let history = [];
  let curScene = -1;

  // ---------- 保存まわり ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(LS_PREFIX + board.id, board), 250);
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
  }

  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- 試合データ → 盤 ----------
  function buildTeam(src, side) {
    const players = (src.players || []).slice(0, 11).map((p, i) => ({
      id: side[0] + i, no: p.no ?? "", name: p.name || "", pos: p.pos || "",
      x: p.x, y: p.y, hidden: false
    }));
    while (players.length < 11) players.push({ id: side[0] + players.length, no: "", name: "", pos: "", hidden: false });
    let formation = src.formation || "4-4-2";
    const hasXY = players.every(p => typeof p.x === "number" && typeof p.y === "number");
    if (!hasXY) {
      const sl = slots(isValid(formation) ? formation : "4-4-2", side);
      players.forEach((p, i) => { p.x = sl[i].x; p.y = sl[i].y; });
    }
    return {
      name: src.name || (side === "home" ? "ホーム" : "アウェイ"),
      short: src.short || "",
      color: src.color || (side === "home" ? "#c8102e" : "#f2d230"),
      formation, show: true, players
    };
  }

  function newBoard(src) {
    const b = {
      v: 1,
      id: src.id,
      title: src.title || `${src.home?.name || "ホーム"} 対 ${src.away?.name || "アウェイ"}`,
      date: src.date || "", competition: src.competition || "", venue: src.venue || "",
      source: clone(src),
      home: buildTeam(src.home || {}, "home"),
      away: buildTeam(src.away || {}, "away"),
      ball: { x: W / 2, y: H / 2, show: false },
      lines: [], scenes: [], memo: "",
      opts: { names: true, pitch: "white" }
    };
    return b;
  }

  function blankSource() {
    return {
      id: "local-" + Date.now(), title: "白紙の盤",
      home: { name: "ホーム", short: "HOME", color: "#c8102e", formation: "4-3-3", players: Array.from({ length: 11 }, (_, i) => ({ no: i + 1 })) },
      away: { name: "アウェイ", short: "AWAY", color: "#1e5bb8", formation: "4-4-2", players: Array.from({ length: 11 }, (_, i) => ({ no: i + 1 })) }
    };
  }

  // ---------- 一覧 ----------
  async function loadIndex() {
    try {
      const r = await fetch("matches/index.json?t=" + Date.now());
      index = r.ok ? await r.json() : [];
    } catch (e) { index = []; }
  }

  function localList() { return store.get(LS_LOCAL) || []; }

  function fillBoardSelect() {
    const sel = $("#boardSelect");
    sel.innerHTML = "";
    const g1 = document.createElement("optgroup"); g1.label = "社長が調べた試合";
    index.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).forEach(m => {
      const o = new Option(`${m.date ? m.date + " " : ""}${m.title}`, "m:" + m.id); g1.appendChild(o);
    });
    const g2 = document.createElement("optgroup"); g2.label = "この端末で作った盤";
    localList().forEach(m => g2.appendChild(new Option(m.title, "l:" + m.id)));
    if (g1.children.length) sel.appendChild(g1);
    if (g2.children.length) sel.appendChild(g2);
    if (board) sel.value = (board.id.startsWith("local-") ? "l:" : "m:") + board.id;
  }

  async function openMatch(id) {
    const saved = store.get(LS_PREFIX + id);
    if (saved && saved.v === 1) { setBoard(saved); return; }
    const m = index.find(x => x.id === id);
    if (!m) { toast("試合が見つからない"); return; }
    try {
      const r = await fetch("matches/" + m.file + "?t=" + Date.now());
      const src = await r.json();
      src.id = id;
      setBoard(newBoard(src));
    } catch (e) { toast("試合データを読めなかった"); }
  }

  function openLocal(id) {
    const saved = store.get(LS_PREFIX + id);
    if (saved) setBoard(saved);
  }

  function addLocal(b) {
    const list = localList().filter(x => x.id !== b.id);
    list.unshift({ id: b.id, title: b.title });
    store.set(LS_LOCAL, list);
  }

  function setBoard(b) {
    board = b; history = []; curScene = -1;
    store.set(LS_LAST, b.id);
    store.set(LS_PREFIX + b.id, b);
    location.hash = "m=" + encodeURIComponent(b.id);
    fillBoardSelect(); syncPanel(); render();
  }

  // ---------- 履歴 ----------
  function snap() {
    return clone({ home: board.home, away: board.away, ball: board.ball, lines: board.lines });
  }
  function pushHistory() {
    history.push(snap()); if (history.length > 60) history.shift();
  }
  function undo() {
    const s = history.pop();
    if (!s) { toast("これ以上戻れない"); return; }
    Object.assign(board, s); save(); syncPanel(); render();
  }

  // ---------- 描画 ----------
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function textColorOn(hex) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? "#111" : "#fff";
  }

  function drawPitch(g, theme) {
    const green = theme === "green";
    const line = green ? "#ffffff" : "#222222";
    const lw = green ? 3 : 2.2;
    if (green) {
      el("rect", { x: -8, y: -8, width: W + 16, height: H + 16, fill: "#3d8b4d" }, g);
      for (let i = 0; i < 10; i += 2) el("rect", { x: i * 105, y: 0, width: 105, height: H, fill: "#459858" }, g);
    } else {
      el("rect", { x: -8, y: -8, width: W + 16, height: H + 16, fill: "#ffffff" }, g);
    }
    const s = { fill: "none", stroke: line, "stroke-width": lw };
    el("rect", { x: 0, y: 0, width: W, height: H, ...s }, g);
    el("line", { x1: W / 2, y1: 0, x2: W / 2, y2: H, ...s }, g);
    el("circle", { cx: W / 2, cy: H / 2, r: 91.5, ...s }, g);
    el("circle", { cx: W / 2, cy: H / 2, r: 3.5, fill: line }, g);
    [0, 1].forEach(side => {
      const x0 = side ? W : 0, dir = side ? -1 : 1;
      const pa = { x: side ? W - 165 : 0, y: H / 2 - 201.5, width: 165, height: 403, ...s };
      el("rect", pa, g);
      el("rect", { x: side ? W - 55 : 0, y: H / 2 - 91.6, width: 55, height: 183.2, ...s }, g);
      el("circle", { cx: x0 + dir * 110, cy: H / 2, r: 3.5, fill: line }, g);
      // ペナルティアーク
      const ax = x0 + dir * 165, dy = Math.sqrt(91.5 * 91.5 - 55 * 55);
      el("path", { d: `M ${ax} ${H / 2 - dy} A 91.5 91.5 0 0 ${side ? 0 : 1} ${ax} ${H / 2 + dy}`, ...s }, g);
      // ゴール
      el("rect", { x: side ? W : -14, y: H / 2 - 36.6, width: 14, height: 73.2, fill: green ? "#fff" : "#222", stroke: "none" }, g);
      // コーナー
      [0, H].forEach(cy => {
        const sy = cy ? -1 : 1;
        el("path", { d: `M ${x0} ${cy + sy * 10} A 10 10 0 0 ${(side ^ (cy ? 1 : 0)) ? 1 : 0} ${x0 + dir * 10} ${cy}`, ...s }, g);
      });
    });
  }

  function drawBanner(g, team, side) {
    const x = side === "home" ? -64 : W + 14;
    el("rect", { x, y: 0, width: 50, height: H, fill: team.color, rx: 4 }, g);
    const label = (team.short || team.name || "").toUpperCase();
    const t = el("text", {
      x: x + 25, y: H / 2, fill: textColorOn(team.color), "font-size": label.length > 9 ? 26 : 32,
      "font-weight": 900, "text-anchor": "middle", "dominant-baseline": "central",
      "letter-spacing": 6, transform: `rotate(${side === "home" ? -90 : 90} ${x + 25} ${H / 2})`
    }, g);
    t.textContent = label;
  }

  function drawLine(g, ln, i) {
    const grp = el("g", { "data-line": i }, g);
    if (ln.type === "arrow") {
      const [a, b] = ln.pts;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const hl = 22, back = [b[0] - Math.cos(ang) * hl * 0.8, b[1] - Math.sin(ang) * hl * 0.8];
      el("line", { x1: a[0], y1: a[1], x2: back[0], y2: back[1], stroke: ln.color, "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": ln.dash ? "14 10" : "" }, grp);
      const p1 = [b[0] - Math.cos(ang - 0.45) * hl, b[1] - Math.sin(ang - 0.45) * hl];
      const p2 = [b[0] - Math.cos(ang + 0.45) * hl, b[1] - Math.sin(ang + 0.45) * hl];
      el("polygon", { points: `${b[0]},${b[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`, fill: ln.color }, grp);
      el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "transparent", "stroke-width": 26, class: "hit" }, grp);
    } else {
      const d = ln.pts.map((p, k) => (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      el("path", { d, fill: "none", stroke: ln.color, "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round" }, grp);
      el("path", { d, fill: "none", stroke: "transparent", "stroke-width": 26, class: "hit" }, grp);
    }
  }

  function drawPiece(g, p, team, side) {
    const grp = el("g", { class: "piece", "data-side": side, "data-id": p.id, transform: `translate(${p.x} ${p.y})` }, g);
    const dir = side === "home" ? 1 : -1;
    const fg = textColorOn(team.color);
    // 攻める向きの小さな三角（画像の駒と同じ）
    el("polygon", { points: `${dir * 19},-8 ${dir * 30},0 ${dir * 19},8`, fill: team.color }, grp);
    el("circle", { r: 19, fill: team.color, stroke: "#fff", "stroke-width": 2 }, grp);
    const n = el("text", { y: 1, fill: fg, "font-size": String(p.no).length > 2 ? 14 : 17, "font-weight": 800, "text-anchor": "middle", "dominant-baseline": "central" }, grp);
    n.textContent = p.no;
    if (board.opts.names && p.name) {
      const green = board.opts.pitch === "green";
      const t = el("text", {
        y: 38, "font-size": 17, "font-weight": 600, "text-anchor": "middle",
        fill: green ? "#fff" : "#111", stroke: green ? "rgba(0,0,0,.55)" : "#fff", "stroke-width": 5,
        "paint-order": "stroke", "stroke-linejoin": "round"
      }, grp);
      t.textContent = p.name;
    }
  }

  function drawBall(g) {
    const b = board.ball;
    const grp = el("g", { class: "piece", "data-side": "ball", "data-id": "ball", transform: `translate(${b.x} ${b.y})` }, g);
    el("circle", { r: 10, fill: "#fff", stroke: "#111", "stroke-width": 2 }, grp);
    el("circle", { r: 4, fill: "#111" }, grp);
  }

  function render() {
    svg.innerHTML = "";
    svg.setAttribute("class", "tool-" + tool);
    const root = el("g", { "font-family": '"Hiragino Sans","Yu Gothic UI","Meiryo","Noto Sans JP",sans-serif' }, svg);
    el("rect", { x: -70, y: -14, width: 1190, height: 708, fill: board.opts.pitch === "green" ? "#2f6e3c" : "#ffffff" }, root);
    drawPitch(el("g", {}, root), board.opts.pitch);
    drawBanner(root, board.home, "home");
    drawBanner(root, board.away, "away");
    const lg = el("g", { class: "lines" }, root);
    board.lines.forEach((ln, i) => drawLine(lg, ln, i));
    const pg = el("g", { class: "pieces" }, root);
    ["home", "away"].forEach(side => {
      const t = board[side];
      if (!t.show) return;
      t.players.forEach(p => { if (!p.hidden) drawPiece(pg, p, t, side); });
    });
    if (board.ball.show) drawBall(pg);
    root.appendChild(el("g", { class: "live" }));
  }

  // ---------- 操作 ----------
  function toSvg(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  const clampX = x => Math.max(-40, Math.min(W + 40, x));
  const clampY = y => Math.max(-6, Math.min(H + 6, y));

  function findPlayer(side, id) {
    if (side === "ball") return board.ball;
    return board[side].players.find(p => p.id === id);
  }

  let drag = null;

  svg.addEventListener("pointerdown", e => {
    if (e.button !== undefined && e.button > 0) return;
    const [x, y] = toSvg(e);
    if (tool === "move") {
      const g = e.target.closest(".piece");
      if (!g) return;
      const side = g.dataset.side, id = g.dataset.id;
      const obj = findPlayer(side, id);
      drag = { kind: "piece", g, side, id, obj, dx: x - obj.x, dy: y - obj.y, sx: e.clientX, sy: e.clientY, before: snap(), moved: false };
      g.parentNode.appendChild(g); // 前面へ
    } else if (tool === "pen" || tool === "arrow") {
      drag = { kind: tool, pts: [[x, y]] };
    } else if (tool === "erase") {
      drag = { kind: "erase", before: snap(), erased: false };
      eraseAt(e);
    }
    if (drag) { svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  });

  svg.addEventListener("pointermove", e => {
    if (!drag) return;
    const [x, y] = toSvg(e);
    if (drag.kind === "piece") {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.moved = true;
      drag.obj.x = clampX(x - drag.dx); drag.obj.y = clampY(y - drag.dy);
      drag.g.setAttribute("transform", `translate(${drag.obj.x} ${drag.obj.y})`);
    } else if (drag.kind === "pen") {
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 4) return;
      drag.pts.push([x, y]); drawLive({ type: "pen", color: penColor, pts: drag.pts });
    } else if (drag.kind === "arrow") {
      drag.pts[1] = [x, y]; drawLive({ type: "arrow", color: penColor, pts: drag.pts });
    } else if (drag.kind === "erase") {
      eraseAt(e);
    }
  });

  function endDrag(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "piece") {
      if (d.moved) { history.push(d.before); save(); curScene = -1; renderScenes(); }
      else if (d.side !== "ball") openPlayer(d.side, d.id);
    } else if (d.kind === "pen") {
      if (d.pts.length > 1) { pushHistory(); board.lines.push({ type: "pen", color: penColor, pts: d.pts.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) }); save(); }
      render();
    } else if (d.kind === "arrow") {
      const [a, b] = d.pts;
      if (b && Math.hypot(b[0] - a[0], b[1] - a[1]) > 20) { pushHistory(); board.lines.push({ type: "arrow", color: penColor, pts: [a, b] }); save(); }
      render();
    } else if (d.kind === "erase") {
      if (d.erased) { history.push(d.before); save(); }
    }
  }
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  function drawLive(ln) {
    const live = svg.querySelector(".live");
    live.innerHTML = "";
    if (ln.type === "arrow" && ln.pts.length < 2) return;
    drawLine(live, ln, -1);
  }

  function eraseAt(e) {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const g = t && t.closest && t.closest("[data-line]");
    if (!g || g.dataset.line === "-1") return;
    board.lines.splice(+g.dataset.line, 1);
    drag.erased = true;
    render();
  }

  // ---------- 選手の編集 ----------
  let editing = null;
  function openPlayer(side, id) {
    const p = findPlayer(side, id);
    editing = { side, id };
    $("#pNo").value = p.no; $("#pName").value = p.name; $("#pPos").value = p.pos || ""; $("#pHide").checked = !!p.hidden;
    $("#playerDlg").showModal();
  }
  $("#playerDlg").addEventListener("close", () => {
    if ($("#playerDlg").returnValue !== "ok" || !editing) return;
    const p = findPlayer(editing.side, editing.id);
    pushHistory();
    p.no = $("#pNo").value.trim(); p.name = $("#pName").value.trim(); p.pos = $("#pPos").value.trim(); p.hidden = $("#pHide").checked;
    editing = null; save(); render();
  });

  // 布陣を変えたとき、各選手を「今いる所に一番近い枠」へ移す（GKはGKのまま）
  function assignNearest(players, sl) {
    players[0].x = sl[0].x; players[0].y = sl[0].y;
    const ps = players.slice(1), ss = sl.slice(1);
    const pairs = [];
    ps.forEach((p, i) => ss.forEach((s, j) => pairs.push([Math.hypot(p.x - s.x, (p.y - s.y) * 0.8), i, j])));
    pairs.sort((a, b) => a[0] - b[0]);
    const usedP = new Set(), usedS = new Set();
    for (const [, i, j] of pairs) {
      if (usedP.has(i) || usedS.has(j)) continue;
      usedP.add(i); usedS.add(j);
      ps[i].x = ss[j].x; ps[i].y = ss[j].y;
    }
  }

  // ---------- パネル ----------
  function fillFormSelect(sel, current) {
    sel.innerHTML = "";
    const list = PRESETS.slice();
    if (current && !list.includes(current)) list.unshift(current);
    list.forEach(f => sel.appendChild(new Option(f, f)));
    sel.value = current;
  }

  function syncPanel() {
    document.querySelectorAll(".teamCard").forEach(card => {
      const t = board[card.dataset.side];
      card.querySelector(".tName").value = t.name;
      card.querySelector(".tColor").value = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#888888";
      fillFormSelect(card.querySelector(".tForm"), t.formation);
      card.querySelector(".tShow").checked = t.show;
    });
    $("#optNames").checked = board.opts.names;
    $("#optBall").checked = board.ball.show;
    $("#optPitch").value = board.opts.pitch;
    $("#memo").value = board.memo || "";
    const info = [board.date, board.competition, board.venue].filter(Boolean).join("・");
    $("#infoLine").textContent = (info ? info + "　" : "") + "書き込みはこの端末に自動保存";
    renderScenes();
    renderFrames();
  }

  document.querySelectorAll(".teamCard").forEach(card => {
    const side = card.dataset.side;
    card.querySelector(".tName").addEventListener("change", e => {
      board[side].name = e.target.value; board[side].short = e.target.value; save(); render();
    });
    card.querySelector(".tColor").addEventListener("input", e => { board[side].color = e.target.value; save(); render(); });
    card.querySelector(".tForm").addEventListener("change", e => {
      const f = e.target.value;
      if (!isValid(f)) return;
      pushHistory();
      board[side].formation = f;
      assignNearest(board[side].players, slots(f, side));
      save(); render();
    });
    card.querySelector(".tShow").addEventListener("change", e => { board[side].show = e.target.checked; save(); render(); });
  });
  $("#optNames").addEventListener("change", e => { board.opts.names = e.target.checked; save(); render(); });
  $("#optBall").addEventListener("change", e => { board.ball.show = e.target.checked; save(); render(); });
  $("#optPitch").addEventListener("change", e => { board.opts.pitch = e.target.value; save(); render(); });
  $("#memo").addEventListener("input", e => { board.memo = e.target.value; save(); });

  // ---------- 場面 ----------
  function renderScenes() {
    const ul = $("#sceneList");
    ul.innerHTML = "";
    if (!board.scenes.length) {
      const li = document.createElement("li"); li.className = "hint"; li.textContent = "まだない"; ul.appendChild(li); return;
    }
    board.scenes.forEach((s, i) => {
      const li = document.createElement("li");
      const go = document.createElement("button"); go.className = "go" + (i === curScene ? " cur" : ""); go.textContent = s.name;
      go.onclick = () => { pushHistory(); Object.assign(board, clone(s.snap)); curScene = i; save(); syncPanel(); render(); };
      const up = document.createElement("button"); up.className = "del"; up.textContent = "上書き"; up.title = "今の形でこの場面を上書き";
      up.onclick = () => { s.snap = snap(); curScene = i; save(); renderScenes(); toast("「" + s.name + "」を上書きした"); };
      const del = document.createElement("button"); del.className = "del"; del.textContent = "✕"; del.title = "消す";
      del.onclick = () => { if (!confirm("「" + s.name + "」を消す？")) return; board.scenes.splice(i, 1); if (curScene === i) curScene = -1; save(); renderScenes(); };
      li.append(go, up, del); ul.appendChild(li);
    });
  }
  $("#sceneSave").addEventListener("click", () => {
    const name = $("#sceneName").value.trim() || `場面${board.scenes.length + 1}`;
    board.scenes.push({ name, snap: snap() });
    curScene = board.scenes.length - 1;
    $("#sceneName").value = ""; save(); renderScenes(); toast("「" + name + "」を残した");
  });

  // ---------- ツール ----------
  $("#toolSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    tool = b.dataset.tool;
    document.querySelectorAll("#toolSeg button").forEach(x => x.classList.toggle("on", x === b));
    svg.setAttribute("class", "tool-" + tool);
  });
  $("#penColors").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    penColor = b.dataset.color;
    document.querySelectorAll("#penColors button").forEach(x => x.classList.toggle("on", x === b));
    if (tool === "move" || tool === "erase") $('#toolSeg [data-tool="pen"]').click();
  });
  $("#undoBtn").addEventListener("click", undo);
  $("#clearLinesBtn").addEventListener("click", () => {
    if (!board.lines.length) return;
    pushHistory(); board.lines = []; save(); render();
  });
  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("両チームの並びを最初の形に戻す？（線・場面・メモは残る）")) return;
    pushHistory();
    const fresh = newBoard(board.source);
    board.home = fresh.home; board.away = fresh.away; board.ball = { ...fresh.ball, show: board.ball.show };
    curScene = -1; save(); syncPanel(); render();
  });

  // ---------- 交代 ----------
  // 試合データの home.subs / away.subs = [{ min, out(出る背番号), in: { no, name, pos } }]
  // 保存済みの盤には手を付けず、交代だけ試合ファイルから読み直す（盤の source は開いた時の写しで古いことがある）
  let subsData = [];
  async function loadSubs() {
    let src = board.source;
    const m = index.find(x => x.id === board.id);
    if (m) {
      try { src = await (await fetch("matches/" + m.file + "?t=" + Date.now())).json(); } catch (e) {}
    }
    const list = [];
    ["home", "away"].forEach(side => (src?.[side]?.subs || []).forEach(s => list.push({ ...s, side })));
    const minNum = s => { const [a, b] = String(s.min).split("+"); return +a + (+b || 0) / 100; };
    return list.sort((a, b) => minNum(a) - minNum(b));
  }
  const sameNo = (a, b) => String(a).trim() === String(b).trim();
  const isApplied = s => board[s.side].players.some(p => sameNo(p.no, s.in.no) && p.name === s.in.name);
  function applySub(s) {
    if (isApplied(s)) return false;
    const p = board[s.side].players.find(q => sameNo(q.no, s.out));
    if (!p) return false;
    p.no = String(s.in.no); p.name = s.in.name; p.pos = s.in.pos || `${s.min}' 途中出場（${s.outName || p.name}と交代）`; p.hidden = false;
    return true;
  }
  function outName(s) {
    const p = board[s.side].players.find(q => sameNo(q.no, s.out));
    return p ? p.name : (s.outName || "");
  }
  function renderSubs() {
    const ul = $("#subsList");
    ul.innerHTML = "";
    subsData.forEach(s => {
      const li = document.createElement("li");
      const done = isApplied(s);
      if (done) li.className = "done";
      const min = document.createElement("span"); min.className = "sMin"; min.textContent = s.min + "'";
      const txt = document.createElement("span"); txt.className = "sTxt";
      txt.innerHTML = `${s.out} ${s.outName || outName(s)} → <b>${s.in.no} ${s.in.name}</b><small>${board[s.side].name}${s.in.pos ? "・" + s.in.pos : ""}</small>`;
      const b = document.createElement("button");
      b.textContent = done ? "済" : "反映"; b.disabled = done;
      b.onclick = () => {
        pushHistory();
        if (applySub(s)) { save(); render(); toast(`${s.in.name} が入った`); }
        else { history.pop(); toast(`${s.out}番が盤にいない（番号を直した？）`); }
        renderSubs();
      };
      li.append(min, txt, b); ul.appendChild(li);
    });
    $("#subsAll").disabled = subsData.every(isApplied);
  }
  $("#subsBtn").addEventListener("click", async () => {
    subsData = await loadSubs();
    if (!subsData.length) { toast("この試合の交代データはまだない"); return; }
    if (!board.subsSeen && !confirm("交代が分かる＝試合のネタバレになる。見る？")) return;
    board.subsSeen = true; save();
    // 外す前の名前を控える（反映した後も一覧で「誰が出たか」を出すため）
    subsData.forEach(s => { s.outName = s.outName || outName(s); });
    renderSubs(); $("#subsDlg").showModal();
  });
  $("#subsAll").addEventListener("click", () => {
    pushHistory();
    let n = 0, miss = 0;
    subsData.forEach(s => { if (isApplied(s)) return; applySub(s) ? n++ : miss++; });
    if (!n) history.pop();
    save(); render(); renderSubs();
    toast(`${n}人を入れ替えた` + (miss ? `（${miss}人は番号が見つからず）` : ""));
  });

  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
  });

  // ---------- 画像で保存 ----------
  $("#pngBtn").addEventListener("click", async () => {
    const live = svg.querySelector(".live"); if (live) live.innerHTML = "";
    const c = svg.cloneNode(true);
    c.setAttribute("width", 2380); c.setAttribute("height", 1416);
    c.removeAttribute("class");
    const xml = new XMLSerializer().serializeToString(c);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = async () => {
      const cv = document.createElement("canvas"); cv.width = 2380; cv.height = 1416;
      cv.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const sceneName = curScene >= 0 ? "_" + board.scenes[curScene].name : "";
      const fname = (board.title + sceneName).replace(/[\\/:*?"<>|\s]+/g, "_") + ".png";
      cv.toBlob(async blob => {
        const file = new File([blob], fname, { type: "image/png" });
        const touch = matchMedia("(pointer:coarse)").matches;
        if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
        }
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        toast("画像を保存した");
      }, "image/png");
    };
    img.onerror = () => toast("画像にできなかった");
    img.src = url;
  });

  // ---------- 動画（コマ送り） ----------
  // board.anim = { frames: [{ name, dur(このコマへ動く秒), hold(止まる秒), snap }], caption }
  function anim() {
    if (!board.anim) board.anim = { frames: [], caption: true };
    return board.anim;
  }
  const fmtSec = v => (Math.round(v * 10) / 10).toFixed(1);

  function renderFrames() {
    const a = anim();
    const ul = $("#frameList");
    ul.innerHTML = "";
    $("#optCaption").checked = a.caption !== false;
    if (!a.frames.length) {
      const li = document.createElement("li"); li.className = "hint"; li.textContent = "まだない。駒を置いて「今の形をコマに追加」"; ul.appendChild(li); return;
    }
    a.frames.forEach((f, i) => {
      const li = document.createElement("li");
      const name = document.createElement("input"); name.className = "fName"; name.value = f.name; name.title = "コマの名前（字幕に出る）";
      name.onchange = () => { f.name = name.value.trim() || `コマ${i + 1}`; name.value = f.name; save(); };
      const dur = document.createElement("label"); dur.className = "fNum";
      dur.innerHTML = `<span>${i === 0 ? "最初" : "移動"}</span>`;
      const dIn = document.createElement("input"); dIn.type = "number"; dIn.step = "0.1"; dIn.min = "0"; dIn.value = fmtSec(f.dur); dIn.disabled = i === 0;
      dIn.onchange = () => { f.dur = Math.max(0, +dIn.value || 0); dIn.value = fmtSec(f.dur); save(); };
      dur.append(dIn, document.createTextNode("秒"));
      const hold = document.createElement("label"); hold.className = "fNum"; hold.innerHTML = "<span>止まる</span>";
      const hIn = document.createElement("input"); hIn.type = "number"; hIn.step = "0.1"; hIn.min = "0"; hIn.value = fmtSec(f.hold);
      hIn.onchange = () => { f.hold = Math.max(0, +hIn.value || 0); hIn.value = fmtSec(f.hold); save(); };
      hold.append(hIn, document.createTextNode("秒"));
      const ops = document.createElement("div"); ops.className = "fOps";
      const go = document.createElement("button"); go.className = "go"; go.textContent = "盤へ"; go.title = "このコマの形を盤に出す（直して「上書き」できる）";
      go.onclick = () => { pushHistory(); Object.assign(board, clone(f.snap)); curScene = -1; save(); syncPanel(); render(); toast(`「${f.name}」を盤に出した`); };
      const ow = document.createElement("button"); ow.textContent = "上書き"; ow.title = "今の盤の形でこのコマを上書き";
      ow.onclick = () => { f.snap = snap(); save(); toast(`「${f.name}」を上書きした`); };
      const up = document.createElement("button"); up.textContent = "▲"; up.title = "一つ前へ"; up.disabled = i === 0;
      up.onclick = () => { [a.frames[i - 1], a.frames[i]] = [a.frames[i], a.frames[i - 1]]; save(); renderFrames(); };
      const dn = document.createElement("button"); dn.textContent = "▼"; dn.title = "一つ後へ"; dn.disabled = i === a.frames.length - 1;
      dn.onclick = () => { [a.frames[i + 1], a.frames[i]] = [a.frames[i], a.frames[i + 1]]; save(); renderFrames(); };
      const del = document.createElement("button"); del.textContent = "✕"; del.title = "消す";
      del.onclick = () => { if (!confirm(`「${f.name}」を消す？`)) return; a.frames.splice(i, 1); save(); renderFrames(); };
      ops.append(go, ow, up, dn, del);
      li.append(name, dur, hold, ops); ul.appendChild(li);
    });
  }
  $("#frameAdd").addEventListener("click", () => {
    const a = anim();
    const name = $("#frameName").value.trim() || `コマ${a.frames.length + 1}`;
    a.frames.push({ name, dur: a.frames.length ? 1.5 : 0, hold: 1.5, snap: snap() });
    $("#frameName").value = ""; save(); renderFrames(); toast(`「${name}」をコマに追加した（${a.frames.length}コマ）`);
  });
  $("#optCaption").addEventListener("change", e => { anim().caption = e.target.checked; save(); });

  // --- 時間→盤の状態 ---
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  function timeline() {
    const fr = anim().frames;
    const segs = []; let t = 0;
    fr.forEach((f, i) => {
      if (i > 0 && f.dur > 0) { segs.push({ kind: "move", from: fr[i - 1], to: f, t0: t, t1: t + f.dur }); t += f.dur; }
      const h = Math.max(f.hold, i === fr.length - 1 ? Math.max(f.hold, 0.8) : f.hold);
      segs.push({ kind: "hold", frame: f, t0: t, t1: t + h }); t += h;
    });
    return { segs, total: t };
  }
  function stateAt(tl, time) {
    const seg = tl.segs.find(s => time < s.t1) || tl.segs[tl.segs.length - 1];
    if (!seg) return null;
    if (seg.kind === "hold") return { snap: seg.frame.snap, lines: seg.frame.snap.lines, caption: seg.frame.name };
    const k = ease(Math.min(1, Math.max(0, (time - seg.t0) / (seg.t1 - seg.t0))));
    const A = seg.from.snap, B = seg.to.snap, out = clone(B);
    ["home", "away"].forEach(s => out[s].players.forEach((p, i) => {
      const q = A[s].players[i]; if (!q) return;
      p.x = q.x + (p.x - q.x) * k; p.y = q.y + (p.y - q.y) * k;
      if (q.hidden && !p.hidden) p.hidden = k < 0.5; // 途中で現れる
    }));
    out.ball.x = A.ball.x + (B.ball.x - A.ball.x) * k; out.ball.y = A.ball.y + (B.ball.y - A.ball.y) * k;
    out.ball.show = k < 0.5 ? A.ball.show : B.ball.show;
    return { snap: out, lines: A.lines, caption: seg.from.name };
  }

  // --- キャンバス描画（SVGと同じ見た目） ---
  const FONT = '"Hiragino Sans","Yu Gothic UI","Meiryo","Noto Sans JP",sans-serif';
  const CW = 1920, CH = 1080;
  const VB = { x: -70, y: -14, w: 1190, h: 708 };
  const SCALE = Math.min(CW / VB.w, CH / VB.h);
  const OX = (CW - VB.w * SCALE) / 2 - VB.x * SCALE, OY = (CH - VB.h * SCALE) / 2 - VB.y * SCALE;

  function pitchImage() {
    return new Promise((res, rej) => {
      const s = document.createElementNS(NS, "svg");
      s.setAttribute("xmlns", NS); s.setAttribute("viewBox", `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);
      s.setAttribute("width", Math.round(VB.w * SCALE)); s.setAttribute("height", Math.round(VB.h * SCALE));
      const root = el("g", { "font-family": FONT }, s);
      el("rect", { x: VB.x, y: VB.y, width: VB.w, height: VB.h, fill: board.opts.pitch === "green" ? "#2f6e3c" : "#ffffff" }, root);
      drawPitch(el("g", {}, root), board.opts.pitch);
      drawBanner(root, board.home, "home"); drawBanner(root, board.away, "away");
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(s)], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => rej(new Error("pitch"));
      img.src = url;
    });
  }

  function cvLine(ctx, ln) {
    ctx.save(); ctx.strokeStyle = ln.color; ctx.fillStyle = ln.color; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (ln.type === "arrow") {
      const [a, b] = ln.pts; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const hl = 22;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0] - Math.cos(ang) * hl * 0.8, b[1] - Math.sin(ang) * hl * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - Math.cos(ang - 0.45) * hl, b[1] - Math.sin(ang - 0.45) * hl);
      ctx.lineTo(b[0] - Math.cos(ang + 0.45) * hl, b[1] - Math.sin(ang + 0.45) * hl); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ln.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    }
    ctx.restore();
  }
  function cvPiece(ctx, p, team, side, names, green) {
    const dir = side === "home" ? 1 : -1; const fg = textColorOn(team.color);
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = team.color;
    ctx.beginPath(); ctx.moveTo(dir * 19, -8); ctx.lineTo(dir * 30, 0); ctx.lineTo(dir * 19, 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `800 ${String(p.no).length > 2 ? 14 : 17}px ${FONT}`; ctx.fillText(p.no, 0, 1);
    if (names && p.name) {
      ctx.font = `600 17px ${FONT}`; ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 5; ctx.lineJoin = "round"; ctx.strokeStyle = green ? "rgba(0,0,0,.55)" : "#fff"; ctx.strokeText(p.name, 0, 38);
      ctx.fillStyle = green ? "#fff" : "#111"; ctx.fillText(p.name, 0, 38);
    }
    ctx.restore();
  }
  function cvFrame(ctx, bg, st, caption) {
    ctx.fillStyle = board.opts.pitch === "green" ? "#2f6e3c" : "#ffffff"; ctx.fillRect(0, 0, CW, CH);
    ctx.drawImage(bg, (CW - bg.width) / 2, (CH - bg.height) / 2);
    ctx.save(); ctx.translate(OX, OY); ctx.scale(SCALE, SCALE);
    (st.lines || []).forEach(ln => cvLine(ctx, ln));
    const green = board.opts.pitch === "green";
    ["home", "away"].forEach(side => {
      const t = st.snap[side]; if (!t.show) return;
      t.players.forEach(p => { if (!p.hidden) cvPiece(ctx, p, t, side, board.opts.names, green); });
    });
    if (st.snap.ball.show) {
      const b = st.snap.ball; ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#111"; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#111"; ctx.fill();
    }
    ctx.restore();
    if (caption && st.caption) {
      ctx.save(); ctx.font = `700 44px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const w = ctx.measureText(st.caption).width + 56, h = 72, x = CW / 2, y = CH - 70;
      ctx.fillStyle = "rgba(20,28,24,.82)"; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 14); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(st.caption, x, y + 2); ctx.restore();
    }
  }

  // --- 再生・保存 ---
  let animRun = null;
  function stopAnim() { if (animRun) { cancelAnimationFrame(animRun.raf); animRun = null; } }
  async function playAnim(record) {
    const a = anim();
    if (a.frames.length < 2) { toast("コマが2つ以上いる"); return; }
    stopAnim();
    const dlg = $("#animDlg"), cv = $("#animCanvas"), ctx = cv.getContext("2d"), status = $("#animStatus");
    if (!dlg.open) dlg.showModal();
    $("#animSave").disabled = !!record; $("#animReplay").disabled = !!record;
    let bg; try { bg = await pitchImage(); } catch (e) { toast("盤を描けなかった"); return; }
    const tl = timeline(), caption = a.caption !== false;
    let rec = null, chunks = [], mime = "";
    if (record) {
      if (!("MediaRecorder" in window) || !cv.captureStream) { toast("この端末では動画を作れない。パソコンのChromeで試してくれ"); $("#animSave").disabled = false; return; }
      mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find(m => MediaRecorder.isTypeSupported(m)) || "";
      const stream = cv.captureStream(30);
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10e6 } : { videoBitsPerSecond: 10e6 });
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => finishRecord(chunks, rec.mimeType || mime, tl.total);
    }
    cvFrame(ctx, bg, stateAt(tl, 0), caption);
    const t0 = performance.now() + (record ? 300 : 0);
    if (rec) rec.start(200);
    const run = { raf: 0 };
    animRun = run;
    const tick = now => {
      if (animRun !== run) return;
      const t = Math.max(0, (now - t0) / 1000);
      cvFrame(ctx, bg, stateAt(tl, Math.min(t, tl.total)), caption);
      status.textContent = (record ? "動画を作っている… " : "") + `${fmtSec(Math.min(t, tl.total))} / ${fmtSec(tl.total)} 秒`;
      if (t < tl.total + (record ? 0.4 : 0)) { run.raf = requestAnimationFrame(tick); }
      else {
        animRun = null; status.textContent = record ? "書き出し中…" : `${fmtSec(tl.total)} 秒・${a.frames.length}コマ`;
        if (rec) rec.stop(); else { $("#animSave").disabled = false; $("#animReplay").disabled = false; }
      }
    };
    run.raf = requestAnimationFrame(tick);
  }
  async function finishRecord(chunks, mime, total) {
    $("#animSave").disabled = false; $("#animReplay").disabled = false;
    if (!chunks.length) { $("#animStatus").textContent = "動画を作れなかった"; return; }
    const ext = /mp4/.test(mime) ? "mp4" : "webm";
    const blob = new Blob(chunks, { type: mime || "video/" + ext });
    const fname = (board.title + "_動画").replace(/[\\/:*?"<>|\s]+/g, "_") + "." + ext;
    const file = new File([blob], fname, { type: blob.type });
    $("#animStatus").textContent = `${fmtSec(total)} 秒の動画（${ext.toUpperCase()}・${(blob.size / 1e6).toFixed(1)}MB）`;
    const touch = matchMedia("(pointer:coarse)").matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("動画を保存した");
  }
  $("#animPlay").addEventListener("click", () => playAnim(false));
  $("#animExport").addEventListener("click", () => playAnim(true));
  $("#animReplay").addEventListener("click", () => playAnim(false));
  $("#animSave").addEventListener("click", () => playAnim(true));
  $("#animClose").addEventListener("click", () => { stopAnim(); $("#animDlg").close(); });
  $("#animDlg").addEventListener("close", stopAnim);

  // ---------- メニュー ----------
  $("#menuBtn").addEventListener("click", () => $("#menuDlg").showModal());
  $("#newBlank").addEventListener("click", () => {
    $("#menuDlg").close();
    const b = newBoard(blankSource()); addLocal(b); setBoard(b);
    toast("白紙の盤を作った。チーム名と布陣を下で変えられる");
  });
  $("#importBtn").addEventListener("click", () => { $("#menuDlg").close(); $("#importText").value = ""; $("#importDlg").showModal(); });
  $("#importDlg").addEventListener("close", () => {
    if ($("#importDlg").returnValue !== "ok") return;
    importText($("#importText").value);
  });
  function importText(txt) {
    let data;
    try { data = JSON.parse(txt); } catch (e) { toast("形が読めなかった。貼り付け直してくれ"); return; }
    if (data && data.v === 1 && data.home && data.home.players && data.source) {
      // 書き出した盤そのもの
      data.id = data.id && data.id.startsWith("local-") ? data.id : "local-" + Date.now();
      addLocal(data); setBoard(data); toast("盤を読み込んだ"); return;
    }
    if (!data || !data.home || !data.away) { toast("ホームとアウェイが入っていない"); return; }
    data.id = "local-" + Date.now();
    const b = newBoard(data); addLocal(b); setBoard(b); toast("読み込んだ");
  }
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(board, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = board.title.replace(/[\\/:*?"<>|\s]+/g, "_") + ".json"; a.click();
  });
  $("#importFileBtn").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    $("#menuDlg").close(); importText(await f.text()); e.target.value = "";
  });
  $("#deleteBoard").addEventListener("click", () => {
    if (!confirm("この盤の書き込み（動かした位置・線・場面・メモ）を全部消す？")) return;
    $("#menuDlg").close();
    store.del(LS_PREFIX + board.id);
    if (board.id.startsWith("local-")) {
      store.set(LS_LOCAL, localList().filter(x => x.id !== board.id));
      start(); return;
    }
    openMatch(board.id);
  });

  $("#boardSelect").addEventListener("change", e => {
    const v = e.target.value;
    if (v.startsWith("m:")) openMatch(v.slice(2)); else openLocal(v.slice(2));
  });

  // ---------- 起動 ----------
  async function start() {
    await loadIndex();
    const hash = decodeURIComponent((location.hash.match(/m=([^&]+)/) || [])[1] || "");
    const last = store.get(LS_LAST);
    const want = [hash, last].find(id => id && (index.some(m => m.id === id) || store.get(LS_PREFIX + id)));
    if (want) {
      if (index.some(m => m.id === want)) await openMatch(want); else openLocal(want);
    } else if (index.length) {
      const latest = index.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
      await openMatch(latest.id);
    } else {
      const b = newBoard(blankSource()); addLocal(b); setBoard(b);
    }
  }
  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent((location.hash.match(/m=([^&]+)/) || [])[1] || "");
    if (board && id && id !== board.id) {
      if (index.some(m => m.id === id)) openMatch(id); else if (store.get(LS_PREFIX + id)) openLocal(id);
    }
  });
  window.FB_VERSION = VERSION;
  start();
})();
