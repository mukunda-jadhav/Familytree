CREATE TABLE IF NOT EXISTS accounts (uid text PRIMARY KEY, email text UNIQUE, verified boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS email_codes (uid text PRIMARY KEY REFERENCES accounts(uid), email text NOT NULL, hash text NOT NULL, expires timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, sent_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS trees (id uuid PRIMARY KEY, owner text NOT NULL REFERENCES accounts(uid), name text NOT NULL, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1, share_hash text UNIQUE);
CREATE INDEX IF NOT EXISTS trees_owner ON trees(owner);
