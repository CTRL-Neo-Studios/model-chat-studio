ALTER TABLE "chat" ADD COLUMN "projectId" uuid;--> statement-breakpoint
ALTER TABLE "chatFolder" ADD COLUMN "projectId" uuid;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatFolder" ADD CONSTRAINT "chatFolder_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;