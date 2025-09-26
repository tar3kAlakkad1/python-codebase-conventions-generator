"use client";

import React, { useState } from "react";
import { Container, Stack, Paper, Typography, Divider, Chip } from "@mui/material";
import CodeUploader from "../components/CodeUploader";
import { UploadedFile } from "../lib/types";

export default function Home() {
  const [files, setFiles] = useState<UploadedFile[]>([]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h4">Codebase Convention Analyzer</Typography>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Upload Python code</Typography>
            <CodeUploader onChange={setFiles} />
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
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
        </Paper>
      </Stack>
    </Container>
  );
}
