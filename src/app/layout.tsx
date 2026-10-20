import type { Metadata, Viewport } from "next";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/nunito";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudyRunway — AI financial agent for international students",
  description:
    "A model-driven AI financial readiness agent for international students. FinTechathon 2026, International Track, Topic C.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
