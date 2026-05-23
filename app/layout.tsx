import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veridyn Document OCR — English + Bengali",
  description:
    "Document OCR for trade licenses and compliance docs (English + Bengali). Optional dialect cue add-on via /lab.",
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
