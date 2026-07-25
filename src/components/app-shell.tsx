"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  FolderIcon,
  ListChecksIcon,
  DownloadIcon,
  KeyRoundIcon,
  CaptionsIcon,
  MessageSquareCodeIcon,
  SettingsIcon,
  PlusIcon,
  ClapperboardIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToolingBanner } from "@/components/tooling-banner";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboardIcon },
  { label: "Projects", href: "/projects", icon: FolderIcon },
  { label: "Processing Queue", href: "/queue", icon: ListChecksIcon },
  { label: "Exports", href: "/exports", icon: DownloadIcon },
  { label: "API Settings", href: "/api-settings", icon: KeyRoundIcon },
  { label: "Subtitle Themes", href: "/subtitle-themes", icon: CaptionsIcon },
  { label: "Prompt Templates", href: "/prompt-templates", icon: MessageSquareCodeIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ClapperboardIcon className="size-5" />
          </span>
          <div className="flex flex-col leading-none">
            <span className="font-heading text-sm font-semibold text-sidebar-foreground">
              AI Shorts
            </span>
            <span className="text-[0.7rem] text-muted-foreground">Studio</span>
          </div>
        </div>

        <Separator className="bg-sidebar-border" />

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-primary"
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Separator className="bg-sidebar-border" />
        <div className="p-3">
          <p className="px-3 text-[0.7rem] uppercase tracking-wider text-muted-foreground">
            v0.1 · local
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-sm">
          <h2 className="font-heading text-base font-medium text-foreground">
            {NAV_ITEMS.find((i) => isActive(i.href))?.label ?? "Dashboard"}
          </h2>
          <Button size="default" asChild>
            <Link href="/projects/new">
              <PlusIcon />
              New Project
            </Link>
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-6 py-8">
            <div className="mb-4">
              <ToolingBanner />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
