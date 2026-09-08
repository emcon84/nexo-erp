import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getModules,
  OrgModules,
} from "../../services/modulesService";

export const useOrgModules = () => {
  const { data, isLoading } = useQuery<OrgModules, Error>({
    queryKey: ["modules"],
    queryFn: getModules,
    staleTime: Infinity,
  });

  return { modules: data ?? null, loading: isLoading };
};

export const useUpdateModules = () => {
  const queryClient = useQueryClient();
  return {
    refreshModules: () => {
      queryClient.invalidateQueries({ queryKey: ["modules"] });
    },
  };
};
