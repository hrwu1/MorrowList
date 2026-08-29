import { redirect } from "next/navigation";

/** Default landing behaviour (spec 7.4): signed-in users start in the Inbox. */
export default function HomePage() {
  redirect("/inbox");
}
