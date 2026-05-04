import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-2xl font-semibold text-black dark:text-zinc-50">
          Sign in
        </h1>
        <LoginForm />
      </div>
    </main>
  );
}
