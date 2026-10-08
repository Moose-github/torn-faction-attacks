import React from "react";
import { offsetPreviewTargets } from "../../../shared/warProgress";

type Props = {
  homeScore: number;
  enemyScore: number;
  plannedHome: number;
  plannedEnemy: number;
  onChange: (home: number, enemy: number) => void;
};

export function WarTargetOffsetControl({ homeScore, enemyScore, plannedHome, plannedEnemy, onChange }: Props) {
  const slider = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ pointerId: number; x: number; home: number; enemy: number; step: number; moved: boolean } | null>(null);
  const [handleOffset, setHandleOffset] = React.useState(0);
  const descriptionId = React.useId();
  const shared = Math.max(0, Math.min(plannedHome - homeScore, plannedEnemy - enemyScore));
  const available = Number.MAX_SAFE_INTEGER - Math.max(plannedHome, plannedEnemy);
  function adjust(offset: number, home = plannedHome, enemy = plannedEnemy) {
    const targets = offsetPreviewTargets(homeScore, enemyScore, home, enemy, offset);
    onChange(targets.home, targets.enemy);
    return targets.home - home;
  }
  function stopDrag() {
    const active = drag.current;
    drag.current = null;
    setHandleOffset(0);
    if (active && slider.current?.hasPointerCapture(active.pointerId)) slider.current.releasePointerCapture(active.pointerId);
  }
  // A new score observation changes the minimum targets. Start a fresh gesture
  // rather than continuing from a snapshot of the previous scores.
  React.useEffect(() => { stopDrag(); }, [homeScore, enemyScore]);
  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const pixels = event.clientX - active.x;
    if (!active.moved && Math.abs(pixels) < 3) return;
    active.moved = true;
    const change = adjust(Math.round(pixels) * active.step, active.home, active.enemy);
    const travel = Math.max(0, event.currentTarget.clientWidth / 2 - 24);
    setHandleOffset(Math.max(-travel, Math.min(travel, change / active.step)));
  }
  return <div className="war-target-offset">
    <span className="war-target-offset-label">Adjust both targets</span>
    <div className="war-target-offset-controls">
      <button type="button" aria-label="Decrease both targets by 100 respect" disabled={shared === 0} onClick={() => adjust(-100)}>−</button>
      <div ref={slider} className="war-target-offset-slider" role="slider" tabIndex={0}
        aria-label="Adjust both targets" aria-orientation="horizontal"
        aria-valuemin={0} aria-valuemax={shared + available} aria-valuenow={shared}
        aria-valuetext={`${shared.toLocaleString("en-GB", { maximumFractionDigits: 2 })} extra respect for each faction`}
        aria-describedby={descriptionId}
        aria-description="Left and right arrows adjust both targets by 100; hold Shift for 1,000. Home removes the shared increase. Release and drag again to keep adjusting."
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = { pointerId: event.pointerId, x: event.clientX, home: plannedHome, enemy: plannedEnemy, step: event.shiftKey ? 100 : 10, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={moveDrag}
        onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) { moveDrag(event); stopDrag(); } }}
        onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
        onKeyDown={(event) => {
          if (event.key === "Escape") { stopDrag(); return; }
          if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
          event.preventDefault();
          stopDrag();
          adjust(event.key === "Home" ? -shared : (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1000 : 100));
        }}>
        <span className="war-target-offset-track" aria-hidden="true" />
        <span className="war-target-offset-handle" style={{ transform: `translateX(${handleOffset}px)` }} aria-hidden="true">↔</span>
      </div>
      <button type="button" aria-label="Increase both targets by 100 respect" disabled={available === 0} onClick={() => adjust(100)}>+</button>
    </div>
    <small id={descriptionId}>Drag left/right · Keeps winner and finish unchanged</small>
  </div>;
}
