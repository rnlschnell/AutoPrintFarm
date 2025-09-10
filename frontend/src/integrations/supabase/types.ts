export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instanciate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      accessories_inventory: {
        Row: {
          brand: string | null
          cost_per_unit: number | null
          created_at: string | null
          diameter: string | null
          id: string
          location: string | null
          low_threshold: number | null
          remaining_units: number
          reorder_link: string | null
          status: string | null
          tenant_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          brand?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          diameter?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_units?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          brand?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          diameter?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_units?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accessories_inventory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assembly_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          finished_good_id: string
          id: string
          notes: string | null
          product_name: string
          quantity: number
          sku: string
          status: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          finished_good_id: string
          id?: string
          notes?: string | null
          product_name: string
          quantity?: number
          sku: string
          status?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          finished_good_id?: string
          id?: string
          notes?: string | null
          product_name?: string
          quantity?: number
          sku?: string
          status?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assembly_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_tasks_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      color_presets: {
        Row: {
          color_name: string
          created_at: string | null
          filament_type: string
          hex_code: string
          id: string
          is_active: boolean | null
          tenant_id: string
        }
        Insert: {
          color_name: string
          created_at?: string | null
          filament_type: string
          hex_code: string
          id?: string
          is_active?: boolean | null
          tenant_id: string
        }
        Update: {
          color_name?: string
          created_at?: string | null
          filament_type?: string
          hex_code?: string
          id?: string
          is_active?: boolean | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "color_presets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_analytics: {
        Row: {
          active_printers: number | null
          average_job_time_minutes: number | null
          created_at: string | null
          date: string
          id: string
          labor_cost: number | null
          materials_cost: number | null
          overhead_cost: number | null
          print_completion_percentage: number | null
          profit: number | null
          revenue: number | null
          tenant_id: string
          time_saved_minutes: number | null
          total_printers: number | null
          units_produced: number | null
          utilization_percentage: number | null
        }
        Insert: {
          active_printers?: number | null
          average_job_time_minutes?: number | null
          created_at?: string | null
          date: string
          id?: string
          labor_cost?: number | null
          materials_cost?: number | null
          overhead_cost?: number | null
          print_completion_percentage?: number | null
          profit?: number | null
          revenue?: number | null
          tenant_id: string
          time_saved_minutes?: number | null
          total_printers?: number | null
          units_produced?: number | null
          utilization_percentage?: number | null
        }
        Update: {
          active_printers?: number | null
          average_job_time_minutes?: number | null
          created_at?: string | null
          date?: string
          id?: string
          labor_cost?: number | null
          materials_cost?: number | null
          overhead_cost?: number | null
          print_completion_percentage?: number | null
          profit?: number | null
          revenue?: number | null
          tenant_id?: string
          time_saved_minutes?: number | null
          total_printers?: number | null
          units_produced?: number | null
          utilization_percentage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_analytics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      filament_inventory: {
        Row: {
          brand: string | null
          color: string
          cost_per_unit: number | null
          created_at: string | null
          diameter: string | null
          id: string
          location: string | null
          low_threshold: number | null
          remaining_grams: number
          reorder_link: string | null
          status: string | null
          tenant_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          brand?: string | null
          color: string
          cost_per_unit?: number | null
          created_at?: string | null
          diameter?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_grams?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          brand?: string | null
          color?: string
          cost_per_unit?: number | null
          created_at?: string | null
          diameter?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_grams?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "filament_inventory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      finished_goods: {
        Row: {
          assembly_status: string | null
          color: string
          created_at: string | null
          current_stock: number
          extra_cost: number | null
          id: string
          image_url: string | null
          is_active: boolean | null
          low_stock_threshold: number | null
          material: string
          print_job_id: string | null
          product_sku_id: string | null
          profit_margin: number | null
          quantity_per_sku: number | null
          sku: string
          status: string | null
          tenant_id: string
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          assembly_status?: string | null
          color: string
          created_at?: string | null
          current_stock?: number
          extra_cost?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          low_stock_threshold?: number | null
          material: string
          print_job_id?: string | null
          product_sku_id?: string | null
          profit_margin?: number | null
          quantity_per_sku?: number | null
          sku: string
          status?: string | null
          tenant_id: string
          unit_price: number
          updated_at?: string | null
        }
        Update: {
          assembly_status?: string | null
          color?: string
          created_at?: string | null
          current_stock?: number
          extra_cost?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          low_stock_threshold?: number | null
          material?: string
          print_job_id?: string | null
          product_sku_id?: string | null
          profit_margin?: number | null
          quantity_per_sku?: number | null
          sku?: string
          status?: string | null
          tenant_id?: string
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_product_sku_id_fkey"
            columns: ["product_sku_id"]
            isOneToOne: false
            referencedRelation: "product_skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          finished_good_id: string | null
          id: string
          order_id: string
          product_name: string
          quantity: number
          sku: string
          tenant_id: string
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          finished_good_id?: string | null
          id?: string
          order_id: string
          product_name: string
          quantity: number
          sku: string
          tenant_id: string
          total_price: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          finished_good_id?: string | null
          id?: string
          order_id?: string
          product_name?: string
          quantity?: number
          sku?: string
          tenant_id?: string
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_finished_good_id_fkey"
            columns: ["finished_good_id"]
            isOneToOne: false
            referencedRelation: "finished_goods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          id: string
          order_date: string | null
          order_number: string | null
          platform: string | null
          shipping_city: string | null
          shipping_cost: number | null
          shipping_country: string | null
          shipping_state: string | null
          shipping_street: string | null
          shipping_zip: string | null
          sku: string | null
          status: string | null
          subtotal: number | null
          tenant_id: string | null
          total_revenue: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          order_date?: string | null
          order_number?: string | null
          platform?: string | null
          shipping_city?: string | null
          shipping_cost?: number | null
          shipping_country?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          shipping_zip?: string | null
          sku?: string | null
          status?: string | null
          subtotal?: number | null
          tenant_id?: string | null
          total_revenue?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          order_date?: string | null
          order_number?: string | null
          platform?: string | null
          shipping_city?: string | null
          shipping_cost?: number | null
          shipping_country?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          shipping_zip?: string | null
          sku?: string | null
          status?: string | null
          subtotal?: number | null
          tenant_id?: string | null
          total_revenue?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_inventory: {
        Row: {
          brand: string | null
          cost_per_unit: number | null
          created_at: string | null
          id: string
          location: string | null
          low_threshold: number | null
          remaining_units: number
          reorder_link: string | null
          status: string | null
          tenant_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          brand?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_units?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          brand?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_units?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packaging_inventory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_file_versions: {
        Row: {
          created_at: string | null
          file_url: string | null
          id: string
          is_current_version: boolean | null
          notes: string | null
          print_file_id: string
          version_number: number | null
        }
        Insert: {
          created_at?: string | null
          file_url?: string | null
          id?: string
          is_current_version?: boolean | null
          notes?: string | null
          print_file_id: string
          version_number?: number | null
        }
        Update: {
          created_at?: string | null
          file_url?: string | null
          id?: string
          is_current_version?: boolean | null
          notes?: string | null
          print_file_id?: string
          version_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "print_file_versions_print_file_id_fkey"
            columns: ["print_file_id"]
            isOneToOne: false
            referencedRelation: "print_files"
            referencedColumns: ["id"]
          },
        ]
      }
      print_files: {
        Row: {
          created_at: string | null
          file_size_bytes: number | null
          id: string
          name: string
          number_of_units: number | null
          product_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          file_size_bytes?: number | null
          id?: string
          name: string
          number_of_units?: number | null
          product_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          file_size_bytes?: number | null
          id?: string
          name?: string
          number_of_units?: number | null
          product_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_files_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          actual_print_time_minutes: number | null
          color: string
          created_at: string | null
          estimated_print_time_minutes: number | null
          failure_reason: string | null
          filament_needed_grams: number | null
          filament_type: string
          file_name: string
          id: string
          material_type: string
          number_of_units: number
          print_file_id: string
          printer_id: string | null
          priority: number | null
          product_sku_id: string | null
          progress_percentage: number | null
          status: string | null
          submitted_by: string | null
          tenant_id: string
          time_completed: string | null
          time_started: string | null
          time_submitted: string | null
          updated_at: string | null
        }
        Insert: {
          actual_print_time_minutes?: number | null
          color: string
          created_at?: string | null
          estimated_print_time_minutes?: number | null
          failure_reason?: string | null
          filament_needed_grams?: number | null
          filament_type: string
          file_name: string
          id?: string
          material_type: string
          number_of_units?: number
          print_file_id: string
          printer_id?: string | null
          priority?: number | null
          product_sku_id?: string | null
          progress_percentage?: number | null
          status?: string | null
          submitted_by?: string | null
          tenant_id: string
          time_completed?: string | null
          time_started?: string | null
          time_submitted?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_print_time_minutes?: number | null
          color?: string
          created_at?: string | null
          estimated_print_time_minutes?: number | null
          failure_reason?: string | null
          filament_needed_grams?: number | null
          filament_type?: string
          file_name?: string
          id?: string
          material_type?: string
          number_of_units?: number
          print_file_id?: string
          printer_id?: string | null
          priority?: number | null
          product_sku_id?: string | null
          progress_percentage?: number | null
          status?: string | null
          submitted_by?: string | null
          tenant_id?: string
          time_completed?: string | null
          time_started?: string | null
          time_submitted?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_print_file_id_fkey"
            columns: ["print_file_id"]
            isOneToOne: false
            referencedRelation: "print_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_product_sku_id_fkey"
            columns: ["product_sku_id"]
            isOneToOne: false
            referencedRelation: "product_skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      printer_parts_inventory: {
        Row: {
          brand: string | null
          cost_per_unit: number | null
          created_at: string | null
          id: string
          location: string | null
          low_threshold: number | null
          remaining_units: number
          reorder_link: string | null
          status: string | null
          tenant_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          brand?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_units?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          brand?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          id?: string
          location?: string | null
          low_threshold?: number | null
          remaining_units?: number
          reorder_link?: string | null
          status?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "printer_parts_inventory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          access_code: string | null
          connection_error: string | null
          connection_type: string | null
          created_at: string | null
          current_color: string | null
          current_color_hex: string | null
          current_filament_type: string | null
          firmware_version: string | null
          id: string
          ip_address: string | null
          is_active: boolean | null
          is_connected: boolean | null
          last_connection_attempt: string | null
          last_maintenance_date: string | null
          location: string | null
          manufacturer: string | null
          model: string
          name: string
          printer_id: number | null
          serial_number: string | null
          sort_order: number | null
          status: string | null
          tenant_id: string
          total_print_time: number | null
          updated_at: string | null
        }
        Insert: {
          access_code?: string | null
          connection_error?: string | null
          connection_type?: string | null
          created_at?: string | null
          current_color?: string | null
          current_color_hex?: string | null
          current_filament_type?: string | null
          firmware_version?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          is_connected?: boolean | null
          last_connection_attempt?: string | null
          last_maintenance_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model: string
          name: string
          printer_id?: number | null
          serial_number?: string | null
          sort_order?: number | null
          status?: string | null
          tenant_id: string
          total_print_time?: number | null
          updated_at?: string | null
        }
        Update: {
          access_code?: string | null
          connection_error?: string | null
          connection_type?: string | null
          created_at?: string | null
          current_color?: string | null
          current_color_hex?: string | null
          current_filament_type?: string | null
          firmware_version?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean | null
          is_connected?: boolean | null
          last_connection_attempt?: string | null
          last_maintenance_date?: string | null
          location?: string | null
          manufacturer?: string | null
          model?: string
          name?: string
          printer_id?: number | null
          serial_number?: string | null
          sort_order?: number | null
          status?: string | null
          tenant_id?: string
          total_print_time?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "printers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_components: {
        Row: {
          component_name: string
          component_type: string | null
          created_at: string | null
          id: string
          notes: string | null
          product_id: string
          quantity_required: number
          tenant_id: string
        }
        Insert: {
          component_name: string
          component_type?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          product_id: string
          quantity_required?: number
          tenant_id: string
        }
        Update: {
          component_name?: string
          component_type?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          quantity_required?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_product_components_product_id"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_skus: {
        Row: {
          color: string
          created_at: string | null
          filament_type: string | null
          hex_code: string | null
          id: string
          is_active: boolean | null
          price: number | null
          product_id: string
          quantity: number
          sku: string
          stock_level: number
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          color: string
          created_at?: string | null
          filament_type?: string | null
          hex_code?: string | null
          id?: string
          is_active?: boolean | null
          price?: number | null
          product_id: string
          quantity?: number
          sku: string
          stock_level?: number
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          filament_type?: string | null
          hex_code?: string | null
          id?: string
          is_active?: boolean | null
          price?: number | null
          product_id?: string
          quantity?: number
          sku?: string
          stock_level?: number
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_product_skus_product_id"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          file_name: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          print_file_id: string | null
          requires_assembly: boolean | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          file_name?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          print_file_id?: string | null
          requires_assembly?: boolean | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          file_name?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          print_file_id?: string | null
          requires_assembly?: boolean | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          first_name: string
          id: string
          is_active: boolean | null
          last_login: string | null
          last_name: string | null
          role: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name: string
          id: string
          is_active?: boolean | null
          last_login?: string | null
          last_name?: string | null
          role?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          last_name?: string | null
          role?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          company_name: string
          created_at: string | null
          id: string
          is_active: boolean | null
          subdomain: string
          updated_at: string | null
        }
        Insert: {
          company_name: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          subdomain: string
          updated_at?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          subdomain?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      worklist_tasks: {
        Row: {
          actual_time_minutes: number | null
          assembly_task_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          estimated_time_minutes: number | null
          id: string
          metadata: Json | null
          order_number: string | null
          printer_id: string | null
          priority: string | null
          started_at: string | null
          status: string | null
          subtitle: string | null
          task_type: string
          tenant_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          actual_time_minutes?: number | null
          assembly_task_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          estimated_time_minutes?: number | null
          id?: string
          metadata?: Json | null
          order_number?: string | null
          printer_id?: string | null
          priority?: string | null
          started_at?: string | null
          status?: string | null
          subtitle?: string | null
          task_type: string
          tenant_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          actual_time_minutes?: number | null
          assembly_task_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          estimated_time_minutes?: number | null
          id?: string
          metadata?: Json | null
          order_number?: string | null
          printer_id?: string | null
          priority?: string | null
          started_at?: string | null
          status?: string | null
          subtitle?: string | null
          task_type?: string
          tenant_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_unique_subdomain: {
        Args: { company_name_input: string }
        Returns: string
      }
      get_next_printer_id: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      get_user_tenant_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      is_admin: {
        Args: { user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
