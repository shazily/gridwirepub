export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_events: {
        Row: {
          audience: string
          body: string | null
          created_at: string
          email_status: string
          event_type: string
          id: string
          org_id: string
          recipients: string[]
          severity: string
          title: string
        }
        Insert: {
          audience?: string
          body?: string | null
          created_at?: string
          email_status?: string
          event_type: string
          id?: string
          org_id: string
          recipients?: string[]
          severity?: string
          title: string
        }
        Update: {
          audience?: string
          body?: string | null
          created_at?: string
          email_status?: string
          event_type?: string
          id?: string
          org_id?: string
          recipients?: string[]
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          created_at: string
          enabled: boolean
          event_type: string
          id: string
          org_id: string
          recipients: string[]
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_type: string
          id?: string
          org_id: string
          recipients?: string[]
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_type?: string
          id?: string
          org_id?: string
          recipients?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_ingest_notification_recipients: {
        Row: {
          created_at: string
          email: string
          id: string
          notify_on_failure: boolean
          notify_on_success: boolean
          org_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          notify_on_failure?: boolean
          notify_on_success?: boolean
          org_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          notify_on_failure?: boolean
          notify_on_success?: boolean
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_ingest_notification_recipients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          org_id: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          org_id: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_api_keys: {
        Row: {
          base_url: string | null
          created_at: string
          created_by: string | null
          id: string
          key_ciphertext: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          model: string | null
          name: string
          org_id: string
          provider: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key_ciphertext: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          model?: string | null
          name: string
          org_id: string
          provider?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          base_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key_ciphertext?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          model?: string | null
          name?: string
          org_id?: string
          provider?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "llm_api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          created_at: string
          dataset_id: string | null
          id: number
          ip: string | null
          metadata: Json
          org_id: string
          resource_id: string | null
          resource_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          dataset_id?: string | null
          id?: never
          ip?: string | null
          metadata?: Json
          org_id: string
          resource_id?: string | null
          resource_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          dataset_id?: string | null
          id?: never
          ip?: string | null
          metadata?: Json
          org_id?: string
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_runs: {
        Row: {
          connector_id: string
          created_at: string
          files_found: number
          files_ingested: number
          finished_at: string | null
          id: string
          kind: string
          message: string | null
          org_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          connector_id: string
          created_at?: string
          files_found?: number
          files_ingested?: number
          finished_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          org_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          connector_id?: string
          created_at?: string
          files_found?: number
          files_ingested?: number
          finished_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          org_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_runs_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          dataset_id: string | null
          enabled: boolean
          id: string
          last_run_at: string | null
          last_status: string | null
          last_test_at: string | null
          name: string
          org_id: string
          schedule: string | null
          secret_ref: string | null
          type: Database["public"]["Enums"]["connector_type"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          dataset_id?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_status?: string | null
          last_test_at?: string | null
          name: string
          org_id: string
          schedule?: string | null
          secret_ref?: string | null
          type: Database["public"]["Enums"]["connector_type"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          dataset_id?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_status?: string | null
          last_test_at?: string | null
          name?: string
          org_id?: string
          schedule?: string | null
          secret_ref?: string | null
          type?: Database["public"]["Enums"]["connector_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connectors_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connectors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consumption_events: {
        Row: {
          api_key_id: string | null
          created_at: string
          dataset_id: string | null
          endpoint: string
          id: number
          org_id: string
          row_count: number
          status_code: number
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          dataset_id?: string | null
          endpoint: string
          id?: number
          org_id: string
          row_count?: number
          status_code?: number
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          dataset_id?: string | null
          endpoint?: string
          id?: number
          org_id?: string
          row_count?: number
          status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "consumption_events_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumption_events_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumption_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dataset_fields: {
        Row: {
          api_name: string
          created_at: string
          data_type: string
          hash_algo: Database["public"]["Enums"]["field_hash_algo"]
          id: string
          included: boolean
          is_pii: boolean
          is_key: boolean
          masking: Database["public"]["Enums"]["field_masking"]
          nullable: boolean
          org_id: string
          original_name: string
          position: number
          sheet_name: string
          version_id: string
        }
        Insert: {
          api_name: string
          created_at?: string
          data_type?: string
          hash_algo?: Database["public"]["Enums"]["field_hash_algo"]
          id?: string
          included?: boolean
          is_pii?: boolean
          is_key?: boolean
          masking?: Database["public"]["Enums"]["field_masking"]
          nullable?: boolean
          org_id: string
          original_name: string
          position?: number
          sheet_name: string
          version_id: string
        }
        Update: {
          api_name?: string
          created_at?: string
          data_type?: string
          hash_algo?: Database["public"]["Enums"]["field_hash_algo"]
          id?: string
          included?: boolean
          is_pii?: boolean
          is_key?: boolean
          masking?: Database["public"]["Enums"]["field_masking"]
          nullable?: boolean
          org_id?: string
          original_name?: string
          position?: number
          sheet_name?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataset_fields_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataset_fields_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "dataset_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      dataset_rows: {
        Row: {
          data: Json
          id: number
          org_id: string
          row_index: number
          sheet_name: string
          version_id: string
        }
        Insert: {
          data?: Json
          id?: number
          org_id: string
          row_index: number
          sheet_name: string
          version_id: string
        }
        Update: {
          data?: Json
          id?: number
          org_id?: string
          row_index?: number
          sheet_name?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataset_rows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataset_rows_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "dataset_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      dataset_versions: {
        Row: {
          created_at: string
          created_by: string | null
          dataset_id: string
          diff_summary: Json | null
          file_name: string | null
          file_ref: string | null
          has_macros: boolean
          id: string
          is_baseline: boolean
          load_mode: Database["public"]["Enums"]["load_mode"]
          org_id: string
          row_count: number
          schema_snapshot: Json
          sheet_count: number
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dataset_id: string
          diff_summary?: Json | null
          file_name?: string | null
          file_ref?: string | null
          has_macros?: boolean
          id?: string
          is_baseline?: boolean
          load_mode?: Database["public"]["Enums"]["load_mode"]
          org_id: string
          row_count?: number
          schema_snapshot?: Json
          sheet_count?: number
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dataset_id?: string
          diff_summary?: Json | null
          file_name?: string | null
          file_ref?: string | null
          has_macros?: boolean
          id?: string
          is_baseline?: boolean
          load_mode?: Database["public"]["Enums"]["load_mode"]
          org_id?: string
          row_count?: number
          schema_snapshot?: Json
          sheet_count?: number
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "dataset_versions_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataset_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      datasets: {
        Row: {
          api_access: Database["public"]["Enums"]["api_access"]
          created_at: string
          created_by: string
          current_version_id: string | null
          description: string | null
          id: string
          name: string
          org_id: string
          slug: string
          source_type: Database["public"]["Enums"]["dataset_source_type"]
          status: Database["public"]["Enums"]["dataset_status"]
          updated_at: string
        }
        Insert: {
          api_access?: Database["public"]["Enums"]["api_access"]
          created_at?: string
          created_by?: string
          current_version_id?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
          slug: string
          source_type?: Database["public"]["Enums"]["dataset_source_type"]
          status?: Database["public"]["Enums"]["dataset_status"]
          updated_at?: string
        }
        Update: {
          api_access?: Database["public"]["Enums"]["api_access"]
          created_at?: string
          created_by?: string
          current_version_id?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          slug?: string
          source_type?: Database["public"]["Enums"]["dataset_source_type"]
          status?: Database["public"]["Enums"]["dataset_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "datasets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          category: string
          created_at: string
          id: string
          message: string
          org_id: string | null
          page_path: string | null
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          message: string
          org_id?: string | null
          page_path?: string | null
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          message?: string
          org_id?: string | null
          page_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_feedback: {
        Row: {
          category: string
          created_at: string
          email: string | null
          id: string
          message: string
          page_path: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          message: string
          page_path?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          page_path?: string | null
        }
        Relationships: []
      }
      org_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          note: string | null
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_org_role"]
          token: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          note?: string | null
          org_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_org_role"]
          token: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          note?: string | null
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_org_role"]
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          identity_source: Database["public"]["Enums"]["org_member_identity_source"]
          org_id: string
          role: Database["public"]["Enums"]["app_org_role"]
          user_id: string
          user_type: Database["public"]["Enums"]["org_member_user_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          identity_source?: Database["public"]["Enums"]["org_member_identity_source"]
          org_id: string
          role?: Database["public"]["Enums"]["app_org_role"]
          user_id: string
          user_type?: Database["public"]["Enums"]["org_member_user_type"]
        }
        Update: {
          created_at?: string
          id?: string
          identity_source?: Database["public"]["Enums"]["org_member_identity_source"]
          org_id?: string
          role?: Database["public"]["Enums"]["app_org_role"]
          user_id?: string
          user_type?: Database["public"]["Enums"]["org_member_user_type"]
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_config: Json
          created_at: string
          created_by: string
          id: string
          is_portal_default: boolean
          name: string
          portal_logo_url: string | null
          portal_platform_name: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          ai_config?: Json
          created_at?: string
          created_by?: string
          id?: string
          is_portal_default?: boolean
          name: string
          portal_logo_url?: string | null
          portal_platform_name?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          ai_config?: Json
          created_at?: string
          created_by?: string
          id?: string
          is_portal_default?: boolean
          name?: string
          portal_logo_url?: string | null
          portal_platform_name?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_notification_reads: {
        Row: {
          last_read_at: string
          org_id: string
          user_id: string
        }
        Insert: {
          last_read_at?: string
          org_id: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_reads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_org_invite: { Args: { _token: string }; Returns: string }
      create_org_invite: {
        Args: {
          _expires_at?: string
          _max_uses?: number
          _note?: string
          _org: string
          _role?: Database["public"]["Enums"]["app_org_role"]
        }
        Returns: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          note: string | null
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_org_role"]
          token: string
          use_count: number
        }
        SetofOptions: {
          from: "*"
          to: "org_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization: {
        Args: { _name: string; _slug: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_invite_preview: { Args: { _token: string }; Returns: Json }
      get_org_role: {
        Args: { _org: string }
        Returns: Database["public"]["Enums"]["app_org_role"]
      }
      get_public_portal_branding: { Args: { _slug: string }; Returns: Json }
      has_org_role: {
        Args: {
          _org: string
          _roles: Database["public"]["Enums"]["app_org_role"][]
        }
        Returns: boolean
      }
      invite_member_by_email: {
        Args: {
          _email: string
          _org: string
          _role: Database["public"]["Enums"]["app_org_role"]
        }
        Returns: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_org_role"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "org_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      log_audit_event: {
        Args: {
          _action: string
          _dataset_id?: string
          _metadata?: Json
          _org: string
          _resource_id?: string
          _resource_type?: string
        }
        Returns: undefined
      }
      shares_org_with: { Args: { _other: string }; Returns: boolean }
      update_org_member_role: {
        Args: {
          _member_id: string
          _new_role: Database["public"]["Enums"]["app_org_role"]
        }
        Returns: {
          created_at: string
          id: string
          identity_source: Database["public"]["Enums"]["org_member_identity_source"]
          org_id: string
          role: Database["public"]["Enums"]["app_org_role"]
          user_id: string
          user_type: Database["public"]["Enums"]["org_member_user_type"]
        }
        SetofOptions: {
          from: "*"
          to: "org_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_org_member_user_type: {
        Args: {
          _member_id: string
          _user_type: Database["public"]["Enums"]["org_member_user_type"]
        }
        Returns: {
          created_at: string
          id: string
          identity_source: Database["public"]["Enums"]["org_member_identity_source"]
          org_id: string
          role: Database["public"]["Enums"]["app_org_role"]
          user_id: string
          user_type: Database["public"]["Enums"]["org_member_user_type"]
        }
      }
    }
    Enums: {
      api_access: "secure" | "public"
      app_org_role: "owner" | "admin" | "member" | "viewer" | "contributor"
      connector_type: "sftp" | "nfs" | "folder"
      dataset_source_type: "upload" | "sftp" | "nfs" | "folder"
      dataset_status: "draft" | "published" | "archived"
      field_hash_algo:
        | "sha256"
        | "sha512"
        | "sha3_256"
        | "sha3_512"
        | "hmac_sha256"
        | "hmac_sha512"
      field_masking: "none" | "mask" | "hash" | "encrypt"
      load_mode: "full" | "incremental"
      org_member_identity_source: "local" | "sso"
      org_member_user_type: "internal" | "external"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      api_access: ["secure", "public"],
      app_org_role: ["owner", "admin", "member", "viewer", "contributor"],
      connector_type: ["sftp", "nfs", "folder"],
      dataset_source_type: ["upload", "sftp", "nfs", "folder"],
      dataset_status: ["draft", "published", "archived"],
      field_hash_algo: [
        "sha256",
        "sha512",
        "sha3_256",
        "sha3_512",
        "hmac_sha256",
        "hmac_sha512",
      ],
      field_masking: ["none", "mask", "hash", "encrypt"],
      load_mode: ["full", "incremental"],
      org_member_identity_source: ["local", "sso"],
      org_member_user_type: ["internal", "external"],
    },
  },
} as const
