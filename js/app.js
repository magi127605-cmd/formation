// 布陣ボード本体。盤は SVG 1枚（1050×680、1m=10）。書き込みはこの端末（localStorage）に盤ごとに残す。
(function () {
  const { W, H, PRESETS, slots, isValid } = window.Formations;
  const NS = "http://www.w3.org/2000/svg";
  const LS_PREFIX = "fb:board:";
  const LS_LOCAL = "fb:local";   // この端末で作った盤（白紙・貼り付け）の一覧
  const LS_LAST = "fb:last";
  const VERSION = "1.0.0";

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
