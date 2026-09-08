import axios from "axios";
import { API_URL } from "../constants";

export type Industry =
  | "FERRETERIA"
  | "KIOSCO"
  | "INDUMENTARIA"
  | "ALMACEN"
  | "OTHER";

export type Plan = "BASICO" | "PRO" | "PREMIUM";

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  address?: string | null;
  phone?: string | null;
  taxId?: string | null;
  taxCondition?: string | null;
  ingresosBrutos?: string | null;
  inicioActividades?: string | null;
  industry?: Industry;
  onboardingCompletedAt: string | null;
  // Plan/billing (sdd/planes-y-billing): opcionales porque el backend de
  // getMe (api/src/services/authServices.ts, AuthService.me) TODAVÍA no los
  // incluye en el select de organization (solo id/name/onboardingCompletedAt
  // a la fecha de esta fase) — quedan listos en el tipo para cuando viajen,
  // y el gate de suspensión trata su ausencia como "activo" (ver ProtectedLayout).
  plan?: Plan;
  paidUntil?: string | null;
  isActive?: boolean;
  // Módulos habilitados por negocio (sdd/modulos-por-negocio): el backend los
  // incluye en getMe (login y /auth/me). Array vacío = "no configurado".
  enabledModules?: string[];
}

export interface Me {
  id: string;
  email: string;
  role: "SUPERADMIN" | "ADMIN" | "MANAGEMENT" | "VENDEDOR" | "CASHIER" | "EMPLOYEE";
  organizationId: string;
  mustChangePassword: boolean;
  organization: Organization;
  branchIds: string[];
}

export interface Category {
  id: string;
  name: string;
  organizationId: string;
  parentId?: string | null;
  _count?: {
    children: number;
    variantDefs: number;
  };
}

export interface VariantDefinition {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  organizationId: string;
  options: VariantOption[];
}

export interface VariantOption {
  id: string;
  variantId: string;
  value: string;
  sortOrder: number;
  organizationId: string;
}

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export const getMe = async (): Promise<Me> => {
  try {
    const response = await axios.get<Me>(`${API_URL}/auth/me`, {
      headers: authHeaders(),
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || "Error fetching me");
    }
    throw new Error("An unknown error occurred");
  }
};

export const updateOrganization = async (
  data: Partial<
    Pick<
      Organization,
      "name" | "address" | "phone" | "taxId" | "taxCondition" | "ingresosBrutos" | "inicioActividades" | "industry"
    >
  >,
): Promise<Organization> => {
  try {
    const response = await axios.patch<Organization>(
      `${API_URL}/organizations/me`,
      data,
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error updating organization",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const completeOnboarding = async (): Promise<Organization> => {
  try {
    const response = await axios.post<Organization>(
      `${API_URL}/organizations/me/complete-onboarding`,
      {},
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error completing onboarding",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const getSuggestedCategories = async (
  industry: Industry,
): Promise<string[]> => {
  try {
    const response = await axios.get<{ categories: string[] }>(
      `${API_URL}/onboarding/suggested-categories`,
      { headers: authHeaders(), params: { industry } },
    );
    return response.data.categories;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error fetching suggested categories",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const createCategories = async (
  names: string[],
  parentId?: string,
): Promise<Category[]> => {
  try {
    const response = await axios.post<Category[]>(
      `${API_URL}/categories`,
      { names, parentId },
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error creating categories",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const getCategories = async (): Promise<Category[]> => {
  try {
    const response = await axios.get<Category[]>(`${API_URL}/categories`, {
      headers: authHeaders(),
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error fetching categories",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const updateCategory = async (
  id: string,
  name: string,
): Promise<Category> => {
  try {
    const response = await axios.put<Category>(
      `${API_URL}/categories/${id}`,
      { name },
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error updating category",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const deleteCategory = async (id: string): Promise<void> => {
  try {
    await axios.delete(`${API_URL}/categories/${id}`, {
      headers: authHeaders(),
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error deleting category",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

// ---------- Variant Definitions ----------

export const getCategoryVariants = async (
  categoryId: string,
): Promise<VariantDefinition[]> => {
  try {
    const response = await axios.get<VariantDefinition[]>(
      `${API_URL}/categories/${categoryId}/variants`,
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error fetching variants",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const createVariant = async (
  categoryId: string,
  data: { name: string; sortOrder?: number },
): Promise<VariantDefinition> => {
  try {
    const response = await axios.post<VariantDefinition>(
      `${API_URL}/categories/${categoryId}/variants`,
      data,
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error creating variant",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const updateVariant = async (
  id: string,
  data: { name?: string; sortOrder?: number },
): Promise<VariantDefinition> => {
  try {
    const response = await axios.put<VariantDefinition>(
      `${API_URL}/categories/variants/${id}`,
      data,
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error updating variant",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const deleteVariant = async (id: string): Promise<void> => {
  try {
    await axios.delete(`${API_URL}/categories/variants/${id}`, {
      headers: authHeaders(),
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error deleting variant",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

// ---------- Variant Options ----------

export const createVariantOption = async (
  variantId: string,
  data: { value: string; sortOrder?: number },
): Promise<VariantOption> => {
  try {
    const response = await axios.post<VariantOption>(
      `${API_URL}/categories/variants/${variantId}/options`,
      data,
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error creating option",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const updateVariantOption = async (
  id: string,
  data: { value?: string; sortOrder?: number },
): Promise<VariantOption> => {
  try {
    const response = await axios.put<VariantOption>(
      `${API_URL}/categories/options/${id}`,
      data,
      { headers: authHeaders() },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error updating option",
      );
    }
    throw new Error("An unknown error occurred");
  }
};

export const deleteVariantOption = async (id: string): Promise<void> => {
  try {
    await axios.delete(`${API_URL}/categories/options/${id}`, {
      headers: authHeaders(),
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "Error deleting option",
      );
    }
    throw new Error("An unknown error occurred");
  }
};
