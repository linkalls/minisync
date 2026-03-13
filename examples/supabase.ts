import { createClient } from "@supabase/supabase-js";
import { SupabaseSyncBackend, supabaseSqlSetup } from "../src";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export const backend = new SupabaseSyncBackend({ client: supabase });

export const sqlSetup = supabaseSqlSetup();
