CREATE TABLE "turnTrace" (
	"messageId" text PRIMARY KEY NOT NULL,
	"blocks" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "turnTrace" ADD CONSTRAINT "turnTrace_messageId_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;