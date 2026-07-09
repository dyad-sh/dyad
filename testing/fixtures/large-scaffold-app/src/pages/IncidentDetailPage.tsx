import { useParams } from "react-router-dom";
import { IncidentComms } from "@/components/incidents/IncidentComms";
import { IncidentSla } from "@/components/incidents/IncidentSla";
import { IncidentTimeline } from "@/components/incidents/IncidentTimeline";
import { PageHeader } from "@/components/layout/PageHeader";
import { calculateIncidentRisk, isSlaBreached } from "@/lib/incidents";
import { useIncident, useIncidents } from "@/hooks/useOpsQueries";

export default function IncidentDetailPage() {
  const { id = "" } = useParams();
  const incident = useIncident(id);
  const incidents = useIncidents();
  const item = incident.data;
  const description = item ? `Risk score ${calculateIncidentRisk(item)}. SLA breached: ${isSlaBreached(item) ? "yes" : "no"}.` : "Detailed incident route for fixture navigation.";
  return (
    <>
      <PageHeader title={item?.title ?? "Incident detail"} description={description} />
      <section className="grid gap-4 lg:grid-cols-3">
        <IncidentTimeline items={item ? [item] : []} />
        <IncidentSla items={incidents.data ?? []} compact />
        <IncidentComms items={item ? [item] : []} />
      </section>
    </>
  );
}
