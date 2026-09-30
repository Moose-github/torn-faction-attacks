import React from "react";
import { getChainWatchLive } from "../api/chainWatchSchedule";
import { usePollingResource } from "./usePollingResource";

function useLiveResource() {
  return usePollingResource("chain-watch-live", getChainWatchLive, {
    intervalMs: 15_000, pauseWhenHidden: true, refreshOnFocus: true, refreshOnVisible: true,
  });
}
const LiveContext = React.createContext<ReturnType<typeof useLiveResource> | null>(null);

export function ChainWatchLiveProvider({ children }: { children: React.ReactNode }) {
  const resource = useLiveResource();
  return <LiveContext.Provider value={resource}>{children}</LiveContext.Provider>;
}

export function useChainWatchLive() {
  const resource = React.useContext(LiveContext);
  if (!resource) throw new Error("Chain Watch requires its authenticated provider");
  return resource;
}
