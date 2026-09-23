# CodeFolio

A clean, runnable GitHub-inspired developer portfolio/project platform starter.

## Requirements
- Node.js 18+ (Node 20+ recommended)
- npm

## Run on Windows / VS Code

### Terminal 1 — Backend
```powershell
cd backend
npm install
npm run dev
```
Backend: http://localhost:5000

### Terminal 2 — Frontend
```powershell
cd frontend
npm install
npm run dev
```
Frontend: http://localhost:5173

Open the frontend URL shown by Vite.

## Included working flows
- Sign up
- Login/logout
- Persistent demo session in browser
- Developer profile
- Repository creation/listing
- Repository details
- Multi-file upload
- Publish/unpublish repository
- Public repository route
- Issues/discussions/pull-request/release API foundations
- Responsive UI
- Dark developer-platform design

## Important
This package is intentionally dependency-light so it can run immediately after `npm install`.
For production, replace the in-memory backend data with PostgreSQL/Supabase, add secure password hashing/JWT/session management, object storage, and configure real GitHub OAuth/API credentials.

## Deploy frontend to Netlify

The repository includes a Netlify configuration that uses `frontend` as the base directory:

- Build command: `npm run build`
- Publish directory: `dist` (relative to `frontend`)
- Node version: `20`

Import the repository into Netlify and deploy it. The SPA fallback is already configured in `frontend/public/_redirects`.

For Vercel, set the project root to `frontend`. The included `frontend/vercel.json` keeps client-side routes working.

In Netlify site settings, add `VITE_API_URL` as a build environment variable pointing to the public backend URL, including `/api`, for example `https://api.example.com/api`. Do not leave it empty in production unless the backend is served from the same domain.

The backend is a separate Node/Express service. Start it with `npm --prefix backend install && npm --prefix backend run start`, then use its public URL as `VITE_API_URL`. Netlify and Vercel deployment requires the provider account/project connection and backend URL; those credentials are not available in this workspace.
