import { useState } from "react";
import { BusinessCard } from "./BusinessCard";
import { STAGE_LABELS } from "../../lib/stages";

export function StageColumn({ stage, businesses, onOpen, onDropBusiness }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`stage-column${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropBusiness(id, stage);
      }}
    >
      <div className="stage-column-header">
        <span>{STAGE_LABELS[stage]}</span>
        <span className="stage-count">{businesses.length}</span>
      </div>
      <div className="stage-column-body">
        {businesses.map((b) => (
          <BusinessCard key={b.id} business={b} onOpen={onOpen} onMoveStage={onDropBusiness} />
        ))}
      </div>
    </div>
  );
}
