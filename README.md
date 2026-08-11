<p align="center">
  <a href="https://webofdevs.com">
    <img src="icon.png" height="50px" width="50px" alt="Web of Devs icon">
  </a>
</p>

<h1 align="center">Web of Devs</h1>

<p align="center">
  <a href="https://webofdevs.com">Web of Devs</a> is a community of developers with personal websites, homepages, and portfolios. Browse other developers' sites for inspiration, favorite the ones you love, and share your own. This project is built with SvelteKit, NestJS, PostgreSQL, and Redis.
</p>

<p align="center">
  <img src="https://img.shields.io/github/check-runs/rosslh/webofdevs.com/main?style=flat&label=Checks" alt="GitHub branch check runs">
  <img src="https://img.shields.io/uptimerobot/status/m792419054-6bfcda1ea164377713c64d65?up_message=online&style=flat&label=Status" alt="Uptime Robot status">
  <img src="https://img.shields.io/uptimerobot/ratio/m792419054-6bfcda1ea164377713c64d65?style=flat&label=Uptime%20(1mo)" alt="Uptime Robot ratio (30 days)">
  <a href="https://mapledeploy.ca/?utm_source=badge&utm_medium=referral&utm_campaign=server-f1b4d852&utm_content=markdown-shields"><img src="https://mapledeploy.ca/api/badge/shields" alt="Hosted in Canada with MapleDeploy"></a>
</p>

## Features

Web of Devs surfaces developer websites in a browsable directory, with **sort and filter** options to narrow the list by programming language, GitHub follower count, or repository stars. Each entry renders an embedded **live preview** of the site alongside the author's name, profile image, and language tags.

Signed-in users can **favorite** the sites they like to keep a personal collection, **submit their own site** by linking a GitHub account, and **report** entries that don't meet the submission criteria. Profile metadata, programming languages, and star counts are pulled directly from GitHub and refreshed on a schedule, so the directory stays current without manual curation.

## Architecture

The frontend is a [SvelteKit](https://github.com/sveltejs/kit) app written in [TypeScript](https://github.com/microsoft/TypeScript) and styled with [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss). End-to-end tests run with [Playwright](https://github.com/microsoft/playwright).

The backend is a [NestJS](https://github.com/nestjs/nest) service that exposes a REST API for entries, favorites, reports, and authentication. [Knex](https://github.com/knex/knex) manages PostgreSQL schema migrations and queries. Background jobs (most notably the GitHub scraper that refreshes user metadata through GitHub's REST API) run on a [BullMQ](https://github.com/taskforcesh/bullmq) queue backed by Redis, scheduled with `@nestjs/schedule`.

Authentication uses GitHub OAuth, with short-lived JWT access tokens and rotating refresh tokens. The NestJS API returns the tokens in the JSON response to the SvelteKit server (a trusted backend-for-frontend), which sets them as HttpOnly cookies on the browser response, so the refresh token is never exposed to client-side JavaScript. Rate limiting (`@nestjs/throttler`), `helmet`, and standard CORS protections are applied at the API boundary.

## Development

This project requires [Node.js](https://nodejs.org/) and [Docker](https://www.docker.com/) to be installed on your system. Check the [`.node-version`](.node-version) file for the recommended Node.js version.

Start PostgreSQL and Redis locally:

```bash
cd server
docker compose -f docker-compose.dev.yml up -d
```

Run the server (port 3001 by default):

```bash
cd server
npm install
npm run start:dev
```

Run the client (port 3000):

```bash
cd client
npm install
npm run dev
```

### Project Structure

- Client routes are in [`client/src/routes`](client/src/routes) and shared UI in [`client/src/components`](client/src/components)
- Server modules are in [`server/src`](server/src), with the GitHub scraper in [`server/src/scraper.service.ts`](server/src/scraper.service.ts)
- Database migrations are in [`server/migrations`](server/migrations)
