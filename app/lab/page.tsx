import { redirect } from "next/navigation";

/** Legacy `/lab`; the public reference surface lives at `/` (static cue/sample reference + integration contract; no browser API calls). */
export default function LegacyLabRedirect() {
  redirect("/");
}
