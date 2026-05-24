import { redirect } from "next/navigation";

/** Legacy `/lab`; primary UI now lives at `/` (Dialect Lab + OCR ingress). */
export default function LegacyLabRedirect() {
  redirect("/");
}
