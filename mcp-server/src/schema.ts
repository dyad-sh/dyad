/**
 * Database schema definitions
 * 
 * These match the Dyad database schema
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const apps = sqliteTable("apps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
  favorite: integer("favorite", { mode: "boolean" }).default(false),
  template: text("template"),
});

export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appId: integer("appId")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New Chat"),
  createdAt: text("createdAt").notNull(),
  initialCommitHash: text("initialCommitHash"),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chatId")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("createdAt").notNull(),
  approvalState: text("approvalState"),
  commitHash: text("commitHash"),
  requestId: text("requestId"),
  totalTokens: integer("totalTokens"),
});
