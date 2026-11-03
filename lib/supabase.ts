import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kvohlfnfbnhkxbmwfzju.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || 'sb_publishable_YbWiI56yGTapU_4ZHTHpsg_Eenr2vXu';

export const supabase = createClient(supabaseUrl, supabaseKey);
