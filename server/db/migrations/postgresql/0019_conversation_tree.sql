ALTER TABLE "chat" ADD COLUMN "leafId" text;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_leafId_message_id_fk" FOREIGN KEY ("leafId") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Today's chats are one branch: each user message and summary follows the user message saved before it.
UPDATE "message" AS m SET "parentId" = (
	SELECT p."id" FROM "message" AS p WHERE p."chatId" = m."chatId" AND p."role" = 'user' AND p."seq" < m."seq" ORDER BY p."seq" DESC LIMIT 1
) WHERE m."role" IN ('user', 'system');--> statement-breakpoint
UPDATE "chat" AS c SET "leafId" = (
	SELECT m."id" FROM "message" AS m WHERE m."chatId" = c."id" AND m."role" = 'user' ORDER BY m."seq" DESC LIMIT 1
);
