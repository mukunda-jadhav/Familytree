# Kinfolk

A React family-tree editor with a Node.js/Express API and PostgreSQL storage. Firebase handles mobile-number OTP login; a custom, hashed email OTP flow verifies the email for that Firebase UID. Only verified accounts can save online or create sharing links.

## Run the preview

Requires Node.js 22.12+ (tested on 26). From this folder:

```sh
npm install
npm run dev
```

Open http://localhost:5173. Without configuration, the example tree is a **local demo** saved in browser storage. No fake OTPs, cloud persistence, or fake public links are used. Add/edit/remove people, connect existing people, search, switch between tree and people views, and print work in the demo.

## Enable real accounts and storage

1. Copy `.env.example` to `.env`. Never commit `.env` or Firebase service-account credentials.
2. Start PostgreSQL. Optionally set `POSTGRES_PASSWORD` then run `docker compose up -d`. Set `DATABASE_URL` using the same password. Use a properly configured TLS connection for remote databases.
3. Create a Firebase project and Web app. Enable Authentication → Phone. Configure your authorized web domains, SMS region policy, billing, and test phone numbers. Use a domain allowed by Firebase for real SMS testing; consult current Firebase guidance for localhost limitations.
4. Fill in the four public `VITE_FIREBASE_*` settings from your Firebase web app. Set `GOOGLE_APPLICATION_CREDENTIALS` to a private server-side service-account JSON path outside the source tree (or adapt Admin initialization to your hosting platform's application-default identity).
5. Set `OTP_SECRET` to a cryptographically random secret of at least 32 characters. Configure SMTP host, port, username, password and a verified `MAIL_FROM` sender. Email verification is implemented by this API, not Firebase's email-link verification; the PostgreSQL account record is the authoritative email-verification state.
6. Set `APP_URL` to the browser-facing URL. Run `npm run db:migrate`, then `npm run dev`.
7. Create an account: mobile number in E.164 format → Firebase SMS code → email address → emailed six-digit code. Manage tree → save to account. Use Share tree to create or disable a link.

Firebase handles SMS delivery. This avoids integrating a separate SMS gateway here, but is not a guarantee about Indian DLT obligations, SMS availability, quotas, or charges. Check the Firebase setup and applicable requirements for your deployment. Phone numbers are processed by Google, as stated in the verification UI.

## Features and data

- Multiple family trees per verified account; optimistic version checks prevent silently overwriting another tab's changes.
- Person names, birthdays, hometowns, gender, biography, and memorial status.
- Parent → child blood/adoptive relationships, plus partner connections. Siblings are represented through shared parents. A relationship graph does not independently verify biological kinship.
- Family-aware graph layout: couples sit together, siblings share a parent branch, and orthogonal paths route around cards. Real joins have dots; crossing lines have a visual gap. Selecting a person highlights their family connections. Includes zoom, search, keyboard-focusable cards, people list, responsive interface, and native dialog forms.
- Revocable, unguessable, read-only share links. Creating a new link revokes the previous one. Shared views expose the tree's full person data; creator contact details are excluded.
- Print / PDF opens the browser print dialog. Choose Save as PDF and landscape; A3 is the default. For very wide trees, use a larger paper size or lower print scaling. People view offers a compact printable directory.
- PostgreSQL owner checks, parameterized SQL, graph validation, token revocation checks, request limits, expiring HMAC-hashed OTPs, five attempts, and resend cooldown.

## Build / deploy

```sh
npm test
npm run build
npm run db:migrate
npm start
```

The Express process serves `dist` and `/api` on loopback port 3001. Deploy to a Node-capable host with PostgreSQL and put an HTTPS reverse proxy in front. Configure secrets securely, Firebase authorized domains, `APP_URL`, and rebuild for frontend environment changes. This project is not deployed to a public host. It deliberately retains Node/PostgreSQL instead of replacing your requested stack with a Worker/D1 hosting stack.

Before multi-instance production use, replace the default in-memory IP rate limiter with a shared store, configure Express proxy trust precisely for your host, and add monitoring/backups. No passwords are stored. Authentication and SMTP require real external credentials; they are not exercised by offline tests.

## Verification

`npm test` covers graph validation, ancestry cycles, crossing-free sample branches, routes avoiding cards, shuffled input, single-parent and adoptive relationships, and disconnected people. `npm run build` compiles the client. Browser checks cover the current family tree and selection highlighting. Full end-to-end verification needs PostgreSQL, Firebase test numbers and SMTP configuration.

Official Firebase reference: https://firebase.google.com/docs/auth/web/phone-auth
