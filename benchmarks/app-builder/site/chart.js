// Numbered points share a ranked key: every model remains identifiable without
// overlapping labels. Details work with pointer, touch, and keyboard input.
let inspectedSlug = null;
function renderChart() {
  const v = visible()
    .filter((r) => r.overall != null && r.costVerified && r.totalCost > 0)
    .sort((a, b) => b.overall - a.overall);
  const el = document.getElementById("chart");
  const key = document.getElementById("chart-key");
  const detail = document.getElementById("chart-detail");
  if (!v.length) {
    el.innerHTML =
      '<p class="empty">Select a model with complete scores and verified costs to compare value.</p>';
    key.innerHTML = "";
    detail.textContent =
      "Quality scores with incomplete costs remain in the table below.";
    document.getElementById("legend").innerHTML = "";
    return;
  }
  const W = Math.max(310, Math.round(el.clientWidth)),
    H = 410;
  const L = 44,
    R = 20,
    T = 42,
    B = 52;
  const costs = v.map((r) => r.totalCost),
    scores = v.map((r) => r.overall * 100);
  let lo = Math.log10(Math.min(...costs)) - 0.15,
    hi = Math.log10(Math.max(...costs)) + 0.15;
  if (hi - lo < 0.7) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.35;
    hi = mid + 0.35;
  }
  const x = (c) => L + ((hi - Math.log10(c)) / (hi - lo)) * (W - L - R);
  let minY = Math.max(0, Math.floor((Math.min(...scores) - 5) / 10) * 10);
  const maxY = 100;
  if (maxY - minY < 20) minY = maxY - 20;
  const y = (score) => T + ((maxY - score * 100) / (maxY - minY)) * (H - T - B);
  let svg =
    '<text x="' +
    L +
    '" y="17" fill="var(--muted)" font-size="11">Overall score ↑</text>';
  for (let s = minY; s <= maxY; s += 10) {
    svg +=
      '<line x1="' +
      L +
      '" x2="' +
      (W - R) +
      '" y1="' +
      y(s / 100) +
      '" y2="' +
      y(s / 100) +
      '" stroke="var(--grid)" stroke-dasharray="3 5"/>';
    svg +=
      '<text x="' +
      (L - 10) +
      '" y="' +
      (y(s / 100) + 4) +
      '" fill="var(--muted)" text-anchor="end" font-size="11">' +
      s +
      "</text>";
  }
  const ticks = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++)
    for (const m of [1, 2, 5]) {
      const c = m * 10 ** e;
      if (Math.log10(c) >= lo && Math.log10(c) <= hi) ticks.push(c);
    }
  let lastX = -Infinity;
  for (const c of ticks.sort((a, b) => b - a)) {
    const xx = x(c);
    if (xx - lastX < 50) continue;
    lastX = xx;
    svg +=
      '<text x="' +
      xx +
      '" y="' +
      (H - B + 24) +
      '" text-anchor="middle" font-size="11" fill="var(--muted)">$' +
      +c.toFixed(2) +
      "</text>";
  }
  svg +=
    '<text x="' +
    (W - R) +
    '" y="' +
    (H - 5) +
    '" text-anchor="end" font-size="11" fill="var(--muted)">Build cost · log scale · cheaper →</text>';
  const pts = v.map((r, i) => ({
    r,
    n: i + 1,
    x: x(r.totalCost),
    y: y(r.overall),
  }));
  svg +=
    '<defs><filter id="bubble-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#061426" flood-opacity=".2"/></filter>' +
    pts
      .map(
        (p) =>
          '<radialGradient id="bubble-' +
          p.n +
          '" cx="32%" cy="22%" r="85%"><stop offset="0%" stop-color="' +
          (VC[p.r.vendor] || "#64748b") +
          '"/><stop offset="100%" stop-color="' +
          (VC[p.r.vendor] || "#64748b") +
          '" style="stop-color:color-mix(in srgb,' +
          (VC[p.r.vendor] || "#64748b") +
          ',black 22%)"/></radialGradient>',
      )
      .join("") +
    "</defs>";
  const labelMeasure = document.createElement("canvas").getContext("2d");
  labelMeasure.font = "700 15px " + getComputedStyle(el).fontFamily;
  const boxes = pts.map((p) => ({ x: p.x - 13, y: p.y - 13, w: 26, h: 26 }));
  const collides = (b) =>
    boxes.some(
      (a) =>
        b.x < a.x + a.w &&
        b.x + b.w > a.x &&
        b.y < a.y + a.h &&
        b.y + b.h > a.y,
    );
  for (const p of pts) {
    // Direct names are a convenience; the numbered key is authoritative when
    // there is no clear label position (especially on small screens).
    let label = "";
    if (W > 500 && (v.length <= 10 || p.n <= 3)) {
      const w = Math.ceil(labelMeasure.measureText(p.r.name).width) + 4;
      const candidates = [
        { x: p.x + 18, y: p.y - 26, w, h: 22 },
        { x: p.x - w - 18, y: p.y - 26, w, h: 22 },
        { x: p.x + 18, y: p.y + 6, w, h: 22 },
        { x: p.x - w - 18, y: p.y + 6, w, h: 22 },
      ];
      const b = candidates.find(
        (b) =>
          b.x >= L &&
          b.x + b.w <= W - R &&
          b.y >= T &&
          b.y + b.h < H - B &&
          !collides(b),
      );
      if (b) {
        boxes.push(b);
        label =
          '<text class="chart-label" x="' +
          b.x +
          '" y="' +
          (b.y + 17) +
          '" font-size="15" font-weight="700" fill="var(--ink)">' +
          p.r.name +
          "</text>";
      }
    }
    svg +=
      '<g class="pt" tabindex="0" role="button" data-slug="' +
      p.r.slug +
      '" style="--bubble:' +
      (VC[p.r.vendor] || "#64748b") +
      '" aria-label="' +
      p.r.name +
      ", " +
      pct(p.r.overall) +
      ", " +
      money(p.r.totalCost) +
      '"><title>' +
      p.r.name +
      " · " +
      pct(p.r.overall) +
      " · " +
      money(p.r.totalCost) +
      '</title><circle cx="' +
      p.x +
      '" cy="' +
      p.y +
      '" r="20" fill="transparent"/><circle class="bubble-halo" cx="' +
      p.x +
      '" cy="' +
      p.y +
      '" r="17" fill="var(--bubble)"/><circle class="marker" cx="' +
      p.x +
      '" cy="' +
      p.y +
      '" r="12.5" fill="url(#bubble-' +
      p.n +
      ')" stroke="var(--panel)" stroke-width="1.5" filter="url(#bubble-shadow)"/><circle cx="' +
      p.x +
      '" cy="' +
      p.y +
      '" r="11" fill="none" stroke="white" stroke-opacity=".2" stroke-width=".7" pointer-events="none"/><text x="' +
      p.x +
      '" y="' +
      (p.y + 3.5) +
      '" text-anchor="middle" font-size="10" font-weight="700" fill="white" pointer-events="none">' +
      p.n +
      "</text>" +
      label +
      "</g>";
  }
  el.innerHTML =
    '<svg viewBox="0 0 ' +
    W +
    " " +
    H +
    '" role="group" aria-label="Score and cost comparison. Select a numbered model for details.">' +
    svg +
    "</svg>";
  key.innerHTML = v
    .map(
      (r, i) =>
        '<button class="key-item" data-slug="' +
        r.slug +
        '" type="button"><span class="key-num" style="--c:' +
        VC[r.vendor] +
        '">' +
        (i + 1) +
        '</span><span class="key-name">' +
        r.name +
        '</span><span class="key-metrics"><strong>' +
        pct(r.overall) +
        '</strong><span class="key-price" title="Total build cost across three apps; excludes judging">' +
        money(r.totalCost) +
        " build</span></span></button>",
    )
    .join("");
  const inspect = (slug) => {
    inspectedSlug = slug;
    const r = v.find((r) => r.slug === slug);
    for (const item of key.querySelectorAll(".key-item")) {
      const active = item.dataset.slug === slug;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    }
    for (const item of el.querySelectorAll(".pt")) {
      const active = item.dataset.slug === slug;
      item.classList.toggle("selected", active);
      item.setAttribute("aria-pressed", String(active));
    }
    detail.innerHTML =
      '<div class="detail-line"><b>' +
      r.name +
      "</b><span><b>" +
      pct(r.overall) +
      "</b> overall</span><span><b>" +
      money(r.totalCost) +
      "</b> build cost</span><span>" +
      r.totalMin +
      " min · " +
      r.effort +
      ' effort</span></div><div class="detail-line">' +
      APPS.map(
        (a) =>
          "<span>" +
          DATA.apps[a].label +
          " <b>" +
          pct(r.perApp[a]?.composite) +
          "</b></span>",
      ).join("") +
      "</div>";
  };
  for (const item of key.querySelectorAll(".key-item"))
    item.addEventListener("click", () => inspect(item.dataset.slug));
  for (const item of el.querySelectorAll(".pt")) {
    item.addEventListener("click", () => inspect(item.dataset.slug));
    item.addEventListener("focus", () => inspect(item.dataset.slug));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inspect(item.dataset.slug);
      }
    });
  }
  inspect(v.some((r) => r.slug === inspectedSlug) ? inspectedSlug : v[0].slug);
  document.getElementById("legend").innerHTML = [
    ...new Set(v.map((r) => r.vendor)),
  ]
    .map(
      (v) => '<span><i style="background:' + VC[v] + '"></i>' + v + "</span>",
    )
    .join("");
}
let chartResizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(renderChart, 120);
});
