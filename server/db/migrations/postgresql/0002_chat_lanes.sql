CREATE TABLE "chatModel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatId" uuid NOT NULL,
	"position" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"name" text,
	"color" text,
	"platform" text,
	"modelId" text,
	"systemPrompt" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "chatModelId" uuid;--> statement-breakpoint
ALTER TABLE "chatModel" ADD CONSTRAINT "chatModel_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chatModel_chatId_position_index" ON "chatModel" USING btree ("chatId","position");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_chatModelId_chatModel_id_fk" FOREIGN KEY ("chatModelId") REFERENCES "public"."chatModel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Every chat gets one lane from its model settings and system prompt. A chosen model belongs to the platform of
-- the chat's last answer, else the active platform.
INSERT INTO "chatModel" ("chatId", "position", "platform", "modelId", "systemPrompt", "params")
SELECT
	c."id",
	0,
	CASE WHEN c."params"->>'model' IS NULL THEN NULL ELSE COALESCE(
		(SELECT m."metadata"->>'platform' FROM "message" m WHERE m."chatId" = c."id" AND m."role" = 'assistant' AND m."metadata"->>'platform' IS NOT NULL ORDER BY m."seq" DESC LIMIT 1),
		(SELECT s."value" #>> '{}' FROM "setting" s WHERE s."key" = 'inferencePlatform'),
		'openrouter'
	) END,
	c."params"->>'model',
	c."systemPrompt",
	CASE WHEN jsonb_typeof(c."params") = 'object' THEN c."params" - 'model' - 'webSearch' ELSE '{}'::jsonb END
FROM "chat" c;--> statement-breakpoint
UPDATE "message" m SET "chatModelId" = l."id" FROM "chatModel" l WHERE l."chatId" = m."chatId" AND m."role" = 'assistant';--> statement-breakpoint
UPDATE "chat" SET "settings" = jsonb_strip_nulls(jsonb_build_object('webSearch', "params"->'webSearch'));--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "systemPrompt";--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "params";
