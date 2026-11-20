/**
 * Line icons for the feature cards on the style tile. A small closed set drawn here (24 by 24, outline only, one stroke
 * width, color from the page), chosen by the icon name Scout wrote in the brief (lucide-style names such as "trophy" or
 * "calendar-check"). A name not in the set gets the closest match by keyword, or a plain spark. The tile is indicative;
 * the build draws its own icons from lucide-react (look.md).
 */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const CALENDAR = `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`;
const REFRESH = `<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>`;

export const TILE_ICONS: Record<string, string> = {
  calendar: svg(CALENDAR),
  "calendar-check": svg(`${CALENDAR}<path d="M9 15l2 2 4-4"/>`),
  smartphone: svg(`<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4v4h-4z"/>`),
  refresh: svg(REFRESH),
  "refresh-off": svg(`${REFRESH}<path d="M4 4l16 16"/>`),
  receipt: svg(`<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>`),
  tag: svg(`<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>`),
  check: svg(`<path d="M5 12l4 4 10-10"/>`),
  clock: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
  users: svg(`<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3 6"/>`),
  shield: svg(`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>`),
  bell: svg(`<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>`),
  chart: svg(`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`),
  lock: svg(`<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>`),
  globe: svg(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>`),
  zap: svg(`<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`),
  heart: svg(`<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>`),
  star: svg(`<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>`),
  spark: svg(`<path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>`),
};

/** Keywords that pick an icon when the name is not in the set, tried in order. */
const KEYWORDS: [RegExp, string][] = [
  [/calendar.*check|check.*calendar/, "calendar-check"],
  [/calendar|date|day|schedule/, "calendar"],
  [/phone|mobile|app|device/, "smartphone"],
  [/trophy|award|medal|win/, "trophy"],
  [/(refresh|repeat|renew|cycle|rotate).*(off|x|slash)|no-renew/, "refresh-off"],
  [/refresh|repeat|renew|cycle|rotate/, "refresh"],
  [/receipt|invoice|bill|wallet|credit|card|money|dollar|coin/, "receipt"],
  [/tag|label|price/, "tag"],
  [/check|done|ok/, "check"],
  [/clock|time|timer|hour|watch/, "clock"],
  [/user|people|team|group|member/, "users"],
  [/shield|safe|secure|protect/, "shield"],
  [/bell|alert|notif/, "bell"],
  [/chart|graph|stat|trend|bar/, "chart"],
  [/lock|key|private/, "lock"],
  [/globe|world|earth|web/, "globe"],
  [/zap|bolt|fast|lightning|flash/, "zap"],
  [/heart|love|like/, "heart"],
  [/star|favorite/, "star"],
];

/** The icon for a name from the brief: an exact match, else the first keyword that fits, else a spark. */
export function tileIcon(name: unknown): string {
  const n = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (TILE_ICONS[n]) return TILE_ICONS[n];
  const hit = KEYWORDS.find(([re]) => re.test(n));
  return TILE_ICONS[hit ? hit[1] : "spark"];
}
