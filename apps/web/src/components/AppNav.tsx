"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type NavKey = "home" | "movies" | "theaters" | "timeline" | "events";

export default function AppNav({ active, date }: { active: NavKey; date?: string }) {
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const dateQuery = date ? `?date=${date}` : "";
  const items: { key: NavKey; label: string; href: string }[] = [
    { key: "home", label: "홈", href: "/" },
    { key: "movies", label: "영화", href: `/movies${dateQuery}` },
    { key: "theaters", label: "극장", href: `/theaters${dateQuery}` },
    { key: "timeline", label: "시간", href: `/timeline${dateQuery}` },
    { key: "events", label: "특전", href: `/events${dateQuery}` },
  ];

  useEffect(() => {
    if (!showSearch) return;
    inputRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowSearch(false);
      searchButtonRef.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [showSearch]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    params.set("query", value);
    setShowSearch(false);
    setQuery("");
    router.push(`/movies?${params.toString()}`);
  }

  return (
    <>
    {showSearch && (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-4 pb-24" onClick={() => setShowSearch(false)}>
        <form
          role="search"
          aria-label="전체 영화 검색"
          onSubmit={submitSearch}
          onClick={(event) => event.stopPropagation()}
          className="flex w-full max-w-[620px] items-center gap-2 rounded-2xl bg-white p-3 shadow-xl"
        >
          <span aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="영화, 장소 또는 시간 검색"
            placeholder="영화 · 장소 · 시간으로 찾기"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
          <button type="submit" disabled={!query.trim()} className="rounded-full bg-app px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">찾기</button>
          <button type="button" onClick={() => { setShowSearch(false); searchButtonRef.current?.focus(); }} className="px-1 text-sm text-ink-3" aria-label="검색 닫기">✕</button>
        </form>
      </div>
    )}
    <nav className="sticky bottom-3 z-20 mx-4 grid grid-cols-6 rounded-2xl border border-line bg-white/95 p-1.5 shadow-lg backdrop-blur-sm" aria-label="주요 메뉴">
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
      <button
        ref={searchButtonRef}
        type="button"
        onClick={() => setShowSearch(true)}
        aria-expanded={showSearch}
        className="rounded-xl py-2 text-center text-[11px] font-semibold text-ink-2"
      >
        검색
      </button>
    </nav>
    </>
  );
}
