import React from "react";
import {
  PackageOpen,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import energyCacheCardBack from "../assets/packs/energy-cache-card-back.png";
import energyCachePackFront from "../assets/packs/energy-cache-pack-front.png";
import energyCachePackOpenBody from "../assets/packs/energy-cache-pack-open-body.png";
import energyCacheTearStrip from "../assets/packs/energy-cache-tear-strip.png";

export type PackRewardRarity = "standard" | "select" | "elite" | "legendary";

export type PackReward = {
  id: string;
  name: string;
  imageUrl: string;
  rarity: PackRewardRarity;
  weight: number;
};

export const TORN_PACK_REWARDS: PackReward[] = [
  {
    id: "530",
    name: "Can of Munster",
    imageUrl: "https://www.torn.com/images/items/530/large@2x.png",
    rarity: "standard",
    weight: 24,
  },
  {
    id: "532",
    name: "Can of Red Cow",
    imageUrl: "https://www.torn.com/images/items/532/large@2x.png",
    rarity: "standard",
    weight: 22,
  },
  {
    id: "533",
    name: "Can of Taurine Elite",
    imageUrl: "https://www.torn.com/images/items/533/large@2x.png",
    rarity: "select",
    weight: 16,
  },
  {
    id: "553",
    name: "Can of Santa Shooters",
    imageUrl: "https://www.torn.com/images/items/553/large@2x.png",
    rarity: "select",
    weight: 14,
  },
  {
    id: "554",
    name: "Can of Rockstar Rudolph",
    imageUrl: "https://www.torn.com/images/items/554/large@2x.png",
    rarity: "elite",
    weight: 10,
  },
  {
    id: "555",
    name: "Can of X-MASS",
    imageUrl: "https://www.torn.com/images/items/555/large@2x.png",
    rarity: "elite",
    weight: 8,
  },
  {
    id: "985",
    name: "Can of Goose Juice",
    imageUrl: "https://www.torn.com/images/items/985/large@2x.png",
    rarity: "legendary",
    weight: 3,
  },
  {
    id: "986",
    name: "Can of Damp Valley",
    imageUrl: "https://www.torn.com/images/items/986/large@2x.png",
    rarity: "legendary",
    weight: 2,
  },
  {
    id: "987",
    name: "Can of Crocozade",
    imageUrl: "https://www.torn.com/images/items/987/large@2x.png",
    rarity: "legendary",
    weight: 1,
  },
];

type PackPhase = "sealed" | "dragging" | "burst" | "emerging" | "card" | "revealing" | "complete";

type SiegePackOpeningModalProps = {
  open: boolean;
  rewards?: PackReward[];
  onClose: () => void;
  onRewardResolved?: (reward: PackReward) => void;
};

const REVEAL_PARTICLES = Array.from({ length: 22 }, (_, index) => index);
const PACK_PHASE_TIMING = {
  autoTearMs: 720,
  burstMs: 520,
  emergeMs: 860,
  revealMs: 860,
};
const TEAR_COMPLETE_THRESHOLD = 0.94;
const CANVAS_PACK_WIDTH = 1122;
const CANVAS_PACK_HEIGHT = 1402;

const rarityMeta: Record<PackRewardRarity, { label: string; color: string; glow: string }> = {
  standard: {
    label: "Standard",
    color: "#38bdf8",
    glow: "rgba(56, 189, 248, 0.34)",
  },
  select: {
    label: "Select",
    color: "#22c55e",
    glow: "rgba(34, 197, 94, 0.34)",
  },
  elite: {
    label: "Elite",
    color: "#f59e0b",
    glow: "rgba(245, 158, 11, 0.38)",
  },
  legendary: {
    label: "Legendary",
    color: "#fb7185",
    glow: "rgba(251, 113, 133, 0.42)",
  },
};

export function SiegePackOpeningModal({
  open,
  rewards = TORN_PACK_REWARDS,
  onClose,
  onRewardResolved,
}: SiegePackOpeningModalProps) {
  const [phase, setPhase] = React.useState<PackPhase>("sealed");
  const [reward, setReward] = React.useState<PackReward | null>(null);
  const [tearProgress, setTearProgress] = React.useState(0);
  const [isDraggingTear, setIsDraggingTear] = React.useState(false);
  const [animationRun, setAnimationRun] = React.useState(0);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const modalRef = React.useRef<HTMLDivElement | null>(null);
  const timersRef = React.useRef<number[]>([]);
  const tearAnimationRef = React.useRef<number | null>(null);
  const tearProgressRef = React.useRef(0);
  const packImagesRef = React.useRef<CanvasPackImages | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  React.useEffect(() => {
    if (!open) {
      clearTimers();
      setPhase("sealed");
      setReward(null);
      setTearProgressValue(0);
      setIsDraggingTear(false);
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => modalRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  React.useEffect(() => {
    return clearTimers;
  }, []);

  React.useEffect(() => {
    let isCancelled = false;

    void loadCanvasPackImages().then((images) => {
      if (isCancelled) {
        return;
      }

      packImagesRef.current = images;
      drawCanvasPack(canvasRef.current, images, tearProgressRef.current);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  React.useEffect(() => {
    drawCanvasPack(canvasRef.current, packImagesRef.current, tearProgress);
  }, [tearProgress, open]);

  if (!open) {
    return null;
  }

  const activeReward = reward ?? rewards[0] ?? null;
  const meta = activeReward ? rarityMeta[activeReward.rarity] : rarityMeta.standard;
  const style = {
    "--pack-rarity-color": meta.color,
    "--pack-rarity-glow": meta.glow,
    "--pack-tear-progress": String(tearProgress),
    "--pack-tear-percent": `${tearProgress * 100}%`,
    "--pack-tear-inset": `${(1 - tearProgress) * 100}%`,
    "--pack-tear-handle-left": `${17 + tearProgress * 65}%`,
    "--pack-shell-highlight-opacity": String(0.28 + tearProgress * 0.58),
    "--pack-tear-opacity": String(Math.min(1, tearProgress * 1.6)),
    "--pack-glow-opacity": String(Math.min(0.95, tearProgress * 1.15)),
  } as React.CSSProperties;
  const isAnimating = phase === "burst" || phase === "emerging" || phase === "revealing";
  const isOpeningLocked = phase === "dragging" || isAnimating;
  const canRevealCard = phase === "card" && activeReward;

  function clearTimers() {
    for (const timer of timersRef.current) {
      window.clearTimeout(timer);
    }
    timersRef.current = [];
    if (tearAnimationRef.current !== null) {
      window.cancelAnimationFrame(tearAnimationRef.current);
      tearAnimationRef.current = null;
    }
  }

  function schedule(callback: () => void, delayMs: number) {
    const timer = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((candidate) => candidate !== timer);
      callback();
    }, delayMs);
    timersRef.current.push(timer);
  }

  function beginOpening() {
    if (phase !== "sealed" || isOpeningLocked || rewards.length === 0) {
      return;
    }

    clearTimers();
    const nextReward = pickReward(rewards);
    setReward(nextReward);

    if (prefersReducedMotion) {
      setTearProgressValue(1);
      onRewardResolved?.(nextReward);
      setPhase("card");
      return;
    }

    setPhase("dragging");
    setTearProgressValue(0);
    animateTearToEnd(nextReward);
  }

  function animateTearToEnd(nextReward: PackReward) {
    const startedAt = window.performance.now();

    function tick(now: number) {
      const elapsed = now - startedAt;
      const linearProgress = Math.min(1, elapsed / PACK_PHASE_TIMING.autoTearMs);
      const easedProgress = 1 - Math.pow(1 - linearProgress, 1.55);
      setTearProgressValue(easedProgress);

      if (linearProgress < 1) {
        tearAnimationRef.current = window.requestAnimationFrame(tick);
        return;
      }

      tearAnimationRef.current = null;
      finishOpening(nextReward);
    }

    tearAnimationRef.current = window.requestAnimationFrame(tick);
  }

  function finishOpening(resolvedReward?: PackReward) {
    const nextReward = resolvedReward ?? reward ?? pickReward(rewards);
    clearTimers();
    setReward(nextReward);
    setTearProgressValue(1);
    setIsDraggingTear(false);
    setAnimationRun((current) => current + 1);
    onRewardResolved?.(nextReward);

    if (prefersReducedMotion) {
      setPhase("card");
      return;
    }

    setPhase("burst");
    schedule(() => setPhase("emerging"), PACK_PHASE_TIMING.burstMs);
    schedule(() => setPhase("card"), PACK_PHASE_TIMING.burstMs + PACK_PHASE_TIMING.emergeMs);
  }

  function revealCard() {
    if (!canRevealCard) {
      return;
    }

    clearTimers();
    setAnimationRun((current) => current + 1);

    if (prefersReducedMotion) {
      setPhase("complete");
      return;
    }

    setPhase("revealing");
    schedule(() => setPhase("complete"), PACK_PHASE_TIMING.revealMs);
  }

  function resetPack() {
    clearTimers();
    setPhase("sealed");
    setReward(null);
    setTearProgressValue(0);
    setIsDraggingTear(false);
  }

  function handleTearPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (phase !== "sealed" || rewards.length === 0) {
      return;
    }

    clearTimers();
    setReward(pickReward(rewards));
    setPhase("dragging");
    setIsDraggingTear(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateTearProgress(event.clientX);
  }

  function handleTearPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isDraggingTear || phase !== "dragging") {
      return;
    }

    updateTearProgress(event.clientX);
  }

  function handleTearPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isDraggingTear) {
      return;
    }

    setIsDraggingTear(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (tearProgressRef.current >= TEAR_COMPLETE_THRESHOLD) {
      finishOpening();
    } else {
      setPhase("sealed");
      setReward(null);
      setTearProgressValue(0);
    }
  }

  function updateTearProgress(clientX: number) {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const start = rect.left + rect.width * 0.17;
    const distance = rect.width * 0.65;
    const nextProgress = Math.min(1, Math.max(0, (clientX - start) / distance));
    setTearProgressValue(nextProgress);
  }

  function setTearProgressValue(nextProgress: number) {
    tearProgressRef.current = nextProgress;
    setTearProgress(nextProgress);
  }

  return (
    <div className="siege-pack-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <div
        ref={modalRef}
        className={`siege-pack-modal phase-${phase}${isDraggingTear ? " is-dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="siege-pack-title"
        tabIndex={-1}
        style={style}
      >
        <button
          type="button"
          className="siege-pack-close"
          onClick={onClose}
          title="Close pack opener"
          aria-label="Close pack opener"
        >
          <X size={18} />
        </button>

        <section className="siege-pack-stage" aria-live="polite">
          <div className="siege-pack-stage-light" aria-hidden="true" />
          <div className="siege-pack-reward-aura" aria-hidden="true" />

          {activeReward ? (
            <button
              key={`card-${activeReward.id}-${animationRun}`}
              type="button"
              className="siege-pack-card"
              onClick={revealCard}
              disabled={!canRevealCard}
              aria-label={`Reveal ${meta.label} reward`}
              title="Reveal reward"
            >
              <span className="siege-pack-card-inner">
                <span className="siege-pack-card-face back">
                  <img className="siege-pack-card-art" src={energyCacheCardBack} alt="" aria-hidden="true" />
                </span>
                <span className="siege-pack-card-face front">
                  <span className="siege-pack-card-rarity">{meta.label}</span>
                  <span className="siege-pack-card-item-frame">
                    <img src={activeReward.imageUrl} alt={activeReward.name} />
                  </span>
                  <strong>{activeReward.name}</strong>
                  <small>Reward acquired</small>
                </span>
              </span>
            </button>
          ) : null}

          <div ref={shellRef} className="siege-pack-shell" aria-hidden={phase !== "sealed" ? "true" : undefined}>
            <canvas
              ref={canvasRef}
              className="siege-pack-canvas"
              width={CANVAS_PACK_WIDTH}
              height={CANVAS_PACK_HEIGHT}
              aria-hidden="true"
            />
            <div className="siege-pack-open-glow" aria-hidden="true" />
            <div className="siege-pack-tear-teeth" aria-hidden="true" />
            <img className="siege-pack-tear-strip-art" src={energyCacheTearStrip} alt="" aria-hidden="true" />
            <div className="siege-pack-tear-track">
              <span />
            </div>
            <button
              type="button"
              className="siege-pack-tear-handle"
              onPointerDown={handleTearPointerDown}
              onPointerMove={handleTearPointerMove}
              onPointerUp={handleTearPointerUp}
              onPointerCancel={handleTearPointerUp}
              disabled={phase !== "sealed" && phase !== "dragging"}
              aria-label="Drag right to tear open the pack"
              title="Drag right to tear open"
            >
              <Zap size={16} />
            </button>
          </div>

          <div className="siege-pack-shards" aria-hidden="true">
            {REVEAL_PARTICLES.map((particle) => (
              <span
                key={particle}
                style={{
                  "--particle-start-angle": `${particle * 23}deg`,
                  "--particle-end-angle": `${particle * 37}deg`,
                  "--particle-travel": `-${90 + particle * 5}px`,
                  "--particle-delay": `${(particle % 7) * 22}ms`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        </section>

        <section className="siege-pack-controls">
          <div>
            <p className="eyebrow">Pack opening</p>
            <h2 id="siege-pack-title">{phase === "complete" && activeReward ? activeReward.name : "Tear the pack"}</h2>
            <p>
              {phase === "sealed"
                ? "Drag the zipper right or use the open button."
                : phase === "dragging"
                  ? "Keep dragging across the seal."
                : phase === "emerging"
                  ? "Reward card emerging."
                : phase === "card"
                  ? "Rarity decrypted. Press the card to reveal your reward."
                : phase === "revealing"
                  ? "Reward card decrypting."
                : phase === "complete" && activeReward
                  ? `${meta.label} reward secured.`
                  : "Pack seal opening."}
            </p>
          </div>
          <div className="siege-pack-actions">
            {phase === "complete" ? (
              <button type="button" className="panel-action-button secondary" onClick={resetPack}>
                <RotateCcw size={15} />
                Reset
              </button>
            ) : null}
            <button
              type="button"
              className="panel-action-button primary-action"
              onClick={phase === "complete" ? resetPack : phase === "card" ? revealCard : beginOpening}
              disabled={isOpeningLocked || rewards.length === 0}
            >
              <PackageOpen size={15} />
              {phase === "complete"
                ? "Open another"
                : phase === "card"
                  ? "Reveal reward"
                  : isOpeningLocked
                    ? "Opening"
                    : "Open pack"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export function pickReward(rewards: PackReward[]): PackReward {
  const totalWeight = rewards.reduce((sum, reward) => sum + Math.max(0, reward.weight), 0);
  if (totalWeight <= 0) {
    return rewards[Math.floor(Math.random() * rewards.length)];
  }

  let roll = Math.random() * totalWeight;
  for (const reward of rewards) {
    roll -= Math.max(0, reward.weight);
    if (roll <= 0) {
      return reward;
    }
  }

  return rewards[rewards.length - 1];
}

type CanvasPackImages = {
  front: HTMLImageElement;
  openBody: HTMLImageElement;
};

async function loadCanvasPackImages(): Promise<CanvasPackImages> {
  const [front, openBody] = await Promise.all([
    loadCanvasImage(energyCachePackFront),
    loadCanvasImage(energyCachePackOpenBody),
  ]);

  return { front, openBody };
}

function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load pack image: ${src}`));
    image.src = src;
  });
}

function drawCanvasPack(
  canvas: HTMLCanvasElement | null,
  images: CanvasPackImages | null,
  rawProgress: number,
) {
  if (!canvas || !images) {
    return;
  }

  const width = images.front.naturalWidth || CANVAS_PACK_WIDTH;
  const height = images.front.naturalHeight || CANVAS_PACK_HEIGHT;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const progress = clamp(rawProgress, 0, 1);
  context.clearRect(0, 0, width, height);

  if (progress <= 0.001) {
    context.drawImage(images.front, 0, 0, width, height);
    return;
  }

  const seamY = height * 0.158;
  const seamHeight = height * 0.029;
  const topHeight = height * 0.184;
  const tearStart = width * 0.15;
  const tearEnd = width * 0.84;
  const tearX = tearStart + (tearEnd - tearStart) * progress;

  context.save();
  context.globalAlpha = Math.min(1, progress * 1.3);
  context.drawImage(images.openBody, 0, 0, width, height);
  context.restore();

  context.save();
  context.beginPath();
  context.rect(0, seamY + seamHeight * 0.32, width, height);
  context.clip();
  context.globalAlpha = 1 - progress * 0.1;
  context.drawImage(images.front, 0, 0, width, height);
  context.restore();

  context.save();
  context.beginPath();
  context.rect(tearX, 0, width - tearX, topHeight + seamHeight);
  context.clip();
  context.globalAlpha = 1 - progress * 0.04;
  context.drawImage(images.front, 0, 0, width, height);
  context.restore();

  drawPulledTopStrip(context, images.front, {
    progress,
    seamY,
    seamHeight,
    tearX,
    topHeight,
    width,
  });
  drawCanvasTornEdge(context, {
    progress,
    seamY,
    seamHeight,
    tearX,
    width,
    height,
  });
}

function drawPulledTopStrip(
  context: CanvasRenderingContext2D,
  source: HTMLImageElement,
  geometry: {
    progress: number;
    seamY: number;
    seamHeight: number;
    tearX: number;
    topHeight: number;
    width: number;
  },
) {
  const { progress, tearX, topHeight, width } = geometry;
  const visibleWidth = Math.max(1, tearX);
  const columns = 132;
  const sourceColumnWidth = visibleWidth / columns;
  const lift = progress;

  context.save();
  context.globalAlpha = Math.min(1, progress * 10);
  context.shadowColor = "rgba(57, 255, 20, 0.18)";
  context.shadowBlur = 18 * progress;

  for (let column = 0; column < columns; column += 1) {
    const sourceX = column * sourceColumnWidth;
    const sourceWidth = Math.ceil(sourceColumnWidth) + 1;
    const t = columns <= 1 ? 0 : column / (columns - 1);
    const leadingLift = Math.pow(1 - t, 0.58);
    const trailingLift = Math.pow(t, 1.7);
    const arc = Math.sin(t * Math.PI);
    const flutter = Math.sin(column * 0.64 + progress * 4.8) * 2.5 * progress;
    const curlTowardViewer = Math.sin(t * Math.PI * 1.18) * progress;
    const destX = sourceX + lift * (width * 0.034 * leadingLift + width * 0.014 * trailingLift) + arc * lift * 10;
    const destY = -lift * (108 * leadingLift + 48 * arc + 18 * trailingLift) + flutter;
    const scaleY = 1 - lift * (0.035 * leadingLift + 0.02 * arc);
    const scaleX = 1 + curlTowardViewer * 0.018;
    const rotation = -lift * (0.08 * leadingLift - 0.04 * trailingLift + 0.035 * arc);
    const skewX = lift * (0.055 * arc - 0.035 * leadingLift);
    const destHeight = topHeight * scaleY;

    context.save();
    context.translate(destX, destY);
    context.transform(scaleX, Math.sin(rotation) * 0.16, skewX, 1, 0, 0);
    context.rotate(rotation);
    context.drawImage(source, sourceX, 0, sourceWidth, topHeight, 0, 0, sourceWidth + 1.5, destHeight);
    context.restore();
  }

  context.restore();
}

function drawCanvasTornEdge(
  context: CanvasRenderingContext2D,
  geometry: {
    progress: number;
    seamY: number;
    seamHeight: number;
    tearX: number;
    width: number;
    height: number;
  },
) {
  const { progress, seamY, seamHeight, tearX, width, height } = geometry;
  const teeth = 46;

  context.save();
  context.beginPath();
  context.moveTo(0, seamY + seamHeight * 0.34);
  for (let index = 0; index <= teeth; index += 1) {
    const x = (tearX / teeth) * index;
    const jag = Math.sin(index * 1.71) * 3.2 + Math.sin(index * 0.63 + 1.2) * 2.4;
    const y = seamY + seamHeight * (index % 2 === 0 ? 0.12 : 0.82) + jag;
    context.lineTo(x, y);
  }
  context.lineTo(tearX, seamY + seamHeight * 1.12);
  context.lineTo(0, seamY + seamHeight * 1.04);
  context.closePath();

  const seamGradient = context.createLinearGradient(0, seamY, tearX, seamY);
  seamGradient.addColorStop(0, "rgba(190, 255, 184, 0.1)");
  seamGradient.addColorStop(0.6, "rgba(255, 255, 255, 0.72)");
  seamGradient.addColorStop(1, "rgba(57, 255, 20, 0.68)");
  context.fillStyle = seamGradient;
  context.globalAlpha = Math.min(1, progress * 1.5);
  context.shadowColor = "rgba(57, 255, 20, 0.7)";
  context.shadowBlur = 18 * progress;
  context.fill();
  context.restore();

  context.save();
  const flare = context.createRadialGradient(tearX, seamY + 10, 2, tearX, seamY + 10, width * 0.13);
  flare.addColorStop(0, "rgba(255, 255, 255, 0.96)");
  flare.addColorStop(0.18, "rgba(57, 255, 20, 0.78)");
  flare.addColorStop(1, "rgba(57, 255, 20, 0)");
  context.globalCompositeOperation = "screen";
  context.globalAlpha = Math.min(0.78, progress * 1.1);
  context.fillStyle = flare;
  context.fillRect(tearX - width * 0.14, seamY - height * 0.05, width * 0.28, height * 0.12);
  context.restore();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(media.matches);

    function handleChange(event: MediaQueryListEvent) {
      setPrefersReducedMotion(event.matches);
    }

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}
