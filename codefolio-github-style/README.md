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
