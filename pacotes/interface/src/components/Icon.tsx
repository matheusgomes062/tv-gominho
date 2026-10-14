// Small line icons (24x24, stroke only) for the overlays. Inline SVG: no icon font, no dependency.

const PATHS = {
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.6-1.3-1.7-1.3-3 0-1 .8-1.8 1.9-1.8H17a4 4 0 0 0 4-4C21 6.2 17 3 12 3Z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10" cy="7.2" r="1" />
      <circle cx="14.5" cy="7.2" r="1" />
    </>
  ),
  picture: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2.5" />
      <path d="M8 21h8M12 17v4" />
      <path d="m6.5 14 3.5-4 3 3 2-2 2.5 3" />
    </>
  ),
  tube: (
    <>
      <path d="M5 6.5c4.5-1.5 9.5-1.5 14 0 1 4 1 7 0 11-4.5 1.5-9.5 1.5-14 0-1-4-1-7 0-11Z" />
      <path d="M8.5 21h7" />
    </>
  ),
  curve: (
    <>
      <path d="M3 8c6 2.5 12 2.5 18 0M3 16c6-2.5 12-2.5 18 0" />
      <path d="M3 8v8M21 8v8" />
    </>
  ),
  aspect: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 9v6M17 9v6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="m8 3 4 4 4-4" />
    </>
  ),
  ads: (
    <>
      <path d="M3.5 10v4a1 1 0 0 0 1 1H8l8 4.5v-15L8 9H4.5a1 1 0 0 0-1 1Z" />
      <path d="M19.5 9.5a4 4 0 0 1 0 5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.1" />
    </>
  ),
  gear: (
    <>
      <path d="M4 7h8.5M17.5 7H20M4 12h2.5M11.5 12H20M4 17h10.5M19.5 17H20" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="12" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5Z" />
      <path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  folder: <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z" />,
  restore: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4.5v4.2h4.2" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
