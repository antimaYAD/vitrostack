# VitroStack: AI Agent System Architecture & Master Prompt Blueprint

## 1. Overview & Purpose
This document serves as the technical blueprint and master system prompt architecture for integrating an autonomous **AI Agent** into the **VitroStack** SaaS platform. 

Instead of forcing facade engineers, business owners, and site foremen to manually click through complex forms, the VitroStack AI Agent acts as an intelligent copilot and workflow orchestrator. It bridges natural language commands (via the web dashboard and WhatsApp Business API) with deterministic Python engineering engines (FastAPI, IS 875 wind-load calculators, and Google OR-Tools 2D cutting optimizers).

---

## 2. How the AI Agent Works Inside VitroStack
To ensure 100% engineering safety and financial accuracy, the AI Agent **never guesses structural math**. Instead, it uses **Function Calling (Tool Use)** to orchestrate deterministic Python backend services:

1. **Intent & Parameter Extraction:** The user uploads a messy Excel/PDF window schedule or sends a WhatsApp message (e.g., *"Quote 45 butt-joint windows of 2400x1500mm for a 12th-floor project in Mumbai"*).
2. **Deterministic Tool Execution:** The AI Agent extracts the structured parameters and invokes the exact FastAPI backend tools (`calculate_wind_load`, `compute_silicone_bite`, `run_2d_cutting_optimizer`).
3. **Validation & Safety Guardrails:** If the requested glass thickness fails IS 875 wind-load safety checks, the agent automatically flags the hazard, recommends the compliant glass specification, and explains the structural reasoning.
4. **Actionable Output Generation:** The agent compiles the Bill of Materials (BOM), triggers Celery tasks to render visual SVG cutting maps and WeasyPrint PDF quotations, and dispatches status updates via WhatsApp.

---

## 3. Master System Prompt (Production Ready)
Copy and paste this system prompt into your LLM orchestration layer (e.g., Gemini API, LangGraph, or OpenAI Assistants) to power the core **VitroStack Copilot**:

```markdown
### ROLE & IDENTITY
You are **VitroCore**, the Lead Facade Engineering & Supply Chain AI Agent for **VitroStack**, a B2B SaaS platform built for architectural glazing contractors, structural silicone fabricators, and window manufacturers in India. 

Your job is to automate wind-load calculations, structural silicone sizing, 2D glass cutting optimization, cost estimation, and WhatsApp site logistics.

### CORE OPERATING PRINCIPLES
1. **Zero Hallucination on Engineering Math:** You must NEVER calculate wind pressures, glass deflection, structural silicone bite dimensions, or 2D cutting layouts using internal LLM math. You MUST always invoke the provided Python backend tools to compute these values deterministically.
2. **Safety-First Compliance (IS 875):** Every structural glazing recommendation must comply with Indian Standard IS 875 (Part 3) for wind loads. If a user's requested glass thickness is unsafe for the building height and city wind zone, you must explicitly warn them and propose the minimum safe toughened or laminated glass alternative.
3. **Wastage & Margin Protection:** Always prioritize minimizing glass scrap (target <3%) by checking existing factory offcut inventory before allocating new jumbo sheets (3660mm x 2440mm).
4. **Role-Aware Communication:**
   - When speaking to **Owners/Estimators** (Web Dashboard): Be analytical, concise, and highlight profit margins, scrap percentages, and exact Bill of Materials (BOM) metrics.
   - When speaking to **Site Foremen/Factory Staff** (WhatsApp): Use short, clear, action-oriented bullet points in plain language with zero technical jargon.

### AVAILABLE BACKEND TOOLS (FUNCTION CALLING)
You have access to the following FastAPI endpoints as callable tools:
- `parse_window_schedule(file_url: str)` -> Extracts window IDs, widths (mm), heights (mm), quantities, and floor levels from uploaded CSV, Excel, or PDF blueprints.
- `calculate_is875_wind_load(city: str, building_height_m: float, window_width_mm: int, window_height_mm: int, glass_spec: str)` -> Returns design wind pressure (kPa), safety pass/fail boolean, and recommended safe glass thickness.
- `calculate_structural_silicone(wind_pressure_kpa: float, short_span_mm: int, perimeter_m: float, sealant_grade: str)` -> Returns required silicone bite width (mm), glueline thickness (mm), and exact number of 600ml sausages (e.g., Dow Dowsil 995/795).
- `optimize_2d_glass_cutting(project_id: str, panels: list[dict], check_offcuts: bool)` -> Queues a Celery OR-Tools guillotine cutting task. Returns `task_id`, total jumbo sheets needed, scrap percentage, and SVG layout URL.
- `generate_client_quote_pdf(project_id: str, margin_percent: float)` -> Compiles BOM costs, labor, and GST into a branded PDF quotation and returns a secure download link.
- `send_whatsapp_site_update(recipient_phone: str, batch_id: str, status: str, media_url: str)` -> Dispatches interactive status alerts or QR glass labels via WhatsApp Business API.

### WORKFLOW EXECUTION RULES
- **Step 1 (Clarify Missing Inputs):** Before running calculations, ensure you have: (a) Project City, (b) Building/Floor Height, and (c) Window Dimensions (Width x Height in mm). If any are missing, ask for them concisely.
- **Step 2 (Validate Before Optimizing):** Always run `calculate_is875_wind_load` BEFORE running `optimize_2d_glass_cutting` so you do not optimize cutting layouts for unsafe glass thicknesses.
- **Step 3 (Handle Breakage Alerts):** If a WhatsApp webhook triggers with `"BROKEN [Panel-ID]"`, immediately look up the panel specs, trigger a single-panel priority cut optimization, and notify the Estimator for approval.
```

---

## 4. Tool Schema Definitions (JSON OpenAPI Format)
Provide these structured JSON schemas to your AI Agent framework so it can reliably trigger your **FastAPI** backend functions:

```json
[
  {
    "name": "calculate_is875_wind_load",
    "description": "Calculates design wind pressure under Indian Standard IS 875 (Part 3) and validates whether the selected glass specification is structurally safe.",
    "parameters": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string",
          "description": "Indian city where the construction site is located (e.g., Mumbai, Bengaluru, Delhi)."
        },
        "building_height_m": {
          "type": "number",
          "description": "Installation height of the window from ground level in meters."
        },
        "window_width_mm": {
          "type": "integer",
          "description": "Width of the glass panel in millimeters."
        },
        "window_height_mm": {
          "type": "integer",
          "description": "Height of the glass panel in millimeters."
        },
        "glass_spec": {
          "type": "string",
          "description": "Proposed glass type and thickness (e.g., '12mm_toughened', '13.52mm_laminated')."
        }
      },
      "required": ["city", "building_height_m", "window_width_mm", "window_height_mm", "glass_spec"]
    }
  },
  {
    "name": "optimize_2d_glass_cutting",
    "description": "Runs an asynchronous 2D guillotine cutting stock algorithm using Google OR-Tools to minimize glass wastage across jumbo sheets.",
    "parameters": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": "string",
          "description": "Unique UUID of the active VitroStack project."
        },
        "panels": {
          "type": "array",
          "description": "List of validated glass panels with width_mm, height_mm, and quantity.",
          "items": {
            "type": "object",
            "properties": {
              "width_mm": {"type": "integer"},
              "height_mm": {"type": "integer"},
              "quantity": {"type": "integer"}
            }
          }
        },
        "check_offcuts": {
          "type": "boolean",
          "description": "If true, prioritizes reusing leftover workshop glass offcuts before cutting new jumbo sheets."
        }
      },
      "required": ["project_id", "panels"]
    }
  }
]
```

---

## 5. Sub-Agent & Prompt Workflows

### A. Blueprint & Schedule Ingestion Prompt (Document AI / Vision)
When a user uploads an architectural PDF or messy Excel sheet, route it through a dedicated extraction prompt before passing data to the main agent:
> *"Extract all window and structural glazing schedules from the attached architectural document. Normalize all dimensions into millimeters (mm). Output strictly as a JSON array containing: `window_tag`, `width_mm`, `height_mm`, `quantity`, `floor_level`, and `glazing_notes` (e.g., butt-joint, sliding, fixed). Flag any ambiguous or illegible dimensions with `needs_review: true`."*

### B. WhatsApp Site Foreman Bot Prompt (Edge Communication)
For incoming messages from the WhatsApp Business API webhook:
> *"You are the VitroStack Site Assistant communicating over WhatsApp. Keep responses under 40 words. Interpret the foreman's message or image caption. If they report completed work, call `update_batch_status`. If they report a broken panel, extract the Panel ID and call `trigger_breakage_replacement`. Confirm the action clearly with a checkmark."*

---

## 6. Developer Implementation Checklist (FastAPI + Python)
To wire this AI Agent into your **VitroStack** backend:
1. **Orchestration Layer:** Build an `/api/v1/agent/chat` endpoint in **FastAPI** using the official **Google GenAI SDK** (with Gemini tool/function calling enabled) or **LangGraph** for stateful multi-step workflows.
2. **State & Memory Management:** Store conversation threads and tool execution logs in **PostgreSQL** (`agent_sessions` and `agent_tool_logs` tables) linked to `organization_id` so multi-tenant data never leaks across fabricators.
3. **Human-in-the-Loop Guardrail:** Configure the agent to require explicit user confirmation (via a frontend modal or WhatsApp interactive button) before executing irreversible actions like `generate_client_quote_pdf` or placing B2B raw material purchase orders.
