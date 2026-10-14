import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
      <div className="w-full max-w-md px-4">
        {children}
        <p className="mt-6 text-center text-sm text-gray-600">
          Need help?{" "}
          <Link
            href="/contact"
            className="font-medium text-primary hover:underline"
          >
            Contact us
          </Link>
        </p>
      </div>
    </div>
  );
}
