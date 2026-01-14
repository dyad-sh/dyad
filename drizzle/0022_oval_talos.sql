CREATE TABLE `vector_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_source` text NOT NULL,
	`version` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`embedding_model` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
