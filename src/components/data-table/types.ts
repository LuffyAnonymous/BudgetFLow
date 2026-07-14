/**
 * Shared types for the DataTable primitive system.
 *
 * Each module defines its own column definitions, filters, row actions,
 * and mobile record layouts. The DataTable primitives only provide
 * the shared infrastructure: pagination, loading state, empty state,
 * error state, column visibility, and accessible semantics.
 */

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: string;
  direction: SortDirection;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ColumnDef<TRow> {
  /** Unique key for this column */
  key: string;
  /** Column header label — also used for aria-label */
  header: string;
  /** Whether users can sort by this column */
  sortable?: boolean;
  /** Whether users can toggle this column's visibility */
  hideable?: boolean;
  /** Default visibility (defaults to true) */
  defaultVisible?: boolean;
  /** Alignment for both header and cell */
  align?: "left" | "right" | "center";
  /** Render function for the cell */
  cell: (row: TRow) => React.ReactNode;
}

export interface DataTableProps<TRow> {
  /** Column definitions provided by the feature module */
  columns: ColumnDef<TRow>[];
  /** Current page of rows to display */
  rows: TRow[];
  /** Unique row identifier accessor */
  rowKey: (row: TRow) => string;
  /** Whether data is currently loading (shows skeleton) */
  isLoading?: boolean;
  /** Error message to show instead of the table */
  error?: string | null;
  /** Content shown when rows is empty and not loading */
  emptyState?: React.ReactNode;
  /** Current sort state */
  sort?: SortState;
  /** Called when user clicks a sortable column header */
  onSortChange?: (sort: SortState) => void;
  /** Column visibility map (key → visible) */
  columnVisibility?: Record<string, boolean>;
  /** Called when column visibility changes */
  onColumnVisibilityChange?: (columnKey: string, visible: boolean) => void;
  /** Optional CSS class for the wrapper */
  className?: string;
}
