import { supabase } from '../SupabaseClient';

const LOCAL_ACTIVITY_KEY = 'lankastay_user_activity_v1';

function readLocalActivity() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ACTIVITY_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLocalActivity(items) {
  try {
    localStorage.setItem(LOCAL_ACTIVITY_KEY, JSON.stringify(items.slice(0, 30)));
  } catch {}
}

export async function recordActivity({ action, item, placeKey = null, userId = null }) {
  const entry = {
    id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
    action,
    item,
    place_key: placeKey,
    created_at: new Date().toISOString(),
  };

  const currentLocal = readLocalActivity();
  writeLocalActivity([entry, ...currentLocal]);

  try {
    let uid = userId;
    if (!uid && supabase?.auth) {
      const { data } = await supabase.auth.getUser();
      uid = data?.user?.id || null;
    }

    if (uid && supabase) {
      const { data: inserted, error } = await supabase
        .from('user_activity')
        .insert([
          {
            user_id: uid,
            action,
            item,
            place_key: placeKey,
          },
        ])
        .select()
        .single();

      if (!error && inserted) {
        return inserted;
      }
    }
  } catch (err) {
    console.warn('Activity DB log fallback to local:', err);
  }

  return entry;
}

export async function loadActivity(userId = null) {
  const localItems = readLocalActivity();

  try {
    let uid = userId;
    if (!uid && supabase?.auth) {
      const { data } = await supabase.auth.getSession();
      uid = data?.session?.user?.id || null;
    }

    if (uid && supabase) {
      const { data, error } = await supabase
        .from('user_activity')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!error && Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn('Activity load fallback to local:', err);
  }

  return localItems;
}

export function formatRelativeTime(isoString) {
  if (!isoString) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}