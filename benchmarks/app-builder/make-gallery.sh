#!/bin/bash
# Build results/videos/index.html — a simple grid of the demo tour videos,
# rows = model, columns = app. Re-run after adding videos. No build step, no
# external assets: it must render from a bare static server on the tailnet.
set -uo pipefail
BENCH="$(cd "$(dirname "$0")" && pwd)"
DIR="$BENCH/results/videos"
mkdir -p "$DIR"
node - "$DIR" <<'EOF'
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.startsWith("demo-") && f.endsWith(".mp4")).sort();
// [model slug, label, cell-id suffix] — the suffix is the effort tag on sweep
// cells (`<model>-<app>-<effort>`); empty for the product-default cell.
const MODELS = [
  ["gpt-6-astra", "GPT 6 Astra · low effort (product default)", "-low"],
  ["gpt-6-astra", "GPT 6 Astra · medium effort", ""],
  ["gpt-5.6-sol", "GPT 5.6 Sol", ""],
  ["claude-fable-5-1", "Claude Fable 5.1", ""],
  ["claude-fable-5", "Claude Fable 5", ""],
];
const APPS = [["relay-crm", "Relay CRM"]];
const cell = (m, a, s = "") => files.find((f) => f === `demo-${m}-${a}${s}.mp4`);
// Benchmark stats for the cell shown: cost + build time from the cell summary,
// composite from the checkpoint scores (same formula as report.mjs: 60% CUJ +
// 25% probes + 15% judge, relay-crm suite sizes).
const RESULTS = path.resolve(dir, "..");
const CFG = { cujs: { 1: 10, 2: 12, 3: 12 }, probes: { 1: 2, 2: 6, 3: 8 }, isProbe: (id) => /-s\d/.test(id) };
function stats(cellId) {
  try {
    const sum = JSON.parse(fs.readFileSync(path.join(RESULTS, "s-cell", `${cellId}.summary.json`)));
    const cost = sum.milestones.reduce((t, m) => t + (m.estimatedUsd || 0), 0);
    const mins = Math.round(sum.milestones.reduce((t, m) => t + (m.durationMs || 0), 0) / 60000);
    let cujP = 0, cujT = 0, prP = 0, prT = 0, judge = 0, n = 0;
    for (const ck of [1, 2, 3]) {
      cujT += CFG.cujs[ck]; prT += CFG.probes[ck];
      const f = path.join(RESULTS, "s-score", `${cellId}-ckpt${ck}-a1.json`);
      if (!fs.existsSync(f)) continue;
      n++;
      const x = JSON.parse(fs.readFileSync(f));
      if (x.buildStatus !== "ok") continue;
      const pf = x.failures.filter(CFG.isProbe).length;
      cujP += CFG.cujs[ck] - (x.failures.length - pf); prP += CFG.probes[ck] - pf;
      const jf = path.join(RESULTS, "judge", `${cellId}-m${ck}.json`);
      if (fs.existsSync(jf)) judge += JSON.parse(fs.readFileSync(jf)).judgeScore;
    }
    const comp = n === 3 ? 0.6 * (cujP / cujT) + 0.25 * (prP / prT) + 0.15 * (judge / n) : null;
    return { cost, mins, comp, cujP, cujT, prP, prT };
  } catch { return null; }
}
const statLine = (st) => !st ? "" :
  `<div class="stats"><span><b>${st.comp == null ? "n/a" : (st.comp * 100).toFixed(1) + "%"}</b> composite</span>` +
  `<span><b>$${st.cost.toFixed(2)}</b> to build</span><span><b>${st.mins} min</b> build time</span>` +
  `<span class="dim">CUJ ${st.cujP}/${st.cujT} · probes ${st.prP}/${st.prT}</span></div>`;
const mb = (f) => (fs.statSync(path.join(dir, f)).size / 1e6).toFixed(1);
let cards = "";
for (const [m, mLabel, sfx] of MODELS) {
  cards += `<h2>${mLabel}</h2>${statLine(stats(`${m}-relay-crm${sfx}`))}<div class="row">`;
  for (const [a, aLabel] of APPS) {
    const f = cell(m, a, sfx);
    cards += f
      ? `<figure><figcaption>${aLabel} <span class="meta">${mb(f)} MB</span></figcaption>
           <video controls preload="metadata" playsinline src="${f}"></video></figure>`
      : `<figure class="missing"><figcaption>${aLabel}</figcaption><div class="ph">not recorded</div></figure>`;
  }
  cards += `</div>`;
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App-builder demo tours</title>
<style>${fs.readFileSync(path.resolve(dir, "../../site/scores.css"), "utf8")}</style>
<script>try { const t=localStorage.getItem('appbench.theme')||'system'; document.documentElement.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t; } catch { document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'; }</script>
<div class="wrap gallery"><div class="topbar"><a class="brand" href="scores.html">dyad<span>/ benchmarks</span></a><nav class="topnav"><a href="scores.html#demos">Latest demos</a><label class="theme-label"><span>Appearance</span><select id="theme" aria-label="Color theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></nav></div>
<p class="eyebrow">From the archive</p><h1>Relay CRM demo tours</h1>
<p class="sub"><a href="scores.html" >Scores &amp; costs across all three apps →</a></p>
<p class="sub">Each video is one continuous walkthrough of the finished app (checkpoint 3), recorded at 1.5× zoom with slowed pacing and a step banner. Generated ${new Date().toISOString().slice(0,16).replace("T"," ")} UTC.</p>
${cards}
<p class="tips">Tip: use the browser's playback-speed control to slow down further; videos are 1600×1000 H.264.</p></div>
<script>
const control=document.getElementById('theme'), system=matchMedia('(prefers-color-scheme: dark)');
try { control.value=localStorage.getItem('appbench.theme')||'system'; } catch {}
const apply=()=>{document.documentElement.dataset.theme=control.value==='system'?(system.matches?'dark':'light'):control.value;};
control.addEventListener('change',()=>{try{localStorage.setItem('appbench.theme',control.value);}catch{} apply();});system.addEventListener('change',apply);apply();
</script>`;
fs.writeFileSync(path.join(dir, "index.html"), html);
console.log(`gallery: ${files.length} videos -> ${path.join(dir, "index.html")}`);
EOF
