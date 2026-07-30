import { neon } from "@neondatabase/serverless";

// Server-side only. Never import this in client components.
export const sql = neon(process.env.DATABASE_URL!);

export type Ticket = {
  id: string;
  subject: string;
  body: string;
  priority: "low" | "medium" | "high";
  status: "open" | "closed";
  creator_id: string;
  created_at: string;
};
