CREATE TABLE "chatFolder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"parentId" uuid,
	"name" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "folderId" uuid;--> statement-breakpoint
ALTER TABLE "chatFolder" ADD CONSTRAINT "chatFolder_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatFolder" ADD CONSTRAINT "chatFolder_parentId_chatFolder_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."chatFolder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chatFolder_userId_index" ON "chatFolder" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_folderId_chatFolder_id_fk" FOREIGN KEY ("folderId") REFERENCES "public"."chatFolder"("id") ON DELETE set null ON UPDATE no action;