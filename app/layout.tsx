import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Agent Operations Center", description: "Live mission control for Hermes agents" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pl"><body>{children}</body></html>;
}
