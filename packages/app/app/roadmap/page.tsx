import { redirect } from "next/navigation";

// /roadmap moved into /#roadmap on the landing page.
export default function RoadmapRedirect() {
  redirect("/#roadmap");
}
