# Chat modes

- Always prefer Agent mode (`local-agent`) over legacy Build mode (`build`) when adding new features or updating existing features that select or create a writable chat mode. Exhausted Basic Agent quota must preserve Agent mode and surface a user-facing quota error with explicit Upgrade and Switch to Build actions; never silently run the turn in Build mode. Use Build automatically only when a documented legacy-only constraint requires it, and reuse the centralized mode-resolution logic instead of adding feature-specific entitlement checks.
