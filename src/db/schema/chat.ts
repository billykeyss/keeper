import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";
import { chatRoleEnum } from "../enums";
import { stamps } from "../stamps";

// Chat history is NOT part of the wipe-and-reload ingest world: these tables are
// intentionally absent from TRUNCATE_TABLES in src/ingest/load.ts and must stay that way.
export const chatSession = pgTable("chat_session", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sdkSessionId: text("sdk_session_id"),
  ...stamps,
});

export const chatMessage = pgTable("chat_message", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => chatSession.id),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  ...stamps,
});
