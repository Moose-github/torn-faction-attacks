import React from "react";

export type PackTearGlowProps = {
  color: string;
  glow: string;
  progress: number;
};

export function packTearGlowStyle({
  color,
  glow,
  progress,
}: PackTearGlowProps): React.CSSProperties {
  return {
    "--pack-rarity-color": color,
    "--pack-rarity-glow": glow,
    "--pack-tear-glow-x": `${progress * 100}%`,
    "--pack-tear-glow-progress": `${progress * 100}%`,
    "--pack-tear-glow-opacity": String(Math.min(0.82, Math.max(0, (progress - 0.02) * 1.45))),
    "--pack-tear-hotspot-opacity": String(Math.min(0.9, 0.54 + progress * 0.26)),
    "--pack-shell-highlight-opacity": String(0.28 + progress * 0.58),
  } as React.CSSProperties;
}

export function PackTearGlow() {
  return (
    <div className="siege-pack-rarity-seam-glow" aria-hidden="true">
      <span className="siege-pack-rarity-seam-trail" />
    </div>
  );
}
