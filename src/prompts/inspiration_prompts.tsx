import {
  BadgeDollarSign,
  CalendarDays,
  Camera,
  ChefHat,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Home,
  Images,
  MapPinned,
  Music,
  Palette,
  Sparkles,
  Store,
  Users,
  Wand2,
} from "lucide-react";

export const INSPIRATION_PROMPTS = [
  {
    icon: <ChefHat className="size-5" />,
    label: "Pantry recipe planner",
    prompt:
      "Build a pantry recipe planner where I can enter ingredients I already have, get meal ideas, save favorites, and generate a weekly grocery list.",
  },
  {
    icon: <MapPinned className="size-5" />,
    label: "Travel memory map",
    prompt:
      "Build an interactive travel memory map with pinned trips, photo cards, notes, filters by year, and a beautiful timeline of places I have visited.",
  },
  {
    icon: <HeartPulse className="size-5" />,
    label: "Mood check-in journal",
    prompt:
      "Build a mood check-in journal with daily reflections, emotion tags, streaks, gentle insights, and a calming dashboard that shows patterns over time.",
  },
  {
    icon: <Store className="size-5" />,
    label: "Indie shop landing page",
    prompt:
      "Build a polished landing page for an indie online shop with a hero section, featured products, customer quotes, newsletter signup, and a strong call to action.",
  },
  {
    icon: <BadgeDollarSign className="size-5" />,
    label: "Freelance invoice tracker",
    prompt:
      "Build a freelance invoice tracker with client profiles, invoice status, monthly revenue charts, overdue reminders, and a clean dashboard.",
  },
  {
    icon: <Dumbbell className="size-5" />,
    label: "Workout streak coach",
    prompt:
      "Build a workout streak coach with weekly plans, exercise cards, progress photos, habit streaks, and encouraging check-ins after each session.",
  },
  {
    icon: <Users className="size-5" />,
    label: "Tiny team CRM",
    prompt:
      "Build a lightweight CRM for a small team with contact cards, deal stages, follow-up reminders, notes, and a simple sales pipeline board.",
  },
  {
    icon: <Images className="size-5" />,
    label: "Creative portfolio",
    prompt:
      "Build a visual portfolio for a designer with project case studies, image galleries, testimonials, an about section, and a contact form.",
  },
  {
    icon: <GraduationCap className="size-5" />,
    label: "Study sprint planner",
    prompt:
      "Build a study sprint planner with subjects, timed focus sessions, spaced-review reminders, progress charts, and a daily study agenda.",
  },
  {
    icon: <Music className="size-5" />,
    label: "Music discovery log",
    prompt:
      "Build a music discovery log where I can save albums, rate tracks, write listening notes, filter by mood, and see my favorite genres over time.",
  },
  {
    icon: <CalendarDays className="size-5" />,
    label: "Event RSVP hub",
    prompt:
      "Build an event RSVP hub with an invitation page, guest list, RSVP statuses, dietary notes, schedule, and a shareable event link.",
  },
  {
    icon: <Camera className="size-5" />,
    label: "Photo shoot planner",
    prompt:
      "Build a photo shoot planner with mood boards, shot lists, locations, model notes, schedules, and a checklist for gear and props.",
  },
  {
    icon: <Wand2 className="size-5" />,
    label: "AI writing workspace",
    prompt:
      "Build an AI writing workspace with document cards, tone presets, draft history, quick rewrite actions, and a distraction-free editor.",
  },
  {
    icon: <Home className="size-5" />,
    label: "Apartment hunt board",
    prompt:
      "Build an apartment hunt board with saved listings, commute notes, rent comparison, must-have filters, viewing schedule, and decision scores.",
  },
  {
    icon: <Palette className="size-5" />,
    label: "Brand kit generator",
    prompt:
      "Build a brand kit generator where I can enter a business idea and get color palettes, font pairings, logo directions, and sample social posts.",
  },
  {
    icon: <Sparkles className="size-5" />,
    label: "Personal launch page",
    prompt:
      "Build a personal launch page for a new project with a bold hero, waitlist signup, feature teasers, social proof, and a launch countdown.",
  },
];
