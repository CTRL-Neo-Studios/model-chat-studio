ALTER TABLE "projectEntry" ADD COLUMN "searchText" text;--> statement-breakpoint
ALTER TABLE "projectEntry" ADD COLUMN "searchVector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("searchText", ''))) STORED;--> statement-breakpoint
CREATE INDEX "projectEntry_searchVector_index" ON "projectEntry" USING gin ("searchVector");