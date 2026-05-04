export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-lg">
        {children}
      </div>
    </div>
  );
}
