import Chatbot from "@/components/Chatbot";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-16 sm:px-8 sm:py-24">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">
          Platinum Electrical Contractors
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
          Generator sales, service &amp; maintenance
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          Professional electrical solutions for homes and businesses. Use the
          chat assistant in the corner to request a quote, book maintenance, or
          speak with our team.
        </p>
        <ul className="mt-8 flex flex-wrap gap-3 text-sm text-slate-700">
          <li className="rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
            New generator quotes
          </li>
          <li className="rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
            Service &amp; repair
          </li>
          <li className="rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
            Maintenance booking
          </li>
        </ul>
      </main>
      <Chatbot />
    </div>
  );
}
