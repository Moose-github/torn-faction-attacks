import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { WarSummary, WarType } from "../api";
import { EmptyState } from "./Common";
import { formatDate } from "../utils/format";
import { displayWarStatus } from "../utils/members";

export function Sidebar({
  warType,
  onWarTypeChange,
  view,
  onViewChange,
  wars,
  selectedWarName,
  isLoadingWars,
  warRoomIcon,
  memberIcon,
  lifestyleIcon,
  miscIcon,
  tradeScoutIcon,
  warPayoutsIcon,
  diceGameIcon,
  adminIcon,
  isAdmin,
  onWarSelect,
}: {
  warType: WarType;
  onWarTypeChange: (value: WarType) => void;
  view: "war" | "warRoom" | "hospitalMonitor" | "members" | "lifestyle" | "miscellaneous" | "tradeScout" | "warPayouts" | "diceGame" | "admin";
  onViewChange: (view: "war" | "warRoom" | "hospitalMonitor" | "members" | "lifestyle" | "miscellaneous" | "tradeScout" | "warPayouts" | "diceGame" | "admin") => void;
  wars: WarSummary[];
  selectedWarName: string | null;
  isLoadingWars: boolean;
  warRoomIcon: React.ReactNode;
  memberIcon: React.ReactNode;
  lifestyleIcon: React.ReactNode;
  miscIcon: React.ReactNode;
  tradeScoutIcon: React.ReactNode;
  warPayoutsIcon: React.ReactNode;
  diceGameIcon: React.ReactNode;
  adminIcon: React.ReactNode;
  isAdmin: boolean;
  onWarSelect: (name: string) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({});
  const membersActive = view === "members" || view === "lifestyle";
  const recordedWarsActive = view === "war";
  const miscellaneousActive = view === "miscellaneous" || view === "diceGame";
  const adminActive = view === "warPayouts" || view === "tradeScout" || view === "admin";

  React.useEffect(() => {
    setCollapsedGroups((current) => {
      const next = { ...current };
      if (membersActive) next.members = false;
      if (recordedWarsActive) next.recordedWars = false;
      if (miscellaneousActive) next.miscellaneous = false;
      if (adminActive) next.admin = false;
      return next;
    });
  }, [adminActive, membersActive, miscellaneousActive, recordedWarsActive]);

  function toggleGroup(group: string) {
    setCollapsedGroups((current) => ({
      ...current,
      [group]: !current[group],
    }));
  }

  return (
    <aside className="sidebar">
      <section className="panel sidebar-panel sidebar-pages-panel">
        <SidebarLink
          active={view === "warRoom"}
          icon={warRoomIcon}
          label="War room"
          onClick={() => onViewChange("warRoom")}
        />
      </section>

      <SidebarGroup
        title="Members"
        active={membersActive}
        collapsed={collapsedGroups.members ?? false}
        onToggle={() => toggleGroup("members")}
      >
        <SidebarLink
          active={view === "members"}
          icon={memberIcon}
          label="Member performance"
          onClick={() => onViewChange("members")}
        />
        <SidebarLink
          active={view === "lifestyle"}
          icon={lifestyleIcon}
          label="Daily stats"
          onClick={() => onViewChange("lifestyle")}
        />
      </SidebarGroup>

      <section
        className={
          recordedWarsActive
            ? "panel sidebar-panel sidebar-wars-panel active"
            : "panel sidebar-panel sidebar-wars-panel"
        }
      >
        <SidebarGroupHeader
          title="Recorded wars"
          active={recordedWarsActive}
          collapsed={collapsedGroups.recordedWars ?? false}
          onToggle={() => toggleGroup("recordedWars")}
          aside={isLoadingWars ? "Loading" : `${wars.length}`}
          control={<WarTypeSelect value={warType} onChange={onWarTypeChange} />}
        />
        {collapsedGroups.recordedWars ? null : (
          <WarNav
            view={view}
            wars={wars}
            selectedWarName={selectedWarName}
            onSelect={onWarSelect}
          />
        )}
      </section>

      <SidebarGroup
        title="Miscellaneous"
        active={miscellaneousActive}
        collapsed={collapsedGroups.miscellaneous ?? false}
        onToggle={() => toggleGroup("miscellaneous")}
      >
        <SidebarLink
          active={view === "miscellaneous"}
          icon={miscIcon}
          label="Miscellaneous"
          onClick={() => onViewChange("miscellaneous")}
        />
        <SidebarLink
          active={view === "diceGame"}
          icon={diceGameIcon}
          label="Dice Game"
          onClick={() => onViewChange("diceGame")}
        />
      </SidebarGroup>

      {isAdmin ? (
        <SidebarGroup
          title="Admin"
          active={adminActive}
          collapsed={collapsedGroups.admin ?? false}
          onToggle={() => toggleGroup("admin")}
        >
          <SidebarLink
            active={view === "warPayouts"}
            icon={warPayoutsIcon}
            label="War payouts"
            onClick={() => onViewChange("warPayouts")}
          />
          <SidebarLink
            active={view === "tradeScout"}
            icon={tradeScoutIcon}
            label="Trade scout"
            onClick={() => onViewChange("tradeScout")}
          />
          <SidebarLink
            active={view === "admin"}
            icon={adminIcon}
            label="Admin controls"
            onClick={() => onViewChange("admin")}
          />
        </SidebarGroup>
      ) : null}
    </aside>
  );
}

function SidebarGroup({
  title,
  active,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  active: boolean;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={active ? "panel sidebar-panel sidebar-group active" : "panel sidebar-panel sidebar-group"}>
      <SidebarGroupHeader
        title={title}
        active={active}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {collapsed ? null : <div className="sidebar-group-links">{children}</div>}
    </section>
  );
}

function SidebarGroupHeader({
  title,
  active,
  collapsed,
  onToggle,
  aside,
  control,
}: {
  title: string;
  active: boolean;
  collapsed: boolean;
  onToggle: () => void;
  aside?: string;
  control?: React.ReactNode;
}) {
  return (
    <div className="sidebar-group-header">
      <button
        type="button"
        className={active ? "sidebar-group-toggle active" : "sidebar-group-toggle"}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span>{title}</span>
        {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
      </button>
      <div className="sidebar-group-header-controls">
        {control}
        {aside ? <span>{aside}</span> : null}
      </div>
    </div>
  );
}

function WarTypeSelect({
  value,
  onChange,
}: {
  value: WarType;
  onChange: (value: WarType) => void;
}) {
  return (
    <select
      className="war-type-select"
      value={value}
      aria-label="Filter recorded wars"
      onChange={(event) => onChange(event.target.value as WarType)}
    >
      <option value="all">All</option>
      <option value="real">Real</option>
      <option value="termed">Termed</option>
      <option value="event">Event</option>
    </select>
  );
}

function SidebarLink({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "sidebar-link active" : "sidebar-link"} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function WarNav({
  view,
  wars,
  selectedWarName,
  onSelect,
}: {
  view: "war" | "warRoom" | "hospitalMonitor" | "members" | "lifestyle" | "miscellaneous" | "tradeScout" | "warPayouts" | "diceGame" | "admin";
  wars: WarSummary[];
  selectedWarName: string | null;
  onSelect: (name: string) => void;
}) {
  if (wars.length === 0) {
    return <EmptyState text="No wars recorded" />;
  }

  return (
    <nav className="war-nav">
      {wars.map((war) => (
        <WarNavButton
          key={war.id}
          war={war}
          selected={view === "war" && war.name === selectedWarName}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function WarNavButton({
  war,
  selected,
  onSelect,
}: {
  war: WarSummary;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      className={selected ? "selected" : ""}
      onClick={() => onSelect(war.name)}
    >
      <span className="war-nav-main">
        <strong>{war.name}</strong>
        <small>
          {displayWarStatus(war)} - {formatDate(war.practical_start_time)}
        </small>
      </span>
      <span className="war-nav-type">{war.war_type ?? "real"}</span>
    </button>
  );
}

