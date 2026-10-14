export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 px-4 py-6 sm:py-10">
      <article className="legal-prose mx-auto max-w-3xl rounded-xl bg-white px-5 py-8 text-gray-700 shadow-sm sm:px-10 sm:py-10">
        {children}
      </article>
    </div>
  );
}
