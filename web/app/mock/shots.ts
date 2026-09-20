// Placeholder NetSuite screenshot (SVG data URI) for static mode. Illustration only, not client data.
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function nsShot(opts: { title: string; status?: string; highlight?: "approve" | "status" | "error" | "none"; error?: string; step: number; dark?: boolean }): string {
  const { title, status = "Pending Approval", highlight = "none", error, step } = opts;
  const bg = "#FFFFFF";
  const hl = (x: number, y: number, w: number, h: number) =>
    `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="4" fill="none" stroke="#0068D6" stroke-width="3"/><rect x="${x - 4}" y="${y - 28}" width="26" height="20" rx="4" fill="#0068D6"/><text x="${x + 9}" y="${y - 13}" font-size="13" fill="#fff" text-anchor="middle" font-family="system-ui">${step}</text>`;
  const fields = [
    ["Vendor", "PT ████████ Supplies"],
    ["Date", "12/09/2026"],
    ["Approval Status", status],
    ["Next Approver", "████ ██████"],
    ["Subsidiary", "ACME Indonesia"],
    ["Amount", "IDR 148.250.000"],
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
  <rect width="1440" height="900" fill="${bg}"/>
  <rect width="1440" height="56" fill="#1F2A37"/>
  <text x="32" y="36" font-size="18" fill="#FFFFFF" font-family="system-ui" font-weight="600">NetSuite</text>
  <rect x="180" y="16" width="420" height="24" rx="4" fill="#374151"/>
  <rect y="56" width="1440" height="40" fill="#E5E7EB"/>
  ${["Activities", "Transactions", "Lists", "Reports", "Customization", "Setup"].map((t, i) => `<text x="${32 + i * 140}" y="81" font-size="14" fill="#374151" font-family="system-ui">${t}</text>`).join("")}
  <text x="32" y="148" font-size="26" fill="#111827" font-family="system-ui" font-weight="600">${esc(title)}</text>
  <text x="32" y="176" font-size="14" fill="#6B7280" font-family="system-ui">Vendor Bill · ${esc(status)}</text>
  <rect x="32" y="196" width="80" height="32" rx="4" fill="#2563EB"/><text x="72" y="217" font-size="14" fill="#fff" text-anchor="middle" font-family="system-ui">Edit</text>
  <rect x="124" y="196" width="96" height="32" rx="4" fill="#E5E7EB"/><text x="172" y="217" font-size="14" fill="#111827" text-anchor="middle" font-family="system-ui">Approve</text>
  <rect x="232" y="196" width="80" height="32" rx="4" fill="#E5E7EB"/><text x="272" y="217" font-size="14" fill="#111827" text-anchor="middle" font-family="system-ui">Reject</text>
  ${error ? `<rect x="32" y="248" width="1376" height="56" rx="4" fill="#FEF2F2" stroke="#FCA5A5"/><text x="56" y="282" font-size="15" fill="#991B1B" font-family="system-ui" font-weight="600">Error: ${esc(error)}</text>` : ""}
  ${fields
    .map(([k, v], i) => {
      const x = 32 + (i % 3) * 460;
      const y = (error ? 340 : 280) + Math.floor(i / 3) * 84;
      return `<text x="${x}" y="${y}" font-size="12" fill="#6B7280" font-family="system-ui">${esc(k!.toUpperCase())}</text><text x="${x}" y="${y + 26}" font-size="16" fill="#111827" font-family="system-ui">${esc(v!)}</text>`;
    })
    .join("")}
  <rect x="32" y="${error ? 540 : 480}" width="1376" height="1" fill="#E5E7EB"/>
  <text x="32" y="${error ? 576 : 516}" font-size="15" fill="#111827" font-family="system-ui" font-weight="600">Expenses and Items</text>
  ${[0, 1, 2, 3].map((r) => `<rect x="32" y="${(error ? 596 : 536) + r * 44}" width="1376" height="40" fill="${r % 2 ? "#FFFFFF" : "#F9FAFB"}"/><text x="48" y="${(error ? 621 : 561) + r * 44}" font-size="14" fill="#374151" font-family="system-ui">Line ${r + 1} · Raw material batch ${1200 + r}</text>`).join("")}
  ${highlight === "approve" ? hl(124, 196, 96, 32) : highlight === "status" ? hl(492, error ? 322 : 262, 300, 50) : highlight === "error" ? hl(32, 248, 1376, 56) : ""}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
