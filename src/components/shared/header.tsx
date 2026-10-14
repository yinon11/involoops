import Image from "next/image";

export function Header() {
  return (
    <header className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/involoops-mark-white.svg"
            alt=""
            width={48}
            height={48}
            className="h-10 w-10"
          />
          <h1 className="text-3xl font-bold text-white">InvoLoops</h1>
        </div>
        <p className="mt-2 text-lg text-white/70">
          Business expense analytics &amp; insights
        </p>
      </div>
    </header>
  );
}
