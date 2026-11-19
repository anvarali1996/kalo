export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  sessionStartedAt: string | null;
  scanCredits: number | null;
}

export interface AdminUsersResponse {
  users: AdminUserRow[];
  total: number;
  page: number;
  hasMore: boolean;
  scannerSetup: { database: boolean; openAi: boolean; stripe: boolean };
}
