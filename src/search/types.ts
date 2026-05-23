import { SearchResult } from "../types.js";

export interface SearchBackend {
  readonly name: string;
  readonly priority: number;
  isAvailable(): Promise<boolean>;
  search(query: string, numResults: number): Promise<SearchResult[]>;
}
