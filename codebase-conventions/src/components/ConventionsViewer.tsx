"use client";

import React from "react";

export interface ConventionsViewerProps {
  conventions?: Array<{ id: string; title: string; description?: string }>;
}

export function ConventionsViewer({ conventions = [] }: ConventionsViewerProps) {
  return (
    <ul>
      {conventions.map((c) => (
        <li key={c.id}>
          <strong>{c.title}</strong>
          {c.description ? <div>{c.description}</div> : null}
        </li>
      ))}
    </ul>
  );
}

export default ConventionsViewer;

