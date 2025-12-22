export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-col items-center justify-center gap-8 p-8">
        <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
          Insider Risk Monitor
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Security telemetry analysis and risk scoring dashboard
        </p>
        <div className="text-sm text-zinc-500 dark:text-zinc-500">
          Setup in progress...
        </div>
      </main>
    </div>
  );
}
