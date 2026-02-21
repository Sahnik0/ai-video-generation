import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Topic to Video",
  description: "Generate slideshow videos from a topic."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen grid-surface">
        {children}
      </body>
    </html>
  );
}
