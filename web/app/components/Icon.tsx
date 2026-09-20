// Small custom icon set (DESIGN.md §5): 1.5px stroke, 16px, kept deliberately small.
const P: Record<string, string> = {
  inbox: "M2 9h3l1.5 2h3L11 9h3M2 9l2-6h8l2 6v4H2z",
  folder: "M2 4h4l1.5 1.5H14V12H2z",
  plus: "M8 3v10M3 8h10",
  chart: "M3 13V7M8 13V3M13 13V9",
  settings: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
  warning: "M8 2l6.5 11.5h-13zM8 6.5v3.5M8 11.8v.2",
  check: "M3 8.5l3 3 7-7",
  x: "M4 4l8 8M12 4l-8 8",
  copy: "M5 5h8v8H5zM3 11V3h8",
  play: "M5 3l8 5-8 5z",
  stop: "M4 4h8v8H4z",
  file: "M4 2h5l3 3v9H4zM9 2v3h3",
  menu: "M2 4h12M2 8h12M2 12h12",
  refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3",
  download: "M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
  moon: "M13.5 9.6A5.5 5.5 0 1 1 6.4 2.5a4.5 4.5 0 0 0 7.1 7.1z",
};
export function Icon({ name, label, className }: { name: keyof typeof P | string; label?: string; className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} className={className} style={{ flex: "none" }}>
      <path d={P[name] ?? P.file} />
    </svg>
  );
}
