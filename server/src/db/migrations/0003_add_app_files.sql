-- Migration: Add app_files table
-- Created: 2025-12-13

CREATE TABLE IF NOT EXISTS "app_files" (
  "id" SERIAL PRIMARY KEY,
  "app_id" INTEGER NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
  "path" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT "app_files_app_path_unique" UNIQUE("app_id", "path")
);

CREATE INDEX "app_files_app_id_idx" ON "app_files"("app_id");
CREATE INDEX "app_files_path_idx" ON "app_files"("path");
