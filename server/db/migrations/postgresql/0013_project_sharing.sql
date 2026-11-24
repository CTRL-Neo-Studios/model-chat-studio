CREATE TABLE "projectMember" (
	"projectId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projectMember_projectId_userId_pk" PRIMARY KEY("projectId","userId")
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "projectVisible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projectMember" ADD CONSTRAINT "projectMember_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projectMember" ADD CONSTRAINT "projectMember_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projectMember_userId_index" ON "projectMember" USING btree ("userId");