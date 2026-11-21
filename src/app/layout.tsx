import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SYNAPSE — Your Personal Learning OS", template: "%s · SYNAPSE" },
  description: "Learn a university subject from your own course material: weekly timeline, AI teaching, practice and revision.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#070910",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
