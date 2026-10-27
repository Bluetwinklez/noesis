export interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  created_at: number;
  updated_at: number;
}

export type PageKind = 'page' | 'database';

export interface PageMeta {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  cover: string | null;
  is_favorite: number;
  is_pinned: number;
  is_template: number;
  archived_at: number | null;
  deleted_at: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface Page extends PageMeta {
  content_json: string | null;
  content_text: string;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
}

export interface Attachment {
  id: string;
  workspace_id: string;
  file_name: string;
  mime: string;
  size: number;
  storage_key: string;
  sha256: string | null;
  created_at: number;
}

export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'relation'
  | 'status'
  | 'formula'
  | 'rollup';

export type RollupFn = 'count' | 'count_values' | 'sum' | 'average' | 'min' | 'max' | 'show' | 'percent_checked';

export interface SelectOption {
  id: string;
  name: string;
  color: string;
}

export interface PropertyOptions {
  options?: SelectOption[];
  /** relation target database id */
  relationDatabaseId?: string;
  /** relation: the paired property in the target database, kept in sync (two-way relation) */
  relationPropertyId?: string;
  /** rollup: aggregates a property of the rows linked through a relation property of this database */
  rollup?: { relationPropertyId: string; targetPropertyId: string | null; fn: RollupFn };
  /** formula expression, e.g. prop("Price") * prop("Qty") */
  expression?: string;
  numberFormat?: 'plain' | 'percent' | 'currency';
}

export interface DbProperty {
  id: string;
  database_id: string;
  name: string;
  type: PropertyType;
  options: PropertyOptions;
  sort_order: number;
}

export type CellValue = string | number | boolean | string[] | null;

export interface DbRow {
  id: string;
  database_id: string;
  values: Record<string, CellValue>;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export type ViewType = 'table' | 'board' | 'calendar' | 'timeline' | 'list' | 'gallery';

export type FilterOp =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'lt'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_checked'
  | 'is_not_checked';

export interface ViewFilter {
  propertyId: string;
  op: FilterOp;
  value?: string;
}

export interface ViewSort {
  propertyId: string;
  direction: 'asc' | 'desc';
}

export interface ViewConfig {
  filters?: ViewFilter[];
  sorts?: ViewSort[];
  groupBy?: string;
  dateProperty?: string;
  /** Timeline view: optional end date property (bars span start → end). */
  endDateProperty?: string;
  hiddenProperties?: string[];
  calendarMonth?: string;
}

export interface DbView {
  id: string;
  database_id: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  sort_order: number;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Task {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  project_page_id: string | null;
  source_page_id: string | null;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: number;
  due_at: number | null;
  remind_at: number | null;
  notified_at: number | null;
  recurrence: Recurrence | null;
  /** Occurrence spawned when this recurring task was completed (guards against duplicates). */
  next_task_id?: string | null;
  completed_at: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface Notebook {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  icon: string | null;
  created_at: number;
  updated_at: number;
}

export type SourceKind =
  | 'pdf'
  | 'docx'
  | 'txt'
  | 'markdown'
  | 'html'
  | 'url'
  | 'csv'
  | 'image'
  | 'audio'
  | 'youtube'
  | 'note';

export type SourceStatus = 'pending' | 'processing' | 'ready' | 'error';
export type PipelineStage =
  | 'import'
  | 'validation'
  | 'extraction'
  | 'normalization'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'done';

export interface Source {
  id: string;
  workspace_id: string;
  title: string;
  kind: SourceKind;
  origin: string;
  mime: string;
  size: number;
  attachment_id: string | null;
  status: SourceStatus;
  stage: PipelineStage;
  error: string | null;
  text_content: string;
  page_count: number | null;
  metadata_json: string;
  embedding_model: string | null;
  created_at: number;
  updated_at: number;
}

export interface SourceChunk {
  id: number;
  source_id: string;
  ordinal: number;
  text: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  embedding: string | null;
}

export interface Citation {
  /** 1-based marker used in the answer text, e.g. [1] */
  n: number;
  sourceId: string;
  sourceTitle: string;
  chunkId: number;
  pageNumber: number | null;
  charStart: number;
  charEnd: number;
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  notebook_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: Citation[];
  status: 'complete' | 'error' | 'cancelled';
  created_at: number;
}

export type NotebookNoteKind =
  | 'note'
  | 'summary'
  | 'study_guide'
  | 'flashcards'
  | 'quiz'
  | 'faq'
  | 'timeline'
  | 'comparison'
  | 'briefing';

export interface NotebookNote {
  id: string;
  notebook_id: string;
  kind: NotebookNoteKind;
  title: string;
  content_md: string;
  data: Record<string, unknown>;
  citations: Citation[];
  created_at: number;
  updated_at: number;
}

export interface AudioLine {
  speaker: string;
  text: string;
}

export interface AudioOverview {
  id: string;
  notebook_id: string;
  title: string;
  language: string;
  length: 'short' | 'medium' | 'long';
  format: 'narration' | 'dialogue';
  script: AudioLine[];
  attachment_id: string | null;
  provider: string;
  source_ids: string[];
  created_at: number;
}

export interface SemanticLink {
  id: string;
  from_kind: string;
  from_id: string;
  to_kind: string;
  to_id: string;
  score: number;
  status: 'suggested' | 'approved' | 'rejected';
  created_at: number;
}

export type SearchKind = 'page' | 'row' | 'task' | 'notebook' | 'note' | 'source' | 'chunk';
