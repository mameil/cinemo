import Link from "next/link";

type NavKey = "home" | "movies" | "theaters" | "timeline" | "events";

export default function AppNav({ active, date }: { active: NavKey; date?: string }) {
  const query = date ? `?date=${date}` : "";
  const items: { key: NavKey; label: string; href: string }[] = [
    { key: "home", label: "홈", href: "/" },
    { key: "movies", label: "영화", href: `/movies${query}` },
    { key: "theaters", label: "극장", href: `/movies${query}${query ? "&" : "?"}open=theaters` },
    { key: "timeline", label: "시간", href: `/timeline${query}` },
    { key: "events", label: "특전", href: "/events" },
  ];

  return (
    <nav className="sticky bottom-3 z-20 mx-4 grid grid-cols-5 rounded-2xl border border-line bg-white/95 p-1.5 shadow-lg backdrop-blur-sm" aria-label="주요 메뉴">
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={`rounded-xl py-2 text-center text-[11px] ${selected ? "bg-app-tint font-bold text-app" : "font-semibold text-ink-2"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
