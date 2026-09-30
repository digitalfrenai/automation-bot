import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WordPress Automation — Setup Dashboard",
  description:
    "Configure credentials, business brief, and theme for Grok-powered WordPress automation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
