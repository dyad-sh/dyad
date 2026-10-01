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
import type { ReactNode } from "react";

export interface InspirationPrompt {
  icon: ReactNode;
  label: string;
  prompt: string;
}

export const INSPIRATION_PROMPTS_FR: InspirationPrompt[] = [
  {
    icon: <ChefHat className="size-5" />,
    label: "Planificateur de recettes",
    prompt:
      "Crée un planificateur de recettes où je peux saisir les ingrédients que j'ai déjà, obtenir des idées de repas, enregistrer mes favoris et générer une liste de courses hebdomadaire.",
  },
  {
    icon: <MapPinned className="size-5" />,
    label: "Carte de souvenirs de voyage",
    prompt:
      "Crée une carte interactive de souvenirs de voyage avec des étapes épinglées, des fiches photos, des notes, des filtres par année et une belle chronologie des lieux visités.",
  },
  {
    icon: <HeartPulse className="size-5" />,
    label: "Journal d'humeur quotidien",
    prompt:
      "Crée un journal de suivi d'humeur avec des réflexions quotidiennes, des étiquettes d'émotions, des séries de jours, des analyses bienveillantes et un tableau de bord apaisant montrant l'évolution dans le temps.",
  },
  {
    icon: <Store className="size-5" />,
    label: "Boutique en ligne",
    prompt:
      "Crée une page d'accueil soignée pour une boutique en ligne indépendante avec une section d'accroche, des produits vedettes, des avis clients, une inscription à la newsletter et un appel à l'action percutant.",
  },
  {
    icon: <BadgeDollarSign className="size-5" />,
    label: "Suivi de factures freelance",
    prompt:
      "Crée un outil de suivi de facturation freelance avec fiches clients, statut des factures, graphiques de revenus mensuels, rappels d'impayés et tableau de bord épuré.",
  },
  {
    icon: <Dumbbell className="size-5" />,
    label: "Coach d'entraînement",
    prompt:
      "Crée un coach d'entraînement sportif avec des plannings hebdomadaires, des fiches d'exercices, des photos de progression, le suivi des habitudes et des encouragements après chaque séance.",
  },
  {
    icon: <Users className="size-5" />,
    label: "Mini CRM d'équipe",
    prompt:
      "Crée un CRM léger pour une petite équipe avec fiches contacts, étapes de transactions, rappels de relance, notes et un tableau visuel de suivi des ventes.",
  },
  {
    icon: <Images className="size-5" />,
    label: "Portfolio créatif",
    prompt:
      "Crée un portfolio visuel pour designer avec des études de cas de projets, des galeries d'images, des témoignages, une section À propos et un formulaire de contact.",
  },
  {
    icon: <GraduationCap className="size-5" />,
    label: "Planificateur de révisions",
    prompt:
      "Crée un planificateur de sessions d'étude avec matières, sessions chronométrées, rappels de révision espacée, graphiques de progression et programme d'étude quotidien.",
  },
  {
    icon: <Music className="size-5" />,
    label: "Journal musical",
    prompt:
      "Crée un carnet de découvertes musicales où je peux enregistrer des albums, noter des morceaux, rédiger des impressions d'écoute, filtrer par ambiance et voir mes genres préférés au fil du temps.",
  },
  {
    icon: <CalendarDays className="size-5" />,
    label: "Gestionnaire de RSVP",
    prompt:
      "Crée une plateforme de gestion d'événements avec page d'invitation, liste des invités, statuts de confirmation RSVP, régimes alimentaires, programme et lien de partage.",
  },
  {
    icon: <Camera className="size-5" />,
    label: "Planificateur de shooting",
    prompt:
      "Crée un planificateur de séances photo avec moodboards, listes de prises de vue, repérage des lieux, notes modèles, plannings et checklist du matériel.",
  },
  {
    icon: <Wand2 className="size-5" />,
    label: "Espace d'écriture IA",
    prompt:
      "Crée un espace de rédaction assisté par IA avec fiches de documents, choix de tonalité, historique des brouillons, options rapides de reformulation et éditeur sans distraction.",
  },
  {
    icon: <Home className="size-5" />,
    label: "Recherche d'appartement",
    prompt:
      "Crée un tableau de recherche d'appartement avec annonces sauvegardées, temps de trajet, comparaison des loyers, filtres indispensables, calendrier des visites et scores de décision.",
  },
  {
    icon: <Palette className="size-5" />,
    label: "Générateur d'identité visuelle",
    prompt:
      "Crée un générateur d'identité de marque où je peux décrire une idée d'entreprise pour obtenir des palettes de couleurs, des associations de polices, des pistes de logos et des exemples de publications.",
  },
  {
    icon: <Sparkles className="size-5" />,
    label: "Page de lancement",
    prompt:
      "Crée une page de lancement pour un nouveau projet avec une accroche percutante, une inscription sur liste d'attente, des aperçus des fonctionnalités, des témoignages et un compte à rebours.",
  },
];

export const INSPIRATION_PROMPTS_EN: InspirationPrompt[] = [
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

export function getInspirationPrompts(language?: string): InspirationPrompt[] {
  if (language && !language.toLowerCase().startsWith("fr")) {
    return INSPIRATION_PROMPTS_EN;
  }
  return INSPIRATION_PROMPTS_FR;
}

export const INSPIRATION_PROMPTS = INSPIRATION_PROMPTS_FR;
