"use client";

import React from "react";

export interface CodeUploaderProps {
  onUpload?: (files: FileList) => void;
}

export function CodeUploader({ onUpload }: CodeUploaderProps) {
  return (
    <div>
      <input
        type="file"
        multiple
        onChange={(e) => {
          if (e.target.files && onUpload) {
            onUpload(e.target.files);
          }
        }}
      />
    </div>
  );
}

export default CodeUploader;

