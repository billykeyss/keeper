import { customType } from "drizzle-orm/pg-core";

// Stores geometry as EWKT text (e.g. "SRID=4326;POINT(-120 39)").
// Spatial ops are done with raw SQL; this type is for round-tripping values.
export const geometry = (name: string, opts: { type: string; srid?: number } = { type: "Geometry", srid: 4326 }) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return `geometry(${opts.type}${opts.srid ? `,${opts.srid}` : ""})`;
    },
    toDriver(value: string) { return value; },
    fromDriver(value: string) { return value; },
  })(name);
