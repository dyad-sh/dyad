import { useState } from "react";
import {
  Building2,
  Database,
  ExternalLink,
  FileSearch,
  Fingerprint,
  Network,
  UserRound,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import { ipc } from "@/ipc/types";

type Presentation = Extract<
  ChatAgentToolPresentation,
  { kind: "osint-profiles" }
>;
type Record = Presentation["records"][number];
type Evidence = Record["evidence"][number];

function EntityAvatar({ record }: { record: Record }) {
  const [failed, setFailed] = useState(false);
  const initials = record.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  if (record.imageUrl && !failed) {
    return (
      <img
        className="chat-agent-osint-avatar"
        src={record.imageUrl}
        alt={`${record.name} profile`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="chat-agent-osint-avatar chat-agent-osint-avatar--fallback">
      {initials ||
        (record.entityType === "person" ? (
          <UserRound className="size-8" />
        ) : record.entityType === "company" ? (
          <Building2 className="size-8" />
        ) : (
          <Network className="size-8" />
        ))}
    </div>
  );
}

function entityLabel(type: Record["entityType"]): string {
  return type === "person"
    ? "Person"
    : type === "company"
      ? "Company"
      : "Entity";
}

export function ChatAgentOsintProfileCards({
  presentation,
}: {
  presentation: Presentation;
}) {
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(
    null,
  );
  const selectedIsImage = Boolean(
    selectedEvidence &&
    (selectedEvidence.mimeType?.startsWith("image/") ||
      /^image$/i.test(selectedEvidence.itemType ?? "")),
  );

  return (
    <>
      <section
        className="chat-agent-osint-stack"
        data-testid="chat-agent-osint-profiles"
      >
        {presentation.records.map((record) => (
          <article
            className="chat-agent-osint-card"
            key={`${record.entityType}-${record.id}`}
          >
            <div className="chat-agent-osint-hero">
              <div className="chat-agent-osint-aura" aria-hidden="true" />
              <EntityAvatar record={record} />
              <div className="chat-agent-osint-identity">
                <span className="chat-agent-osint-kind">
                  <Fingerprint className="size-3" />
                  {entityLabel(record.entityType)} profile
                </span>
                <h3>{record.name}</h3>
                {record.subtitle && <p>{record.subtitle}</p>}
                <span className="chat-agent-osint-id">Record #{record.id}</span>
              </div>
            </div>

            {record.description && (
              <p className="chat-agent-osint-description">
                {record.description}
              </p>
            )}

            {record.fields.length > 0 && (
              <dl className="chat-agent-osint-fields">
                {record.fields.map((field) => (
                  <div key={field.label}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {record.evidence.length > 0 && (
              <div className="chat-agent-osint-evidence">
                <div className="chat-agent-osint-section-title">
                  <FileSearch className="size-3.5" />
                  Linked evidence
                  <span>{record.evidence.length}</span>
                </div>
                <div className="chat-agent-osint-evidence-list">
                  {record.evidence.map((item) => {
                    const content = (
                      <>
                        <span className="chat-agent-osint-evidence-icon">
                          {item.itemType?.slice(0, 1).toUpperCase() || "E"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong>{item.title}</strong>
                          <small>
                            {[item.itemType, item.relationship]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                        {item.url && (
                          <ExternalLink className="size-3.5 shrink-0" />
                        )}
                      </>
                    );
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="chat-agent-osint-evidence-item"
                        onClick={() => setSelectedEvidence(item)}
                      >
                        {content}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <footer className="chat-agent-osint-footer">
              <span>
                <Database className="size-3" />
                {presentation.sourceName}
              </span>
              <span>{presentation.table}</span>
              {presentation.executionMs !== undefined && (
                <span>{Math.round(presentation.executionMs)} ms</span>
              )}
            </footer>
          </article>
        ))}
      </section>

      <Dialog
        open={selectedEvidence !== null}
        onOpenChange={(open) => !open && setSelectedEvidence(null)}
      >
        <DialogContent className="chat-agent-osint-modal">
          <DialogHeader>
            <DialogTitle>{selectedEvidence?.title}</DialogTitle>
            <DialogDescription>
              {[selectedEvidence?.itemType, selectedEvidence?.relationship]
                .filter(Boolean)
                .join(" · ") || "Linked OSINT evidence"}
            </DialogDescription>
          </DialogHeader>

          {selectedIsImage && selectedEvidence?.url ? (
            <img
              className="chat-agent-osint-preview"
              src={selectedEvidence.url}
              alt={selectedEvidence.title}
            />
          ) : (
            <div className="chat-agent-osint-preview-empty">
              <FileSearch className="size-8" />
              <span>
                There is no locally previewable image for this evidence.
              </span>
              {selectedEvidence?.storageKey && (
                <code>{selectedEvidence.storageKey}</code>
              )}
            </div>
          )}

          {(selectedEvidence?.sourceUrl ||
            selectedEvidence?.url?.startsWith("http")) && (
            <button
              type="button"
              className="chat-agent-osint-open-source"
              onClick={() =>
                void ipc.system.openExternalUrl(
                  selectedEvidence.sourceUrl ?? selectedEvidence.url ?? "",
                )
              }
            >
              <ExternalLink className="size-4" />
              Open original source
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
