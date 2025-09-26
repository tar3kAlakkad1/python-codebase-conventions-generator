"use client";

import React from "react";

export interface DownloadButtonProps {
  filename: string;
  content: string | Blob;
}

export function DownloadButton({ filename, content }: DownloadButtonProps) {
  return (
    <button
      onClick={() => {
        const blob = content instanceof Blob ? content : new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      Download
    </button>
  );
}

export default DownloadButton;

