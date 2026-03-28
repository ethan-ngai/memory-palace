import { createServerFn } from "@tanstack/react-start";
import { getServerHomeState } from "@/features/home/server/home-state.server";

export const getHomeState = createServerFn({ method: "GET" }).handler(async () => {
  return getServerHomeState();
});
