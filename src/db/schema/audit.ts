import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { auditActionEnum } from "../enums";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  tableName: text("table_name").notNull(),
  rowId: integer("row_id").notNull(),
  action: auditActionEnum("action").notNull(),
  actor: text("actor"),
  at: timestamp("at").defaultNow().notNull(),
  diff: jsonb("diff"),
});
