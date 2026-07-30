import { TicketHeader } from "@/components/ticket-header";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50"><TicketHeader />{children}</div>;
}
