import type { ReactNode } from "react";

/** The starter cards on Home. Copy and art match the Appnomics site's hero. Store cards use a screenshot from /public/images when it is there, and the drawing otherwise. */

const artProps = { viewBox: "0 0 320 240", preserveAspectRatio: "xMidYMid slice", className: "h-full w-full", "aria-hidden": true } as const;

function CeramicsArt() {
  const speckles: [number, number][] = [[62, 138], [78, 150], [96, 134], [70, 168], [100, 162], [88, 178], [58, 156]];
  return (
    <svg {...artProps}>
      <rect width="320" height="240" fill="#ead9c6" />
      <rect y="192" width="320" height="48" fill="#d9c1a6" />
      <rect y="190" width="320" height="6" fill="#c7a98a" />
      <path d="M116 130h12a17 17 0 0 1 0 36h-12" fill="none" stroke="#b4644a" strokeWidth="10" strokeLinecap="round" />
      <rect x="46" y="112" width="70" height="80" rx="12" fill="#b4644a" />
      <ellipse cx="81" cy="113" rx="35" ry="7" fill="#8f4a35" />
      {speckles.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="#f3e4d3" />
      ))}
      <path d="M150 150h112c0 30-24 44-56 44s-56-14-56-44z" fill="#f2e8dc" />
      <ellipse cx="206" cy="150" rx="56" ry="9" fill="#d8c3aa" />
      <ellipse cx="206" cy="151" rx="47" ry="6" fill="#e9d7c1" />
      <path d="M282 92h10v20c14 9 18 30 18 48v32h-46v-32c0-18 4-39 18-48z" fill="#6f7d6a" />
    </svg>
  );
}

function BoutiqueArt() {
  return (
    <svg {...artProps}>
      <rect width="320" height="240" fill="#e5dde6" />
      <rect y="204" width="320" height="36" fill="#d3c7d6" />
      <path d="M20 40H300" stroke="#7d6f84" strokeWidth="4" strokeLinecap="round" />
      <path d="M92 66h36l8 26-14 14 20 92H78l20-92-14-14z" fill="#7b3f61" />
      <path d="M192 66h36l8 26-14 14 20 92H178l20-92-14-14z" fill="#dba596" />
      <rect x="20" y="186" width="54" height="18" rx="3" fill="#a9b8a5" />
      <rect x="20" y="168" width="54" height="18" rx="3" fill="#e6cfae" />
      <rect x="262" y="156" width="40" height="48" rx="4" fill="#c8b79d" />
    </svg>
  );
}

function PortfolioArt() {
  return (
    <svg {...artProps}>
      <rect width="320" height="240" fill="#e8e4dc" />
      <rect x="40" y="40" width="110" height="140" rx="4" fill="#b8574a" />
      <rect x="170" y="40" width="110" height="64" rx="4" fill="#4a6b8a" />
      <rect x="170" y="116" width="110" height="64" rx="4" fill="#d9b44a" />
      <rect x="40" y="196" width="120" height="8" rx="3" fill="#a69f90" />
    </svg>
  );
}

export type Template = {
  id: string;
  caption: string;
  text: string;
  art: ReactNode;
  image?: string;
  /** Live example sites: label and address. */
  demos?: { label: string; url: string }[];
  /** Not available yet. */
  soon?: boolean;
};

export const STORE_TEMPLATES: Template[] = [
  { id: "fernhollow", caption: "Handmade goods", text: "A handmade ceramics store with mugs, bowls and custom engraving", image: "/images/fernhollow-store-template.png", art: <CeramicsArt />, demos: [{ label: "Fernhollow", url: "https://fernhollow.store" }] },
  { id: "boutique", caption: "Designer fashion", text: "A boutique clothing shop with seasonal drops and local pickup", image: "/images/aldervale-template.png", art: <BoutiqueArt />, demos: [{ label: "Alder & Vale", url: "https://aldervale.appnomics.live" }] },
  { id: "art", caption: "Art and portfolio", text: "A portfolio and shop for a painter", image: "/images/avant-store-template.png", art: <PortfolioArt />, demos: [{ label: "Studio Avant", url: "https://studioavant.appnomics.live" }] },
];

export const SITE_TEMPLATES: Template[] = [
  {
    id: "website-mvp",
    caption: "Waitlist site",
    text: "A waitlist website for ___, with a product overview, features and a signup form.",
    demos: [
      { label: "Ksandra", url: "https://ksandra.appnomics.live/" },
      { label: "Tidewell Ring", url: "https://tidewell-ring.appnomics.live/" },
      { label: "DispatchOS", url: "https://dispatchos-waitlist.appnomics.live" },
    ],
    art: (
      <div className="flex h-full flex-col justify-center gap-3 bg-emerald-50 p-5 text-emerald-950 sm:p-8">
        <span className="font-mono text-[10px]">YOUR PRODUCT</span>
        <span className="text-lg leading-tight sm:text-2xl">An idea.<br />A first launch.</span>
        <span className="h-2 w-3/4 bg-emerald-900/15" />
        <span className="h-6 w-1/2 rounded bg-emerald-800" />
      </div>
    ),
  },
  {
    id: "website-portfolio",
    caption: "Portfolio site",
    text: "A personal portfolio website with selected projects, an about section and a contact form",
    soon: true,
    art: (
      <div className="flex h-full flex-col justify-center gap-3 bg-sky-50 p-5 text-sky-950 sm:p-8">
        <span className="font-mono text-[10px]">SELECTED WORK</span>
        <span className="text-lg leading-tight sm:text-2xl">Made with<br />purpose.</span>
        <div className="grid grid-cols-2 gap-2"><span className="h-10 bg-sky-200" /><span className="h-10 bg-rose-200" /></div>
      </div>
    ),
  },
  {
    id: "website-resume",
    caption: "Resume / Personal site",
    text: "A professional resume website with my experience, skills, education and contact details",
    soon: true,
    art: (
      <div className="flex h-full flex-col justify-center gap-3 bg-neutral-100 p-5 text-neutral-900 sm:p-8">
        <span className="font-mono text-[10px]">YOUR NAME</span>
        <span className="text-lg leading-tight sm:text-2xl">Experience<br />that matters.</span>
        <span className="h-2 w-full bg-neutral-300" /><span className="h-2 w-3/4 bg-neutral-300" /><span className="h-2 w-1/2 bg-neutral-300" />
      </div>
    ),
  },
];
