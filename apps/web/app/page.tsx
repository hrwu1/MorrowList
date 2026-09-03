import { redirect } from "next/navigation";

/** Default landing behaviour (spec 7.4): signed-in users start in Today. */
export default function HomePage() {
  redirect("/today");
}
