"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Box, Typography } from "@mui/material";

export interface ConventionsViewerProps {
  markdown?: string;
}

export function ConventionsViewer({ markdown = "" }: ConventionsViewerProps) {
  const content = useMemo(() => markdown?.trim() || "", [markdown]);

  if (!content) {
    return (
      <Typography variant="body2" color="text.secondary">
        No conventions to display yet.
      </Typography>
    );
  }

  return (
    <Box sx={{
      "& h1": { fontSize: 24, fontWeight: 700, mt: 1.5, mb: 1 },
      "& h2": { fontSize: 20, fontWeight: 700, mt: 1.5, mb: 1 },
      "& h3": { fontSize: 18, fontWeight: 700, mt: 1.25, mb: 0.75 },
      "& p": { mb: 1 },
      "& ul, & ol": { pl: 3, mb: 1 },
      "& code": { bgcolor: "action.hover", px: 0.5, py: 0.2, borderRadius: 0.5, fontFamily: "monospace" },
      "& pre": { bgcolor: "action.hover", p: 1, borderRadius: 1, overflow: "auto" },
      "& table": { borderCollapse: "collapse", width: "100%", mb: 1 },
      "& th, & td": { border: "1px solid", borderColor: "divider", p: 0.5 },
    }}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </Box>
  );
}

export default ConventionsViewer;

