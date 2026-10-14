CREATE TABLE "admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"volume" integer,
	"dj_role_id" text,
	"delete_old_np" boolean DEFAULT true NOT NULL,
	"last_text_channel_id" text,
	"last_voice_channel_id" text,
	"default_filter" text DEFAULT 'off' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"allowed" boolean DEFAULT false NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lavalink_session" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"session_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"track" jsonb NOT NULL,
	"requester_id" text NOT NULL,
	"requester_name" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_state" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"current_item_id" text,
	"position_ms" integer DEFAULT 0 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"loop_mode" text DEFAULT 'off' NOT NULL,
	"filter" text DEFAULT 'off' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"playlist_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"encoded_track" text NOT NULL,
	"info" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_store" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radio_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "radio_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"base_url" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"guild_id" text NOT NULL,
	"voice_channel_id" text NOT NULL,
	"started_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_history_guild_started_idx" ON "play_history" USING btree ("guild_id","started_at");--> statement-breakpoint
CREATE INDEX "playlist_items_idx" ON "playlist_items" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX "playlists_owner_idx" ON "playlists" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "radio_sources_base_url_uq" ON "radio_sources" USING btree ("base_url");--> statement-breakpoint
CREATE UNIQUE INDEX "web_sessions_token_hash_uq" ON "web_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "web_sessions_guild_idx" ON "web_sessions" USING btree ("guild_id");