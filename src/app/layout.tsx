import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";

// Inter for the Builder's own interface (APP-44): easier to read than Geist at small sizes in the chat, sidebar and forms.
// Generated sites get their fonts from the packs, not from here.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Sora for h1 to h3, the same as the marketing site.
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });

export const metadata: Metadata = {
  title: "Appnomics Builder",
  description: "Describe what you want to launch. Appnomics builds it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
      <body>{children}</body>
    </html>
  );
}
