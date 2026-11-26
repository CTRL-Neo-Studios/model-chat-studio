CREATE TABLE "listingReport" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listingId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolvedBy" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "star" (
	"userId" uuid NOT NULL,
	"listingId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "star_userId_listingId_pk" PRIMARY KEY("userId","listingId")
);
--> statement-breakpoint
CREATE TABLE "starList" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "starListItem" (
	"listId" uuid NOT NULL,
	"listingId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "starListItem_listId_listingId_pk" PRIMARY KEY("listId","listingId")
);
--> statement-breakpoint
ALTER TABLE "listing" ADD COLUMN "stars" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "listingVersion" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "listingVersion" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "listingVersion" ADD COLUMN "reviewedBy" uuid;--> statement-breakpoint
ALTER TABLE "listingVersion" ADD COLUMN "reviewedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listingReport" ADD CONSTRAINT "listingReport_listingId_listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listingReport" ADD CONSTRAINT "listingReport_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listingReport" ADD CONSTRAINT "listingReport_resolvedBy_user_id_fk" FOREIGN KEY ("resolvedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "star" ADD CONSTRAINT "star_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "star" ADD CONSTRAINT "star_listingId_listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starList" ADD CONSTRAINT "starList_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starListItem" ADD CONSTRAINT "starListItem_listId_starList_id_fk" FOREIGN KEY ("listId") REFERENCES "public"."starList"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starListItem" ADD CONSTRAINT "starListItem_listingId_listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listingReport_status_createdAt_index" ON "listingReport" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "listingReport_open_once" ON "listingReport" USING btree ("listingId","userId") WHERE "listingReport"."status" = 'open';--> statement-breakpoint
CREATE INDEX "star_listingId_index" ON "star" USING btree ("listingId");--> statement-breakpoint
CREATE INDEX "starList_userId_index" ON "starList" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "starListItem_listingId_index" ON "starListItem" USING btree ("listingId");--> statement-breakpoint
ALTER TABLE "listingVersion" ADD CONSTRAINT "listingVersion_reviewedBy_user_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;