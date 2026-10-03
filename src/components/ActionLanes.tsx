import { Activity } from "lucide-react";

export default function ActionLanes({ actions }: { actions: any[] }) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="action-lanes-container">
      <div className="action-lanes-header">
        <Activity size={14} className="spin-slow" />
        <span>Background Tasks</span>
      </div>
      <div className="action-lanes-list">
        {actions.map((action) => (
          <div key={action.id} className={`action-item status-${action.status}`}>
            <span className="action-lane-tag">{action.lane}</span>
            <span className="action-label">
              {action.label || (action.lane === "browser" ? "Trình duyệt tự hành..." : action.lane === "computer" ? "Điều khiển máy tính..." : action.lane === "smarthome" ? "Smart Home..." : "Đang xử lý...")}
            </span>
          </div>
        ))}
      </div>
      <style>{`
        .action-lanes-container {
          position: absolute;
          bottom: 24px;
          right: 24px;
          background: rgba(10, 10, 12, 0.85);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 12px;
          width: 260px;
          z-index: 100;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
          color: white;
          font-family: var(--font-mono, monospace);
        }
        .action-lanes-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--tx-dim);
          margin-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 8px;
        }
        .spin-slow {
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .action-lanes-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 150px;
          overflow-y: auto;
        }
        .action-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
        }
        .action-lane-tag {
          background: rgba(255, 255, 255, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          text-transform: capitalize;
        }
        .action-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status-running {
          color: #4ade80;
        }
        .status-queued {
          color: #facc15;
        }
      `}</style>
    </div>
  );
}
