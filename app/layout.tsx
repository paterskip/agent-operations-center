import type { Metadata } from "next";
import "./globals.css";
import "./inbox.css";
import "./decisions.css";

export const metadata: Metadata = { title: "Agent Operations Center", description: "Live mission control for Hermes agents" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
