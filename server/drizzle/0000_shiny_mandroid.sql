CREATE TABLE "apps" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"github_org" text,
	"github_repo" text,
	"github_branch" text,
	"supabase_project_id" text,
	"supabase_parent_project_id" text,
	"neon_project_id" text,
	"neon_development_branch_id" text,
	"neon_preview_branch_id" text,
	"vercel_project_id" text,
	"vercel_project_name" text,
	"vercel_team_id" text,
	"vercel_deployment_url" text,
	"install_command" text,
	"start_command" text,
	"chat_context" jsonb,
	"is_favorite" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" serial NOT NULL,
	"title" text,
	"initial_commit_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_model_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_base_url" text NOT NULL,
	"env_var_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"api_name" text NOT NULL,
	"builtin_provider_id" text,
	"custom_provider_id" text,
	"description" text,
	"max_output_tokens" integer,
	"context_window" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"transport" text NOT NULL,
	"command" text,
	"args" jsonb,
	"env_json" jsonb,
	"url" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"tool_name" text NOT NULL,
	"consent" text DEFAULT 'ask' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_mcp_consent" UNIQUE("server_id","tool_name")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"approval_state" text,
	"source_commit_hash" text,
	"commit_hash" text,
	"request_id" text,
	"max_tokens_used" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"commit_hash" text NOT NULL,
	"neon_db_timestamp" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "versions_app_commit_unique" UNIQUE("app_id","commit_hash")
);
--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_models" ADD CONSTRAINT "language_models_custom_provider_id_language_model_providers_id_fk" FOREIGN KEY ("custom_provider_id") REFERENCES "public"."language_model_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_consents" ADD CONSTRAINT "mcp_tool_consents_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;