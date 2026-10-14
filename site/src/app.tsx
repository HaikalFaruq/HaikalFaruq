import ContributionSkyline from "@/components/ui/contribution-skyline"
import contributions from "../../assets/contributions.json"
import meta from "../../assets/meta.json"

// The calendar card's four activity levels (THEMES in scripts/render.mjs).
const palette = {
  light: ["#b7d0ea", "#7eaee0", "#3f84cc", "#1c5a9f"],
  dark: ["#1f4470", "#26609f", "#3a86d8", "#7cb8fb"],
}

const muted = { color: "var(--color-muted-foreground)" }

export default function App() {
  return (
    <main className="mx-auto w-full max-w-[980px] px-4 py-10 sm:px-8 sm:py-14">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="m-0 text-[13px]" style={muted}>
            Muhammad Haikal Faruq
          </p>
          <h1 className="m-0 mt-1 text-[26px] leading-tight font-semibold tracking-[-0.01em]">Contribution calendar</h1>
        </div>
        <a
          className="text-[13px] font-medium underline-offset-4 hover:underline"
          style={{ color: "var(--color-link)" }}
          href="https://github.com/HaikalFaruq"
        >
          github.com/HaikalFaruq
        </a>
      </header>
      <ContributionSkyline data={contributions.days} palette={palette} />
      <p className="mt-4 text-[12px]" style={muted}>
        Private work included. Updated {meta.updated}.
      </p>
    </main>
  )
}
