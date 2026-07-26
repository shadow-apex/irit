import { type RefObject } from "react";
import { MessageSquare, VolumeX } from "lucide-react";
import type { TranscriptLine } from "../types";
import ContextSupplementInput from "./ContextSupplementInput";

export default function CommsPanel({
  transcript,
  scrollRef,
  awake,
  silentOutput,
  onSendSupplement,
}: {
  transcript: TranscriptLine[];
  scrollRef: RefObject<HTMLDivElement | null>;
  awake: boolean;
  silentOutput?: boolean;
  onSendSupplement: (text: string) => void;
}) {
  return (
    <section className="deck-panel comms">
      <div className="col-head">
        <MessageSquare size={14} />
        <span>Iris Conversation</span>
        {silentOutput && (
          <span title="Silent Mode (No voice)" className="silent-badge" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px", color: "var(--tx-dim)" }}>
            <VolumeX size={14} /> Im lặng
          </span>
        )}
      </div>
      <div className="comms-scroll" ref={scrollRef}>
        {transcript.length === 0 ? (
          <p className="empty">No conversation yet. Wake Iris and start talking.</p>
        ) : (
          transcript.map((line) => {
            const self = /you|user/i.test(line.speaker);
            return (
              <div className={`bubble ${self ? "self" : "iris"}`} key={line.id}>
                <span className="who">{self ? "You" : "Iris"}</span>
                {line.text}
              </div>
            );
          })
        )}
      </div>
      <ContextSupplementInput disabled={!awake} onSubmit={onSendSupplement} />
    </section>
  );
}
