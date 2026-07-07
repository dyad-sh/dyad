# Promo Message Improvements (streaming-time promos)

## Implementation (shipped in this PR)

- `promo_click` PostHog event (with `messageId`), exempted from the non-Pro 10% sampling in `shouldBypassNonProTelemetrySampling` — promos only show to non-Pro users, so sampling would have dropped 90% of clicks.
- Pro promo clicks open the in-app `DyadProTrialDialog` (no browser context switch); the dialog now takes a `utmCampaign` prop so checkout/learn-more traffic is attributed per message (`streaming-promo-<messageId>`).
- Promo is picked at stream start and persists after the stream ends; a new stream rotates to a new one. Hidden in test mode to keep e2e snapshots stable.
- Rotation rebalanced: 4 Pro promos (trial, Agent mode, Pro tools, all models) at 3x weight vs 3 community tips (GitHub, Reddit, X) at 1x → ~80% Pro. Dropped Smart Context/Turbo Edits and doc tips.
- Visual: bordered card using theme tokens (dark-mode safe), button-styled CTA, dismiss "×" that suppresses promos for 7 days via localStorage.
- Skipped per decision: impression events, contextual/quantified copy.

## Current state (src/components/chat/PromoMessage.tsx, MessagesList.tsx)

- Shown only while `isStreaming` to non-Pro users (`!settings?.enableDyadPro && !userBudget`), then **disappears the moment the stream ends** — exactly when the user's attention returns to the chat.
- Small text-only banner: `bg-blue-50 text-blue-700`, **no dark-mode variants** (looks broken/harsh in dark theme, which most devs use).
- 12 messages rotate randomly by hash; **only 2 of 12 are Pro promos** (~17% of impressions). The rest are community/docs tips (Reddit, GitHub star, roadmap, report-a-bug).
- **Zero analytics**: no PostHog impression/click events, no UTM params on the promo links (every other upgrade surface in the app has `utm_campaign`). We can't measure CTR or conversion per message.
- No frequency capping, no dismiss, no targeting — the same random banner on every stream forever → banner blindness.
- Messaging is feature-jargon-led ("Turbo Edits", "Smart Context") with no offer. Meanwhile the app _has_ a 3-day free trial (`trialCode=1PRO30`, used by DyadProTrialDialog/SetupBanner) that none of these messages mention.

## Why it underperforms

1. **Ephemeral + mid-task**: users watch code stream; clicking a link mid-stream context-switches them to a browser while their build is running. The moment of attention is _right after_ the stream, and that's when we remove the banner.
2. **Looks like an info notice**, not an offer — no icon, no button, no visual weight.
3. **Diluted inventory**: 83% of the slot is spent on non-conversion tips.
4. **No offer, no proof, no numbers**: "Get Dyad Pro for faster edits with Turbo Edits" means nothing to someone who doesn't know what Turbo Edits is.
5. **Unmeasurable**: no way to know which message works.

## Ideas, prioritized

### P0 — Measure first

- PostHog `promo_impression` / `promo_click` events with a stable `messageId`.
- Per-message `utm_campaign` (e.g. `utm_campaign=streaming-promo-turbo-edits`).

### P0 — Click opens the in-app trial dialog, not the browser

- Promo click → open existing `DyadProTrialDialog` (no context switch, stream keeps going).
- Dialog already sells the trial and routes warm traffic to checkout with trial code.

### P1 — Persist past stream end

- Keep the promo visible after streaming completes (until next user message, or dismissible), or animate it into a slightly stronger card on stream end: "That took 84s — Pro's Turbo mode is ~2x faster."

### P1 — Offer-led, quantified copy

- Lead with the trial: "Try Dyad Pro free for 3 days" beats "Get Dyad Pro".
- Use real numbers from the session where possible (tokens sent → Smart Context savings; elapsed stream time → speed; error/retry detected → Agent mode auto-debugging).
- Benefit language, not feature names: "Stop juggling API keys — one plan with GPT-5.5 + Claude Opus", "Fix errors automatically with Agent mode".

### P1 — Rebalance rotation

- Split tips from promos. Streaming slot: mostly Pro promos for users past an engagement threshold (e.g. >N messages / >1 app); tips for brand-new users.
- Move community tips (Reddit, GitHub star) to low-intent surfaces: empty states, post-deploy success.

### P2 — Visual upgrade (still tasteful)

- Sparkles/gradient accent consistent with DyadProTrialDialog, real button-styled CTA, dark-mode support, subtle fade-in.
- Optional dismiss ("×") that suppresses promos for ~7 days.

### P2 — Frequency/lifecycle

- Cap impressions per day; escalate offer strength with usage; stop showing a message a user has clicked.

## Link destination: dyad.sh/pro vs academy sign-in→checkout

- **Education-style messages** (user may not know what Pro is) → `https://www.dyad.sh/pro?utm_...` — consideration page, low bounce.
- **Direct-offer messages** ("Start your free 3-day trial") → `https://academy.dyad.sh/redirect-to-checkout?trialCode=1PRO30&utm_...` — same pattern the app already uses. Prefer this over hardcoding `/sign-in?redirect_url=...`: the redirect endpoint owns the auth flow (survives auth changes) and carries the trial code.
- **Best of both**: click → in-app `DyadProTrialDialog`, which offers "Start Free Trial" (checkout) and "Learn more" (/pro). Warm the user before the sign-in wall.
