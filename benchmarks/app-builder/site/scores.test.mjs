// Run after ./make-scores.sh and ./make-gallery.sh:
// node --test benchmarks/app-builder/site/scores.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

test("benchmark page: themes, chart inspection, filtering, sorting, mobile and demos", async () => {
  const server = createServer(async (req, res) => {
    if (!["/scores.html", "/index.html"].includes(req.url)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      await readFile(new URL("../results/videos" + req.url, import.meta.url)),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = "http://127.0.0.1:" + server.address().port;
    await page.goto(base + "/scores.html");
    const theme = () => page.locator("html").getAttribute("data-theme");
    assert.equal(await theme(), "light");
    const models = await page.locator("#table tbody tr").count();
    assert(models >= 20);
    assert.equal(await page.locator("#tiles .tile").count(), 3);
    const rows = await page.evaluate("DATA.rows");
    const leader = rows
      .filter((r) => r.overall != null)
      .sort((a, b) => b.overall - a.overall)[0];
    const firstRow = await page.locator("#table tbody tr").first().innerText();
    assert(firstRow.includes(leader.name));
    assert(firstRow.includes((leader.overall * 100).toFixed(1) + "%"));
    const luna = rows.find((r) => r.slug === "gpt-6-luna");
    const lunaScore = (luna.overall * 100).toFixed(1) + "%";
    assert(
      (
        await page
          .locator("#table tbody tr")
          .filter({ hasText: "GPT-6 Luna" })
          .innerText()
      ).includes(lunaScore),
    );
    const n = await page.locator(".pt").count();
    assert.equal(await page.locator(".key-item").count(), n);
    assert.equal(
      n,
      rows.filter((r) => r.overall != null && r.costVerified && r.totalCost > 0)
        .length,
    );
    await page.locator('.key-item[data-slug="gpt-6-luna"]').click();
    assert(
      (await page.locator("#chart-detail").innerText()).includes(lunaScore),
    );
    await page.locator('.pt[data-slug="gpt-6-sol"]').focus();
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#chart-detail").innerText(), /GPT-6 Sol/);
    await page.selectOption("#theme", "dark");
    assert.equal(await theme(), "dark");
    await page.reload();
    assert.equal(await theme(), "dark");
    await page.selectOption("#theme", "system");
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await theme(), "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await page.locator("#top").click();
    assert.equal(await page.locator(".pt").count(), 5);
    await page.reload();
    assert.equal(await page.locator(".pt").count(), 5);
    await page.locator("#none").click();
    assert.equal(await page.locator(".pt").count(), 0);
    assert.match(
      await page.locator("#chart").innerText(),
      /Select a model with complete scores and verified costs/,
    );
    await page.locator("#all").click();
    assert.equal(await page.locator("#table tbody tr").count(), models);
    await page.locator("#search").fill("DeepSeek");
    assert.equal(
      await page.locator(".model-options").evaluate((e) => e.open),
      true,
    );
    assert.equal(await page.locator(".model-chip").count(), 1);
    await page.locator("#search").fill("");
    await page.locator('th[data-k="totalCost"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator('th[data-k="totalCost"]').getAttribute("aria-sort"),
      "ascending",
    );
    const videos = await page
      .locator(".demo video")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")));
    assert(videos.length >= 5);
    assert(videos.includes("demo-deepseek-v4.1-flash-all-apps.mp4"));
    assert(videos.includes("demo-claude-sonnet-5-5-all-apps.mp4"));
    assert.equal(
      await page.locator('.demo a[href*="deskhero-repeat1"]').count(),
      2,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.locator('.key-item[data-slug="gpt-6-luna"]').click();
    assert.match(await page.locator("#chart-detail").innerText(), /GPT-6 Luna/);
    await page.selectOption("#theme", "light");
    await page.goto(base + "/index.html");
    assert.equal(await theme(), "light");
    await page.selectOption("#theme", "dark");
    await page.goto(base + "/scores.html");
    assert.equal(await theme(), "dark");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
