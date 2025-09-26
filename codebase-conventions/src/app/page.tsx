"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Container,
  Stack,
  Paper,
  Typography,
  Divider,
  Chip,
  Grid,
  Button,
  Tabs,
  Tab,
  Snackbar,
  Alert,
  CircularProgress,
  Box,
} from "@mui/material";
import CodeUploader from "../components/CodeUploader";
import KnowledgeGraph from "../components/KnowledgeGraph";
import ConventionsViewer from "../components/ConventionsViewer";
import type { UploadedFile, KnowledgeGraph as TKnowledgeGraph } from "../lib/types";

type Stage = "idle" | "building" | "analyzing" | "done";

export default function Home() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [graph, setGraph] = useState<TKnowledgeGraph | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [stage, setStage] = useState<Stage>("idle");
  const [activeTab, setActiveTab] = useState<"graph" | "conventions">("graph");
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "info" | "warning" | "error" }>({ open: false, message: "", severity: "info" });
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);

  const graphRef = useRef<HTMLDivElement | null>(null);
  const convRef = useRef<HTMLDivElement | null>(null);

  const canAnalyze = useMemo(() => files.length > 0, [files.length]);
  const availableModules = useMemo(() => {
    // Approximate modules from filenames (without .py)
    return Array.from(new Set(files.map((f) => {
      const n = f.name;
      return n.endsWith(".py") ? n.slice(0, -3) : n;
    })));
  }, [files]);

  const handleUploaderError = useCallback((m: string) => {
    setSnackbar({ open: true, message: m, severity: "error" });
  }, []);

  async function runAnalysis() {
    if (!canAnalyze) {
      setSnackbar({ open: true, message: "Please add at least one .py file or snippet", severity: "warning" });
      return;
    }
    try {
      setStage("building");
      setGraph(null);
      setMarkdown("");
      setActiveTab("graph");

      const res1 = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files, options: { includeDocstrings: true }, timeoutMs: 20000 }),
      });
      if (!res1.ok) {
        const err = await safeReadError(res1);
        throw new Error(err);
      }
      const j1 = await res1.json();
      const g: TKnowledgeGraph = j1.graph;
      setGraph(g);
      setStage("analyzing");

      const codeSnippets = files.slice(0, 3).map((f) => f.content);
      const res2 = await fetch("/api/conventions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph: g, codeSnippets }),
      });
      if (!res2.ok) {
        const err = await safeReadError(res2);
        throw new Error(err);
      }
      const j2 = await res2.json();
      setMarkdown(String(j2.markdown || ""));
      setStage("done");
      setActiveTab("conventions");
      setSnackbar({ open: true, message: "Analysis complete", severity: "success" });
      // best-effort focus
      setTimeout(() => convRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      const msg = (e as Error)?.message || "Analysis failed";
      setStage("idle");
      setSnackbar({ open: true, message: msg, severity: "error" });
    }
  }

  function resetAll() {
    setFiles([]);
    setGraph(null);
    setMarkdown("");
    setStage("idle");
    setActiveTab("graph");
    setSelectedFileNames([]);
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack spacing={2}>
        <Typography variant="h4">Codebase Convention Analyzer</Typography>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Upload Python code</Typography>
            <CodeUploader onChange={setFiles} onError={handleUploaderError} />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={runAnalysis} disabled={!canAnalyze || stage === "building" || stage === "analyzing"}>
                {stage === "building" ? "Building graph…" : stage === "analyzing" ? "Analyzing patterns…" : "Analyze"}
              </Button>
              <Button onClick={resetAll} disabled={stage === "building" || stage === "analyzing"}>Reset</Button>
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Typography variant="subtitle1">Selection</Typography>
              <Typography variant="body2" color="text.secondary">
                {files.length === 0 ? "No files selected yet" : `${files.length} item(s) ready`}
              </Typography>
              {files.length > 0 && (
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {files.slice(0, 10).map((f) => (
                    <Chip key={f.name} label={f.name} />
                  ))}
                </Stack>
              )}
              {files.length > 10 && (
                <Typography variant="caption" color="text.secondary">
                  +{files.length - 10} more
                </Typography>
              )}
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ px: 2 }}>
          <Tabs
            value={activeTab === "graph" ? 0 : 1}
            onChange={(_, v) => {
              const tab = v === 0 ? "graph" : "conventions";
              setActiveTab(tab);
              if (tab === "graph") graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              else convRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            aria-label="View tabs"
          >
            <Tab label="Graph view" />
            <Tab label="Conventions view" />
          </Tabs>
        </Paper>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4, lg: 3 }}>
            <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
              <Typography variant="subtitle1" gutterBottom>
                Input
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Click a file to focus its graph/conventions.
              </Typography>
              <Box component="nav" aria-label="uploaded files">
                {files.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No files yet</Typography>
                ) : (
                  <Stack spacing={0.5}>
                    {files.map((f) => {
                      const selected = selectedFileNames.includes(f.name);
                      return (
                        <Button
                          key={f.name}
                          size="small"
                          variant={selected ? "contained" : "outlined"}
                          onClick={() => {
                            setSelectedFileNames((prev) => {
                              if (prev.includes(f.name)) return prev.filter((n) => n !== f.name);
                              return [f.name];
                            });
                            setActiveTab("graph");
                            setTimeout(() => graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                          }}
                          sx={{ justifyContent: "flex-start" }}
                        >
                          {f.name}
                        </Button>
                      );
                    })}
                    {files.length > 1 && (
                      <Button size="small" onClick={() => setSelectedFileNames([])}>Clear selection</Button>
                    )}
                  </Stack>
                )}
              </Box>
            </Paper>
          </Grid>

          {activeTab === "graph" && (
            <Grid size={{ xs: 12, md: 8, lg: 9 }}>
              <div ref={graphRef} />
              <Paper
                variant="elevation"
                sx={{ p: 2, height: "100%", borderColor: "primary.main" }}
              >
                <Stack spacing={1}>
                  <Typography variant="subtitle1">Knowledge Graph</Typography>
                  <Divider />
                  <Box sx={{ position: "relative", minHeight: 360 }}>
                    {stage === "building" && (
                      <Stack alignItems="center" justifyContent="center" sx={{ position: "absolute", inset: 0 }} spacing={1}>
                        <CircularProgress size={24} />
                        <Typography variant="body2" color="text.secondary">
                          Building graph…
                        </Typography>
                      </Stack>
                    )}
                    {graph ? (
                      <KnowledgeGraph
                        graph={graph}
                        height={420}
                        filterModules={selectedFileNames.length ? availableModules.filter((m) => selectedFileNames.some((n) => n.startsWith(m))) : undefined}
                        filterFilePaths={selectedFileNames.length ? files.filter((f) => selectedFileNames.includes(f.name)).map((f) => f.name) : undefined}
                      />
                    ) : (
                      <Stack alignItems="center" justifyContent="center" sx={{ height: 360 }}>
                        <Typography variant="body2" color="text.secondary">
                          {stage === "building" ? "" : "No graph yet"}
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          )}

          {activeTab === "conventions" && (
            <Grid size={{ xs: 12, md: 8, lg: 9 }}>
              <div ref={convRef} />
              <Paper
                variant="elevation"
                sx={{ p: 2, height: "100%", borderColor: "primary.main" }}
              >
                <Stack spacing={1}>
                  <Typography variant="subtitle1">Conventions</Typography>
                  <Divider />
                  <Box sx={{ position: "relative", minHeight: 360 }}>
                    {stage === "analyzing" && (
                      <Stack alignItems="center" justifyContent="center" sx={{ position: "absolute", inset: 0 }} spacing={1}>
                        <CircularProgress size={24} />
                        <Typography variant="body2" color="text.secondary">
                          Analyzing patterns…
                        </Typography>
                      </Stack>
                    )}
                    {markdown ? (
                      <ConventionsViewer markdown={markdown} />
                    ) : (
                      <Stack alignItems="center" justifyContent="center" sx={{ height: 360 }}>
                        <Typography variant="body2" color="text.secondary">
                          {stage === "analyzing" ? "" : "No conventions yet"}
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          )}
        </Grid>

        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert
            severity={snackbar.severity}
            onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
            variant="filled"
            sx={{ width: "100%" }}
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Stack>
    </Container>
  );
}

async function safeReadError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return String(j?.error || res.statusText || `HTTP ${res.status}`);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}
