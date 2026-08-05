import { Suspense } from "react";
import Dashboard from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <Suspense fallback={<main className="center-state"><div className="loader" /><p>Łączenie z centrum operacyjnym…</p></main>}>
      <Dashboard />
    </Suspense>
  );
}
