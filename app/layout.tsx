import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veridyn Bengali Dialect Lab — OCR backbone",
  description:
    "Public dialect lab UI with WASM OCR (English + Bengali). Products integrate POST /api/documents/extract; dialect cues via /api/dialect/analyze.",
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
