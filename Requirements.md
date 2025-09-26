# Python Codebase Convention Analyzer - Requirements Document

## 1. Purpose

**Goal:** Analyze Python codebases to automatically discover and document coding conventions by building a knowledge graph of code relationships, then using LLM analysis to generate a `conventions.md` file.

**MVP Features (4 hours):**
- Upload Python file(s) or paste code
- Build knowledge graph: functions, classes, modules as nodes
- Extract relationships: imports, calls, inherits, uses
- Visualize graph (interactive diagram)
- LLM analyzes patterns to identify conventions
- Generate conventions.md file
- Deploy to Vercel

---

## 2. File Structure

```
codebase-convention-analyzer/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # MUI theme setup
│   │   ├── page.tsx                # Main page
│   │   └── api/
│   │       ├── analyze/route.ts    # Parse & build graph
│   │       └── conventions/route.ts # LLM convention generation
│   ├── components/
│   │   ├── CodeUploader.tsx        # File/paste input
│   │   ├── KnowledgeGraph.tsx      # Interactive graph visualization
│   │   ├── ConventionsViewer.tsx   # Display generated conventions
│   │   └── DownloadButton.tsx      # Export conventions.md
│   ├── lib/
│   │   ├── graph-builder.ts        # Build knowledge graph from code
│   │   ├── python-parser.ts        # Extract functions/classes/imports
│   │   ├── llm-analyzer.ts         # Claude pattern detection
│   │   └── types.ts                # Graph interfaces
│   └── utils/
│       └── example-code.ts         # Demo Python files
├── .env.local                      # ANTHROPIC_API_KEY
└── README.md
```

---

## 3. Core Functionality

### Phase 1: Code Input (20 min)
- MUI file upload (accept `.py` files, 5MB max)
- Textarea for code paste
- Support single file or multiple files (zip upload optional)
- Validate: contains Python code

### Phase 2: Knowledge Graph Building (60 min)

**Node Types:**
```typescript
interface CodeNode {
  id: string;
  type: 'function' | 'class' | 'module' | 'variable';
  name: string;
  code: string;           // Original code snippet
  metadata: {
    lineNumber: number;
    docstring?: string;
    decorators?: string[];
    parameters?: string[];
    returnType?: string;
    isAsync?: boolean;
    isPrivate?: boolean;   // starts with _
  };
}
```

**Relationship Types:**
```typescript
interface CodeEdge {
  source: string;         // Node ID
  target: string;         // Node ID
  relationship: 'imports' | 'calls' | 'inherits' | 'uses' | 'defines';
  weight?: number;        // Frequency of relationship
}

interface KnowledgeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
}
```

**Extraction Logic:**
- **Functions:** Regex/AST for `def function_name(...)`
- **Classes:** Regex for `class ClassName(BaseClass):`
- **Imports:** `import X`, `from X import Y`
- **Calls:** Function calls within function bodies
- **Inheritance:** Base classes in class definitions
- **Variables:** Top-level assignments (module-level)

**Example:**
```python
from typing import List
import requests

class UserService:
    def get_users(self) -> List[dict]:
        return self._fetch_data("/users")
    
    def _fetch_data(self, endpoint: str):
        return requests.get(endpoint).json()
```

**Produces:**
- Nodes: `UserService` (class), `get_users` (function), `_fetch_data` (function)
- Edges: 
  - `UserService` --defines--> `get_users`
  - `UserService` --defines--> `_fetch_data`
  - `get_users` --calls--> `_fetch_data`
  - `_fetch_data` --uses--> `requests.get`

### Phase 3: Graph Visualization (45 min)

**Use React Flow or D3.js:**
- Nodes: Color-coded by type
  - Functions: Blue
  - Classes: Green
  - Modules: Purple
- Edges: Arrows showing relationships
- Interactive: Click node to see code
- Zoom/pan controls
- Filter: Show only imports, or only function calls

**Layout:**
- Hierarchical (top-to-bottom)
- Classes at top, functions below
- Group by module

### Phase 4: LLM Convention Detection (60 min)

**Claude Analysis Prompt:**
```
You are a senior code reviewer analyzing a Python codebase. Given this knowledge graph, identify coding conventions:

GRAPH DATA:
Nodes: {JSON.stringify(nodes)}
Edges: {JSON.stringify(edges)}

CODE SAMPLES:
{codeSnippets}

Analyze and document these conventions:
1. **Naming Conventions**:
   - Function naming pattern (snake_case, camelCase, etc.)
   - Class naming pattern
   - Private method indicators (_prefix, __prefix)
   - Constants naming (UPPER_CASE)

2. **Code Structure**:
   - Module organization patterns
   - Class hierarchy patterns
   - Common base classes

3. **Common Patterns**:
   - Decorator usage (most used decorators)
   - Type hints coverage (% of functions with types)
   - Async/await usage
   - Error handling patterns (try/except frequency)

4. **Import Conventions**:
   - Import organization (stdlib first, then 3rd party, then local)
   - Absolute vs relative imports

5. **Documentation**:
   - Docstring coverage (% of functions with docs)
   - Docstring style (Google, NumPy, reStructuredText)

Return markdown formatted output for conventions.md file. Include:
- Pattern name
- Description
- Code examples from the codebase
- % adoption rate
- Recommendations for improvement

Be specific and cite actual examples from the provided code.
```

**LLM Config:**
- Model: `claude-sonnet-4-20250514`
- Max tokens: 4000
- Temperature: 0.2
- Timeout: 45 seconds

**Output Structure:**
```markdown
# Codebase Conventions

## Naming Conventions
- **Functions**: snake_case (95% adoption)
  Example: `def get_user_data()`, `def process_payment()`
- **Classes**: PascalCase (100% adoption)
  Example: `class UserService`, `class PaymentProcessor`
- **Private methods**: Single underscore prefix (87% adoption)
  Example: `def _internal_helper()`

## Code Structure
- **Class hierarchy**: Service layer pattern detected
  - 3 classes inherit from BaseService
  - Graph: BaseService -> UserService, PaymentService, NotificationService

## Common Patterns
- **Decorators**: 
  - `@property` used in 12 places
  - `@staticmethod` used in 5 places
- **Type Hints**: 73% coverage
  - Recommendation: Add type hints to `calculate_total()`, `fetch_data()`

...
```

### Phase 5: UI & Export (35 min)

**Layout:**
- Header: "Codebase Convention Analyzer"
- Left: File upload area
- Center: Knowledge graph visualization
- Right: Conventions panel

**Features:**
- Real-time graph updates as files are analyzed
- Loading states: "Building graph..." → "Analyzing patterns..." → "Done"
- Download buttons:
  - conventions.md
  - graph.json (export graph data)
  - graph.png (visual export)

**MUI Components:**
- AppBar for header
- Grid for layout
- Paper for cards
- Tabs to switch: Graph view | Conventions view
- Snackbar for notifications

---

## 4. Tech Stack

### Dependencies
```bash
npm install @mui/material @mui/icons-material @emotion/react @emotion/styled
npm install @anthropic-ai/sdk
npm install reactflow  # or d3 for graph visualization
npm install react-dropzone
npm install react-markdown  # for rendering conventions.md
npm install zod
```

### Config
- Next.js 14 (App Router) + TypeScript
- MUI v5 for UI
- React Flow for graph visualization (easier than D3)
- Claude API for pattern analysis
- Vercel deployment

---

## 5. Implementation Checklist

### Hour 1: Setup & Input
- [ ] Create Next.js + MUI project
- [ ] Build file upload component
- [ ] Add code paste textarea
- [ ] Validate Python files

### Hour 2: Graph Building
- [ ] Write Python parser (regex-based)
- [ ] Extract functions, classes, imports
- [ ] Build graph data structure
- [ ] Test with example files

### Hour 3: Visualization & Analysis
- [ ] Integrate React Flow
- [ ] Render graph nodes/edges
- [ ] Add Claude API call
- [ ] Generate conventions.md

### Hour 4: Polish & Deploy
- [ ] Style with MUI
- [ ] Add download buttons
- [ ] Error handling
- [ ] Deploy to Vercel

---

## 6. Test Cases

**Test File 1: Simple Service**
```python
class UserService:
    def get_user(self, user_id: int) -> dict:
        return self._fetch(user_id)
    
    def _fetch(self, id: int):
        return {"id": id}
```

**Expected Graph:**
- 2 nodes (UserService, get_user, _fetch)
- 2 edges (defines, calls)

**Expected Conventions:**
- snake_case functions ✓
- PascalCase classes ✓
- Private methods with _ prefix ✓
- Type hints present (50%)

---

## 7. Demo Script

1. "Analyzing this codebase to find conventions automatically"
2. Upload example Python files
3. Show knowledge graph: "Here are all functions and relationships"
4. Click nodes: "Each node shows the actual code"
5. Show conventions.md: "AI discovered these patterns"
6. Download: "Export conventions for your team"

---

## 8. Success Metrics

- ✅ Parses 5+ Python files
- ✅ Builds graph with 20+ nodes
- ✅ Identifies 5+ convention categories
- ✅ Generates actionable conventions.md
- ✅ Interactive graph works smoothly
- ✅ Download conventions.md

---

## 9. Stretch Goals (if time permits)

- [ ] Multi-language support (JavaScript, TypeScript)
- [ ] Diff mode: Compare two codebases
- [ ] Convention violations checker
- [ ] Export graph to Mermaid diagram
- [ ] Integrate with GitHub (analyze entire repo)

---

## 10. Fallback Plan

**If graph visualization is too complex:**
- Skip React Flow, use simple list view
- Show nodes as cards
- Display relationships as text

**If LLM is too slow:**
- Use simpler pattern detection (regex-based)
- Pre-defined convention templates

---
