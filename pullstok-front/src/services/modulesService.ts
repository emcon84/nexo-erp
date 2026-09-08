import axios from "axios";
import { API_URL } from "../constants";

export type Plan = "BASICO" | "PRO" | "PREMIUM";

export interface ModuleRegistryEntry {
  key: string;
  label: string;
  minPlan: Plan;
  enabled: boolean;
}

export interface OrgModules {
  registry: ModuleRegistryEntry[];
  plan: Plan;
  planAllowed: string[];
  enabledModules: string[];
  hasPriceKg: boolean;
}

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export const getModules = async (): Promise<OrgModules> => {
  try {
    const response = await axios.get<OrgModules>(`${API_URL}/modules`, {
      headers: authHeaders(),
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error fetching modules",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const updateModules = async (modules: string[]): Promise<OrgModules> => {
  try {
    const response = await axios.put<OrgModules>(
      `${API_URL}/modules`,
      { modules },
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error updating modules",
      );
    }
    throw new Error("An unknown error occurred");
  }
};
