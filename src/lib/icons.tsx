// Inline SVG icon set — 1.8px stroke, matches the Cumulus/Sentinel style.

function svg(w: number, children: React.ReactNode) {
  return (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const Icon = {
  layers: ({ w = 17 }: { w?: number } = {}) =>
    svg(w, <><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5" /><path d="m2 17 10 5 10-5" /></>),
  plug: ({ w = 17 }: { w?: number } = {}) =>
    svg(w, <><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></>),
  table: ({ w = 17 }: { w?: number } = {}) =>
    svg(w, <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 10h18" /><path d="M10 10v10" /></>),
  terminal: ({ w = 17 }: { w?: number } = {}) =>
    svg(w, <><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>),
  settings: ({ w = 17 }: { w?: number } = {}) =>
    svg(w, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>),
  database: ({ w = 17 }: { w?: number } = {}) =>
    svg(w, <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></>),
  refresh: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></>),
  search: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /></>),
  close: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
  check: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <polyline points="20 6 9 17 4 12" />),
  copy: ({ w = 13 }: { w?: number } = {}) =>
    svg(w, <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  alert: ({ w = 16 }: { w?: number } = {}) =>
    svg(w, <><path d="m10.3 3.86-8.05 13.9A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3.25L13.7 3.86a2 2 0 0 0-3.4 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>),
  chevLeft: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <polyline points="15 18 9 12 15 6" />),
  chevRight: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <polyline points="9 18 15 12 9 6" />),
  chevDown: ({ w = 13 }: { w?: number } = {}) =>
    svg(w, <polyline points="6 9 12 15 18 9" />),
  plus: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>),
  trash: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
  play: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <polygon points="6 4 20 12 6 20 6 4" />),
  filter: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />),
  key: ({ w = 12 }: { w?: number } = {}) =>
    svg(w, <><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>),
  clock: ({ w = 13 }: { w?: number } = {}) =>
    svg(w, <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>),
  edit: ({ w = 13 }: { w?: number } = {}) =>
    svg(w, <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></>),
  columns: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M9 3v18" /><path d="M15 3v18" /></>),
  eye: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  history: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /><polyline points="12 7 12 12 15 14" /></>),
  zap: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />),
  sparkles: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" /><path d="M5 16l.8 2L8 18.8 6 19.6 5.2 22 4.4 19.6 2.4 18.8 4.4 18 5 16Z" /></>),
  minus: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <line x1="5" y1="12" x2="19" y2="12" />),
  link: ({ w = 13 }: { w?: number } = {}) =>
    svg(w, <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  unlink: ({ w = 13 }: { w?: number } = {}) =>
    svg(w, <><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 0 1 4 8" /><line x1="8" y1="12" x2="12" y2="12" /><line x1="2" y1="2" x2="22" y2="22" /></>),
  frame: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <><path d="M4 8V5a1 1 0 0 1 1-1h3" /><path d="M20 8V5a1 1 0 0 0-1-1h-3" /><path d="M4 16v3a1 1 0 0 0 1 1h3" /><path d="M20 16v3a1 1 0 0 1-1 1h-3" /></>),
  graph: ({ w = 17 }: { w?: number } = {}) =>
    svg(w, <><circle cx="5" cy="6" r="2.4" /><circle cx="19" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" /><path d="M6.9 7.4 10.4 16M17.1 7.4 13.6 16M7 6h10" /></>),
  chart: ({ w = 15 }: { w?: number } = {}) =>
    svg(w, <><path d="M3 3v18h18" /><path d="M7 16v-5" /><path d="M12 16V7" /><path d="M17 16v-8" /></>),
  download: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
  coffee: ({ w = 14 }: { w?: number } = {}) =>
    svg(w, <><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z" /><line x1="6" y1="2" x2="6" y2="5" /><line x1="10" y1="2" x2="10" y2="5" /><line x1="14" y1="2" x2="14" y2="5" /></>),
};
