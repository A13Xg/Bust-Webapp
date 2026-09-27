/*
 * Generated. Do not hand-edit — regenerate after any schema change:
 *   supabase gen types typescript --linked > supabase/functions/_shared/database.types.ts
 *
 * Threading this through createClient<Database>(...) is what makes
 * `deno check` (npm run typecheck:functions, already in CI) catch a wrong
 * table/column name or a bad .rpc() signature at typecheck time instead of
 * silently shipping — createClient() with no type param accepts any string
 * as a table name.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      achievement_catalog: {
        Row: {
          id: string;
        };
        Insert: {
          id: string;
        };
        Update: {
          id?: string;
        };
        Relationships: [];
      };
      achievements: {
        Row: {
          achievement_type: string;
          id: string;
          unlocked_at: string;
          user_id: string;
        };
        Insert: {
          achievement_type: string;
          id?: string;
          unlocked_at?: string;
          user_id: string;
        };
        Update: {
          achievement_type?: string;
          id?: string;
          unlocked_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'achievements_achievement_type_fkey';
            columns: ['achievement_type'];
            isOneToOne: false;
            referencedRelation: 'achievement_catalog';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'achievements_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      busts: {
        Row: {
          btc_usd: number | null;
          city: string | null;
          elevation_ft: number | null;
          id: string;
          lat: number | null;
          long: number | null;
          note: string | null;
          pressure: number | null;
          temp_f: number | null;
          tide_ft: number | null;
          time_bucket: string;
          timestamp: string;
          user_id: string;
        };
        Insert: {
          btc_usd?: number | null;
          city?: string | null;
          elevation_ft?: number | null;
          id?: string;
          lat?: number | null;
          long?: number | null;
          note?: string | null;
          pressure?: number | null;
          temp_f?: number | null;
          tide_ft?: number | null;
          time_bucket: string;
          timestamp?: string;
          user_id: string;
        };
        Update: {
          btc_usd?: number | null;
          city?: string | null;
          elevation_ft?: number | null;
          id?: string;
          lat?: number | null;
          long?: number | null;
          note?: string | null;
          pressure?: number | null;
          temp_f?: number | null;
          tide_ft?: number | null;
          time_bucket?: string;
          timestamp?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'busts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      inactivity_reminders: {
        Row: {
          cycle_bust_at: string;
          last_message_index: number | null;
          last_sent_at: string | null;
          scheduled_for: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cycle_bust_at: string;
          last_message_index?: number | null;
          last_sent_at?: string | null;
          scheduled_for?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cycle_bust_at?: string;
          last_message_index?: number | null;
          last_sent_at?: string | null;
          scheduled_for?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'inactivity_reminders_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_seed: string;
          created_at: string;
          id: string;
          last_bust_timestamp: string | null;
          showcase: string | null;
          tagline: string | null;
          username: string;
        };
        Insert: {
          avatar_seed: string;
          created_at?: string;
          id: string;
          last_bust_timestamp?: string | null;
          showcase?: string | null;
          tagline?: string | null;
          username: string;
        };
        Update: {
          avatar_seed?: string;
          created_at?: string;
          id?: string;
          last_bust_timestamp?: string | null;
          showcase?: string | null;
          tagline?: string | null;
          username?: string;
        };
        Relationships: [];
      };
      push_deliveries: {
        Row: {
          acked_at: string | null;
          actor_id: string | null;
          batch_id: string;
          id: number;
          kind: string;
          receipt_id: string;
          recipient_id: string | null;
          sent_at: string;
          subscription_id: number | null;
          title: string;
        };
        Insert: {
          acked_at?: string | null;
          actor_id?: string | null;
          batch_id: string;
          id?: never;
          kind: string;
          receipt_id?: string;
          recipient_id?: string | null;
          sent_at?: string;
          subscription_id?: number | null;
          title?: string;
        };
        Update: {
          acked_at?: string | null;
          actor_id?: string | null;
          batch_id?: string;
          id?: never;
          kind?: string;
          receipt_id?: string;
          recipient_id?: string | null;
          sent_at?: string;
          subscription_id?: number | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_deliveries_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_deliveries_recipient_id_fkey';
            columns: ['recipient_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      push_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          delivered: number;
          dispatched_at: string | null;
          id: number;
          kind: string;
          recipients: number;
          source_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          delivered?: number;
          dispatched_at?: string | null;
          id?: never;
          kind: string;
          recipients?: number;
          source_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          delivered?: number;
          dispatched_at?: string | null;
          id?: never;
          kind?: string;
          recipients?: number;
          source_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          failure_count: number;
          id: number;
          last_ack_at: string | null;
          last_success_at: string | null;
          p256dh: string;
          unacked_count: number;
          updated_at: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          failure_count?: number;
          id?: never;
          last_ack_at?: string | null;
          last_success_at?: string | null;
          p256dh: string;
          unacked_count?: number;
          updated_at?: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          failure_count?: number;
          id?: never;
          last_ack_at?: string | null;
          last_success_at?: string | null;
          p256dh?: string;
          unacked_count?: number;
          updated_at?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      bump_push_failure: {
        Args: { subscription_ids: number[] };
        Returns: number;
      };
      mark_push_sent: {
        Args: { subscription_ids: number[] };
        Returns: undefined;
      };
      prune_dead_push_subscriptions: {
        Args: {
          min_age?: string;
          never_acked_after?: number;
          silent_for?: string;
          went_silent_after?: number;
        };
        Returns: number;
      };
      push_subscription_health: {
        Args: never;
        Returns: {
          acked_total: number;
          created_at: string;
          failure_count: number;
          host: string;
          id: number;
          last_ack_at: string;
          last_success_at: string;
          sent_total: number;
          unacked_count: number;
          user_agent: string;
          user_id: string;
        }[];
      };
      record_push_ack: { Args: { receipt: string }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views']
    )
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views']
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (
    & DefaultSchema['Tables']
    & DefaultSchema['Views']
  ) ? (
      & DefaultSchema['Tables']
      & DefaultSchema['Views']
    )[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
