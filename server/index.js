import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pg from "pg";
import nodemailer from "nodemailer";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  randomUUID,
  randomBytes,
  randomInt,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { validateTree } from "./model.js";
const app = express(),
  ready = Boolean(
    process.env.DATABASE_URL &&
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    process.env.OTP_SECRET?.length >= 32,
  );
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
if (ready) initializeApp({ credential: applicationDefault() });
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60000, limit: 100 }));
const digest = (s) => createHash("sha256").update(s).digest("hex");
const otpHash = (uid, email, code) =>
  createHmac("sha256", process.env.OTP_SECRET)
    .update(`${uid}:${email}:${code}`)
    .digest("hex");
app.get("/api/status", (_, res) => res.json({ configured: ready }));
app.get("/api/shared/:token", async (req, res) => {
  if (!ready) return res.status(503).json({ error: "Server setup required" });
  const { rows } = await db.query(
    "SELECT name,data FROM trees WHERE share_hash=$1",
    [digest(req.params.token)],
  );
  if (!rows[0])
    return res
      .status(404)
      .json({ error: "This link is unavailable or has been revoked." });
  res.set("Cache-Control", "no-store").json(rows[0].data);
});
app.use("/api", async (req, res, next) => {
  if (!ready)
    return res
      .status(503)
      .json({
        error:
          "Connect PostgreSQL and Firebase to enable accounts and sharing.",
      });
  try {
    req.user = await getAuth().verifyIdToken(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
      true,
    );
    if (!req.user.phone_number) throw Error();
    await db.query(
      "INSERT INTO accounts(uid) VALUES($1) ON CONFLICT DO NOTHING",
      [req.user.uid],
    );
    next();
  } catch {
    return res.status(401).json({ error: "Please verify your phone number." });
  }
});
app.get("/api/me", async (req, res) => {
  const { rows } = await db.query(
    "SELECT email,verified FROM accounts WHERE uid=$1",
    [req.user.uid],
  );
  res.json(rows[0]);
});
const otpLimit = rateLimit({ windowMs: 3600000, limit: 10 });
app.post("/api/email/send", otpLimit, async (req, res) => {
  const email = z.email().max(254).parse(req.body.email).toLowerCase();
  if (!process.env.SMTP_HOST)
    return res.status(503).json({ error: "Email delivery is not configured." });
  const code = String(randomInt(100000, 1000000));
  const result = await db.query(
    `INSERT INTO email_codes(uid,email,hash,expires) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT(uid) DO UPDATE SET email=$2,hash=$3,expires=now()+interval '10 minutes',attempts=0,sent_at=now() WHERE email_codes.sent_at < now()-interval '60 seconds' RETURNING uid`,
    [req.user.uid, email, otpHash(req.user.uid, email, code)],
  );
  if (!result.rowCount)
    return res
      .status(429)
      .json({ error: "Wait 60 seconds before requesting another code." });
  await nodemailer
    .createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    .sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: "Your Kinfolk verification code",
      text: `Your code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    });
  res.json({ ok: true });
});
app.post("/api/email/verify", otpLimit, async (req, res) => {
  const code = z
    .string()
    .regex(/^\d{6}$/)
    .parse(req.body.code);
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      "SELECT * FROM email_codes WHERE uid=$1 FOR UPDATE",
      [req.user.uid],
    );
    const record = rows[0];
    if (
      !record ||
      record.attempts >= 5 ||
      new Date(record.expires) < new Date()
    ) {
      await c.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Code expired. Request a new code." });
    }
    await c.query("UPDATE email_codes SET attempts=attempts+1 WHERE uid=$1", [
      req.user.uid,
    ]);
    if (
      !timingSafeEqual(
        Buffer.from(record.hash),
        Buffer.from(otpHash(req.user.uid, record.email, code)),
      )
    ) {
      await c.query("COMMIT");
      return res.status(400).json({ error: "Incorrect code." });
    }
    await c.query("UPDATE accounts SET email=$2,verified=true WHERE uid=$1", [
      req.user.uid,
      record.email,
    ]);
    await c.query("DELETE FROM email_codes WHERE uid=$1", [req.user.uid]);
    await c.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
app.use("/api/trees", async (req, res, next) => {
  const { rows } = await db.query(
    "SELECT verified FROM accounts WHERE uid=$1",
    [req.user.uid],
  );
  if (!rows[0]?.verified)
    return res.status(403).json({ error: "Verify your email first." });
  next();
});
app.get("/api/trees", async (req, res) => {
  res.json(
    (
      await db.query(
        "SELECT id,name,data,version,share_hash IS NOT NULL AS shared FROM trees WHERE owner=$1 ORDER BY name",
        [req.user.uid],
      )
    ).rows,
  );
});
app.post("/api/trees", async (req, res) => {
  const data = validateTree(req.body),
    id = randomUUID();
  await db.query("INSERT INTO trees(id,owner,name,data) VALUES($1,$2,$3,$4)", [
    id,
    req.user.uid,
    data.name,
    data,
  ]);
  res.status(201).json({ id, version: 1 });
});
app.put("/api/trees/:id", async (req, res) => {
  const data = validateTree(req.body);
  const version = z.number().int().positive().parse(req.body.version);
  const r = await db.query(
    "UPDATE trees SET name=$3,data=$4,version=version+1 WHERE id=$1 AND owner=$2 AND version=$5 RETURNING version",
    [req.params.id, req.user.uid, data.name, data, version],
  );
  if (!r.rowCount)
    return res
      .status(409)
      .json({ error: "Tree changed elsewhere. Reload before saving." });
  res.json(r.rows[0]);
});
app.post("/api/trees/:id/share", async (req, res) => {
  const token = randomBytes(32).toString("hex");
  const r = await db.query(
    "UPDATE trees SET share_hash=$3 WHERE id=$1 AND owner=$2",
    [req.params.id, req.user.uid, digest(token)],
  );
  if (!r.rowCount) return res.sendStatus(404);
  res.json({ url: `${process.env.APP_URL}/?share=${token}` });
});
app.delete("/api/trees/:id/share", async (req, res) => {
  const r = await db.query(
    "UPDATE trees SET share_hash=NULL WHERE id=$1 AND owner=$2",
    [req.params.id, req.user.uid],
  );
  res.status(r.rowCount ? 204 : 404).end();
});
app.use("/api", (_, res) => res.status(404).json({ error: "Not found" }));
app.use(express.static(fileURLToPath(new URL("../dist", import.meta.url))));
app.get("/{*path}", (_, res) =>
  res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
);
app.use((e, req, res, next) => {
  console.error(e.name, e.code || "");
  res
    .status(e instanceof z.ZodError ? 400 : e.code === "23505" ? 409 : 400)
    .json({
      error:
        e instanceof z.ZodError
          ? "Please check the submitted fields."
          : e.code === "23505"
            ? "This email is already associated with an account."
            : "Request failed. Check your data and server configuration.",
    });
});
app.listen(process.env.PORT || 3001, "0.0.0.0", () =>
  console.log("Kinfolk API listening on port " + (process.env.PORT || 3001)),
);
