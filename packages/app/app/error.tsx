"use client";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">An unexpected error occurred. Please try again.</p>
        <button onClick={reset} className="pill pill--ghost">Try again</button>
      </div>
    </main>
  );
}
