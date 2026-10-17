// 布陣 → 盤上の位置。盤は 1050×680（1m=10）、左チームは右向きに攻める。
// 選手の並び順（試合データの players）: GK → 後ろの列から前の列へ、各列は「右から左」（FotMobと同じ）。
(function () {
  const W = 1050, H = 680, MID = H / 2;

  const PRESETS = [
    "4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "4-4-1-1", "4-3-1-2", "4-1-2-1-2",
    "4-2-2-2", "4-3-2-1", "3-4-3", "3-4-2-1", "3-5-2", "3-4-1-2", "3-1-4-2",
    "5-3-2", "5-4-1", "5-2-3"
  ];

  function lines(form) {
    return String(form).split("-").map(n => parseInt(n, 10)).filter(n => n > 0);
  }

  function isValid(form) {
    const l = lines(form);
    return l.length >= 2 && l.reduce((a, b) => a + b, 0) === 10;
  }

  // 列ごとの横幅（中央からの片側の広がり）
  function spread(n, i, L) {
    if (n === 1) return 0;
    if (n === 2) return i === L - 1 ? 95 : 85;
    if (n === 3) {
      if (i === 0) return 165;                 // 3バック
      if (i === L - 1) return 215;             // 3トップ（両ウイング）
      if (L >= 4 && i === L - 2) return 200;   // 4-2-3-1 の 3
      return 150;                              // 中盤の3枚
    }
    if (n === 4) return i === 0 ? 245 : 235;
    return 270;                                // 5枚
  }

  // 自陣ゴールからの深さ（0〜1＝ハーフウェーラインまで）
  function depth(i, L) {
    const a = 0.30, b = 0.84;
    return L === 1 ? a : a + (b - a) * i / (L - 1);
  }

  // side: "home"（左・右向きに攻める）/ "away"（右・左向きに攻める）
  function slots(form, side) {
    const L = lines(form);
    const out = [];
    const put = (d, s) => {
      // s>0 = その選手から見て右側
      const half = W / 2;
      if (side === "home") out.push({ x: d * half, y: MID + s });
      else out.push({ x: W - d * half, y: MID - s });
    };
    put(0.085, 0); // GK
    L.forEach((n, i) => {
      const sp = spread(n, i, L.length);
      const d = depth(i, L.length);
      for (let j = 0; j < n; j++) {
        const s = n === 1 ? 0 : sp - (2 * sp) * j / (n - 1);
        put(d, s);
      }
    });
    return out;
  }

  window.Formations = { PRESETS, slots, isValid, W, H };
})();
