import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veridyn Bengali Dialect Reference — OCR service",
  description:
    "Public reference UI for a bearer-protected OCR and Bengali dialect service. Vercel scan OCR uses a configured vision provider.",
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
