# Adding a model to the benchmark (checklist)

Do these in order; each step exists because skipping it once produced a
wrong number (see traps.md).

1. **Find it in the live catalog** and pin the catalog.

   ```bash
   curl -sf https://api.dyad.sh/v1/language-model-catalog -o catalog/catalog-$(date +%F).json
   node -e "const c=require('./catalog/catalog-$(date +%F).json');for(const [p,ms] of Object.entries(c.modelsByProvider))for(const m of ms)if(/<name>/i.test(m.apiName+m.displayName))console.log(p,JSON.stringify(m))"
   ```

   Note the provider id (this is the spec prefix: `openai/`, `anthropic/`,
   `google/`, `openrouter/<vendor>/…`), `maxOutputTokens` (sanity-check it
   against the provider's context accounting), and
   `effortSettings.defaultEffortLevel` (that is what "product default" means
   for this model — record it, it can change between pins).
   Never overwrite an existing pin: historical runs reference them.

2. **Pin list pricing** in `pricing/pricing.json` under `models`, keyed by the
   api name (`gemini-3.8-flash`, `meta/muse-spark-1.3`; the proxy matches the
   longest key contained in the wire model string). Fields: `input`,
   `cachedInput`, `output`, optional `cacheWrite`, optional `tiers`
   `{threshold, input, cachedInput, output[, cacheWrite]}` when a prompt-size
   threshold re-prices the whole request. Use the vendor's LIST rate (never a
   promo, batch, flex or "contributor" rate) and append provenance + date to
   the top-level `note`. Web-search the vendor's pricing page and cross-check
   one aggregator; state both sources in the note.

3. **Register it** in three places (keep the slug identical everywhere):
   - `report.mjs` `MODELS` (`name`, `slug`, `vendor`; a new vendor also needs a
     colour in both `VENDOR_COLOR` palettes). Add to `EFFORT_MODELS` if you
     run more than one tier. If the product default is not `medium`, set
     `headlineSuffix` so the headline row uses the right cells.
   - `make-scores.sh` `MODELS` (adds `effort` badge text) and `VENDOR_COLOR`.
   - `make-gallery.sh` `MODELS` only if you record a demo video.
     The slug is what `appbench_cell.eval.ts` derives from the spec: strip the
     provider, replace anything outside `[a-z0-9.-]` with `_` —
     `openrouter/z-ai/glm-5.3` → `z-ai_glm-5.3`.

4. **Run** with `scripts/run-arm.sh` (see SKILL.md), then
   `scripts/verify-ledger.mjs` on every cell before reading any score.

5. **Regenerate**: `node report.mjs && ./make-scores.sh` (and
   `./make-gallery.sh` after recording tours). Read the new row for
   `partial`/`built` placeholders — they mean a checkpoint is unscored.
