CREATE TABLE "pin" (
	"userId" uuid NOT NULL,
	"kind" text NOT NULL,
	"targetId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_userId_kind_targetId_pk" PRIMARY KEY("userId","kind","targetId")
);
--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;