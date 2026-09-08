import { useState, useEffect, useRef, useCallback } from "react";
import { useInfiniteProducts, useProductFacets } from "./useProducts";
import { readStoredFilter } from "./vendorCatalogHelpers";
import { scrollRowInContainer } from "./vendorRowHelpers";

/**
 * Dominio del catálogo del vendor: búsqueda con debounce, listado paginado +
 * facets, selección por teclado y scroll infinito. No conoce nada de ventas,
 * pedidos ni del carrito.
 */
export function useVendorCatalog(branchId: string) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  // Contenedor scrolleable de la lista: es el que se desplaza al navegar.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  // Restaura el filtro guardado al volver del scanner (lee y limpia UNA vez).
  const [storedFilter] = useState(() => readStoredFilter(branchId));
  const [filter, setFilter] = useState(storedFilter?.filter ?? "");
  const [categoryFilter, setCategoryFilter] = useState(
    storedFilter?.categoryFilter ?? "",
  );
  // Título de planilla SECO (sdd/alican-plan-titles): se envía server-side como
  // ?title=<key> (la API lo soporta desde GET /products).
  const [titleFilter, setTitleFilter] = useState<string | null>(null);
  // "Solo lo que trabajo": default OFF → envía el catálogo completo. Al
  // encenderlo envía server-side ?carriedOnly=1 (solo los marcados).
  const [onlyCarried, setOnlyCarried] = useState(false);
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search: wait 250ms after last keystroke before querying backend
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedFilter(filter.trim());
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [filter]);

  const { items, isLoadingInitial, isFetchingNextPage, hasNextPage, loadMore } =
    useInfiniteProducts(
      branchId,
      debouncedFilter?.trim() || undefined,
      categoryFilter.trim() || undefined,
      titleFilter?.trim() || undefined,
      undefined,
      onlyCarried,
    );

  // Complete facets for the filter chips: all org categories plus variant
  // groups for the selected category. Independent of the paginated list.
  const { categories: facetsCategories, variants: facetsVariants, titles: facetsTitles } =
    useProductFacets(categoryFilter.trim() || undefined);

  // Infinite scroll: load the next page when the sentinel enters the viewport.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, loadMore]);

  // Auto-scroll de la fila activa al navegar con flechas o L: desplaza el
  // contenedor de la lista por offsetTop (a prueba de anidamiento).
  useEffect(() => {
    const container = scrollRef.current;
    const row = itemRefs.current[selectedIndex];
    if (container && row) scrollRowInContainer(container, row);
  }, [selectedIndex]);

  const resetSelection = useCallback(() => {
    setSelectedIndex(-1);
    itemRefs.current = [];
  }, []);

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      setSelectedIndex((prev) => {
        if (delta === 1) {
          return prev < 0 ? 0 : Math.min(items.length - 1, prev + 1);
        }
        return prev <= 0 ? 0 : prev - 1;
      });
    },
    [items.length],
  );

  const selectFirst = useCallback(() => {
    if (items.length > 0) setSelectedIndex(0);
  }, [items.length]);

  const registerRow = useCallback(
    (index: number, el: HTMLTableRowElement | null) => {
      itemRefs.current[index] = el;
    },
    [],
  );

  const clearSearch = () => {
    setFilter("");
    setCategoryFilter("");
    setTitleFilter(null);
    setSelectedIndex(-1);
  };

  return {
    searchInputRef,
    itemRefs,
    scrollRef,
    selectedIndex,
    setSelectedIndex,
    filter,
    setFilter,
    categoryFilter,
    setCategoryFilter,
    titleFilter,
    setTitleFilter,
    onlyCarried,
    setOnlyCarried,
    items,
    isLoadingInitial,
    isFetchingNextPage,
    hasNextPage,
    loadMore,
    facetsCategories,
    facetsVariants,
    facetsTitles,
    sentinelRef,
    resetSelection,
    moveSelection,
    selectFirst,
    registerRow,
    clearSearch,
  };
}
