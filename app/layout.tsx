import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Mono, Syne } from "next/font/google";
import "./globals.css";
import "./inbox.css";
import "./decisions.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const mono = Space_Mono({ subsets: ["latin"], variable: "--font-space-mono", display: "swap", weight: ["400", "700"] });
const syne = Syne({ subsets: ["latin"], variable: "--font-syne", display: "swap", weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "Agent Operations Center // Mission Control",
  description: "Autonomous Agent Orchestration & Mission Control",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className={`${jakarta.variable} ${mono.variable} ${syne.variable}`} suppressHydrationWarning>{children}</body>
    </html>
  );
}
