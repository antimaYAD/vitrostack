# VitroStack

AI copilot and engineering workspace for structural-glazing contractors in India. It implements the
`VitroStack_AI_Agent_Prompt_Blueprint.md`: **VitroCore** turns plain-language requests or uploaded window
schedules into IS 875-checked, cut-optimized, priced quotations. It never does structural math itself.
Every number comes from a deterministic Python engine, and every engine call is logged.

## Run it

```bash
# Backend (FastAPI): http://localhost:8000
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                                  # optional keys
uvicorn app.main:app --reload --port 8000

# Frontend (React + Vite): http://localhost:5173
cd frontend
npm install
npm run dev
```

For a single-origin build, run `npm run build` in `frontend/`. The backend then serves the UI at http://localhost:8000.
Demo data (4 projects and an offcut inventory) is seeded on first launch. Delete `backend/vitrostack.db` to reset it.

### Sign-in & roles

| Role | Can do |
|---|---|
| **Admin** | Everything, plus **Admin → Pricing**, **Admin → Users** (add, change role, reset password, deactivate, delete), deleting projects, and adding offcuts (by hand or by saving a cutting plan's remnants) |
| **Estimator** | Overview, Copilot, Projects, Designer, Engineering tools, Offcuts (view only), Site Ops. No admin area |

Anyone can **create an account** at `/register`. It creates a new, separate company workspace with that person as admin; colleagues are then added from Admin → Users. Set `ALLOW_SIGNUP=0` to turn self sign-up off.

Demo accounts are created on first start: `admin@vitrostack.local` / `admin123` and `estimator@vitrostack.local` / `estimator123`.
For a real deployment, set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before the first start, set `DEMO_MODE=0`, and set `COOKIE_SECURE=1` behind HTTPS.
Sessions are server-side and stored in an HttpOnly cookie (12 h, or 30 days with "Keep me signed in"). New users get a
temporary password and must change it at first sign-in. Copilot conversations are private to each user.

Run the tests with `cd backend && python -m pytest`.

## What's inside

| Area | Where | Notes |
|---|---|---|
| IS 875 (Part 3) wind load | `backend/app/engines/wind.py` | Vb for 60+ cities, k2 terrain/height tables, Kd/Ka/Kc, Cp,net by zone |
| Glass check | `engines/glass.py` | Four-edge plate stress & deflection, laminated effective thickness, min-safe recommendation |
| Facade elevations | `engines/facade.py`, `facade_dxf.py` | Net glass sizes, butt-joint / slider support conditions, silicone bite, BOM, DXF (ezdxf) |
| Structural silicone | `engines/silicone.py` | ASTM C1401 bite, glueline, 600 ml sausage count (DOWSIL 995/993/795) |
| 2D cutting | `engines/cutting.py` | Multi-heuristic guillotine packing, offcuts first, reusable-remnant tracking |
| BOM & quote | `engines/costing.py`, `pdf.py` | Jumbo-sheet glass costing, labour, GST, branded PDF (ReportLab) |
| Schedule import | `engines/schedule_parser.py` | CSV/XLSX, fuzzy headers, m/cm/in → mm, `needs_review` flags |
| Agent | `backend/app/agent/` | Tool registry (blueprint schemas), Gemini function calling, offline planner fallback |
| Human-in-the-loop | `orchestrator.resolve_action` | Quote PDF and WhatsApp sends require explicit approval |
| WhatsApp | `whatsapp.py` | Meta webhook + simulator; `BROKEN W1-03` → priority re-cut → estimator approval |

### UI

- **Overview:** ask box, pipeline KPIs, scrap vs. 3% target, items needing attention, and the agent's tool-call log.
- **Copilot:** chat with expandable tool-call timelines, an approval card with a live margin preview, schedule drag-and-drop, and suggested follow-ups.
- **Projects:** a stepper (Schedule → IS 875 → Cutting → Quote) with one contextual "next step" button. Tabs show the pressure derivation, per-pane utilisation bars, interactive SVG cutting patterns, and the BOM/quote.
- **Engineering tools:** live calculators for wind/glass, silicone, and quick nesting.
- **Designer** (`/designer`): a react-konva CAD canvas for window and structural-glazing elevations.
  - Millimetre grid with zoom (wheel), pan (Space or the hand tool) and 1 mm / 5 mm snap. Dimension chains update live.
  - Add mullions and transoms by clicking. Click a vertical divider to switch between an aluminium mullion and an 8 mm silicone butt joint (optionally backed by a glass fin); drag dividers to move them.
  - Each pane takes an infill (glass, spandrel or louvre), an operation (fixed, sliding left/right, casement, top-hung, tilt & turn, door), a glass type (10/12 mm toughened, 13.52 laminated toughened, 24 mm DGU) and, for sliders, a 2- or 3-track system.
  - Panes that fail IS 875 at the design pressure are outlined in red with a warning badge. The pressure can be typed or calculated from the site; opening the designer from a project uses that project's site.
  - **Add to project** turns the glass panes into schedule rows tagged `W-101/B1-A`, and so on. Panes whose glass differs from the project's spec are added marked for review (or left out); non-glass infills are skipped.
  - The elevation is kept as parametric JSON (`frontend/src/lib/facade.ts`) and sent to `POST /api/v1/canvas/validate-wind-load`, `/extract-bom` and `/export-dxf`. The JSON can be copied, downloaded and imported.
  - Elevations save to the shared design library. Rectangular designs from the earlier window designer can be opened from the library and converted; shaped (arched, gable, raked) designs can't.
- **Offcut inventory** and **Site ops**, which has a WhatsApp phone simulator and an approval queue.
- Responsive layout, light/dark mode, and a <kbd>Ctrl</kbd>+<kbd>K</kbd> command palette.

## Engineering assumptions

These are screening checks. Final designs need sign-off from a facade engineer.
- k1 = k3 = k4 = 1.0, terrain category 3 by default, Cp,net 1.2 (typical) or 1.7 (corner).
- Glass: linear plate theory (conservative), minimum thickness tolerances, allowable stress 17/35/50 MPa
  (annealed/HS/toughened), deflection ≤ min(short span/60, 25 mm). Laminated glass assumes no interlayer shear transfer.
- Floor N → glazing top at (N+1) × 3.3 m.
- Prices are managed in **Admin → Pricing** (`/admin`), per organisation: glass ₹/m², sealants, labour, hardware,
  transport, GST and the default margin. Every change is logged. Quotes keep the prices they were generated with,
  and the project shows a "prices changed, re-quote" banner. The built-in
  defaults (`engines/rates.py`) are indicative only.

## Deploy (Docker + PostgreSQL)

The `Dockerfile` builds the React app and serves it from the FastAPI server, so one container is the whole app.
It listens on `$PORT` (default 8000) and reports health at `/api/v1/health`.

**Own server / local test:**

```bash
cp .env.production.example .env     # set POSTGRES_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build        # app + Postgres 16 on http://localhost:8000
```

Put it behind HTTPS (Caddy, nginx or a load balancer) and keep `COOKIE_SECURE=1`.

**Managed hosts (Render, Railway, Fly.io and similar):** deploy the repo as a Docker web service, add a Postgres
database, and set these environment variables: `DATABASE_URL` (the host's `postgres://` URL works as is),
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DEMO_MODE=0`, `ALLOW_SIGNUP=0`, `COOKIE_SECURE=1`. No disk is needed: all data is in
Postgres, and quote PDFs and uploaded schedules are temporary files.

On the first start against an empty database, the app creates the tables and the admin account. Demo projects are
only seeded when `DEMO_MODE=1`. Run the tests against Postgres with `TEST_DATABASE_URL=postgresql://... pytest`.

## Production notes

- Multi-tenant: every table carries `organization_id`, taken from the signed-in user's account (never from the client).
- Cutting runs synchronously because it is fast for typical jobs. Move `services.run_cutting` to Celery for very large schedules.
- PDF schedule extraction needs a vision model. Wire it through `parse_window_schedule` once `GEMINI_API_KEY` is set.
