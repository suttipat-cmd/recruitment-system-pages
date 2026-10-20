// Example schema only. Replace with the owner's generated Database types if different.
export type Item = { id: string; title: string; created_at: string };
export type Database = {
  public: {
    Tables: {
      items: {
        Row: Item;
        Insert: { title: string; id?: string; created_at?: string };
        Update: { title?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
