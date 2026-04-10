import { redirect } from "next/navigation";

/**
 * Root page: redirect to the dashboard.
 */
export default function Home() {
  redirect("/dashboard");
}
