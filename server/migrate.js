import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query(
  await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
);
await db.end();
console.log("Database migration complete.");
