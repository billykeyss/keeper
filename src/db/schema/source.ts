import { pgTable, serial, integer, text, boolean, date } from "drizzle-orm/pg-core";
import {
  documentTypeEnum, instrumentTypeEnum, authorityLevelEnum, fetchStatusEnum,
} from "../enums";
import { authority } from "./geography";
import { stamps } from "../stamps";

export const source = pgTable("source", {
  id: serial("id").primaryKey(),
  authorityId: integer("authority_id").references(() => authority.id),
  documentType: documentTypeEnum("document_type").notNull(),
  instrumentType: instrumentTypeEnum("instrument_type"),
  authorityLevel: authorityLevelEnum("authority_level").notNull(),
  isOfficial: boolean("is_official").notNull().default(true),
  mirrorOfId: integer("mirror_of_id"), // self-ref, intentionally not an FK (v2 may be inserted before v1); enforced in application layer
  fetchStatus: fetchStatusEnum("fetch_status"),
  url: text("url"),
  title: text("title"),
  publishedDate: date("published_date"),
  retrievedDate: date("retrieved_date"),
  sectionRef: text("section_ref"),
  quotedText: text("quoted_text"),
  disputed: boolean("disputed").notNull().default(false),
  refutationNote: text("refutation_note"),
  ...stamps,
});
