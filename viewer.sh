# Used to start viewer server (in prod).
# Avoid over-logging.
MESOP_HTTP_CACHE_JS_BUNDLE=true MESOP_WEB_COMPONENTS_HTTP_CACHE_KEY=$(awk 'BEGIN { srand(); print int(rand() * 10^18) }') DYAD_LOG_LEVELS=WARNING DYAD_APP_MODE=viewer DYAD_WORKSPACE_DIR=. MESOP_STATIC_FOLDER=./src/dyad_app/static uv run gunicorn viewer:mesop
