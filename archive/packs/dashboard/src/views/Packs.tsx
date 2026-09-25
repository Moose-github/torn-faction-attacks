import React from "react";
import { AlertTriangle, PackageOpen, RefreshCw, Sparkles } from "lucide-react";
import { getAdminPacks } from "../api";
import type { AdminPackDefinition } from "../api";
import {
  SiegePackOpeningModal,
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
  const [packs, setPacks] = React.useState<AdminPackDefinition[]>([]);
  const [selectedPackId, setSelectedPackId] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const selectedPack = React.useMemo(
    () => packs.find((pack) => pack.id === selectedPackId) ?? packs[0] ?? null,
    [packs, selectedPackId],
  );
  const rewards = React.useMemo(
    () => selectedPack?.rewards.map(packRewardToModalReward) ?? [],
    [selectedPack],
  );
  const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);

  React.useEffect(() => {
    void loadPacks();
  }, []);

  async function loadPacks() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getAdminPacks();
      setPacks(response.packs);
      setSelectedPackId((current) =>
        current && response.packs.some((pack) => pack.id === current)
          ? current
          : response.packs[0]?.id ?? null,
      );
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsLoading(false);
    }
  }

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
          disabled={!selectedPack || rewards.length === 0}
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
            title={selectedPack?.name ?? "Pack preview"}
            aside={selectedPack ? `${rewards.length} rewards` : "No pack"}
          />
          <PackSelector
            packs={packs}
            selectedPackId={selectedPack?.id ?? null}
            isLoading={isLoading}
            onSelect={setSelectedPackId}
          />
          <div className="packs-preview-stage">
            <div className="packs-preview-pack">
              <span>BG</span>
              <strong>{selectedPack?.name ?? "Faction Pack"}</strong>
              <small>{selectedPack?.description ?? "Reward pool"}</small>
            </div>
            <button
              type="button"
              className="panel-action-button primary-action"
              disabled={!selectedPack || rewards.length === 0}
              onClick={() => setIsPackOpeningModalOpen(true)}
            >
              <PackageOpen size={15} />
              Open pack
            </button>
          </div>
        </section>

        <section className="panel packs-reward-panel">
          <PanelHeader
            title="Reward pool"
            aside={isLoading ? "Loading" : `Weight ${totalWeight}`}
          />
          {error ? (
            <div className="packs-state-message danger">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button type="button" className="icon-button" onClick={() => void loadPacks()} title="Retry packs">
                <RefreshCw size={15} />
              </button>
            </div>
          ) : isLoading ? (
            <div className="packs-state-message">
              <RefreshCw className="spinning-icon" size={17} />
              <span>Loading packs...</span>
            </div>
          ) : rewards.length === 0 ? (
            <div className="packs-state-message">
              <PackageOpen size={17} />
              <span>No rewards configured.</span>
            </div>
          ) : (
            <div className="packs-reward-grid">
              {rewards.map((reward) => (
                <RewardTile
                  key={reward.id}
                  reward={reward}
                  totalWeight={totalWeight}
                />
              ))}
            </div>
          )}
        </section>
      </section>

      <SiegePackOpeningModal
        open={isPackOpeningModalOpen}
        rewards={rewards}
        onClose={() => setIsPackOpeningModalOpen(false)}
      />
    </>
  );
}

function PackSelector({
  packs,
  selectedPackId,
  isLoading,
  onSelect,
}: {
  packs: AdminPackDefinition[];
  selectedPackId: string | null;
  isLoading: boolean;
  onSelect: (packId: string) => void;
}) {
  if (isLoading || packs.length <= 1) {
    return null;
  }

  return (
    <div className="packs-selector" aria-label="Pack selection">
      {packs.map((pack) => (
        <button
          key={pack.id}
          type="button"
          className={pack.id === selectedPackId ? "active" : ""}
          onClick={() => onSelect(pack.id)}
        >
          <span>{pack.name}</span>
          <small>{pack.rewards.length}</small>
        </button>
      ))}
    </div>
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

function packRewardToModalReward(reward: AdminPackDefinition["rewards"][number]): PackReward {
  return {
    id: reward.id,
    name: reward.name,
    imageUrl: reward.image_url_large || reward.image_url,
    rarity: reward.rarity,
    weight: reward.weight,
  };
}
