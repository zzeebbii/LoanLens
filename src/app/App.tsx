/**
 * Application shell.
 *
 * Intentionally minimal until the router and feature routes land. The only
 * literal text here is the product name, which is a proper noun and is not
 * translated; every other user-facing string in the app must come from i18n.
 */
export function App() {
  return (
    <main className="flex h-full items-center justify-center p-8">
      <h1 className="text-3xl font-semibold tracking-tight">LoanLens</h1>
    </main>
  )
}
