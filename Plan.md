## Build Plan – Python Codebase Convention Analyzer

### Overview
Goal: Build a Next.js app that ingests Python files, constructs a knowledge graph (functions, classes, modules, variables and their relationships), visualizes it, and uses an LLM to generate a `conventions.md`. The plan is chunked into clear steps with acceptance criteria and deliverables.

### Success Criteria
- Parses 5+ Python files and builds a graph with 20+ nodes
- Identifies 5+ convention categories and generates actionable `conventions.md`
- Interactive graph visualization (zoom/pan, select, filter) performs smoothly
- Download: `conventions.md`, `graph.json`, and graph image
- Deployed on Vercel with environment-secure LLM access

---

### Step 0: Prerequisites and Environment - **DONE**
- Install Node 20+, PNPM or NPM
- Create Anthropic account and obtain `ANTHROPIC_API_KEY`
- Install Vercel CLI and log in

Acceptance criteria
- `node -v` outputs ≥ 20
- `.env.local` exists with `ANTHROPIC_API_KEY=...`

Deliverables
- `.env.local`


Done by user - here are the commands ran for the setup: 

```
npx create-next-app@latest
Need to install the following packages:
create-next-app@15.5.4
Ok to proceed? (y) y

✔ What is your project named? … codebase-conventions
✔ Would you like to use TypeScript? … No / Yes
✔ Which linter would you like to use? › ESLint
✔ Would you like to use Tailwind CSS? … No / Yes
✔ Would you like your code inside a `src/` directory? … No / Yes
✔ Would you like to use App Router? (recommended) … No / Yes
✔ Would you like to use Turbopack? (recommended) … No / Yes
✔ Would you like to customize the import alias (`@/*` by default)? … No / Yes
✔ What import alias would you like configured? … @/*
Creating a new Next.js app in /Users/tarekalakkadp/Desktop/personal/python-codebase-conventions-generator/codebase-conventions.

Using npm.

Initializing project with template: app-tw 


Installing dependencies:
- react
- react-dom
- next

Installing devDependencies:
- typescript
- @types/node
- @types/react
- @types/react-dom
- @tailwindcss/postcss
- tailwindcss
- eslint
- eslint-config-next
- @eslint/eslintrc
```

---

### Step 1: Project Scaffolding and Dependencies - **DONE**
- Create Next.js 15 App Router project with TypeScript
- Install dependencies per requirements
  - `@mui/material @mui/icons-material @emotion/react @emotion/styled`
  - `reactflow`, `react-dropzone`, `react-markdown`, `zod`
  - `@anthropic-ai/sdk`
- Add baseline MUI theme and CSS reset
- Commit initial project to git

Acceptance criteria
- `npm run dev` serves app on localhost
- No TypeScript or build errors

Deliverables
- Next.js project bootstrapped with MUI

---

### Step 2: Directory Layout and Type Definitions **DONE**
- Create directories per spec:
  - `src/app/` with `layout.tsx`, `page.tsx`, `api/analyze/route.ts`, `api/conventions/route.ts`
  - `src/components/` with `CodeUploader.tsx`, `KnowledgeGraph.tsx`, `ConventionsViewer.tsx`, `DownloadButton.tsx`
  - `src/lib/` with `graph-builder.ts`, `python-parser.ts`, `llm-analyzer.ts`, `types.ts`
  - `src/utils/` with `example-code.ts`
- Define core types in `src/lib/types.ts`:
  - `CodeNode`, `CodeEdge`, `KnowledgeGraph`, `UploadedFile`, `ParseOptions`

Acceptance criteria
- All files created and export their public interfaces

Deliverables
- Compiling TypeScript types and empty module scaffolds

---

### Step 3: Code Input UI- **DONE**
- Build `CodeUploader.tsx` using `react-dropzone` for `.py` files (≤ 5MB each)
- Add a textarea for code paste (single or multiple snippets)
- Validate inputs with `zod` (extension, size, non-empty, reasonable character set)
- Surface errors via MUI `Snackbar`
- Emit a normalized array of `{ filename, content }` to parent
- Use MUI for all components that you may need.

Acceptance criteria
- Drag-and-drop accepts only `.py` and rejects others with clear messaging
- Pasted code treated equivalently to uploaded files

Deliverables
- Reusable uploader component with validation and events

---

### Step 4: Python Parsing (Regex-first MVP) **DONE**
- Implement `python-parser.ts` to extract:
  - Functions: name, parameters, return hint, async flag, privacy (`_` prefix)
  - Classes: name, base classes, decorators on methods
  - Imports: `import x`, `from x import y`
  - Variables: top-level assignments
  - Calls: intra-function call sites (best-effort regex)
- Populate node metadata: line numbers, docstrings, decorators
- Provide `parsePythonFiles(files, options): ParsedModule[]`

Acceptance criteria
- Given provided examples, returns expected nodes for functions/classes/imports/variables
- Includes line numbers and code excerpts for nodes

Deliverables
- `python-parser.ts` with unit-like dev tests (TS only) run in Node

---

### Step 5: Knowledge Graph Builder **DONE**
- Implement `graph-builder.ts` with:
  - `buildKnowledgeGraph(parsedModules): KnowledgeGraph`
  - Node IDs are globally unique (e.g., `${module}:${type}:${name}:${line}`)
  - Edges: `imports`, `calls`, `inherits`, `uses`, `defines`, with optional weight
- Deduplicate nodes across files/modules and merge metadata
- Provide `toGraphJson(graph): string` for export

Acceptance criteria
- Produces deterministic graph for same input
- Matches expected graph from test cases in Requirements

Deliverables
- Knowledge graph construction utilities

---

### Step 6: Analyze API – Build Graph on Server
- Implement `src/app/api/analyze/route.ts` (POST):
  - Input: `{ files: {filename, content}[] } | { codeSnippets: string[] }`
  - Validate with `zod`
  - Run parser + graph builder
  - Return `{ graph }`
- Add error handling and timeouts for large inputs

Acceptance criteria
- cURL/REST client returns graph JSON for uploaded files

Deliverables
- Analyze endpoint returning `KnowledgeGraph`

---

### Step 7: Graph Visualization
- Build `KnowledgeGraph.tsx` using React Flow
  - Color-code by type: function (blue), class (green), module (purple), variable (orange)
  - Hierarchical layout (top-to-bottom); group by module
  - Interactions: select node to view code, zoom/pan controls
  - Filters: toggle visibility for edge types (imports/calls/inherits/uses/defines)
- Performance: memoize nodes/edges mapping from `KnowledgeGraph`

Acceptance criteria
- Renders non-trivial graphs smoothly (200+ edges acceptable for MVP)
- Clicking a node shows code snippet and metadata

Deliverables
- Interactive graph component

---

### Step 8: LLM Convention Analysis
- Implement `llm-analyzer.ts`:
  - Prepare prompt as specified in Requirements (graph JSON + code samples)
  - Call Anthropic `claude-sonnet-4-20250514` via `@anthropic-ai/sdk`
  - Config: max tokens 4000, temperature 0.2, 45s timeout
  - Return markdown for `conventions.md`
- Add offline fallback when no API key: minimal heuristic-based conventions

Acceptance criteria
- Given demo graph, returns markdown with sections and examples

Deliverables
- LLM analysis utility with configurable model/env

---

### Step 9: Conventions API – Generate Markdown
- Implement `src/app/api/conventions/route.ts` (POST):
  - Input: `{ graph: KnowledgeGraph, codeSnippets: string[] }`
  - Validate with `zod`
  - Call `llm-analyzer` and return `{ markdown }`

Acceptance criteria
- Returns consistent markdown shape suitable for rendering and download

Deliverables
- Conventions endpoint

---

### Step 10: App Shell, Layout, and Flow Integration
- `layout.tsx`: MUI theme, fonts, color mode baseline
- `page.tsx`: three-column layout with MUI Grid
  - Left: `CodeUploader`
  - Center: `KnowledgeGraph`
  - Right: `ConventionsViewer`
- Tabs: Graph view | Conventions view
- Loading states: "Building graph…" → "Analyzing patterns…" → "Done"
- Error handling via MUI `Snackbar`

Acceptance criteria
- End-to-end flow: upload → server analyze → graph renders → analyze conventions → markdown renders

Deliverables
- Usable MVP UI

---

### Step 11: Download and Export Utilities
- `DownloadButton.tsx` supports:
  - Download `conventions.md`
  - Download `graph.json`
  - Export graph image (PNG) from React Flow viewport

Acceptance criteria
- Files download with correct content and filenames

Deliverables
- Reusable download component(s)

---

### Step 12: QA with Provided Test Cases and Metrics
- Add `src/utils/example-code.ts` with sample Python files
- Verify Test File 1 expectations from Requirements
- Confirm success metrics (node count, categories, downloads)

Acceptance criteria
- Matches expected nodes/edges and conventions outlined in Requirements

Deliverables
- Verified behavior against examples

---

### Step 13: Styling, Polish, and Accessibility
- Apply MUI theming and consistent spacing/typography
- Keyboard navigation, focus states, ARIA labeling
- Empty states and helpful inline guidance

Acceptance criteria
- No obvious accessibility blockers in primary flows

Deliverables
- Polished UI

---

### Step 14: Deployment to Vercel
- Add Vercel project and configure environment variables
- Set build command and output settings (default Next.js)
- Verify production app end-to-end

Acceptance criteria
- Public URL serves the app, analysis works with remote LLM

Deliverables
- Deployed app URL

---

### Stretch Goals (Post-MVP)
- Multi-language (JS/TS) parsing via pluggable strategy
- Diff mode: compare two codebases and highlight convention drift
- Convention violations checker for CI
- Export to Mermaid diagram
- GitHub integration for repo-wide analysis

---

### Implementation Notes
- Keep parser regex simple and fast; prioritize recall over perfect precision for MVP
- Ensure node IDs remain stable across runs for consistent layout
- Chunk prompt inputs and sample only representative code snippets to control token usage
- Centralize Zod schemas to share between client and server
- Add timeouts and guardrails to prevent OOM on very large inputs

### Timeline (Target ~4 hours)
- Hour 1: Steps 1–3
- Hour 2: Steps 4–6
- Hour 3: Steps 7–9
- Hour 4: Steps 10–12 (+13 if time permits); 14 as final


