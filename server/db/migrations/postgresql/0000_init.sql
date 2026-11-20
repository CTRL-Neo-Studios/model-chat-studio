CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"title" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"systemPrompt" text,
	"params" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatShare" (
	"chatId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatShare_chatId_userId_pk" PRIMARY KEY("chatId","userId")
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid,
	"chatId" uuid,
	"messageId" text,
	"blobPath" text NOT NULL,
	"fileName" text,
	"mediaType" text NOT NULL,
	"size" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codeHash" text NOT NULL,
	"createdBy" uuid,
	"maxUses" integer DEFAULT 1 NOT NULL,
	"useCount" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codeHash_unique" UNIQUE("codeHash")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "message_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chatId" uuid NOT NULL,
	"parentId" text,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelSetting" (
	"platform" text NOT NULL,
	"modelId" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priceInput" numeric(16, 8),
	"priceCachedInput" numeric(16, 8),
	"priceOutput" numeric(16, 8),
	CONSTRAINT "modelSetting_platform_modelId_pk" PRIMARY KEY("platform","modelId")
);
--> statement-breakpoint
CREATE TABLE "providerFile" (
	"fileId" uuid NOT NULL,
	"platform" text NOT NULL,
	"keyHash" text NOT NULL,
	"remoteId" text NOT NULL,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providerFile_fileId_platform_keyHash_pk" PRIMARY KEY("fileId","platform","keyHash")
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usageEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"chatId" uuid,
	"kind" text NOT NULL,
	"platform" text NOT NULL,
	"model" text,
	"provider" text,
	"inputTokens" integer,
	"cachedInputTokens" integer,
	"outputTokens" integer,
	"reasoningTokens" integer,
	"costUsd" numeric(16, 8),
	"byok" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"githubId" bigint NOT NULL,
	"username" text NOT NULL,
	"name" text,
	"email" text,
	"avatarUrl" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"banReason" text,
	"banExpires" timestamp with time zone,
	"monthlyBudgetUsd" numeric(16, 8),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_githubId_unique" UNIQUE("githubId")
);
--> statement-breakpoint
CREATE TABLE "userApiKey" (
	"userId" uuid NOT NULL,
	"platform" text NOT NULL,
	"ciphertext" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "userApiKey_userId_platform_pk" PRIMARY KEY("userId","platform")
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"chatId" uuid NOT NULL,
	"messageId" text NOT NULL,
	"isUpvoted" boolean NOT NULL,
	CONSTRAINT "vote_chatId_messageId_pk" PRIMARY KEY("chatId","messageId")
);
--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatShare" ADD CONSTRAINT "chatShare_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatShare" ADD CONSTRAINT "chatShare_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_messageId_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_parentId_message_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providerFile" ADD CONSTRAINT "providerFile_fileId_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usageEvent" ADD CONSTRAINT "usageEvent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usageEvent" ADD CONSTRAINT "usageEvent_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userApiKey" ADD CONSTRAINT "userApiKey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_messageId_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_userId_createdAt_index" ON "chat" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "chatShare_userId_index" ON "chatShare" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "file_chatId_index" ON "file" USING btree ("chatId");--> statement-breakpoint
CREATE INDEX "message_chatId_seq_index" ON "message" USING btree ("chatId","seq");--> statement-breakpoint
CREATE INDEX "usageEvent_userId_createdAt_index" ON "usageEvent" USING btree ("userId","createdAt");