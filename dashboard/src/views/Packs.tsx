import React from "react";
import { PackageOpen, Sparkles } from "lucide-react";
import {
  SiegePackOpeningModal,
  TORN_PACK_REWARDS,
  type PackReward,
} from "../components/SiegePackOpeningModal";
import { PanelHeader } from "../components/Common";

const rarityLabels: Record<PackReward["rarity"], string> = {
  standard: "Standard",
  select: "Select",
  elite: "Elite",
  legendary: "Legendary",
};

export function Packs() {
  const [isPackOpeningModalOpen, setIsPackOpeningModalOpen] = React.useState(false);
  const totalWeight = TORN_PACK_REWARDS.reduce((sum, reward) => sum + reward.weight, 0);

  return (
    <>
      <section className="hero-panel compact-hero-panel packs-hero">
        <div>
          <p className="eyebrow">Packs</p>
          <h2>Faction packs</h2>
          <p>Preview reward pools, rarity weighting, and the full-screen pack reveal.</p>
        </div>
        <button
          type="button"
          className="panel-action-button primary-action"
          onClick={() => setIsPackOpeningModalOpen(true)}
        >
          <PackageOpen size={15} />
          Open pack
        </button>
      </section>

      <section className="packs-layout">
        <section className="panel packs-preview-panel">
          <PanelHeader
            icon={<Sparkles size={17} />}
            title="Energy pack"
            aside={`${TORN_PACK_REWARDS.length} rewards`}
          />
          <div className="packs-preview-stage">
            <div className="packs-preview-pack">
              <span>BG</span>
              <strong>Faction Pack</strong>
              <small>Energy reward pool</small>
            </div>
            <button
              type="button"
              className="panel-action-button primary-action"
              onClick={() => setIsPackOpeningModalOpen(true)}
            >
              <PackageOpen size={15} />
              Open pack
            </button>
          </div>
        </section>

        <section className="panel packs-reward-panel">
          <PanelHeader title="Reward pool" aside={`Weight ${totalWeight}`} />
          <div className="packs-reward-grid">
            {TORN_PACK_REWARDS.map((reward) => (
              <RewardTile
                key={reward.id}
                reward={reward}
                totalWeight={totalWeight}
              />
            ))}
          </div>
        </section>
      </section>

      <SiegePackOpeningModal
        open={isPackOpeningModalOpen}
        onClose={() => setIsPackOpeningModalOpen(false)}
      />
    </>
  );
}

function RewardTile({
  reward,
  totalWeight,
}: {
  reward: PackReward;
  totalWeight: number;
}) {
  const dropPercent = totalWeight > 0 ? (reward.weight / totalWeight) * 100 : 0;

  return (
    <article className={`packs-reward-tile rarity-${reward.rarity}`}>
      <img src={reward.imageUrl} alt={reward.name} loading="lazy" decoding="async" />
      <div>
        <strong>{reward.name}</strong>
        <span>{rarityLabels[reward.rarity]}</span>
        <small>{dropPercent.toFixed(dropPercent < 10 ? 1 : 0)}% weight</small>
      </div>
    </article>
  );
}
