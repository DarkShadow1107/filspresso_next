# Filspresso (Next.js migration)

This repository contains a migrated version of the original Filspresso static site (found in the `deprecated/` folder) to a modern Next.js application using TypeScript and Tailwind CSS.

What I migrated

-   Converted the static HTML/CSS/JS project into a modular Next.js app (App Router + TypeScript).
-   Preserved the legacy CSS 1:1 by consolidating it into `src/styles/globals.css` so the migrated pages render exactly the same as the original site.
-   Moved frontend logic into React components. Backend logic (form handling, server-side logic) is implemented as Next.js server actions / API routes when relevant.

Important notes

-   The original `deprecated/` folder is intentionally ignored by the app and by Git. It remains in the repository as an archive but is not used by the Next.js app.
-   SCSS files from the old project were not migrated; they are considered legacy and intentionally ignored.

Quick start (development)

1. Install dependencies

    ```powershell
    npm install
    ```

2. Run development server

    ```powershell
    npm run dev
    ```

3. Open http://localhost:3000

Project structure (high level)

-   `src/app/` – App Router routes and layout
-   `src/components/` – Reusable React components
-   `src/styles/` – Consolidated legacy/global styles consumed by the app router
-   `deprecated/` – Original static project (ignored by the app and Git)

Why this structure

-   The app is modular: small components, clear separation of server (Next.js routes/actions) and client UI.
-   Legacy CSS is kept verbatim to guarantee visual parity with the original static site.

License

This project is released under the MIT License (see `LICENSE`).

If you want additional pages converted, or a stricter conversion of every CSS rule into Tailwind utilities, I can continue migrating specific pages on request.
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

-   [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
-   [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
