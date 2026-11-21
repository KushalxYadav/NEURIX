import {
  BookOpenText,
  CalendarCheck2,
  CalendarRange,
  GalleryVerticalEnd,
  LayoutDashboard,
  Library,
  MessageSquareText,
  NotebookPen,
  Settings,
  Target,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Learn",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/weekly-overview", label: "Weekly Overview", icon: CalendarRange },
      { href: "/curriculum", label: "Subject Curriculum", icon: Workflow },
      { href: "/learning", label: "Learning Room", icon: BookOpenText },
      { href: "/tutor", label: "AI Tutor", icon: MessageSquareText },
    ],
  },
  {
    label: "Practise",
    items: [
      { href: "/notes", label: "My Notes", icon: NotebookPen },
      { href: "/practice", label: "Practice Arena", icon: Target },
      { href: "/flashcards", label: "Flashcards", icon: GalleryVerticalEnd },
      { href: "/planner", label: "Study Planner", icon: CalendarCheck2 },
      { href: "/progress", label: "Progress", icon: TrendingUp },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/sources", label: "Source Library", icon: Library },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
