ALTER TABLE "chats" ALTER COLUMN "app_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;