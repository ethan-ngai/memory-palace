import { useQuery } from "@tanstack/react-query";
import { getHomeState } from "@/features/home/functions";

export function useHomeState() {
  return useQuery({
    queryFn: () => getHomeState(),
    queryKey: ["home-state"],
  });
}
