import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veridyn OCR + Dialect Lab",
  description:
    "Bengali-first OCR (English supported) plus dialect cue-matching API — reusable across operator products.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
